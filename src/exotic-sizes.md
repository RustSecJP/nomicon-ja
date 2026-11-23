# 風変わりなサイズの型 {#exotically-sized-types}

ほとんどの場合、型は、静的に分かっている正のサイズを持つものと期待されます。Rust では、いつもそうとは限りません。

## 動的サイズ型（DST） {#dynamically-sized-types-dsts}

Rust は動的サイズ型（Dynamically Sized Types、DST）、つまりサイズやアラインメントが静的に分からない型に対応しています。一見すると、これは少し筋が通りません。何かを正しく扱うには、Rust はそのサイズとアラインメントを知って*いなければならない*からです。この点で、DST は普通の型ではありません。静的に分かるサイズがないので、これらの型はポインタの向こう側にしか存在できません。そのため、DST へのポインタはどれも、ポインタと、それを「完成させる」情報（詳しくは後述します）からなる*ワイド*ポインタになります。

言語が公開している主な DST は 2 つあります。

* トレイトオブジェクト: `dyn MyTrait`
* スライス: [`[T]`][slice]、[`str`]、ほか

トレイトオブジェクトは、指定したトレイトを実装する何らかの型を表します。もとの正確な型は*消去*され、代わりに、その型を使うのに必要な情報をすべて収めた vtable による実行時リフレクションが使われます。トレイトオブジェクトのポインタを完成させる情報は、vtable へのポインタです。指す先の実行時のサイズは、vtable から動的に問い合わせることができます。

スライスは、何らかの連続した記憶域、典型的には配列や `Vec` を覗く、単なるビューです。スライスのポインタを完成させる情報は、それが指す要素の数だけです。指す先の実行時のサイズは、静的に分かっている要素 1 つのサイズに、要素の数を掛けたものにすぎません。

実は、構造体は最後のフィールドとして DST を 1 つだけ直接格納できます。ただしそうすると、その構造体も DST になります。

```rust
// Can't be stored on the stack directly
struct MySuperSlice {
    info: u32,
    data: [u8],
}
```

残念ながら、このような型は、構築する手段がなければほとんど役に立ちません。今のところ、独自の DST を作る方法としてきちんと対応されているのは、型をジェネリックにして、*アンサイズ型強制（unsizing coercion）* を行うことだけです。

```rust
struct MySuperSliceable<T: ?Sized> {
    info: u32,
    data: T,
}

fn main() {
    let sized: MySuperSliceable<[u8; 8]> = MySuperSliceable {
        info: 17,
        data: [0; 8],
    };

    let dynamic: &MySuperSliceable<[u8]> = &sized;

    // prints: "17 [0, 0, 0, 0, 0, 0, 0, 0]"
    println!("{} {:?}", dynamic.info, &dynamic.data);
}
```

（そうです、独自の DST は、今のところおおむね生煮えの機能です。）

## サイズが 0 の型（ZST） {#zero-sized-types-zsts}

Rust では、領域をまったく占めない型を定めることもできます。

```rust
struct Nothing; // No fields = no size

// All fields have no size = no size
struct LotsOfNothing {
    foo: Nothing,
    qux: (),      // empty tuple has no size
    baz: [u8; 0], // empty array has no size
}
```

サイズが 0 の型（Zero Sized Types、ZST）は、それだけでは、当然ながらほとんど役に立ちません。しかし、Rust の風変わりなレイアウト上の選択の多くと同じく、その真価はジェネリックな文脈で発揮されます。Rust は、ZST を生み出したり格納したりする操作はどれも何もしない操作（no-op）にまとめられる、ということをおおむね理解しています。まず、ZST を格納することにはそもそも意味がありません。領域をまったく占めないからです。また、その型の値は 1 つしかないので、それを読み込むものは、何もないところから値を生み出すだけで済みます。そしてこれも、領域を占めないので、何もしない操作です。

その最も極端な例の 1 つが、Set と Map です。`Map<Key, Value>` があるとき、`Set<Key>` を `Map<Key, UselessJunk>` の薄いラッパーとして実装するのは、よくあることです。多くの言語では、そのために UselessJunk 用の領域を割り当て、UselessJunk を格納して読み込み、結局は捨てるだけ、という仕事をしなければなりません。それが不要だと証明するのは、コンパイラにとって難しい解析になるでしょう。

しかし Rust では、単に `Set<Key> = Map<Key, ()>` と言えば済みます。こうすると Rust は、読み込みと格納がどれも無駄であり、どの割り当てにもサイズがないことを、静的に知ることができます。その結果、単相化されたコードは、HashMap が値を扱うために抱えるはずのオーバーヘッドを一切持たない、HashSet の専用実装とほぼ同じものになります。

安全なコードは ZST を心配する必要がありません。しかし、*unsafe* なコードは、サイズのない型がもたらす結果に気を付けなければなりません。特に、ポインタのオフセットは何もしない操作になりますし、アロケータはたいてい[ゼロでないサイズを要求します][alloc]。

なお、ZST への参照（空のスライスを含みます）は、ほかのすべての参照と同じく、非 null で、適切に整列されていなければなりません。一方で、ZST への null ポインタを通じた読み込みや格納は、ほかの型へのポインタの場合と違って、[未定義動作][ub]ではありません。

[alloc]: https://doc.rust-lang.org/std/alloc/trait.GlobalAlloc.html#tymethod.alloc
[ub]: what-unsafe-does.html

## 空の型 {#empty-types}

Rust では、*インスタンスを作ることさえできない*型を宣言することもできます。こうした型は型のレベルでしか語ることができず、値のレベルでは決して語れません。空の型は、ヴァリアントのない列挙型を定めることで宣言できます。

```rust
enum Void {} // No variants = EMPTY
```

空の型は、ZST よりもさらに出番が限られます。空の型が欲しくなる主な例は、型のレベルで到達不能であることを表す場合です。たとえば、ある API が一般には Result を返す必要があるものの、特定の場合には実際には失敗しえないとします。このことは、`Result<T, Void>` を返すことで、実際に型のレベルで伝えられます。API を使う側は、そのような Result を自信を持って unwrap できます。この値が `Err` になることは*静的にありえない*と分かっているからです。`Err` になるには、`Void` 型の値を用意しなければなりません。

原理的には、Rust はこの事実に基づいて、いくつか興味深い解析と最適化を行えます。たとえば、`Result<T, Void>` は単なる `T` として表現されます。`Err` の場合が実際には存在しないからです（厳密に言うと、これは保証のない最適化にすぎません。そのため、たとえば一方をもう一方へ transmute することは、やはり未定義動作です）。

次のコードもコンパイルできます。

```rust
enum Void {}

let res: Result<u32, Void> = Ok(0);

// Err doesn't exist anymore, so Ok is actually irrefutable.
let Ok(num) = res;
```

空の型について最後にもう 1 つ、細かい点があります。空の型への生ポインタを作ることは実際には妥当ですが、それを参照外しすることは未定義動作です。参照外しには意味がないからです。

C の `void*` 型を `*const Void` で表すことはお勧めしません。多くの人がそうし始めましたが、すぐに困ったことになりました。unsafe なコードで空の型のインスタンスを作ろうとすることに対して、Rust には安全のための歯止めが実質的に何もなく、もしそうすれば未定義動作になるからです。開発者には生ポインタを参照に変換する習慣があり、`&Void` を作ること*も*未定義動作なので、これは特に問題になりました。

`void*` には `*const ()`（またはそれと同等のもの）がまずまずうまく働き、安全性の問題なしに参照にすることもできます。それでも値を読み書きしようとすること自体は防げませんが、少なくとも、未定義動作ではなく、何もしない操作にコンパイルされます。

## extern 型 {#extern-types}

サイズの分からない型をきちんとした形で追加する、[受理済みの RFC][extern-types] があります。これは *extern 型*と呼ばれ、Rust の開発者が C の `void*` や、そのほかの「宣言されているが定義されていない」型を、より正確に表せるようにするものです。しかし Rust 2018 の時点では、[`size_of_val::<MyExternType>()` がどう振る舞うべきかをめぐって、この機能は宙に浮いたままです][extern-types-issue]。

[extern-types]: https://github.com/rust-lang/rfcs/blob/master/text/1861-extern-types.md
[extern-types-issue]: https://github.com/rust-lang/rust/issues/43467
[`str`]: https://doc.rust-lang.org/std/primitive.str.html
[slice]: https://doc.rust-lang.org/std/primitive.slice.html
