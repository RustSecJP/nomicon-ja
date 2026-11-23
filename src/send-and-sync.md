# Send と Sync {#send-and-sync}

もっとも、すべてのものが継承可変性（inherited mutability）に従うわけではありません。型によっては、あるメモリ位置を変更しながら、その位置への複数のエイリアスを持つことを許します。こうした型は、同期を使ってこのアクセスを管理していない限り、決してスレッド安全ではありません。Rust はこのことを、`Send` と `Sync` というトレイトで表現します。

* 別のスレッドに送っても安全な型は Send です。
* スレッド間で共有しても安全な型は Sync です（`&T` が Send であるとき、かつそのときに限り、T は Sync です）。

Send と Sync は、Rust の並行性の根幹をなすものです。そのため、これらを正しく機能させるための特別な仕組みが数多く存在します。何よりもまず、これらは [unsafe なトレイト][unsafe traits]です。つまり、実装することが unsafe であり、ほかの unsafe なコードは、これらが正しく実装されていると仮定できます。これらは*マーカートレイト*（marker trait。メソッドのような関連アイテムを持たないトレイト）なので、正しく実装されているというのは、実装する型が持つべき本来の性質を持っているということにすぎません。Send や Sync を誤って実装すると、未定義動作（undefined behavior）を引き起こす可能性があります。

Send と Sync は、自動的に導出されるトレイトでもあります。つまり、ほかのどのトレイトとも違って、ある型が Send または Sync な型だけで構成されていれば、その型は Send または Sync になります。ほとんどすべてのプリミティブは Send かつ Sync であり、その結果、あなたが扱うことになる型のほぼすべてが Send かつ Sync です。

主な例外は次のとおりです。

* 生ポインタは Send でも Sync でもありません（安全のための防護が無いためです）。
* `UnsafeCell` は Sync ではありません（したがって `Cell` と `RefCell` も Sync ではありません）。
* `Rc` は Send でも Sync でもありません（参照カウントが共有されており、同期されていないためです）。

`Rc` と `UnsafeCell` は、ごく根本的にスレッド安全ではありません。同期されていない共有の可変状態を可能にするものだからです。一方、生ポインタは、厳密に言えば、どちらかというと*リント*（lint）としてスレッド安全でないと印を付けられています。生ポインタで何か役に立つことをするには参照外しが必要で、それはすでに unsafe です。その意味では、生ポインタにスレッド安全の印が付いていても「構わない」と主張することもできるでしょう。

しかし、生ポインタを含む型が自動的にスレッド安全と印付けされるのを防ぐために、生ポインタがスレッド安全でないことは重要です。そうした型は、追跡されない自明でない所有権を持っており、その作者がスレッド安全性について必ずしも真剣に考えていたとは考えにくいからです。`Rc` は、`*mut` を含んでいて、間違いなくスレッド安全ではない型の良い例です。

自動的に導出されない型は、望むなら単にこれらを実装できます。

```rust
struct MyBox(*mut u8);

unsafe impl Send for MyBox {}
unsafe impl Sync for MyBox {}
```

ある型が不適切に Send や Sync として自動導出されてしまうという*信じられないほどまれな*場合には、Send と Sync の実装を取り消すこともできます。

```rust
#![feature(negative_impls)]

// I have some magic semantics for some synchronization primitive!
struct SpecialThreadToken(u8);

impl !Send for SpecialThreadToken {}
impl !Sync for SpecialThreadToken {}
```

なお、*それ自体としては*、Send や Sync を誤って導出することは不可能です。誤って Send や Sync になることで問題を起こしうるのは、ほかの unsafe なコードによって特別な意味を与えられている型だけです。

生ポインタの使用のほとんどは、Send と Sync を導出できるだけの十分な抽象化の背後に閉じ込めるべきです。たとえば、Rust の標準のコレクションは、割り当てや複雑な所有権の管理に生ポインタを至るところで使っているにもかかわらず、（Send かつ Sync な型を格納している場合には）すべて Send かつ Sync です。同様に、これらのコレクションへのイテレータのほとんどは、おおむねコレクションへの `&` や `&mut` のように振る舞うので、Send かつ Sync です。

## 例 {#example}

[`Box`][box-doc] は、[さまざまな理由][box-is-special]から、コンパイラによって独自の特別な組み込み型として実装されています。しかし、それに似た振る舞いをするものを自分たちで実装して、Send と Sync を実装することが健全である場合の例を見ることはできます。これを `Carton` と呼ぶことにしましょう。

まず、スタックに割り当てられた値を受け取り、それをヒープへ移すコードを書きます。

```rust
# pub mod libc {
#    pub use ::std::os::raw::{c_int, c_void};
#    #[allow(non_camel_case_types)]
#    pub type size_t = usize;
#    unsafe extern "C" { pub fn posix_memalign(memptr: *mut *mut c_void, align: size_t, size: size_t) -> c_int; }
# }
use std::{
    mem::{align_of, size_of},
    ptr,
    cmp::max,
};

struct Carton<T>(ptr::NonNull<T>);

impl<T> Carton<T> {
    pub fn new(value: T) -> Self {
        // Allocate enough memory on the heap to store one T.
        assert_ne!(size_of::<T>(), 0, "Zero-sized types are out of the scope of this example");
        let mut memptr: *mut T = ptr::null_mut();
        unsafe {
            let ret = libc::posix_memalign(
                (&mut memptr as *mut *mut T).cast(),
                max(align_of::<T>(), size_of::<usize>()),
                size_of::<T>()
            );
            assert_eq!(ret, 0, "Failed to allocate or invalid alignment");
        };

        // NonNull is just a wrapper that enforces that the pointer isn't null.
        let ptr = {
            // Safety: memptr is dereferenceable because we created it from a
            // reference and have exclusive access.
            ptr::NonNull::new(memptr)
                .expect("Guaranteed non-null if posix_memalign returns 0")
        };

        // Move value from the stack to the location we allocated on the heap.
        unsafe {
            // Safety: If non-null, posix_memalign gives us a ptr that is valid
            // for writes and properly aligned.
            ptr.as_ptr().write(value);
        }

        Self(ptr)
    }
}
```

これはあまり役に立ちません。利用者がいったん値を渡すと、その値にアクセスする手段が無いからです。[`Box`][box-doc] は、内側の値にアクセスできるように [`Deref`][deref-doc] と [`DerefMut`][deref-mut-doc] を実装しています。同じようにしましょう。

```rust
use std::ops::{Deref, DerefMut};

# struct Carton<T>(std::ptr::NonNull<T>);
#
impl<T> Deref for Carton<T> {
    type Target = T;

    fn deref(&self) -> &Self::Target {
        unsafe {
            // Safety: The pointer is aligned, initialized, and dereferenceable
            //   by the logic in [`Self::new`]. We require readers to borrow the
            //   Carton, and the lifetime of the return value is elided to the
            //   lifetime of the input. This means the borrow checker will
            //   enforce that no one can mutate the contents of the Carton until
            //   the reference returned is dropped.
            self.0.as_ref()
        }
    }
}

impl<T> DerefMut for Carton<T> {
    fn deref_mut(&mut self) -> &mut Self::Target {
        unsafe {
            // Safety: The pointer is aligned, initialized, and dereferenceable
            //   by the logic in [`Self::new`]. We require writers to mutably
            //   borrow the Carton, and the lifetime of the return value is
            //   elided to the lifetime of the input. This means the borrow
            //   checker will enforce that no one else can access the contents
            //   of the Carton until the mutable reference returned is dropped.
            self.0.as_mut()
        }
    }
}
```

最後に、この `Carton` が Send かつ Sync であるかどうかを考えましょう。あるものは、排他的なアクセスを強制することなく可変状態をほかの何かと共有しているのでない限り、安全に Send にできます。各 `Carton` は一意なポインタを持っているので、問題ありません。

```rust
# struct Carton<T>(std::ptr::NonNull<T>);
// Safety: No one besides us has the raw pointer, so we can safely transfer the
// Carton to another thread if T can be safely transferred.
unsafe impl<T> Send for Carton<T> where T: Send {}
```

Sync はどうでしょうか。`Carton` が Sync であるためには、ある `&Carton` に格納されているものへ書き込んでいる間に、その同じものが別の `&Carton` から読み書きされることがありえない、ということを強制しなければなりません。ポインタへ書き込むには `&mut Carton` が必要であり、借用チェッカーが可変参照は排他的でなければならないことを強制するので、`Carton` を Sync にすることにも健全性の問題はありません。

```rust
# struct Carton<T>(std::ptr::NonNull<T>);
// Safety: Since there exists a public way to go from a `&Carton<T>` to a `&T`
// in an unsynchronized fashion (such as `Deref`), then `Carton<T>` can't be
// `Sync` if `T` isn't.
// Conversely, `Carton` itself does not use any interior mutability whatsoever:
// all the mutations are performed through an exclusive reference (`&mut`). This
// means it suffices that `T` be `Sync` for `Carton<T>` to be `Sync`:
unsafe impl<T> Sync for Carton<T> where T: Sync  {}
```

自分の型が Send かつ Sync であると表明するとき、通常は、含まれるすべての型が Send かつ Sync であることを強制する必要があります。標準ライブラリの型のように振る舞う独自の型を書くときは、それと同じ要件を持つと表明できます。たとえば次のコードは、同じ種類の Box が Send であるなら Carton は Send である、と表明しています。この場合、それは T が Send であると言うのと同じです。

```rust
# struct Carton<T>(std::ptr::NonNull<T>);
unsafe impl<T> Send for Carton<T> where Box<T>: Send {}
```

今のところ、`Carton<T>` にはメモリリークがあります。割り当てたメモリを決して解放しないからです。これを直すと、Send であるために満たさなければならない新しい要件が生じます。別のスレッドで行われた割り当てによって得られたポインタに対して `free` を呼び出せることを、確かめておく必要があるのです。これが成り立つことは、[`libc::free`][libc-free-docs] のドキュメントで確認できます。

```rust
# struct Carton<T>(std::ptr::NonNull<T>);
# mod libc {
#     pub use ::std::os::raw::c_void;
#     unsafe extern "C" { pub fn free(p: *mut c_void); }
# }
impl<T> Drop for Carton<T> {
    fn drop(&mut self) {
        unsafe {
            libc::free(self.0.as_ptr().cast());
        }
    }
}
```

これが成り立たない良い例が MutexGuard です。MutexGuard が [Send ではない][mutex-guard-not-send-docs-rs]ことに注目してください。MutexGuard の実装は、別のスレッドで取得したロックを解放しようとしないことを利用者に求める[ライブラリを使っています][mutex-guard-not-send-comment]。もし MutexGuard を別のスレッドに送ることができたら、デストラクタは送り先のスレッドで実行され、この要件に違反してしまいます。それでも MutexGuard は Sync でありえます。別のスレッドに送れるのは `&MutexGuard` だけであり、参照をドロップしても何も起こらないからです。

TODO: 何が Send や Sync になれて何がなれないのかを、もっとうまく説明する。データ競合だけに訴えれば十分か？

[unsafe traits]: safe-unsafe-meaning.html
[box-doc]: https://doc.rust-lang.org/std/boxed/struct.Box.html
[box-is-special]: https://manishearth.github.io/blog/2017/01/10/rust-tidbits-box-is-special/
[deref-doc]: https://doc.rust-lang.org/core/ops/trait.Deref.html
[deref-mut-doc]: https://doc.rust-lang.org/core/ops/trait.DerefMut.html
[mutex-guard-not-send-docs-rs]: https://doc.rust-lang.org/std/sync/struct.MutexGuard.html#impl-Send-for-MutexGuard%3C'_,+T%3E
[mutex-guard-not-send-comment]: https://github.com/rust-lang/rust/issues/23465#issuecomment-82730326
[libc-free-docs]: https://linux.die.net/man/3/free
