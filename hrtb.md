{% raw %}
# 高階トレイト境界（HRTB） {#higher-rank-trait-bounds-hrtbs}

Rust の `Fn` トレイトには、少しばかり魔法がかかっています。たとえば、次のようなコードが書けます。

```rust
struct Closure<F> {
    data: (u8, u16),
    func: F,
}

impl<F> Closure<F>
    where F: Fn(&(u8, u16)) -> &u8,
{
    fn call(&self) -> &u8 {
        (self.func)(&self.data)
    }
}

fn do_it(data: &(u8, u16)) -> &u8 { &data.0 }

fn main() {
    let clo = Closure { data: (0, 1), func: do_it };
    println!("{}", clo.call());
}
```

このコードを、[ライフタイムの節][lt]でやったのと同じように素朴に展開しようとすると、困ったことになります。

<!-- ignore: desugared code -->
```rust
// NOTE: `&'b data.0` and `'x: {` is not valid syntax!
struct Closure<F> {
    data: (u8, u16),
    func: F,
}

impl<F> Closure<F>
    // where F: Fn(&'??? (u8, u16)) -> &'??? u8,
{
    fn call<'a>(&'a self) -> &'a u8 {
        (self.func)(&self.data)
    }
}

fn do_it<'b>(data: &'b (u8, u16)) -> &'b u8 { &'b data.0 }

fn main() {
    'x: {
        let clo = Closure { data: (0, 1), func: do_it };
        println!("{}", clo.call());
    }
}
```

`F` のトレイト境界に付くライフタイムを、いったいどう表せばよいのでしょうか。そこには何かライフタイムを書く必要がありますが、私たちが気にしているライフタイムは、`call` の本体に入るまで名前を付けられません。しかも、それは何か決まった 1 つのライフタイムではありません。`call` は、その時点で `&self` がたまたま持っている*どんな*ライフタイムに対しても動きます。

この仕事には、高階トレイト境界（Higher-Rank Trait Bounds、HRTB）の魔法が必要です。これを展開すると次のようになります。

<!-- ignore: simplified code -->
```rust
where for<'a> F: Fn(&'a (u8, u16)) -> &'a u8,
```

あるいは、次のようにも書けます。

<!-- ignore: simplified code -->
```rust
where F: for<'a> Fn(&'a (u8, u16)) -> &'a u8,
```

（ここで `Fn(a, b, c) -> d` 自体も、まだ安定化されていない*本物の* `Fn` トレイトに対する糖衣構文にすぎません）

`for<'a>` は「`'a` のあらゆる選び方に対して」と読むことができ、要するに、F が満たさなければならないトレイト境界の*無限のリスト*を作り出します。強烈ですね。`Fn` トレイト以外で HRTB に出くわす場面は多くありませんし、`Fn` トレイトについても、よくある場合のための便利な魔法の糖衣構文が用意されています。

まとめると、元のコードは次のように、もっと明示的に書き直せます。

```rust
struct Closure<F> {
    data: (u8, u16),
    func: F,
}

impl<F> Closure<F>
    where for<'a> F: Fn(&'a (u8, u16)) -> &'a u8,
{
    fn call(&self) -> &u8 {
        (self.func)(&self.data)
    }
}

fn do_it(data: &(u8, u16)) -> &u8 { &data.0 }

fn main() {
    let clo = Closure { data: (0, 1), func: do_it };
    println!("{}", clo.call());
}
```

[lt]: lifetimes.html
{% endraw %}
