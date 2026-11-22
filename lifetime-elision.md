{% raw %}
# ライフタイムの省略 {#lifetime-elision}

よくある書き方をもっと書きやすくするために、Rust では関数シグネチャの中のライフタイムを*省略*（elide）できます。

*ライフタイムの位置*（lifetime position）とは、型の中でライフタイムを書ける場所すべてのことです。

<!-- ignore: simplified code -->
```rust
&'a T
&'a mut T
T<'a>
```

ライフタイムの位置は、「入力」か「出力」のどちらかとして現れます。

* `fn` の定義、`fn` 型、およびトレイト `Fn`、`FnMut`、`FnOnce` では、入力は仮引数の型を指し、出力は結果の型を指します。したがって `fn foo(s: &str) -> (&str, &str)` では、入力の位置でライフタイムが 1 つ、出力の位置でライフタイムが 2 つ省略されています。なお、`fn` によるメソッド定義の入力の位置には、そのメソッドの `impl` ヘッダーに現れるライフタイムは含まれません（デフォルトメソッドの場合は、トレイトのヘッダーに現れるライフタイムも含まれません）。

* `impl` ヘッダーでは、すべての型が入力です。したがって `impl Trait<&T> for Struct<&T>` では入力の位置でライフタイムが 2 つ省略されており、`impl Struct<&T>` では 1 つ省略されています。

省略の規則は次のとおりです。

* 入力の位置で省略されたライフタイムは、それぞれ別々のライフタイムパラメータになります。

* 入力のライフタイムの位置がちょうど 1 つだけある場合（省略されているかどうかは問いません）、そのライフタイムが、省略された出力ライフタイムの*すべて*に割り当てられます。

* 入力のライフタイムの位置が複数あっても、そのうちの 1 つが `&self` または `&mut self` である場合は、`self` のライフタイムが、省略された出力ライフタイムの*すべて*に割り当てられます。

* それ以外の場合、出力ライフタイムを省略するとエラーになります。

例:

<!-- ignore: simplified code -->
```rust
fn print(s: &str);                                      // elided
fn print<'a>(s: &'a str);                               // expanded

fn debug(lvl: usize, s: &str);                          // elided
fn debug<'a>(lvl: usize, s: &'a str);                   // expanded

fn substr(s: &str, until: usize) -> &str;               // elided
fn substr<'a>(s: &'a str, until: usize) -> &'a str;     // expanded

fn get_str() -> &str;                                   // ILLEGAL

fn frob(s: &str, t: &str) -> &str;                      // ILLEGAL

fn get_mut(&mut self) -> &mut T;                        // elided
fn get_mut<'a>(&'a mut self) -> &'a mut T;              // expanded

fn args<T: ToCStr>(&mut self, args: &[T]) -> &mut Command                  // elided
fn args<'a, 'b, T: ToCStr>(&'a mut self, args: &'b [T]) -> &'a mut Command // expanded

fn new(buf: &mut [u8]) -> BufWriter;                    // elided
fn new(buf: &mut [u8]) -> BufWriter<'_>;                // elided (with `rust_2018_idioms`)
fn new<'a>(buf: &'a mut [u8]) -> BufWriter<'a>          // expanded
```
{% endraw %}
