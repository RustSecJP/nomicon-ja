{% raw %}
# 検査のない未初期化メモリ {#unchecked-uninitialized-memory}

この規則の興味深い例外の 1 つが、配列の扱いです。Safe Rust では、配列を部分的に初期化することは許されていません。配列を初期化するときは、`let x = [val; N]` ですべての値を同じものにするか、`let x = [val1, val2, val3]` で要素を 1 つずつ指定するかのどちらかです。残念ながら、これはかなり融通が利きません。配列をもっと少しずつ、あるいは動的に初期化する必要があるときは、なおさらです。

Unsafe Rust は、この問題を扱うための強力な道具を用意しています。[`MaybeUninit`] です。この型は、まだ完全には初期化されていないメモリを扱うために使えます。

`MaybeUninit` を使うと、次のように配列を要素ごとに初期化できます。

```rust
use std::mem::{self, MaybeUninit};

// Size of the array is hard-coded but easy to change (meaning, changing just
// the constant is sufficient). This means we can't use [a, b, c] syntax to
// initialize the array, though, as we would have to keep that in sync
// with `SIZE`!
const SIZE: usize = 10;

let x = {
    // Create an uninitialized array of `MaybeUninit`.
    let mut x = [const { MaybeUninit::uninit() }; SIZE];

    // Dropping a `MaybeUninit` does nothing. Thus using raw pointer
    // assignment instead of `ptr::write` does not cause the old
    // uninitialized value to be dropped.
    // Exception safety is not a concern because Box can't panic
    for i in 0..SIZE {
        x[i] = MaybeUninit::new(Box::new(i as u32));
    }

    // Everything is initialized. Transmute the array to the
    // initialized type.
    unsafe { mem::transmute::<_, [Box<u32>; SIZE]>(x) }
};

println!("{x:?}");
```

このコードは 3 つの段階で進みます。

1. `MaybeUninit<T>` の配列を作ります。

2. 配列を初期化します。ここで微妙なのは、次の点です。Rust の型検査器がすでに初期化済みと見なしている値（`x[i]` など）に `=` で代入すると、ふつうは左辺に入っていた古い値がドロップされます。それでは大惨事になります。しかし、この場合は左辺の型が `MaybeUninit<Box<u32>>` であり、これをドロップしても何も起こりません。この `drop` の問題については、下でもう少し説明します。

3. 最後に、配列の型を変えて `MaybeUninit` を取り除かなければなりません。現在の安定版の Rust では、これには `transmute` が必要です。このトランスミュートが正当なのは、メモリ上で `MaybeUninit<T>` が `T` と同じ見た目をしているからです。

   ただし、一般には `Container<MaybeUninit<T>>>` が `Container<T>` と同じ見た目をしているとは*限らない*ことに注意してください。`Container` が `Option` で、`T` が `bool` だとしましょう。`Option<bool>` は、`bool` に妥当な値が 2 つしかないことを利用します。しかし `Option<MaybeUninit<bool>>` は、それができません。`bool` が初期化されている必要がないからです。

   そのため、トランスミュートで `MaybeUninit` を取り除いてよいかどうかは、`Container` によります。配列では許されます（そして、いずれ標準ライブラリが適切なメソッドを用意することで、それを認めることになるでしょう）。

真ん中のループ、特に代入演算子と、それが `drop` とどう関わるかについては、もう少し時間をかけて見ておく価値があります。もし次のように書いたとすると、

<!-- ignore: simplified code -->
```rust
*x[i].as_mut_ptr() = Box::new(i as u32); // WRONG!
```

実際には `Box<u32>` を上書きすることになり、未初期化のデータを `drop` することになります。これは多くの悲しみと苦しみを引き起こします。

何らかの理由で `MaybeUninit::new` を使えない場合の正しい代わりの方法は、[`ptr`] モジュールを使うことです。特に、このモジュールには、古い値をドロップせずにメモリ上の場所へバイトを代入できる関数が 3 つあります。[`write`]、[`copy`]、[`copy_nonoverlapping`] です。

* `ptr::write(ptr, val)` は `val` を受け取り、`ptr` が指すアドレスへそれをムーブします。
* `ptr::copy(src, dest, count)` は、T の要素 `count` 個分が占めるビットを src から dest へコピーします（これは C の memmove に相当します。引数の順序が逆であることに注意してください）。
* `ptr::copy_nonoverlapping(src, dest, count)` は `copy` と同じことをしますが、2 つのメモリ範囲が重ならないという前提のもとで、少し速く動きます（これは C の memcpy に相当します。引数の順序が逆であることに注意してください）。

言うまでもないことですが、これらの関数は、使い方を誤ると深刻な大混乱を引き起こすか、あるいはそのまま未定義動作になります。これらの関数*そのもの*が要求するのは、読み書きしたい場所が確保済みで、正しくアラインされていることだけです。しかし、メモリの任意の場所に任意のビットを書き込むことで物事が壊れる道筋は、ほとんど数えきれません。

なお、`Drop` を実装しておらず、`Drop` の型も含まない型では、`ptr::write` のようなややこしい手口を気にする必要はありません。Rust は、そうした型をドロップしようとしないことを知っているからです。上の例で頼りにしていたのは、このことです。

しかし、未初期化メモリを扱うときには、こうして作った値が完全に初期化される前に Rust がそれをドロップしようとしないか、常に用心している必要があります。値がデストラクタを持つなら、その変数のスコープを通るすべての制御経路は、スコープが終わる前に値を初期化しなければなりません。*[これにはコードがパニックする場合も含まれます](unwinding.html)*。`MaybeUninit` はここで少し助けになります。中身を暗黙のうちにドロップしないからです。しかし、パニックの場合にこれが実際に意味するのは、まだ初期化されていない部分の二重解放の代わりに、すでに初期化された部分のメモリリークが起きる、ということにすぎません。

なお、`ptr` のメソッドを使うには、初期化したいデータを指す*生ポインタ*をまず手に入れる必要があります。未初期化のデータを指す*参照*を作るのは不正です。そのため、その生ポインタを手に入れるときには注意が必要です。

* `T` の配列では、`base_ptr: *mut T` として `base_ptr.add(idx)` を使うと、配列の添字 `idx` のアドレスを計算できます。これは、配列がメモリ上でどうレイアウトされるかに依存しています。
* しかし構造体では、一般にどうレイアウトされるかが分かりません。また、`&mut base_ptr.field` を使うこともできません。それは参照を作ることになるからです。そのため、[生の参照（raw reference）][raw_reference]の構文を注意深く使わなければなりません。これは、途中で参照を作らずに、フィールドを指す生ポインタを作ります。

```rust
use std::{ptr, mem::MaybeUninit};

struct Demo {
    field: bool,
}

let mut uninit = MaybeUninit::<Demo>::uninit();
// `&uninit.as_mut().field` would create a reference to an uninitialized `bool`,
// and thus be Undefined Behavior!
let f1_ptr = unsafe { &raw mut (*uninit.as_mut_ptr()).field };
unsafe { f1_ptr.write(true); }

let init = unsafe { uninit.assume_init() };
```

最後にもう 1 つ。古い Rust のコードを読んでいると、非推奨になった `mem::uninitialized` 関数に出会うことがあるかもしれません。この関数は、かつてはスタック上の未初期化メモリを扱う唯一の方法でした。しかし、言語のほかの部分と正しく統合するのは不可能だと分かりました。新しいコードでは必ず `MaybeUninit` を代わりに使い、古いコードも機会があれば移行してください。

未初期化メモリの扱いについては、これでほぼすべてです。基本的に、未初期化メモリを渡されることを想定しているものはどこにもありません。ですから、もし未初期化メモリを受け渡しするのであれば、*本当に*気をつけてください。

[`MaybeUninit`]: https://doc.rust-lang.org/core/mem/union.MaybeUninit.html
[`ptr`]: https://doc.rust-lang.org/core/ptr/index.html
[raw_reference]: https://doc.rust-lang.org/reference/types/pointer.html#r-type.pointer.raw.constructor
[`write`]: https://doc.rust-lang.org/core/ptr/fn.write.html
[`copy`]: https://doc.rust-lang.org/std/ptr/fn.copy.html
[`copy_nonoverlapping`]: https://doc.rust-lang.org/std/ptr/fn.copy_nonoverlapping.html
{% endraw %}
