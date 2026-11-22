{% raw %}
# 型強制 {#coercions}

型は、特定の文脈で暗黙のうちに別の型へ強制（coerce）されることがあります。こうした変更は、おおむね型を*弱める*だけのもので、主にポインタとライフタイムに関するものです。その大半は、より多くの場面で Rust が「そのまま動く」ようにするために存在していて、ほとんど無害です。

型強制（coercion）のすべての種類を網羅した一覧は、リファレンスの [Coercion types] の節を見てください。

なお、トレイトの照合では型強制を行いません（レシーバーは例外です。[次のページ][dot-operator]を見てください）。ある型 `U` に対する `impl` があり、`T` が `U` に強制されるとしても、それは `T` に対する実装にはなりません。たとえば次のコードは、`t` を `&T` に強制することに問題がなく、`&T` に対する `impl` があっても、型検査を通りません。

```rust
trait Trait {}

fn foo<X: Trait>(t: X) {}

impl<'a> Trait for &'a i32 {}

fn main() {
    let t: &mut i32 = &mut 0;
    foo(t);
}
```

これは次のように失敗します。

```text
error[E0277]: the trait bound `&mut i32: Trait` is not satisfied
 --> src/main.rs:9:9
  |
3 | fn foo<X: Trait>(t: X) {}
  |           ----- required by this bound in `foo`
...
9 |     foo(t);
  |         ^ the trait `Trait` is not implemented for `&mut i32`
  |
  = help: the following implementations were found:
            <&'a i32 as Trait>
  = note: `Trait` is implemented for `&i32`, but not for `&mut i32`
```

[Coercion types]: https://doc.rust-lang.org/reference/type-coercions.html#coercion-types
[dot-operator]: ./dot-operator.html
{% endraw %}
