# ドット演算子 {#the-dot-operator}

ドット演算子は、型を変換するために多くの魔法を使います。型が一致するまで、自動参照（auto-referencing）、自動参照外し（auto-dereferencing）、型強制を行います。メソッド探索の詳しい仕組みは[こちら][method_lookup]で定義されていますが、ここでは主な手順をまとめた簡単な概要を示します。

レシーバー（`self`、`&self`、`&mut self` のいずれかの引数）を持つ関数 `foo` があるとします。`value.foo()` と呼び出すと、コンパイラは、関数の正しい実装を呼び出す前に、`Self` がどの型なのかを決める必要があります。この例では、`value` の型を `T` とします。

どの型に対して関数を呼び出しているのかをはっきりさせるために、[完全修飾構文（fully-qualified syntax）][fqs]を使います。

- まずコンパイラは、`T::foo(value)` を直接呼び出せるかどうかを調べます。これを「値による（by value）」メソッド呼び出しと呼びます。
- この関数を呼び出せない場合（たとえば、関数の型が合わない、または `Self` にトレイトが実装されていない場合）、コンパイラは自動的に参照を付け足そうとします。つまりコンパイラは、`<&T>::foo(value)` と `<&mut T>::foo(value)` を試します。これを「autoref」メソッド呼び出しと呼びます。
- これらの候補がどれもうまくいかなかった場合、`T` を参照外しして、もう一度試します。これには `Deref` トレイトを使います。`T: Deref<Target = U>` であれば、`T` の代わりに型 `U` でもう一度試します。`T` を参照外しできない場合は、`T` の*サイズ情報を外す*（unsizing）ことも試せます。これは、コンパイル時に分かっているサイズのパラメータを `T` が持っている場合に、メソッドを解決する目的でそれを「忘れる」というだけのことです。たとえば、このサイズ情報を外す手順では、配列のサイズを「忘れる」ことで `[i32; 2]` を `[i32]` に変換できます。

メソッド探索のアルゴリズムの例を示します。

```rust,ignore
let array: Rc<Box<[T; 3]>> = ...;
let first_entry = array[0];
```

配列がこれほど多くの間接参照の向こうにあるとき、コンパイラは実際にどうやって `array[0]` を計算するのでしょうか。まず、`array[0]` は実のところ [`Index`][index] トレイトの糖衣構文にすぎません。コンパイラは `array[0]` を `array.index(0)` に変換します。次にコンパイラは、関数を呼び出せるように、`array` が `Index` を実装しているかどうかを調べます。

そこでコンパイラは、`Rc<Box<[T; 3]>>` が `Index` を実装しているかどうかを調べますが、実装していません。`&Rc<Box<[T; 3]>>` も `&mut Rc<Box<[T; 3]>>` も実装していません。どれもうまくいかなかったので、コンパイラは `Rc<Box<[T; 3]>>` を参照外しして `Box<[T; 3]>` にし、もう一度試します。`Box<[T; 3]>`、`&Box<[T; 3]>`、`&mut Box<[T; 3]>` は `Index` を実装していないので、もう一度参照外しします。`[T; 3]` とその autoref も `Index` を実装していません。`[T; 3]` は参照外しできないので、コンパイラはサイズ情報を外して `[T]` にします。最後に、`[T]` は `Index` を実装しているので、ここでようやく実際の `index` 関数を呼び出せます。

ドット演算子が働いている、もう少し複雑な次の例を考えてみましょう。

```rust
fn do_stuff<T: Clone>(value: &T) {
    let cloned = value.clone();
}
```

`cloned` はどの型でしょうか。まずコンパイラは、値によって呼び出せるかどうかを調べます。`value` の型は `&T` なので、`clone` 関数のシグネチャは `fn clone(&T) -> T` です。`T: Clone` であることが分かっているので、コンパイラは `cloned: T` だと判断します。

`T: Clone` の制約を取り除いたら、どうなるでしょうか。`T` に対する `Clone` の実装が無いので、値による呼び出しはできません。そこでコンパイラは、autoref による呼び出しを試します。この場合、`Self = &T` なので、関数のシグネチャは `fn clone(&&T) -> &T` です。コンパイラは `&T: Clone` であることを確かめ、`cloned: &T` だと推論します。

autoref の振る舞いが微妙な効果を生む、もう 1 つの例を示します。

```rust
# use std::sync::Arc;
#
#[derive(Clone)]
struct Container<T>(Arc<T>);

fn clone_containers<T>(foo: &Container<i32>, bar: &Container<T>) {
    let foo_cloned = foo.clone();
    let bar_cloned = bar.clone();
}
```

`foo_cloned` と `bar_cloned` はどの型でしょうか。`Container<i32>: Clone` であることは分かっているので、コンパイラは `clone` を値によって呼び出し、`foo_cloned: Container<i32>` になります。ところが、`bar_cloned` の型は、実は `&Container<T>` です。そんなはずはないと思うでしょう。`Container` に `#[derive(Clone)]` を付けたのだから、`Clone` を実装しているはずです。よく見ると、`derive` マクロが生成するコードは（おおよそ）次のとおりです。

```rust,ignore
impl<T> Clone for Container<T> where T: Clone {
    fn clone(&self) -> Self {
        Self(Arc::clone(&self.0))
    }
}
```

derive した `Clone` の実装は、[`T: Clone` の場合にだけ定義されます][clone]。そのため、一般の `T` については `Container<T>: Clone` の実装がありません。次にコンパイラは、`&Container<T>` が `Clone` を実装しているかどうかを調べ、実装していることが分かります。そこでコンパイラは、`clone` が autoref によって呼び出されると推論し、`bar_cloned` の型は `&Container<T>` になります。

これは、`T: Clone` を要求せずに `Clone` を手で実装することで直せます。

```rust,ignore
impl<T> Clone for Container<T> {
    fn clone(&self) -> Self {
        Self(Arc::clone(&self.0))
    }
}
```

これで型検査器は、`bar_cloned: Container<T>` だと推論します。

[fqs]: https://doc.rust-lang.org/book/ch19-03-advanced-traits.html#fully-qualified-syntax-for-disambiguation-calling-methods-with-the-same-name
[method_lookup]: https://rustc-dev-guide.rust-lang.org/hir-typeck/method-lookup.html
[index]: https://doc.rust-lang.org/std/ops/trait.Index.html
[clone]: https://doc.rust-lang.org/std/clone/trait.Clone.html#derivable
