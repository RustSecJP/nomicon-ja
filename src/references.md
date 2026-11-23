# 参照 {#references}

参照には 2 種類あります。

* 共有参照: `&`
* 可変参照: `&mut`

これらは、次の規則に従います。

* 参照は、その参照先より長く生きることはできない
* 可変参照は、エイリアスされてはならない

これだけです。参照が従うモデルは、これですべてです。

もちろん、*エイリアスされる（aliased）* とはどういう意味なのかを、定義しておくべきでしょう。

```text
error[E0425]: cannot find value `aliased` in this scope
 --> <rust.rs>:2:20
  |
2 |     println!("{}", aliased);
  |                    ^^^^^^^ not found in this scope

error: aborting due to previous error
```

残念ながら、Rust は自身のエイリアシングモデルを、実はまだ定義していません。 🙀

Rust の開発者たちが言語の意味論を定めるのを待つ間に、次の節では、エイリアシングとは
一般にどういうものか、そしてなぜそれが重要なのかを説明します。
