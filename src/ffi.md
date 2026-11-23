# 他言語関数インターフェース（Foreign Function Interface） {#foreign-function-interface}

## はじめに {#introduction}

この手引きでは、圧縮・展開ライブラリの [snappy](https://github.com/google/snappy) を題材にして、外部のコードに対するバインディングの書き方を紹介します。Rust は今のところ C++ のライブラリを直接呼び出せませんが、snappy には C のインターフェースが含まれています（[`snappy-c.h`](https://github.com/google/snappy/blob/master/snappy-c.h) に説明があります）。

## libc についての注意 {#a-note-about-libc}

ここで挙げる例の多くは [`libc` クレート][libc]を使います。このクレートは、C の型に対応するさまざまな型定義などを提供しています。これらの例を自分で試す場合は、`Cargo.toml` に `libc` を追加する必要があります。

```toml
[dependencies]
libc = "0.2.0"
```

[libc]: https://crates.io/crates/libc

## ビルドスクリプトを用意する {#prepare-the-build-script}

[snappy](https://github.com/google/snappy) は既定では静的ライブラリなので、出力される成果物には stdc++ がリンクされません。この外部ライブラリを Rust で使うには、stdc++ をプロジェクトにリンクしたいということを手動で指定しなければなりません。いちばん簡単な方法は、ビルドスクリプトを用意することです。

まず `Cargo.toml` を編集し、`package` の中に `build = "build.rs"` を追加します。
```toml
[package]
...
build = "build.rs"
```

次に、ワークスペースのルートに `build.rs` という名前の新しいファイルを作ります。
```rust
// build.rs
fn main() {
    println!("cargo:rustc-link-lib=dylib=stdc++"); // This line may be unnecessary for some environments.
    println!("cargo:rustc-link-search=<YOUR SNAPPY LIBRARY PATH>");
}
```

詳しくは、[The Cargo Book - build script](https://doc.rust-lang.org/cargo/reference/build-scripts.html) を読んでください。


## 外部関数を呼び出す {#calling-foreign-functions}

次に示すのは、外部関数を呼び出す最小限の例です。snappy がインストールされていればコンパイルできます。

<!-- ignore: requires libc crate -->
```rust,ignore
use libc::size_t;

#[link(name = "snappy")]
unsafe extern "C" {
    fn snappy_max_compressed_length(source_length: size_t) -> size_t;
}

fn main() {
    let x = unsafe { snappy_max_compressed_length(100) };
    println!("max compressed length of a 100 byte buffer: {}", x);
}
```

`extern` ブロックは、外部ライブラリにある関数のシグネチャを並べたものです。この例では、プラットフォームの C ABI を使います。`#[link(...)]` 属性は、シンボルを解決できるように snappy ライブラリとリンクするよう、リンカに指示するために使います。

外部関数は unsafe であるとみなされます。そのため、呼び出しは `unsafe {}` で包む必要があります。これは、中に含まれるものすべてが本当に安全であるという、コンパイラに対する約束です。C のライブラリは、スレッドセーフでないインターフェースを公開していることがよくあります。また、ポインタを引数に取る関数のほとんどは、あり得るすべての入力に対して有効というわけではありません。ポインタがダングリングしている（無効な場所を指している）かもしれませんし、生ポインタは Rust の安全なメモリモデルの外にあるからです。

外部関数の引数の型を宣言するとき、Rust コンパイラはその宣言が正しいかどうかを検査できません。そのため、宣言を正しく書くことが、バインディングを実行時に正しく保つことの一部になります。

`extern` ブロックは、snappy の API 全体を含むように広げられます。

<!-- ignore: requires libc crate -->
```rust,ignore
use libc::{c_int, size_t};

#[link(name = "snappy")]
unsafe extern "C" {
    fn snappy_compress(input: *const u8,
                       input_length: size_t,
                       compressed: *mut u8,
                       compressed_length: *mut size_t) -> c_int;
    fn snappy_uncompress(compressed: *const u8,
                         compressed_length: size_t,
                         uncompressed: *mut u8,
                         uncompressed_length: *mut size_t) -> c_int;
    fn snappy_max_compressed_length(source_length: size_t) -> size_t;
    fn snappy_uncompressed_length(compressed: *const u8,
                                  compressed_length: size_t,
                                  result: *mut size_t) -> c_int;
    fn snappy_validate_compressed_buffer(compressed: *const u8,
                                         compressed_length: size_t) -> c_int;
}
# fn main() {}
```

## 安全なインターフェースを作る {#creating-a-safe-interface}

生の C API は、メモリ安全性を提供し、ベクタのような高水準の概念を使えるようにするために、包む必要があります。ライブラリは、安全で高水準なインターフェースだけを公開し、unsafe な内部の詳細を隠すことを選べます。

バッファを受け取る関数を包むには、`slice::raw` モジュールを使って、Rust のベクタをメモリへのポインタとして操作します。Rust のベクタは、連続したメモリのかたまりであることが保証されています。長さは今入っている要素の数で、容量は割り当て済みのメモリの大きさを要素数で表したものです。長さは容量以下です。

<!-- ignore: requires libc crate -->
```rust,ignore
# use libc::{c_int, size_t};
# unsafe fn snappy_validate_compressed_buffer(_: *const u8, _: size_t) -> c_int { 0 }
# fn main() {}
pub fn validate_compressed_buffer(src: &[u8]) -> bool {
    unsafe {
        snappy_validate_compressed_buffer(src.as_ptr(), src.len() as size_t) == 0
    }
}
```

上の `validate_compressed_buffer` というラッパーは `unsafe` ブロックを使っています。しかし、関数のシグネチャに `unsafe` を付けないことで、どんな入力に対しても呼び出しが安全であることを保証しています。

`snappy_compress` 関数と `snappy_uncompress` 関数はもっと複雑です。出力を入れるバッファも割り当てなければならないからです。

`snappy_max_compressed_length` 関数を使うと、圧縮後の出力を入れるのに必要な最大の容量を持つベクタを割り当てられます。そのベクタを、出力引数として `snappy_compress` 関数に渡せます。さらに、圧縮後の本当の長さを受け取って長さを設定するために、もう 1 つ出力引数を渡します。

<!-- ignore: requires libc crate -->
```rust,ignore
# use libc::{size_t, c_int};
# unsafe fn snappy_compress(a: *const u8, b: size_t, c: *mut u8,
#                           d: *mut size_t) -> c_int { 0 }
# unsafe fn snappy_max_compressed_length(a: size_t) -> size_t { a }
# fn main() {}
pub fn compress(src: &[u8]) -> Vec<u8> {
    unsafe {
        let srclen = src.len() as size_t;
        let psrc = src.as_ptr();

        let mut dstlen = snappy_max_compressed_length(srclen);
        let mut dst = Vec::with_capacity(dstlen as usize);
        let pdst = dst.as_mut_ptr();

        snappy_compress(psrc, srclen, pdst, &mut dstlen);
        dst.set_len(dstlen as usize);
        dst
    }
}
```

展開も同じようにできます。snappy は圧縮形式の一部として展開後の大きさを保存していて、`snappy_uncompressed_length` で必要なバッファの大きさを正確に取得できるからです。

<!-- ignore: requires libc crate -->
```rust,ignore
# use libc::{size_t, c_int};
# unsafe fn snappy_uncompress(compressed: *const u8,
#                             compressed_length: size_t,
#                             uncompressed: *mut u8,
#                             uncompressed_length: *mut size_t) -> c_int { 0 }
# unsafe fn snappy_uncompressed_length(compressed: *const u8,
#                                      compressed_length: size_t,
#                                      result: *mut size_t) -> c_int { 0 }
# fn main() {}
pub fn uncompress(src: &[u8]) -> Option<Vec<u8>> {
    unsafe {
        let srclen = src.len() as size_t;
        let psrc = src.as_ptr();

        let mut dstlen: size_t = 0;
        snappy_uncompressed_length(psrc, srclen, &mut dstlen);

        let mut dst = Vec::with_capacity(dstlen as usize);
        let pdst = dst.as_mut_ptr();

        if snappy_uncompress(psrc, srclen, pdst, &mut dstlen) == 0 {
            dst.set_len(dstlen as usize);
            Some(dst)
        } else {
            None // SNAPPY_INVALID_INPUT
        }
    }
}
```

それでは、使い方を示すためにテストをいくつか追加しましょう。

<!-- ignore: requires libc crate -->
```rust,ignore
# use libc::{c_int, size_t};
# unsafe fn snappy_compress(input: *const u8,
#                           input_length: size_t,
#                           compressed: *mut u8,
#                           compressed_length: *mut size_t)
#                           -> c_int { 0 }
# unsafe fn snappy_uncompress(compressed: *const u8,
#                             compressed_length: size_t,
#                             uncompressed: *mut u8,
#                             uncompressed_length: *mut size_t)
#                             -> c_int { 0 }
# unsafe fn snappy_max_compressed_length(source_length: size_t) -> size_t { 0 }
# unsafe fn snappy_uncompressed_length(compressed: *const u8,
#                                      compressed_length: size_t,
#                                      result: *mut size_t)
#                                      -> c_int { 0 }
# unsafe fn snappy_validate_compressed_buffer(compressed: *const u8,
#                                             compressed_length: size_t)
#                                             -> c_int { 0 }
# fn main() { }
#
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid() {
        let d = vec![0xde, 0xad, 0xd0, 0x0d];
        let c: &[u8] = &compress(&d);
        assert!(validate_compressed_buffer(c));
        assert!(uncompress(c) == Some(d));
    }

    #[test]
    fn invalid() {
        let d = vec![0, 0, 0, 0];
        assert!(!validate_compressed_buffer(&d));
        assert!(uncompress(&d).is_none());
    }

    #[test]
    fn empty() {
        let d = vec![];
        assert!(!validate_compressed_buffer(&d));
        assert!(uncompress(&d).is_none());
        let c = compress(&d);
        assert!(validate_compressed_buffer(&c));
        assert!(uncompress(&c) == Some(d));
    }
}
```

## デストラクタ {#destructors}

外部ライブラリは、リソースの所有権を呼び出し側のコードに渡すことがよくあります。その場合は、Rust のデストラクタを使って安全性を確保し、リソースが（特にパニックが起きたときに）確実に解放されるようにしなければなりません。

デストラクタについて詳しくは、[Drop トレイト](https://doc.rust-lang.org/std/ops/trait.Drop.html)を参照してください。

## C から Rust のコードを呼び出す {#calling-rust-code-from-c}

Rust のコードを、C から呼び出せる形でコンパイルしたいことがあります。これはかなり簡単ですが、いくつか必要なことがあります。

### Rust 側 {#rust-side}

まず、`rust_from_c` という名前のライブラリクレートがあるとします。`lib.rs` には、次のような Rust のコードを書きます。

```rust
#[unsafe(no_mangle)]
pub extern "C" fn hello_from_rust() {
    println!("Hello from Rust!");
}
# fn main() {}
```

`extern "C"` を付けると、この関数は C の呼び出し規約に従うようになります。呼び出し規約については、後の「[外部の呼び出し規約][Foreign Calling Conventions]」で説明します。`no_mangle` 属性は、Rust の名前マングリング（シンボル名の変換）を無効にします。これにより、リンク先としてはっきり定まったシンボルが得られます。

次に、Rust のコードを C から呼び出せる共有ライブラリとしてコンパイルするために、`Cargo.toml` に次の内容を追加します。

```toml
[lib]
crate-type = ["cdylib"]
```

（注: クレートの種類として `staticlib` を使うこともできますが、その場合はリンク用のフラグをいくつか調整する必要があります。）

`cargo build` を実行すれば、Rust 側の準備は完了です。

[Foreign Calling Conventions]: ffi.html#foreign-calling-conventions

### C 側 {#c-side}

`hello_from_rust` 関数を呼び出す C のファイルを作り、`gcc` でコンパイルします。

C のファイルは次のようになります。

```c
extern void hello_from_rust();

int main(void) {
    hello_from_rust();
    return 0;
}
```

このファイルに `call_rust.c` という名前を付けて、クレートのルートに置きます。次のコマンドを実行してコンパイルします。

```sh
gcc call_rust.c -o call_rust -lrust_from_c -L./target/debug
```

`-l` と `-L` は、私たちの Rust ライブラリを探すよう gcc に伝えます。

最後に、`LD_LIBRARY_PATH` を指定すれば、C から Rust のコードを呼び出せます。

```sh
$ LD_LIBRARY_PATH=./target/debug ./call_rust
Hello from Rust!
```

これで完了です。もっと実際に近い例については、[`cbindgen`] を見てください。

[`cbindgen`]: https://github.com/eqrion/cbindgen

## C のコードから Rust の関数へのコールバック {#callbacks-from-c-code-to-rust-functions}

外部ライブラリの中には、現在の状態や途中のデータを呼び出し側に伝えるために、コールバックを使う必要があるものがあります。Rust で定義した関数を、外部ライブラリに渡すことができます。そのためには、C のコードから呼び出せるように、コールバック関数に正しい呼び出し規約の `extern` を付ける必要があります。

そうすれば、コールバック関数を登録用の呼び出しを通じて C のライブラリに渡し、あとでそこから呼び出してもらえます。

基本的な例は次のとおりです。

Rust のコード:

```rust,no_run
extern fn callback(a: i32) {
    println!("I'm called from C with value {0}", a);
}

#[link(name = "extlib")]
unsafe extern "C" {
   fn register_callback(cb: extern fn(i32)) -> i32;
   fn trigger_callback();
}

fn main() {
    unsafe {
        register_callback(callback);
        trigger_callback(); // Triggers the callback.
    }
}
```

C のコード:

```c
typedef void (*rust_callback)(int32_t);
rust_callback cb;

int32_t register_callback(rust_callback callback) {
    cb = callback;
    return 1;
}

void trigger_callback() {
  cb(7); // Will call callback(7) in Rust.
}
```

この例では、Rust の `main()` が C の `trigger_callback()` を呼び出し、それが今度は Rust の `callback()` を呼び返します。

## Rust のオブジェクトに向けたコールバック {#targeting-callbacks-to-rust-objects}

前の例では、グローバルな関数を C のコードから呼び出す方法を示しました。しかし、コールバックを特定の Rust オブジェクトに向けたいことがよくあります。たとえば、対応する C のオブジェクトを包むラッパーを表すオブジェクトです。

これは、そのオブジェクトへの生ポインタを C のライブラリに渡すことで実現できます。C のライブラリは、通知に Rust オブジェクトへのポインタを含められます。これにより、コールバックは参照先の Rust オブジェクトに unsafe にアクセスできます。

Rust のコード:

```rust,no_run
struct RustObject {
    a: i32,
    // Other members...
}

unsafe extern "C" fn callback(target: *mut RustObject, a: i32) {
    println!("I'm called from C with value {0}", a);
    unsafe {
        // Update the value in RustObject with the value received from the callback:
        (*target).a = a;
    }
}

#[link(name = "extlib")]
unsafe extern "C" {
   fn register_callback(target: *mut RustObject,
                        cb: unsafe extern "C" fn(*mut RustObject, i32)) -> i32;
   fn trigger_callback();
}

fn main() {
    // Create the object that will be referenced in the callback:
    let mut rust_object = Box::new(RustObject { a: 5 });

    unsafe {
        register_callback(&mut *rust_object, callback);
        trigger_callback();
    }
}
```

C のコード:

```c
typedef void (*rust_callback)(void*, int32_t);
void* cb_target;
rust_callback cb;

int32_t register_callback(void* callback_target, rust_callback callback) {
    cb_target = callback_target;
    cb = callback;
    return 1;
}

void trigger_callback() {
  cb(cb_target, 7); // Will call callback(&rustObject, 7) in Rust.
}
```

## 非同期のコールバック {#asynchronous-callbacks}

ここまでの例では、コールバックは、外部の C ライブラリへの関数呼び出しに対する直接の反応として呼び出されていました。コールバックを実行するために、現在のスレッドの制御は Rust から C へ、そして再び Rust へと移ります。しかし結局のところ、コールバックは、それを引き起こした関数を呼び出したのと同じスレッドで実行されます。

外部ライブラリが自分でスレッドを立ち上げ、そこからコールバックを呼び出す場合は、話がもっと複雑になります。こうした場合、コールバックの中で Rust のデータ構造にアクセスするのは特に安全でなく、適切な同期の仕組みを使わなければなりません。ミューテックスのような昔ながらの同期の仕組みのほかに、Rust ではチャネル（`std::sync::mpsc` にあります）を使う方法もあります。コールバックを呼び出した C のスレッドから Rust のスレッドへ、チャネルでデータを送るのです。

非同期のコールバックが Rust のアドレス空間にある特定のオブジェクトに向けられている場合は、そのオブジェクトが破棄されたあとで C のライブラリがコールバックをいっさい実行しないことも、絶対に必要です。これは、オブジェクトのデストラクタでコールバックの登録を解除し、登録を解除したあとはコールバックが実行されないと保証できるようにライブラリを設計することで実現できます。

## リンク {#linking}

`extern` ブロックに付ける `link` 属性は、ネイティブライブラリとどうリンクするかを rustc に指示するための基本的な部品です。現在、link 属性には次の 2 つの形式が認められています。

* `#[link(name = "foo")]`
* `#[link(name = "foo", kind = "bar")]`

どちらの場合も、`foo` はリンクするネイティブライブラリの名前です。2 つ目の場合の `bar` は、コンパイラがリンクするネイティブライブラリの種類です。現在知られているネイティブライブラリの種類は、次の 3 つです。

* 動的 - `#[link(name = "readline")]`
* 静的 - `#[link(name = "my_build_dependency", kind = "static")]`
* フレームワーク - `#[link(name = "CoreFoundation", kind = "framework")]`

フレームワークは macOS のターゲットでしか使えないことに注意してください。

`kind` の値の違いは、ネイティブライブラリがリンクにどう関わるかを区別するためのものです。リンクの観点から見ると、Rust コンパイラは 2 種類の成果物を作ります。部分的なもの（rlib / staticlib）と、最終的なもの（dylib / バイナリ）です。ネイティブの動的ライブラリとフレームワークへの依存は、最終的な成果物の境界まで伝わります。一方、静的ライブラリへの依存はまったく伝わりません。静的ライブラリは、後続の成果物に直接組み込まれるからです。

このモデルの使い方の例を、いくつか挙げます。

* ネイティブのビルド依存。Rust のコードを書いていると、C / C++ のつなぎのコードが必要になることがあります。しかし、その C / C++ のコードをライブラリの形式で配布するのは負担です。この場合、コードは `libfoo.a` にまとめられ、Rust のクレートは `#[link(name = "foo", kind = "static")]` によって依存を宣言します。

  クレートの出力がどの種類であっても、ネイティブの静的ライブラリは出力に含まれます。つまり、ネイティブの静的ライブラリを配布する必要はありません。

* 通常の動的な依存。よく使われるシステムライブラリ（`readline` など）は多くのシステムで利用できますが、そうしたライブラリの静的な複製は見つからないことがよくあります。この依存を Rust のクレートに含めた場合、部分的なターゲット（rlib など）はライブラリとリンクしません。しかし、その rlib が最終的なターゲット（バイナリなど）に含まれるときに、ネイティブライブラリがリンクされます。

macOS では、フレームワークは動的ライブラリと同じ意味論でふるまいます。

## unsafe ブロック {#unsafe-blocks}

生ポインタの参照外しや、unsafe と印が付いた関数の呼び出しなど、一部の操作は unsafe ブロックの中でしか許されません。unsafe ブロックは unsafe な部分を切り離すものであり、その unsafe さがブロックの外に漏れ出さないという、コンパイラに対する約束です。

一方、unsafe な関数は、unsafe であることを外の世界に知らせます。unsafe な関数は次のように書きます。

```rust
unsafe fn kaboom(ptr: *const i32) -> i32 { *ptr }
```

この関数は、`unsafe` ブロックか、別の `unsafe` な関数からしか呼び出せません。

## 外部のグローバル変数にアクセスする {#accessing-foreign-globals}

外部の API は、グローバルな状態の追跡などに使うグローバル変数を公開していることがよくあります。こうした変数にアクセスするには、`extern` ブロックの中で `static` キーワードを付けて宣言します。

<!-- ignore: requires libc crate -->
```rust,ignore
#[link(name = "readline")]
unsafe extern "C" {
    static rl_readline_version: libc::c_int;
}

fn main() {
    println!("You have readline version {} installed.",
             unsafe { rl_readline_version as i32 });
}
```

あるいは、外部のインターフェースが提供するグローバルな状態を書き換える必要があるかもしれません。そのためには、static を `mut` 付きで宣言して、変更できるようにします。

<!-- ignore: requires libc crate -->
```rust,ignore
use std::ffi::CString;
use std::ptr;

#[link(name = "readline")]
unsafe extern "C" {
    static mut rl_prompt: *const libc::c_char;
}

fn main() {
    let prompt = CString::new("[my-awesome-shell] $").unwrap();
    unsafe {
        rl_prompt = prompt.as_ptr();

        println!("{:?}", rl_prompt);

        rl_prompt = ptr::null();
    }
}
```

`static mut` とのやり取りは、読み取りも書き込みも、すべて unsafe であることに注意してください。変更可能なグローバルな状態を扱うには、細心の注意が必要です。

## 外部の呼び出し規約 {#foreign-calling-conventions}

外部のコードのほとんどは C ABI を公開しています。Rust は、外部関数を呼び出すときに、既定ではプラットフォームの C の呼び出し規約を使います。しかし、外部関数の中には、ほかの呼び出し規約を使うものもあります。代表的なのは Windows API です。Rust には、どの規約を使うかをコンパイラに伝える方法があります。

<!-- ignore: requires libc crate -->
```rust,ignore
#[cfg(all(target_os = "win32", target_arch = "x86"))]
#[link(name = "kernel32")]
#[allow(non_snake_case)]
unsafe extern "stdcall" {
    fn SetEnvironmentVariableA(n: *const u8, v: *const u8) -> libc::c_int;
}
# fn main() { }
```

これは `extern` ブロック全体に適用されます。サポートされている ABI の指定は、次のとおりです。

* `stdcall`
* `aapcs`
* `cdecl`
* `fastcall`
* `thiscall`
* `vectorcall`
これは今のところ `abi_vectorcall` ゲートの後ろに隠されていて、変更される可能性があります。
* `Rust`
* `system`
* `C`
* `win64`
* `sysv64`

この一覧の ABI のほとんどは名前から意味が分かりますが、`system` ABI は少し変わって見えるかもしれません。この指定は、ターゲットのライブラリと相互運用するのに適切な ABI を、それが何であれ選びます。たとえば、x86 アーキテクチャの win32 では、使われる ABI は `stdcall` になります。一方、x86_64 では、Windows は `C` の呼び出し規約を使うので、`C` が使われます。つまり、先ほどの例では `extern "system" { ... }` を使って、x86 だけでなくすべての Windows システム向けのブロックを定義することもできました。

## 外部のコードとの相互運用 {#interoperability-with-foreign-code}

Rust は、`#[repr(C)]` 属性が付いている場合に限り、`struct` のレイアウトがプラットフォームの C での表現と互換であることを保証します。`#[repr(C, packed)]` を使うと、構造体のメンバーをパディングなしで配置できます。`#[repr(C)]` は列挙型にも付けられます。

Rust の所有権を持つボックス（`Box<T>`）は、中のオブジェクトを指すハンドルとして、null にならないポインタを使います。ただし、ボックスは内部のアロケータによって管理されているので、手動で作るべきではありません。参照は、その型を直接指す null にならないポインタであると、安全に仮定できます。しかし、借用検査や可変性の規則を破ることは、安全であると保証されていません。そのため、規則を破る必要があるなら、生ポインタ（`*`）を使うほうがよいでしょう。コンパイラは、生ポインタについてはそれほど多くのことを仮定できないからです。

ベクタと文字列は基本的なメモリレイアウトが同じで、C の API を扱うための便利な機能が `vec` モジュールと `str` モジュールにあります。ただし、文字列は `\0` で終端されていません。C との相互運用のために NUL 終端の文字列が必要な場合は、`std::ffi` モジュールの `CString` 型を使ってください。

[crates.io の `libc` クレート][libc]は、`libc` モジュールに C 標準ライブラリの型エイリアスと関数定義を含んでいます。また、Rust は既定で `libc` と `libm` をリンクします。

## 可変長引数の関数 {#variadic-functions}

C では、関数を「可変長引数（variadic）」にできます。つまり、可変個の引数を受け取れるということです。Rust では、外部関数の宣言の引数リストに `...` を指定することで、これを実現できます。

```no_run
unsafe extern "C" {
    fn foo(x: i32, ...);
}

fn main() {
    unsafe {
        foo(10, 20, 30, 40, 50);
    }
}
```

通常の Rust の関数は、可変長引数に*できません*。

```rust,compile_fail
// This will not compile

fn foo(x: i32, ...) {}
```

## 「null 許容ポインタ最適化」 {#the-nullable-pointer-optimization}

Rust の一部の型は、決して `null` にならないものとして定義されています。これには、参照（`&T`、`&mut T`）、ボックス（`Box<T>`）、関数ポインタ（`extern "abi" fn()`）が含まれます。C とやり取りするときは、`null` かもしれないポインタがよく使われます。そのため、Rust の型との間の変換を扱うには、面倒な `transmute` や unsafe なコードが必要になるように思えます。しかし、こうした無効な値を作ったり扱ったりしようとすることは**未定義動作（undefined behavior）です**。そこで、代わりに次の回避策を使ってください。

特別な場合として、`enum` がちょうど 2 つのヴァリアントを持ち、一方がデータを持たず、もう一方が上に挙げた null にならない型のいずれかのフィールドを 1 つ持つ場合、その `enum` は「null 許容ポインタ最適化（nullable pointer optimization）」の対象になります。これは、判別子のための余分な領域が要らないということです。代わりに、空のヴァリアントは、null にならないフィールドに `null` の値を入れることで表されます。これは「最適化」と呼ばれていますが、ほかの最適化とは違って、対象となる型には必ず適用されることが保証されています。

null 許容ポインタ最適化を利用する型でいちばんよく使われるのは `Option<T>` で、`None` が `null` に対応します。そのため、`Option<extern "C" fn(c_int) -> c_int>` は、C ABI を使う null 許容の関数ポインタ（C の型 `int (*)(int)` に対応します）を表す正しい方法です。

作為的な例を挙げます。ある C のライブラリに、特定の状況で呼び出されるコールバックを登録する機能があるとしましょう。コールバックには関数ポインタと整数が渡され、コールバックはその整数を引数としてその関数を実行することになっています。つまり、関数ポインタが FFI の境界を両方向に飛び交うわけです。

<!-- ignore: requires libc crate -->
```rust,ignore
use libc::c_int;

# #[cfg(hidden)]
unsafe extern "C" {
    /// Registers the callback.
    fn register(cb: Option<extern "C" fn(Option<extern "C" fn(c_int) -> c_int>, c_int) -> c_int>);
}
# unsafe fn register(_: Option<extern "C" fn(Option<extern "C" fn(c_int) -> c_int>,
#                                            c_int) -> c_int>)
# {}

/// This fairly useless function receives a function pointer and an integer
/// from C, and returns the result of calling the function with the integer.
/// In case no function is provided, it squares the integer by default.
extern "C" fn apply(process: Option<extern "C" fn(c_int) -> c_int>, int: c_int) -> c_int {
    match process {
        Some(f) => f(int),
        None    => int * int
    }
}

fn main() {
    unsafe {
        register(Some(apply));
    }
}
```

そして、C 側のコードは次のようになります。

```c
void register(int (*f)(int (*)(int), int)) {
    ...
}
```

`transmute` は必要ありません。

## FFI と巻き戻し {#ffi-and-unwinding}

FFI を扱うときは、巻き戻し（unwinding）に気を配ることが大切です。ほとんどの ABI 文字列には、`-unwind` という接尾辞が付いたものと付かないものの 2 種類があります。`Rust` ABI は常に巻き戻しを許すので、`Rust-unwind` という ABI はありません。

Rust の `panic` や外部の例外（C++ の例外など）が FFI の境界を越えることを想定しているなら、その境界には適切な `-unwind` 付きの ABI 文字列を使わなければなりません。逆に、巻き戻しが ABI の境界を越えることを想定していないなら、`unwind` の付かない ABI 文字列のいずれかを使ってください。

> 注: `panic=abort` を指定してコンパイルした場合は、`panic` を起こす関数がどの ABI を指定していても、`panic!` はやはりプロセスを直ちに中断（アボート）します。

巻き戻しの処理が、巻き戻しを許されていない ABI の境界に実際に行き当たった場合、そのふるまいは巻き戻しの発生源（Rust の `panic` か、外部の例外か）によって変わります。

* `panic` の場合は、プロセスが安全に中断されます。
* 外部の例外が Rust に入ってきた場合は、未定義動作になります。

`catch_unwind` と外部の例外との相互作用は**未定義**であることに注意してください。`panic` と外部の例外捕捉の仕組み（特に C++ の `try` / `catch`）との相互作用も同じく未定義です。

### `"C-unwind"` での Rust の `panic` {#rust-panic-with-c-unwind}

<!-- ignore: using unstable feature -->
```rust,ignore
#[unsafe(no_mangle)]
unsafe extern "C-unwind" fn example() {
    panic!("Uh oh");
}
```

この関数は（`panic=unwind` を指定してコンパイルした場合）、C++ のスタックフレームを巻き戻すことを許されています。

```text
[Rust function with `catch_unwind`, which stops the unwinding]
      |
     ...
      |
[C++ frames]
      |                           ^
      | (calls)                   | (unwinding
      v                           |  goes this
[Rust function `example`]         |  way)
      |                           |
      +--- rust function panics --+
```

C++ のフレームにオブジェクトがあれば、そのデストラクタが呼び出されます。

### `"C-unwind"` での C++ の `throw` {#c-throw-with-c-unwind}

<!-- ignore: using unstable feature -->
```rust,ignore
#[link(...)]
unsafe extern "C-unwind" {
    // A C++ function that may throw an exception
    fn may_throw();
}

#[unsafe(no_mangle)]
unsafe extern "C-unwind" fn rust_passthrough() {
    let b = Box::new(5);
    unsafe { may_throw(); }
    println!("{:?}", &b);
}
```

`try` ブロックを持つ C++ の関数は、`rust_passthrough` を呼び出して、`may_throw` が投げた例外を `catch` できます。

```text
[C++ function with `try` block that invokes `rust_passthrough`]
      |
     ...
      |
[Rust function `rust_passthrough`]
      |                            ^
      | (calls)                    | (unwinding
      v                            |  goes this
[C++ function `may_throw`]         |  way)
      |                            |
      +--- C++ function throws ----+
```

`may_throw` が実際に例外を投げた場合は、`b` がドロップされます。そうでなければ、`5` が表示されます。

### `panic` は ABI の境界で止められる {#panic-can-be-stopped-at-an-abi-boundary}

```rust
#[unsafe(no_mangle)]
extern "C" fn assert_nonzero(input: u32) {
    assert!(input != 0)
}
```

`assert_nonzero` が引数 `0` で呼び出された場合、`panic=abort` を指定してコンパイルしたかどうかにかかわらず、ランタイムがプロセスを（安全に）中断することが保証されています。

### `panic` をあらかじめ捕捉する {#catching-panic-preemptively}

パニックするかもしれない Rust のコードを書いていて、パニックしたときにプロセスを中断させたくない場合は、[`catch_unwind`] を使わなければなりません。

```rust
use std::panic::catch_unwind;

#[unsafe(no_mangle)]
pub extern "C" fn oh_no() -> i32 {
    let result = catch_unwind(|| {
        panic!("Oops!");
    });
    match result {
        Ok(_) => 0,
        Err(_) => 1,
    }
}

fn main() {}
```

[`catch_unwind`] が捕捉するのは巻き戻しを行うパニックだけで、プロセスを中断するパニックは捕捉しないことに注意してください。詳しくは [`catch_unwind`] のドキュメントを参照してください。

[`catch_unwind`]: https://doc.rust-lang.org/std/panic/fn.catch_unwind.html

## 不透明な構造体を表す {#representing-opaque-structs}

C のライブラリが、何かへのポインタは渡したいけれども、その中身の詳細は知らせたくない、ということがあります。安定していて簡単な方法は、`void *` の引数を使うことです。

```c
void foo(void *arg);
void bar(void *arg);
```

Rust では、これを `c_void` 型で表せます。

<!-- ignore: requires libc crate -->
```rust,ignore
unsafe extern "C" {
    pub fn foo(arg: *mut libc::c_void);
    pub fn bar(arg: *mut libc::c_void);
}
# fn main() {}
```

これは、この状況を扱う方法としてまったく正当です。しかし、もう少しうまくやれます。これを解決するために、一部の C のライブラリは代わりに `struct` を作り、その構造体の詳細とメモリレイアウトを非公開にします。こうすると、ある程度の型安全性が得られます。こうした構造体は「不透明（opaque）」と呼ばれます。C での例を示します。

```c
struct Foo; /* Foo is a structure, but its contents are not part of the public interface */
struct Bar;
void foo(struct Foo *arg);
void bar(struct Bar *arg);
```

Rust でこれを行うために、独自の不透明な型を作りましょう。

```rust
#[repr(C)]
pub struct Foo {
    _data: (),
    _marker:
        core::marker::PhantomData<(*mut u8, core::marker::PhantomPinned)>,
}
#[repr(C)]
pub struct Bar {
    _data: (),
    _marker:
        core::marker::PhantomData<(*mut u8, core::marker::PhantomPinned)>,
}

unsafe extern "C" {
    pub fn foo(arg: *mut Foo);
    pub fn bar(arg: *mut Bar);
}
# fn main() {}
```

非公開のフィールドを少なくとも 1 つ含め、コンストラクタを用意しないことで、このモジュールの外ではインスタンスを作れない不透明な型になります。（フィールドのない構造体は、誰でもインスタンスを作れてしまいます。）また、この型を FFI で使いたいので、`#[repr(C)]` を付ける必要があります。マーカーは、コンパイラがこの構造体を `Send`、`Sync`、`Unpin` として扱わないようにします。（`*mut u8` は `Send` でも `Sync` でもなく、`PhantomPinned` は `Unpin` ではありません。）

そして、`Foo` 型と `Bar` 型は別の型なので、両者の間で型安全性が得られます。そのため、`Foo` へのポインタをうっかり `bar()` に渡してしまうことはありません。

空の列挙型を FFI の型として使うのは、とてもまずい考えであることに注意してください。コンパイラは、空の列挙型には値が存在しない（uninhabited）ことを前提にしています。そのため、`&Empty` 型の値を扱うことは大きな落とし穴であり、（未定義動作を引き起こすことで）プログラムのおかしなふるまいにつながることがあります。

> **注:** いちばん簡単な方法は「extern 型（extern types）」を使うことでしょう。しかし、これは現在（2021 年 6 月時点）不安定で、未解決の問題がいくつかあります。詳しくは [RFC のページ][extern-type-rfc]と[追跡用の issue][extern-type-issue] を参照してください。

[extern-type-issue]: https://github.com/rust-lang/rust/issues/43467
[extern-type-rfc]: https://rust-lang.github.io/rfcs/1861-extern-types.html
