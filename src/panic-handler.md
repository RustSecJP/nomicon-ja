# #[panic_handler] {#panic_handler}

`#[panic_handler]` は、`#![no_std]` のアプリケーションで `panic!` のふるまいを定義するために使います。
`#[panic_handler]` 属性は、シグネチャが `fn(&PanicInfo) -> !` の関数に付けなければなりません。また、そのような関数は、バイナリ / dylib / cdylib クレートの依存グラフの中に *1 つだけ* 存在しなければなりません。`PanicInfo` の API は [API ドキュメント][API docs]にあります。

[API docs]: https://doc.rust-lang.org/core/panic/struct.PanicInfo.html

`#![no_std]` のアプリケーションには*標準*出力がありません。また、組み込みアプリケーションなど一部の `#![no_std]` アプリケーションでは、開発時とリリース時でパニックのふるまいを変える必要があります。そのため、パニッククレート、つまり `#[panic_handler]` だけを含むクレートを用意しておくと便利です。
こうしておけば、アプリケーションは、リンクするパニッククレートを取り替えるだけで、パニックのふるまいを簡単に切り替えられます。

次に示すのは、dev プロファイル（`cargo build`）でコンパイルするか、release プロファイル（`cargo build --release`）でコンパイルするかによって、アプリケーションのパニックのふるまいが変わる例です。

`panic-semihosting` クレート -- セミホスティングを使って、パニックのメッセージをホストの標準エラー出力に記録します。

<!-- ignore: simplified code -->
```rust,ignore
#![no_std]

use core::fmt::{Write, self};
use core::panic::PanicInfo;

struct HStderr {
    // ..
#     _0: (),
}
#
# impl HStderr {
#     fn new() -> HStderr { HStderr { _0: () } }
# }
#
# impl fmt::Write for HStderr {
#     fn write_str(&mut self, _: &str) -> fmt::Result { Ok(()) }
# }

#[panic_handler]
fn panic(info: &PanicInfo) -> ! {
    let mut host_stderr = HStderr::new();

    // logs "panicked at '$reason', src/main.rs:27:4" to the host stderr
    writeln!(host_stderr, "{}", info).ok();

    loop {}
}
```

`panic-halt` クレート -- パニックが起きたらスレッドを停止します。メッセージは捨てられます。

<!-- ignore: simplified code -->
```rust,ignore
#![no_std]

use core::panic::PanicInfo;

#[panic_handler]
fn panic(_info: &PanicInfo) -> ! {
    loop {}
}
```

`app` クレート:

<!-- ignore: requires the above crates -->
```rust,ignore
#![no_std]

// dev profile
#[cfg(debug_assertions)]
extern crate panic_semihosting;

// release profile
#[cfg(not(debug_assertions))]
extern crate panic_halt;

fn main() {
    // ..
}
```
