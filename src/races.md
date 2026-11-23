# データ競合と競合状態 {#data-races-and-race-conditions}

安全な Rust は、データ競合（data race）が起こらないことを保証します。データ競合は次のように定義されます。

* 2 つ以上のスレッドが、あるメモリ位置に並行してアクセスしている
* そのうち 1 つ以上が書き込みである
* そのうち 1 つ以上が同期されていない

データ競合は未定義動作（undefined behavior）であり、したがって安全な Rust では起こすことができません。データ競合は、*ほとんど* Rust の所有権システムだけで防がれています。可変参照をエイリアスすることはできないので、データ競合を起こすこともできないのです。内部可変性（interior mutability）があると話はもっと複雑になります。Send と Sync というトレイトがあるのは、主にそのためです（詳しくは次の節を参照してください）。

**しかし、Rust は一般の競合状態（race condition）を防ぎません。**

これは、スケジューラを制御できない状況では数学的に不可能であり、通常の OS 環境はそれに当てはまります。プリエンプション（preemption）を制御できるのであれば、一般の競合を防ぐことは*可能になりえます*。この手法は、[RTIC](https://github.com/rtic-rs/rtic) などのフレームワークで使われています。しかし、スケジューリングを実際に制御できるというのは、非常にまれな場合です。

このため、Rust がデッドロックしたり、誤った同期によって無意味なことをしたりするのは「安全」だとみなされます。これは、一般の競合状態、あるいはリソース競合（resource race）と呼ばれます。もちろん、そのようなプログラムはあまり良いものではありませんが、Rust がすべてのロジックの誤りを防げないのは当然のことです。

いずれにせよ、Rust のプログラムでは、競合状態が単独でメモリ安全性を破ることはできません。競合状態が実際にメモリ安全性を破れるのは、ほかの何らかの unsafe なコードと組み合わさったときだけです。たとえば、正しいプログラムは次のようになります。

```rust,no_run
use std::thread;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

let data = vec![1, 2, 3, 4];
// Arc so that the memory the AtomicUsize is stored in still exists for
// the other thread to increment, even if we completely finish executing
// before it. Rust won't compile the program without it, because of the
// lifetime requirements of thread::spawn!
let idx = Arc::new(AtomicUsize::new(0));
let other_idx = idx.clone();

// `move` captures other_idx by-value, moving it into this thread
thread::spawn(move || {
    // It's ok to mutate idx because this value
    // is an atomic, so it can't cause a Data Race.
    other_idx.fetch_add(10, Ordering::SeqCst);
});

// Index with the value loaded from the atomic. This is safe because we
// read the atomic memory only once, and then pass a copy of that value
// to the Vec's indexing implementation. This indexing will be correctly
// bounds checked, and there's no chance of the value getting changed
// in the middle. However our program may panic if the thread we spawned
// managed to increment before this ran. A race condition because correct
// program execution (panicking is rarely correct) depends on order of
// thread execution.
println!("{}", data[idx.load(Ordering::SeqCst)]);
```

一方、境界検査を先に行っておき、その後で検査していない値を使ってデータに unsafe にアクセスすると、競合状態によってメモリ安全性が破られるようにできます。

```rust,no_run
use std::thread;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

let data = vec![1, 2, 3, 4];

let idx = Arc::new(AtomicUsize::new(0));
let other_idx = idx.clone();

// `move` captures other_idx by-value, moving it into this thread
thread::spawn(move || {
    // It's ok to mutate idx because this value
    // is an atomic, so it can't cause a Data Race.
    other_idx.fetch_add(10, Ordering::SeqCst);
});

if idx.load(Ordering::SeqCst) < data.len() {
    unsafe {
        // Incorrectly loading the idx after we did the bounds check.
        // It could have changed. This is a race condition, *and dangerous*
        // because we decided to do `get_unchecked`, which is `unsafe`.
        println!("{}", data.get_unchecked(idx.load(Ordering::SeqCst)));
    }
}
```
