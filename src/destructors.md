# デストラクタ {#destructors}

言語が*実際に*用意しているのは、`Drop` トレイトによる本格的な自動デストラクタです。このトレイトには次のメソッドがあります。

<!-- ignore: function header -->
```rust,ignore
fn drop(&mut self);
```

このメソッドは、していたことを何らかの形で終わらせる時間を型に与えます。

**`drop` が実行された後、Rust は `self` のすべてのフィールドを再帰的にドロップしようとします。**

これは、子をドロップするための「デストラクタの決まり文句」を書かなくて済むようにする便利な機能です。構造体に、子をドロップすること以外にドロップ時の特別な処理が無ければ、`Drop` を実装する必要はまったくありません。

**Rust 1.0 には、この振る舞いを防ぐ安定した方法がありません。**

なお、`&mut self` を受け取るということは、たとえ再帰的な Drop を抑えられたとしても、たとえば self からフィールドをムーブすることを Rust が防ぐ、ということです。ほとんどの型では、これでまったく問題ありません。

たとえば、`Box` を独自に実装するなら、`Drop` を次のように書くかもしれません。

```rust
use std::alloc::{Allocator, Global, GlobalAlloc, Layout};
use std::marker::PhantomData;
use std::mem;
use std::ptr::{drop_in_place, NonNull};

struct Box<T>{ ptr: NonNull<T>, _marker: PhantomData<T> }

impl<T> Drop for Box<T> {
    fn drop(&mut self) {
        unsafe {
            drop_in_place(self.ptr.as_ptr());
            Global.deallocate(self.ptr.cast(), Layout::new::<T>())
        }
    }
}
# fn main() {}
```

これがうまく動くのは、Rust がフィールドをドロップしに行ったときに目にするのが [`NonNull`] と [`PhantomData`] だけで、どちらも実際の `Drop` の実装を持たないからです。同じように、何かが `ptr` を解放後に使用（use-after-free）することもありません。drop を抜けると、`ptr` にはアクセスできなくなるからです。

しかし、次のコードはうまく動きません。

```rust
use std::alloc::{Allocator, Global, GlobalAlloc, Layout};
use std::marker::PhantomData;
use std::ptr::{drop_in_place, NonNull};
use std::mem;

struct Box<T>{ ptr: NonNull<T>, _marker: PhantomData<T> }

impl<T> Drop for Box<T> {
    fn drop(&mut self) {
        unsafe {
            drop_in_place(self.ptr.as_ptr());
            Global.deallocate(self.ptr.cast(), Layout::new::<T>());
        }
    }
}

struct SuperBox<T> { my_box: Box<T> }

impl<T> Drop for SuperBox<T> {
    fn drop(&mut self) {
        unsafe {
            // Hyper-optimized: deallocate the box's contents for it
            // without `drop`ing the contents
            Global.deallocate(self.my_box.ptr.cast::<u8>(), Layout::new::<T>());
        }
    }
}
# fn main() {}
```

SuperBox のデストラクタで `box` の ptr を解放した後、Rust は何食わぬ顔で、box に自分自身を Drop するよう指示します。そして、解放後の使用と二重解放で、すべてが吹き飛びます。

なお、再帰的なドロップの振る舞いは、Drop を実装しているかどうかに関係なく、すべての構造体と列挙型に当てはまります。そのため、次のようなものは、

```rust
struct Boxy<T> {
    data1: Box<T>,
    data2: Box<T>,
    info: u32,
}
```

それ自身が Drop を実装していなくても、ドロップ「されるはず」のときには必ず、`data1` と `data2` のフィールドのデストラクタが呼ばれます。こうした型は、それ自身は Drop ではなくても、*Drop を必要とする*（needs Drop）と言います。

同じように、

```rust
enum Link {
    Next(Box<Link>),
    None,
}
```

は、インスタンスが Next のバリアントを持っている場合に限り、内側の Box のフィールドがドロップされます。

一般に、これはとてもうまく働きます。データレイアウトを作り変えるときに、ドロップの追加や削除を気にする必要が無いからです。それでも、デストラクタでもっと込み入ったことをする必要がある、正当な使い道がたくさんあるのは確かです。

再帰的なドロップを上書きし、`drop` の間に Self からムーブできるようにする、昔からある安全な解決策は、Option を使うことです。

```rust
use std::alloc::{Allocator, GlobalAlloc, Global, Layout};
use std::marker::PhantomData;
use std::ptr::{drop_in_place, NonNull};
use std::mem;

struct Box<T>{ ptr: NonNull<T>, _marker: PhantomData<T> }

impl<T> Drop for Box<T> {
    fn drop(&mut self) {
        unsafe {
            drop_in_place(self.ptr.as_ptr());
            Global.deallocate(self.ptr.cast(), Layout::new::<T>());
        }
    }
}

struct SuperBox<T> { my_box: Option<Box<T>> }

impl<T> Drop for SuperBox<T> {
    fn drop(&mut self) {
        unsafe {
            // Hyper-optimized: deallocate the box's contents for it
            // without `drop`ing the contents. Need to set the `box`
            // field as `None` to prevent Rust from trying to Drop it.
            let my_box = self.my_box.take().unwrap();
            Global.deallocate(my_box.ptr.cast(), Layout::new::<T>());
            mem::forget(my_box);
        }
    }
}
# fn main() {}
```

しかし、これにはかなり奇妙な意味論があります。常に Some で*あるべき*フィールドが、デストラクタで起きることのためだけに、None で*ありうる*と言っているのです。もちろん、逆に考えれば、これは大いに筋が通っています。デストラクタの間は self に対して任意のメソッドを呼び出せるので、フィールドを未初期化に戻した後にそうすることを、これで防げるはずです。もっとも、そこでほかの任意の不正な状態を作り出すことまで防いでくれるわけではありません。

全体として見れば、これは悪くない選択です。間違いなく、まず最初に手を伸ばすべきものです。しかし将来は、フィールドを自動的にドロップすべきでないと宣言する、第一級の方法ができると見込んでいます。

[`NonNull`]: https://doc.rust-lang.org/std/ptr/struct.NonNull.html
[`PhantomData`]: phantom-data.html
