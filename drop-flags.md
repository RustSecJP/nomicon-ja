{% raw %}
# ドロップフラグ {#drop-flags}

前の節の例は、Rust にとって興味深い問題を持ち込みます。メモリの場所を、条件に応じて初期化し、未初期化に戻し、初期化し直すことが、まったく安全にできることを見ました。Copy の型では、これは特に注目すべきことではありません。ただのビットの山だからです。しかし、デストラクタを持つ型では話が違います。変数に代入するとき、または変数がスコープを抜けるときには必ず、Rust はデストラクタを呼ぶべきかどうかを知る必要があります。条件付きの初期化があるとき、どうすればそれが分かるのでしょうか。

なお、これはすべての代入で気にしなければならない問題ではありません。特に、参照外しを通した代入は無条件にドロップし、`let` での代入は無条件にドロップしません。

```rust
let mut x = Box::new(0); // let makes a fresh variable, so never need to drop
let y = &mut x;
*y = Box::new(1); // Deref assumes the referent is initialized, so always drops
```

これが問題になるのは、すでに初期化されている変数、またはそのフィールドの 1 つを上書きするときだけです。

実は Rust は、型をドロップすべきかどうかを*実行時に*追跡しています。変数が初期化されたり未初期化になったりするたびに、その変数の*ドロップフラグ*（drop flag）が切り替えられます。変数をドロップする必要があるかもしれないときには、このフラグを評価して、ドロップすべきかどうかを決めます。

もちろん、プログラムのあらゆる時点で、値の初期化の状態が静的に分かることはよくあります。その場合、コンパイラは理論上、もっと効率のよいコードを生成できます。たとえば、分岐のない一直線のコードには、こうした*静的なドロップの意味論*（static drop semantics）があります。

```rust
let mut x = Box::new(0); // x was uninit; just overwrite.
let mut y = x;           // y was uninit; just overwrite and make x uninit.
x = Box::new(0);         // x was uninit; just overwrite.
y = x;                   // y was init; Drop y, overwrite it, and make x uninit!
                         // y goes out of scope; y was init; Drop y!
                         // x goes out of scope; x was uninit; do nothing.
```

同じように、分岐のあるコードでも、初期化についてすべての分岐が同じ振る舞いをするなら、静的なドロップの意味論があります。

```rust
# let condition = true;
let mut x = Box::new(0);    // x was uninit; just overwrite.
if condition {
    drop(x)                 // x gets moved out; make x uninit.
} else {
    println!("{}", x);
    drop(x)                 // x gets moved out; make x uninit.
}
x = Box::new(0);            // x was uninit; just overwrite.
                            // x goes out of scope; x was init; Drop x!
```

しかし、次のようなコードを正しくドロップするには、実行時の情報が*必要*です。

```rust
# let condition = true;
let x;
if condition {
    x = Box::new(0);        // x was uninit; just overwrite.
    println!("{}", x);
}
                            // x goes out of scope; x might be uninit;
                            // check the flag!
```

もちろん、この場合に静的なドロップの意味論を取り戻すのは簡単です。

```rust
# let condition = true;
if condition {
    let x = Box::new(0);
    println!("{}", x);
}
```

ドロップフラグはスタック上で追跡されます。古いバージョンの Rust では、ドロップフラグは `Drop` を実装する型の隠しフィールドにしまわれていました。
{% endraw %}
