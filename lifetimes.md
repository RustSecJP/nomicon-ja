{% raw %}
# ライフタイム {#lifetimes}

Rust は、これらの規則を*ライフタイム*（lifetime）によって守らせます。ライフタイムとは、参照が有効でなければならないコード上の領域に名前を付けたものです。この領域はプログラムの実行経路に対応するので、かなり複雑になることがあります。実行経路の途中に穴が空いていることさえあります。再び使う前に初期化し直しさえすれば、参照をいったん無効にしてもかまわないからです。参照を含む型（あるいは参照を含むふりをする型）にもライフタイムの札を付けることができ、Rust はそうした型も無効にならないようにできます。

この章の例のほとんどでは、ライフタイムはスコープと一致します。例が単純だからです。一致しない、もっと複雑な場合については後で説明します。

関数本体の中では、関係するライフタイムにはっきり名前を付けることを、Rust は基本的に許していません。局所的な文脈では、ライフタイムについて語る必要がたいてい無いからです。Rust はすべての情報を持っていて、何もかもできるだけ最適に割り出せます。本来なら自分で書かなければならない無名のスコープや一時変数がたくさん導入され、コードが「とにかく動く」ようになっています。

しかし、関数の境界をまたぐと、ライフタイムについて語り始める必要が出てきます。ライフタイムはアポストロフィを付けて `'a`、`'static` のように書きます。ライフタイムに少しずつ慣れるために、ここではスコープにライフタイムの札を付けることが実際に許されているものと仮定して、この章の冒頭の例から糖衣構文を取り除いてみます。

もともとの例では、スコープとライフタイムのまわりで*強烈な*糖衣構文を使っていました。果糖ぶどう糖液糖と呼べるほどです。すべてを明示的に書き出すと*ひどくごちゃごちゃする*からです。Rust のコードはどれも、強力な推論と、「明らかな」ものの省略に頼っています。

特に興味深い糖衣構文のひとつが、それぞれの `let` 文が暗黙のうちにスコープを導入することです。ほとんどの場合、これは大した問題ではありません。しかし、互いを参照する変数にとっては問題になります。簡単な例として、次の単純な Rust コードから糖衣構文を完全に取り除いてみましょう。

```rust
let x = 0;
let y = &x;
let z = &y;
```

借用チェッカーは常にライフタイムの範囲を最小にしようとするので、おそらく次のように展開されます。

<!-- ignore: desugared code -->
```rust
// NOTE: `'a: {` and `&'b x` is not valid syntax!
'a: {
    let x: i32 = 0;
    'b: {
        // lifetime used is 'b because that's good enough.
        let y: &'b i32 = &'b x;
        'c: {
            // ditto on 'c
            let z: &'c &'b i32 = &'c y; // "a reference to a reference to an i32" (with lifetimes annotated)
        }
    }
}
```

うわあ。これは……ひどいですね。これを簡単にしてくれている Rust に、みんなで少し感謝しましょう。

実際に参照を外側のスコープへ渡すと、Rust はもっと大きなライフタイムを推論します。

```rust
let x = 0;
let z;
let y = &x;
z = y;
```

<!-- ignore: desugared code -->
```rust
'a: {
    let x: i32 = 0;
    'b: {
        let z: &'b i32;
        'c: {
            // Must use 'b here because the reference to x is
            // being passed to the scope 'b.
            let y: &'b i32 = &'b x;
            z = y;
        }
    }
}
```

## 例: 参照先より長生きする参照 {#example-references-that-outlive-referents}

では、前に出てきた例をいくつか見てみましょう。

```rust
fn as_str(data: &u32) -> &str {
    let s = format!("{}", data);
    &s
}
```

これは次のように展開されます。

<!-- ignore: desugared code -->
```rust
fn as_str<'a>(data: &'a u32) -> &'a str {
    'b: {
        let s = format!("{}", data);
        return &'a s;
    }
}
```

`as_str` のこのシグネチャは、*何らかの*ライフタイムを持つ u32 への参照を受け取り、*それとちょうど同じだけ*生きられる str への参照を作れると約束しています。この時点でもう、このシグネチャが厄介そうな理由が見えてきます。これは要するに、u32 への参照が生まれたスコープか、*それよりさらに前の*どこかで str を見つけてくる、ということを意味します。それはなかなか無理な注文です。

続いて文字列 `s` を計算し、それへの参照を返します。この関数の契約では、参照は `'a` より長く生きなければならないので、参照のライフタイムとしてはそれが推論されます。残念ながら、`s` はスコープ `'b` の中で定義されています。したがって、これが健全になるのは `'b` が `'a` を含む場合だけです。しかし `'a` は関数呼び出しそのものを含まなければならないので、それは明らかに成り立ちません。つまり、参照先よりも長く生きるライフタイムを持つ参照を作ってしまったことになります。これは、参照がしてはならないこととして最初に挙げた、*まさにその*ことです。コンパイラがエラーを突きつけてくるのは当然です。

もっとはっきりさせるために、例を広げてみます。

<!-- ignore: desugared code -->
```rust
fn as_str<'a>(data: &'a u32) -> &'a str {
    'b: {
        let s = format!("{}", data);
        return &'a s
    }
}

fn main() {
    'c: {
        let x: u32 = 0;
        'd: {
            // An anonymous scope is introduced because the borrow does not
            // need to last for the whole scope x is valid for. The return
            // of as_str must find a str somewhere before this function
            // call. Obviously not happening.
            println!("{}", as_str::<'d>(&'d x));
        }
    }
}
```

だめですね。

もちろん、この関数の正しい書き方は次のとおりです。

```rust
fn to_string(data: &u32) -> String {
    format!("{}", data)
}
```

値を返すには、関数の中で所有権を持つ値を作らなければなりません。`&'a str` を返せるとしたら、それが `&'a u32` のフィールドに入っている場合だけですが、明らかにそうではありません。

（実は、文字列リテラルをそのまま返すこともできました。文字列リテラルはグローバルなものなので、スタックの底にあるとみなせます。ただし、それでは実装が*ほんの少し*制限されてしまいます。）

## 例: 可変参照のエイリアス {#example-aliasing-a-mutable-reference}

もうひとつの例はどうでしょうか。

```rust
let mut data = vec![1, 2, 3];
let x = &data[0];
data.push(4);
println!("{}", x);
```

<!-- ignore: desugared code -->
```rust
'a: {
    let mut data: Vec<i32> = vec![1, 2, 3];
    'b: {
        // 'b is as big as we need this borrow to be
        // (just need to get to `println!`)
        let x: &'b i32 = Index::index::<'b>(&'b data, 0);
        'c: {
            // Temporary scope because we don't need the
            // &mut to last any longer.
            Vec::push(&'c mut data, 4);
        }
        println!("{}", x);
    }
}
```

ここでの問題は、もう少し微妙で興味深いものです。Rust にこのプログラムを拒否してほしい理由は、次のとおりです。`push` のために `data` への可変参照を取ろうとする時点で、`data` の子孫を指す生きた共有参照 `x` が存在します。これではエイリアスのある可変参照ができてしまい、参照の*第 2 の*規則に違反します。

しかし、Rust がこのプログラムを不正と判断する筋道は、これとは*まったく*違います。Rust は、`x` が `data` の一部分への参照であることを理解していません。`Vec` のことも一切理解していません。Rust に*見えている*のは、`x` を出力するために、`x` が `'b` の間生きていなければならないということです。すると `Index::index` のシグネチャにより、`data` に対して取る参照も `'b` の間生き延びなければならなくなります。そして `push` を呼ぼうとするとき、Rust は私たちが `&'c mut data` を作ろうとしているのを見ます。Rust は `'c` が `'b` の中に含まれていることを知っているので、`&'b data` がまだ生きているはずだとして、このプログラムを拒否するのです。

ここから分かるのは、ライフタイムの仕組みは、私たちが本当に守りたい参照の意味論よりもずっと粗いということです。たいていの場合、*それでまったく問題ありません*。おかげで、プログラムについてコンパイラに一日中説明し続けずに済むからです。しかしそれは、Rust の*真の*意味論に照らせば完全に正しいプログラムのいくつかが、ライフタイムが賢くないせいで拒否されるということでもあります。

## ライフタイムが覆う範囲 {#the-area-covered-by-a-lifetime}

参照（*借用*（borrow）と呼ばれることもあります）は、作られた場所から最後に使われる場所まで*生きています*。借用された値は、生きている借用よりも長く生きていれば十分です。単純に見えますが、微妙な点がいくつかあります。

次のコード片はコンパイルできます。`x` を出力した後は `x` がもう必要ないので、それがダングリングになっていてもエイリアスされていても問題にならないからです（変数 `x` は*厳密には*スコープの最後まで存在しますが）。

```rust
let mut data = vec![1, 2, 3];
let x = &data[0];
println!("{}", x);
// This is OK, x is no longer needed
data.push(4);
```

しかし、値がデストラクタを持つ場合、デストラクタはスコープの終わりで実行されます。そしてデストラクタの実行は使用とみなされます。当然、それが最後の使用です。したがって、次のコードはコンパイル*できません*。

```rust
#[derive(Debug)]
struct X<'a>(&'a i32);

impl Drop for X<'_> {
    fn drop(&mut self) {}
}

let mut data = vec![1, 2, 3];
let x = X(&data[0]);
println!("{:?}", x);
data.push(4);
// Here, the destructor is run and therefore this'll fail to compile.
```

`x` がもう有効ではないとコンパイラに納得させる方法のひとつは、`data.push(4)` の前で `drop(x)` を使うことです。

さらに、借用の最後の使用になりうる場所が複数あることもあります。たとえば、条件分岐のそれぞれの枝です。

```rust
# fn some_condition() -> bool { true }
let mut data = vec![1, 2, 3];
let x = &data[0];

if some_condition() {
    println!("{}", x); // This is the last use of `x` in this branch
    data.push(4);      // So we can push here
} else {
    // There's no use of `x` in here, so effectively the last use is the
    // creation of x at the top of the example.
    data.push(5);
}
```

また、ライフタイムの途中に中断が入ることもあります。あるいは、別々の 2 つの借用が同じローカル変数に結び付いているだけだ、と見ることもできます。これはループのまわりでよく起こります（ループの終わりで変数に新しい値を書き込み、次の繰り返しの先頭でそれを最後に使う場合です）。

```rust
let mut data = vec![1, 2, 3];
// This mut allows us to change where the reference points to
let mut x = &data[0];

println!("{}", x); // Last use of this borrow
data.push(4);
x = &data[3]; // We start a new borrow here
println!("{}", x);
```

歴史的には、Rust は借用をスコープの終わりまで生かしていました。そのため、これらの例は古いコンパイラではコンパイルできないかもしれません。また、Rust が借用の生きている部分をうまく縮められず、コンパイルできそうに見えるのにできない、という細かな例外的ケースも今なお残っています。これらは時間とともに解決されていくでしょう。
{% endraw %}
