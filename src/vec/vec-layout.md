# レイアウト {#layout}

まず最初に、構造体のレイアウトを考える必要があります。Vec には 3 つの部分があります。割り当てへのポインタ、割り当ての大きさ、そして初期化済みの要素の数です。

素朴に考えれば、次の設計にすればよいことになります。

<!-- ignore: simplified code -->
```rust,ignore
pub struct Vec<T> {
    ptr: *mut T,
    cap: usize,
    len: usize,
}
```

そして実際、これはコンパイルできます。残念ながら、これでは厳しすぎます。コンパイラが与える変性（variance）が厳しすぎるのです。そのため、`&Vec<&'a str>` が期待される場所で `&Vec<&'static str>` を使えなくなります。変性の詳細はすべて、[所有権とライフタイムの章][ownership]を参照してください。

所有権の章で見たように、標準ライブラリは、自分が所有する割り当てへの生ポインタを持つとき、そのポインタに、ただの `*mut T` よりも多くのことを宣言させたいと考えます。

* `T` に対して共変である
* `T` 型の値を所有しているかもしれない（ここでの例には関係ありませんが、本物の `std::vec::Vec<T>` にこれが必要な理由は [PhantomData の章][phantom-data]を参照してください）
* `T` が Send/Sync であれば、Send/Sync である
* ポインタは決してヌルにならない（そのため `Option<Vec<T>>` にヌルポインタ最適化が効く）

上の要件はすべて、安定版の Rust で実装できます。そのために、[`NonNull<T>`][NonNull] を使います。これは生ポインタのラッパーで、上の性質のうち 2 つを与えてくれます。つまり、`T` に対して共変であり、決してヌルにならないと宣言されています。`T` が Send/Sync であるときに Send/Sync を実装すれば、必要な残りも手に入ります。

```rust
use std::ptr::NonNull;

pub struct Vec<T> {
    ptr: NonNull<T>,
    cap: usize,
    len: usize,
}

unsafe impl<T: Send> Send for Vec<T> {}
unsafe impl<T: Sync> Sync for Vec<T> {}
# fn main() {}
```

[ownership]: ../ownership.html
[phantom-data]: ../phantom-data.html
[NonNull]: https://doc.rust-lang.org/std/ptr/struct.NonNull.html
