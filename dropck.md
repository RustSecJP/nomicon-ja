{% raw %}
# ドロップチェック {#drop-check}

ここまでで、ダングリング参照を決して読まないことを保証するための、かなり単純な規則をライフタイムが与えてくれることを見てきました。しかし、これまでは*より長く生きる*（outlives）という関係を、両端を含む形でしか扱ってきませんでした。つまり、`'a: 'b` について話すとき、`'a` が `'b` と*ちょうど*同じだけ生きていてもかまわなかったのです。一見すると、これは意味のない区別に思えます。何かが別の何かと同時にドロップされることなどありませんよね。だからこそ、`let` 文を次のように展開してきました。

<!-- ignore: simplified code -->
```rust
let x;
let y;
```

これは次のように展開されます。

<!-- ignore: desugared code -->
```rust
{
    let x;
    {
        let y;
    }
}
```

スコープを使った展開ができない、もっと複雑な状況もいくつかあります。それでも順序は定義されています。変数は定義の逆順にドロップされ、構造体とタプルのフィールドは定義の順にドロップされます。ドロップの順序についてのさらに詳しい内容は、[RFC 1857][rfc1857] にあります。

次のようにしてみましょう。

<!-- ignore: simplified code -->
```rust
let tuple = (vec![], vec![]);
```

左のベクタが先にドロップされます。しかしそれは、借用チェッカーから見て、右のベクタが左のベクタより厳密に長く生きるということを意味するのでしょうか。この問いへの答えは*いいえ*です。借用チェッカーはタプルのフィールドを別々に追跡することはできるでしょう。しかしそれでも、ベクタの要素については、どれがどれより長く生きるのかを判断できません。ベクタの要素は、借用チェッカーが理解していない純粋なライブラリのコードによって、手動でドロップされるからです。

では、なぜこれを気にするのでしょうか。型システムが注意深くないと、うっかりダングリングポインタを作ってしまうおそれがあるからです。次の単純なプログラムを考えてみましょう。

```rust
struct Inspector<'a>(&'a u8);

struct World<'a> {
    inspector: Option<Inspector<'a>>,
    days: Box<u8>,
}

fn main() {
    let mut world = World {
        inspector: None,
        days: Box::new(1),
    };
    world.inspector = Some(Inspector(&world.days));
}
```

このプログラムは完全に健全で、現在コンパイルできます。`days` が `inspector` より厳密に長く生きるわけではない、という事実は問題になりません。`inspector` が生きている間は、`days` も生きています。

ところが、デストラクタを追加すると、このプログラムはもうコンパイルできなくなります。

```rust
struct Inspector<'a>(&'a u8);

impl<'a> Drop for Inspector<'a> {
    fn drop(&mut self) {
        println!("I was only {} days from retirement!", self.0);
    }
}

struct World<'a> {
    inspector: Option<Inspector<'a>>,
    days: Box<u8>,
}

fn main() {
    let mut world = World {
        inspector: None,
        days: Box::new(1),
    };
    world.inspector = Some(Inspector(&world.days));
    // Let's say `days` happens to get dropped first.
    // Then when Inspector is dropped, it will try to read free'd memory!
}
```

```text
error[E0597]: `world.days` does not live long enough
  --> src/main.rs:19:38
   |
19 |     world.inspector = Some(Inspector(&world.days));
   |                                      ^^^^^^^^^^^ borrowed value does not live long enough
...
22 | }
   | -
   | |
   | `world.days` dropped here while still borrowed
   | borrow might be used here, when `world` is dropped and runs the destructor for type `World<'_>`
```

フィールドの順序を変えたり、構造体の代わりにタプルを使ったりしてみても、やはりコンパイルできません。

`Drop` を実装すると、`Inspector` は自分が死ぬときに任意のコードを実行できるようになります。つまり、自分と同じだけ生きるはずの型が、実際には先に破棄されていたことを観測できてしまうかもしれないのです。

興味深いことに、これを心配する必要があるのはジェネリックな型だけです。ジェネリックでなければ、その型が抱え込めるライフタイムは `'static` だけで、それは本当に*永遠に*生きます。この問題が*健全なジェネリックドロップ*（sound generic drop）と呼ばれるのはそのためです。健全なジェネリックドロップは、*ドロップチェッカー*（drop checker）によって守らせられます。この文章を書いている時点では、ドロップチェッカー（dropck とも呼ばれます）が型を検証する方法の細かい部分のいくつかは、まったく定まっていません。しかし「大原則」は、この節全体で注目してきた、次の微妙な点です。

**ジェネリックな型が drop を健全に実装するには、そのジェネリック引数が、その型より厳密に長く生きなければなりません。**

この規則に従うことは、借用チェッカーを満足させるために（たいていは）必要です。一方、健全であるためには、この規則に従うことは十分条件ではありますが、必要条件ではありません。つまり、型がこの規則に従っているなら、ドロップするのは間違いなく健全です。

上の規則を満たすことが必ずしも必要ではない理由は 2 つあります。ひとつは、Drop の実装の中には、型の上では借用されたデータにアクセスする能力を与えられていても、実際にはアクセスしないものがあるからです。もうひとつは、具体的なドロップ順序が私たちには分かっていて、借用チェッカーがそれを知らなくても、借用されたデータがまだ無事だと言える場合があるからです。

たとえば、上の `Inspector` の例を次のように変えたものは、借用されたデータに決してアクセスしません。

```rust
struct Inspector<'a>(&'a u8, &'static str);

impl<'a> Drop for Inspector<'a> {
    fn drop(&mut self) {
        println!("Inspector(_, {}) knows when *not* to inspect.", self.1);
    }
}

struct World<'a> {
    inspector: Option<Inspector<'a>>,
    days: Box<u8>,
}

fn main() {
    let mut world = World {
        inspector: None,
        days: Box::new(1),
    };
    world.inspector = Some(Inspector(&world.days, "gadget"));
    // Let's say `days` happens to get dropped first.
    // Even when Inspector is dropped, its destructor will not access the
    // borrowed `days`.
}
```

同じように、次のものも借用されたデータに決してアクセスしません。

```rust
struct Inspector<T>(T, &'static str);

impl<T> Drop for Inspector<T> {
    fn drop(&mut self) {
        println!("Inspector(_, {}) knows when *not* to inspect.", self.1);
    }
}

struct World<T> {
    inspector: Option<Inspector<T>>,
    days: Box<u8>,
}

fn main() {
    let mut world = World {
        inspector: None,
        days: Box::new(1),
    };
    world.inspector = Some(Inspector(&world.days, "gadget"));
    // Let's say `days` happens to get dropped first.
    // Even when Inspector is dropped, its destructor will not access the
    // borrowed `days`.
}
```

しかし、上の*どちらも*、借用チェッカーが `fn main` を解析する段階で、`days` が十分に長く生きないとして拒否されます。

その理由は、`main` の借用チェック解析が、それぞれの `Inspector` の `Drop` 実装の中身を知らないことにあります。`main` を解析している間に借用チェッカーが知っている限りでは、inspector のデストラクタの本体は、借用されたデータにアクセスするかもしれないのです。

そのためドロップチェッカーは、値の中にある借用されたデータすべてに、その値より厳密に長く生きることを強制します。

## 抜け道 {#an-escape-hatch}

ドロップチェックを支配する正確な規則は、将来もっと緩やかになるかもしれません。

現在の解析は、意図的に保守的になっています。値の中にある借用されたデータすべてに、その値より長く生きることを強制しており、これは確実に健全です。

将来の版の言語では、解析がもっと精密になり、健全なコードが安全でないとして拒否される場合が減るかもしれません。そうなれば、破棄の最中に調べてはいけないことをわきまえている上の 2 つの `Inspector` のような場合に対処しやすくなるでしょう。

それまでの間は、ある不安定な属性を使うことができます。これは、ジェネリックな型のデストラクタが、型の上ではアクセスする能力を与えられていても、期限の切れたデータには*決して*アクセスしないと（unsafe に）表明するためのものです。

その属性は `may_dangle` と呼ばれ、[RFC 1327][rfc1327] で導入されました。上の `Inspector` にこれを使うには、次のように書きます。

```rust
#![feature(dropck_eyepatch)]

struct Inspector<'a>(&'a u8, &'static str);

unsafe impl<#[may_dangle] 'a> Drop for Inspector<'a> {
    fn drop(&mut self) {
        println!("Inspector(_, {}) knows when *not* to inspect.", self.1);
    }
}

struct World<'a> {
    days: Box<u8>,
    inspector: Option<Inspector<'a>>,
}

fn main() {
    let mut world = World {
        inspector: None,
        days: Box::new(1),
    };
    world.inspector = Some(Inspector(&world.days, "gadget"));
}
```

この属性を使うには、`Drop` の impl に `unsafe` の印を付ける必要があります。期限が切れているかもしれないデータ（たとえば上の `self.0`）にアクセスしない、という暗黙の表明を、コンパイラは検査しないからです。

この属性は、ライフタイムパラメータと型パラメータにいくつでも付けられます。次の例では、ライフタイム `'b` の参照の先にあるデータにはアクセスしないこと、そして `T` はムーブかドロップにしか使わないことを表明しています。一方、`'a` と `U` には属性を付けていません。そのライフタイムとその型を持つデータには、実際にアクセスするからです。

```rust
#![feature(dropck_eyepatch)]
use std::fmt::Display;

struct Inspector<'a, 'b, T, U: Display>(&'a u8, &'b u8, T, U);

unsafe impl<'a, #[may_dangle] 'b, #[may_dangle] T, U: Display> Drop for Inspector<'a, 'b, T, U> {
    fn drop(&mut self) {
        println!("Inspector({}, _, _, {})", self.0, self.3);
    }
}
```

上の場合のように、そうしたアクセスが起こりえないことが明らかなときもあります。しかし、ジェネリックな型パラメータを扱っている場合、そうしたアクセスは間接的に起こりえます。間接的なアクセスの例は次のとおりです。

- コールバックを呼び出す
- トレイトのメソッド呼び出しを経由する

（impl の特殊化（specialization）のような将来の言語の変更によって、こうした間接的なアクセスの経路がほかにも増えるかもしれません。）

コールバックを呼び出す例は次のとおりです。

```rust
struct Inspector<T>(T, &'static str, Box<for <'r> fn(&'r T) -> String>);

impl<T> Drop for Inspector<T> {
    fn drop(&mut self) {
        // The `self.2` call could access a borrow e.g. if `T` is `&'a _`.
        println!("Inspector({}, {}) unwittingly inspects expired data.",
                 (self.2)(&self.0), self.1);
    }
}
```

トレイトのメソッド呼び出しの例は次のとおりです。

```rust
use std::fmt;

struct Inspector<T: fmt::Display>(T, &'static str);

impl<T: fmt::Display> Drop for Inspector<T> {
    fn drop(&mut self) {
        // There is a hidden call to `<T as Display>::fmt` below, which
        // could access a borrow e.g. if `T` is `&'a _`
        println!("Inspector({}, {}) unwittingly inspects expired data.",
                 self.0, self.1);
    }
}
```

そしてもちろん、これらのアクセスはどれも、デストラクタの中に直接書かれているのではなく、デストラクタが呼び出す別のメソッドの中にさらに隠れていることもありえます。

デストラクタの中で `&'a u8` にアクセスしている上記のすべての場合において、`#[may_dangle]` 属性を付けると、その型は借用チェッカーが捕まえてくれない誤用に対して無防備になり、大混乱を招きます。この属性は付けないほうがよいでしょう。

## ドロップ順序に関する余談 {#a-related-side-note-about-drop-order}

構造体の中のフィールドのドロップ順序は定義されていますが、それに頼るのは壊れやすく、微妙な問題をはらみます。順序が重要な場合は、[`ManuallyDrop`] ラッパーを使うほうがよいでしょう。

## ドロップチェッカーについてはこれで全部ですか？ {#is-that-all-about-drop-checker}

実は、unsafe なコードを書くとき、ドロップチェッカーに対して正しいことをしているかどうかを心配する必要は、たいていまったくありません。しかし、気にかけなければならない特別な場合が 1 つあります。それは次の節で見ていきます。

[rfc1327]: https://github.com/rust-lang/rfcs/blob/master/text/1327-dropck-param-eyepatch.md
[rfc1857]: https://github.com/rust-lang/rfcs/blob/master/text/1857-stabilize-drop-order.md
[`manuallydrop`]: https://doc.rust-lang.org/std/mem/struct.ManuallyDrop.html
{% endraw %}
