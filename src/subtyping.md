# 部分型付けと変性 {#subtyping-and-variance}

Rust は、借用と所有権の関係を追跡するためにライフタイムを使います。しかし、ライフタイムを素朴に実装すると、制限が厳しすぎるか、未定義動作（undefined behavior）を許してしまうかのどちらかになります。

ライフタイムを柔軟に使えるようにしつつ、誤用も防ぐために、Rust は**部分型付け**（subtyping）と**変性**（variance）を使います。

例から始めましょう。

```rust
// Note: debug expects two parameters with the *same* lifetime
fn debug<'a>(a: &'a str, b: &'a str) {
    println!("a = {a:?} b = {b:?}");
}

fn main() {
    let hello: &'static str = "hello";
    {
        let world = String::from("world");
        let world = &world; // 'world has a shorter lifetime than 'static
        debug(hello, world);
    }
}
```

ライフタイムを保守的に実装した場合、`hello` と `world` のライフタイムが異なるので、次のようなエラーが出るかもしれません。

```text
error[E0308]: mismatched types
 --> src/main.rs:10:16
   |
10 |         debug(hello, world);
   |                      ^
   |                      |
   |                      expected `&'static str`, found struct `&'world str`
```

これではかなり残念です。この場合に私たちが望んでいるのは、*少なくとも* `'world` と同じだけ生きる型なら何でも受け入れることです。ライフタイムに部分型付けを使ってみましょう。

## 部分型付け {#subtyping}

部分型付けとは、ある型を別の型の代わりに使える、という考え方です。

`Sub` が `Super` の部分型（subtype）であると定義しましょう（この章を通じて `Sub <: Super` という記法を使います）。

これが意味しているのは、`Super` が定める*要件*の集まりを `Sub` が完全に満たしている、ということです。そのうえで、`Sub` はさらに多くの要件を持っていてもかまいません。

さて、ライフタイムに部分型付けを使うには、ライフタイムの要件を定義する必要があります。

> `'a` はコードの領域を定める。

これでライフタイムの要件の集まりが定まったので、ライフタイム同士がどう関係するかを定義できます。

> `'long` が定めるコードの領域が `'short` を**完全に含む**とき、かつそのときに限り、`'long <: 'short` である。

`'long` は `'short` より大きな領域を定めていてもかまいません。それでもこの定義に当てはまります。

> この章の残りで見ていくように、部分型付けはこれよりずっと複雑で微妙なものです。しかしこの単純な規則は、99% の場面で通用するとても良い直感になります。そして unsafe なコードを書かない限り、細かな例外的ケースはすべてコンパイラが自動的に処理してくれます。

> しかし、これは Rustonomicon です。私たちは unsafe なコードを書いているのですから、この仕組みが本当はどう動いているのか、そしてどうすればそれを台無しにしてしまえるのかを理解する必要があります。

上の例に戻ると、`'static <: 'world` だと言えます。ここではひとまず、ライフタイムの部分型の関係は参照を通しても伝わる、という考え方も受け入れてください（詳しくは[変性](#variance)で説明します）。*たとえば* `&'static str` は `&'world str` の部分型なので、`&'static str` を `&'world str` へ「格下げ」できます。これで、上の例はコンパイルできるようになります。

```rust
fn debug<'a>(a: &'a str, b: &'a str) {
    println!("a = {a:?} b = {b:?}");
}

fn main() {
    let hello: &'static str = "hello";
    {
        let world = String::from("world");
        let world = &world; // 'world has a shorter lifetime than 'static
        debug(hello, world); // hello silently downgrades from `&'static str` into `&'world str`
    }
}
```

## 変性 {#variance}

上では、`'static <: 'b` ならば `&'static T <: &'b T` である、という事実を詳しく説明せずに済ませました。これは*変性*（variance）と呼ばれる性質を使っています。ただし、いつもこの例のように単純とは限りません。それを理解するために、この例を少し広げてみましょう。

```rust,compile_fail,E0597
fn assign<T>(input: &mut T, val: T) {
    *input = val;
}

fn main() {
    let mut hello: &'static str = "hello";
    {
        let world = String::from("world");
        assign(&mut hello, &world);
    }
    println!("{hello}"); // use after free 😿
}
```

`assign` の中で、参照 `hello` が `world` を指すように設定しています。ところが、その後の println! で `hello` を使う前に、`world` はスコープを抜けてしまいます。

これは典型的な解放後使用（use-after-free）のバグです。

真っ先に `assign` の実装を疑いたくなるかもしれませんが、そこには実のところ何も問題がありません。`T` を `T` に代入したくなるのは、驚くようなことではないはずです。

問題は、`&'static str` がいったん `&mut` 参照の向こう側に入ってしまうと、`T` を満たすために `&'world str` へ格下げできるとはもう仮定できない、という点にあります。つまり、たとえ `'static` が `'world` の部分型であっても、`&mut &'static str` は `&mut &'world str` の*部分型*には**なりえません**。

変性とは、ジェネリックパラメータを通した部分型の関係を定義するために、Rust が借りてきた概念です。

> 注: 便宜上、`T` について話しやすいように、ジェネリック型 `F<T>` を定義することにします。文脈から意味がはっきり伝わるとよいのですが。

型 `F` の*変性*とは、入力の部分型付けが出力の部分型付けにどう影響するかのことです。Rust には 3 種類の変性があります。2 つの型 `Sub` と `Super` があり、`Sub` が `Super` の部分型であるとします。

* `F<Sub>` が `F<Super>` の部分型であるとき、`F` は**共変**（covariant）です（部分型の性質がそのまま伝わります）
* `F<Super>` が `F<Sub>` の部分型であるとき、`F` は**反変**（contravariant）です（部分型の性質が「反転」します）
* それ以外のとき、`F` は**非変**（invariant）です（部分型の関係は存在しません）

上の例を思い出すと、`'a <: 'b` であれば `&'a T` を `&'b T` の部分型として扱ってかまいませんでした。したがって、`&'a T` は `'a` に対して*共変*だと言えます。

また、`&mut &'a T` を `&mut &'b T` の部分型として扱ってはいけないことも見ました。したがって、`&mut T` は `T` に対して*非変*だと言えます。

ほかのジェネリック型とその変性を、次の表に示します。

|                 |     'a    |         T         |     U     |
|-----------------|:---------:|:-----------------:|:---------:|
| `&'a T `        | 共変      | 共変              |           |
| `&'a mut T`     | 共変      | 非変              |           |
| `Box<T>`        |           | 共変              |           |
| `Vec<T>`        |           | 共変              |           |
| `UnsafeCell<T>` |           | 非変              |           |
| `Cell<T>`       |           | 非変              |           |
| `fn(T) -> U`    |           | **反**変          | 共変      |
| `*const T`      |           | 共変              |           |
| `*mut T`        |           | 非変              |           |

このうちいくつかは、ほかのものとの関係で簡単に説明できます。

* `Vec<T>` と、そのほかすべての所有ポインタやコレクションは、`Box<T>` と同じ理屈に従います
* `Cell<T>` と、そのほかすべての内部可変性を持つ型は、`UnsafeCell<T>` と同じ理屈に従います
* `UnsafeCell<T>` は内部可変性を持つので、`&mut T` と同じ変性の性質を持ちます
* `*const T` は `&T` の理屈に従います
* `*mut T` は `&mut T`（または `UnsafeCell<T>`）の理屈に従います

そのほかの型については、リファレンスの[「Variance」の節][variance-table]を参照してください。

[variance-table]: https://doc.rust-lang.org/reference/subtyping.html#variance

> 注: この言語で反変性が生じる*唯一の*源は関数の引数です。そのため、実際にはあまり話題になりません。反変性を働かせるには、特定のライフタイムを持つ参照を受け取る関数ポインタを使った高階プログラミングが必要になります（これは、よくある「任意のライフタイム」の場合とは対照的です。そちらは高階ライフタイムの話になり、部分型付けとは独立に働きます）。

変性について、もう少し形式的な理解が得られました。そこで、いくつかの例をもっと詳しく見ていきましょう。

```rust,compile_fail,E0597
fn assign<T>(input: &mut T, val: T) {
    *input = val;
}

fn main() {
    let mut hello: &'static str = "hello";
    {
        let world = String::from("world");
        assign(&mut hello, &world);
    }
    println!("{hello}");
}
```

これを実行すると、どうなるでしょうか。

```text
error[E0597]: `world` does not live long enough
  --> src/main.rs:9:28
   |
6  |     let mut hello: &'static str = "hello";
   |                    ------------ type annotation requires that `world` is borrowed for `'static`
...
9  |         assign(&mut hello, &world);
   |                            ^^^^^^ borrowed value does not live long enough
10 |     }
   |     - `world` dropped here while still borrowed
```

よかった、コンパイルできません。ここで何が起きているのかを、詳しく分解してみましょう。

まず、`assign` 関数を見てみます。

```rust
fn assign<T>(input: &mut T, val: T) {
    *input = val;
}
```

この関数がするのは、可変参照と値を受け取り、参照先をその値で上書きすることだけです。この関数で重要なのは、型が等しいという制約を作り出す点です。参照先と値が*厳密に同じ*型でなければならないことを、シグネチャではっきり述べています。

一方、呼び出し側では `&mut &'static str` と `&'world str` を渡しています。

`&mut T` は `T` に対して非変なので、コンパイラは第 1 引数に部分型付けを一切適用できないと結論し、`T` は厳密に `&'static str` でなければならないことになります。

これは `&T` の場合とは対照的です。

```rust
fn debug<T: std::fmt::Debug>(a: T, b: T) {
    println!("a = {a:?} b = {b:?}");
}
```

こちらでも同じように、`a` と `b` は同じ型 `T` を持たなければなりません。しかし `&'a T` は `'a` に対して共変*である*ので、部分型付けを行うことが許されます。そこでコンパイラは、`&'static str` が `&'b str` の部分型であるとき、かつそのときに限り、`&'static str` は `&'b str` になれると判断します。これは `'static <: 'b` であれば成り立ちます。実際に成り立つので、コンパイラは喜んでこのコードのコンパイルを続けます。

結局のところ、Box（および Vec、HashMap など）が共変でかまわない理由の議論は、ライフタイムが共変でかまわない理由の議論とよく似ています。可変参照のようなものの中に詰め込もうとしたとたんに非変性を受け継ぐので、悪いことは何もできなくなるのです。

ただし Box を使うと、これまで一部を詳しく説明せずに済ませてきた、参照の「値として渡す」側面に目を向けやすくなります。

値をいつでも自由にエイリアスできる多くの言語とは違い、Rust にはとても厳しい規則があります。値を変更したりムーブしたりすることが許されているなら、その値にアクセスできるのは自分だけであることが保証されている、という規則です。

次のコードを考えてみましょう。

```rust,ignore
let hello: Box<&'static str> = Box::new("hello");

let mut world: Box<&'b str>;
world = hello;
```

`hello` が `'static` の間生きていたことを忘れてしまっても、まったく問題はありません。`hello` を、`'b` の間生きていることしか知らない変数へムーブしたとたんに、**それがもっと長く生きることを覚えていた、この世で唯一のものを壊してしまった**からです。

説明が残っているのはあと 1 つ、関数ポインタだけです。

`fn(T) -> U` が `U` に対して共変であるべき理由を知るために、次のシグネチャを考えてみましょう。

<!-- ignore: simplified code -->
```rust,ignore
fn get_str() -> &'a str;
```

この関数は、何らかのライフタイム `'a` で境界付けられた `str` を作ると主張しています。そうであれば、代わりに次のシグネチャを持つ関数を渡しても、まったく問題ありません。

<!-- ignore: simplified code -->
```rust,ignore
fn get_static() -> &'static str;
```

関数が呼ばれるとき、呼び出し側が期待しているのは、少なくとも `'a` のライフタイムの間生きる `&str` だけです。その値が実際にはもっと長く生きていても、かまいません。

しかし、同じ理屈は*引数*には当てはまりません。次のものを、

<!-- ignore: simplified code -->
```rust,ignore
fn store_ref(&'a str);
```

次のもので満たそうとする場合を考えてみましょう。

<!-- ignore: simplified code -->
```rust,ignore
fn store_static(&'static str);
```

1 つ目の関数は、少なくとも `'a` の間生きる文字列参照なら何でも受け取れます。しかし 2 つ目の関数は、`'static` より短い期間しか生きない文字列参照を受け取れないので、食い違いが生じます。ここでは共変性は成り立ちません。ところが、向きをひっくり返すと、実は*成り立つ*のです。`&'static str` を扱える関数が必要なとき、*どんな*ライフタイムの参照でも扱える関数なら、間違いなくうまく働きます。

実際に見てみましょう。

```rust,compile_fail
# use std::cell::RefCell;
thread_local! {
    pub static StaticVecs: RefCell<Vec<&'static str>> = RefCell::new(Vec::new());
}

/// saves the input given into a thread local `Vec<&'static str>`
fn store(input: &'static str) {
    StaticVecs.with_borrow_mut(|v| v.push(input));
}

/// Calls the function with it's input (must have the same lifetime!)
fn demo<'a>(input: &'a str, f: fn(&'a str)) {
    f(input);
}

fn main() {
    demo("hello", store); // "hello" is 'static. Can call `store` fine

    {
        let smuggle = String::from("smuggle");

        // `&smuggle` is not static. If we were to call `store` with `&smuggle`,
        // we would have pushed an invalid lifetime into the `StaticVecs`.
        // Therefore, `fn(&'static str)` cannot be a subtype of `fn(&'a str)`
        demo(&smuggle, store);
    }

    // use after free 😿
    StaticVecs.with_borrow(|v| println!("{v:?}"));
}
```

これが、関数型が、この言語のほかのどんなものとも違って、引数に対して**反**変である理由です。

さて、標準ライブラリが提供する型についてはこれで結構ですが、*自分で*定義する型の変性はどう決まるのでしょうか。くだけた言い方をすれば、構造体はフィールドの変性を受け継ぎます。構造体 `MyType` がジェネリック引数 `A` を持ち、それがフィールド `a` で使われているなら、`A` に対する MyType の変性は、`A` に対する `a` の変性とちょうど同じです。

ただし、`A` が複数のフィールドで使われている場合は次のようになります。

* `A` の使われ方がすべて共変なら、MyType は `A` に対して共変です
* `A` の使われ方がすべて反変なら、MyType は `A` に対して反変です
* それ以外の場合、MyType は `A` に対して非変です

```rust
use std::cell::Cell;

struct MyType<'a, 'b, A: 'a, B: 'b, C, D, E, F, G, H, In, Out, Mixed> {
    a: &'a A,     // covariant over 'a and A
    b: &'b mut B, // covariant over 'b and invariant over B

    c: *const C,  // covariant over C
    d: *mut D,    // invariant over D

    e: E,         // covariant over E
    f: Vec<F>,    // covariant over F
    g: Cell<G>,   // invariant over G

    h1: H,        // would also be covariant over H except...
    h2: Cell<H>,  // invariant over H, because invariance wins all conflicts

    i: fn(In) -> Out,       // contravariant over In, covariant over Out

    k1: fn(Mixed) -> usize, // would be contravariant over Mixed except..
    k2: Mixed,              // invariant over Mixed, because invariance wins all conflicts
}
```
