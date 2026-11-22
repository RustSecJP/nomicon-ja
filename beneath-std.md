{% raw %}
# `std` の下 {#beneath-std}

この節では、ふだんは `std` クレートが提供している機能のうち、`#![no_std]` のバイナリクレートをビルドするために `#![no_std]` の開発者が自分で対処しなければならない（つまり、自分で用意しなければならない）ものを説明します。

## `libc` を使う {#using-libc}

`#[no_std]` の実行ファイルをビルドするには、依存として `libc` が必要です。
これは `Cargo.toml` ファイルで指定できます。

```toml
[dependencies]
libc = { version = "0.2.146", default-features = false }
```

既定のフィーチャーを無効にしていることに注意してください。これは欠かせない手順です。**`libc` の既定のフィーチャーには `std` クレートが含まれているので、無効にしなければなりません。**

別の方法として、不安定な非公開フィーチャー `rustc_private` を、下の例に示すように `extern crate libc;` の宣言と組み合わせて使うこともできます。なお、windows-msvc のターゲットは libc を必要としないので、そのターゲットの sysroot には `libc` クレートがありません。その場合、下の `extern crate libc;` は不要で、windows-msvc のターゲットでこれを書くとコンパイルエラーになります。

## `std` なしで実行ファイルを書く {#writing-an-executable-without-std}

`#![no_std]` の実行ファイルを作るには、おそらく nightly 版のコンパイラが必要です。多くのプラットフォームでは `eh_personality` という[言語アイテム（lang item）][lang item]を用意しなければならず、これが不安定だからです。

エントリポイントとして、ターゲットに合ったシンボルを定義する必要があります。たとえば `main`、`_start`、`WinMain` など、ターゲットに応じた開始点です。
加えて、コンパイラが自分でエントリポイントを生成しようとするのを防ぐために、`#![no_main]` 属性を使う必要があります。

さらに、[パニックハンドラ関数](panic-handler.html)を定義することも必須です。

```rust
#![feature(lang_items, core_intrinsics, rustc_private)]
#![allow(internal_features)]
#![no_std]
#![no_main]

// Necessary for `panic = "unwind"` builds on cfg(unix) platforms.
#![feature(panic_unwind)]
extern crate unwind;

// Pull in the system libc library for what crt0.o likely requires.
#[cfg(not(windows))]
extern crate libc;

use core::ffi::{c_char, c_int};
use core::panic::PanicInfo;

// Entry point for this program.
#[unsafe(no_mangle)] // ensure that this symbol is included in the output as `main`
extern "C" fn main(_argc: c_int, _argv: *const *const c_char) -> c_int {
    0
}

// These functions are used by the compiler, but not for an empty program like this.
// They are normally provided by `std`.
#[lang = "eh_personality"]
fn rust_eh_personality() {}
#[panic_handler]
fn panic_handler(_info: &PanicInfo) -> ! { core::intrinsics::abort_immediate() }
```

rustup で標準ライブラリのバイナリリリースが手に入らないターゲットを扱っていて（これはおそらく、`core` クレートを自分でビルドしているということです）、compiler-rt の組み込み関数（intrinsics）が必要な場合（つまり、実行ファイルをビルドするときに ``undefined reference to `__aeabi_memcpy'`` のようなリンカエラーが出ている場合）は、[`compiler_builtins` クレート]を手動でリンクして、それらの組み込み関数を取り込み、リンカエラーを解消する必要があります。

[`compiler_builtins` クレート]: https://crates.io/crates/compiler_builtins
[lang item]: https://doc.rust-lang.org/nightly/unstable-book/language-features/lang-items.html
{% endraw %}
