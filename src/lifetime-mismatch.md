# ライフタイムの限界 {#limits-of-lifetimes}

次のコードを考えます。

```rust,compile_fail
#[derive(Debug)]
struct Foo;

impl Foo {
    fn mutate_and_share(&mut self) -> &Self { &*self }
    fn share(&self) {}
}

fn main() {
    let mut foo = Foo;
    let loan = foo.mutate_and_share();
    foo.share();
    println!("{:?}", loan);
}
```

これはコンパイルできそうに思えます。`mutate_and_share` を呼ぶと `foo` が一時的に可変借用されますが、返ってくるのは共有参照だけです。だから `foo` は可変借用されていないはずで、`foo.share()` は成功するだろうと期待します。

ところが、コンパイルしてみるとこうなります。

```text
error[E0502]: cannot borrow `foo` as immutable because it is also borrowed as mutable
  --> src/main.rs:12:5
   |
11 |     let loan = foo.mutate_and_share();
   |                --- mutable borrow occurs here
12 |     foo.share();
   |     ^^^ immutable borrow occurs here
13 |     println!("{:?}", loan);
```

何が起きたのでしょうか。実は、[前の節の 2 つ目の例][ex2]とまったく同じ筋道の推論が行われたのです。プログラムから糖衣構文を取り除くと、次のようになります。

<!-- ignore: desugared code -->
```rust,ignore
struct Foo;

impl Foo {
    fn mutate_and_share<'a>(&'a mut self) -> &'a Self { &'a *self }
    fn share<'a>(&'a self) {}
}

fn main() {
    'b: {
        let mut foo: Foo = Foo;
        'c: {
            let loan: &'c Foo = Foo::mutate_and_share::<'c>(&'c mut foo);
            'd: {
                Foo::share::<'d>(&'d foo);
            }
            println!("{:?}", loan);
        }
    }
}
```

`loan` のライフタイムと `mutate_and_share` のシグネチャのせいで、ライフタイムの仕組みは `&mut foo` のライフタイムを `'c` まで延ばさざるをえません。そして `share` を呼ぼうとすると、その `&'c mut foo` のエイリアスを作ろうとしていると判断され、エラーを突きつけられます。

このプログラムは、私たちが本当に気にかけている参照の意味論に照らせば明らかに正しいのですが、ライフタイムの仕組みは粗すぎて、これを扱えません。

[ex2]: lifetimes.html#example-aliasing-a-mutable-reference
