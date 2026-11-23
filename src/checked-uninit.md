# 検査のある未初期化メモリ {#checked-uninitialized-memory}

C と同じように、Rust のスタック変数はすべて、値を明示的に代入するまで未初期化です。C と違って、Rust は、代入するまでその変数を読むことを静的に防ぎます。

```rust,compile_fail
fn main() {
    let x: i32;
    println!("{}", x);
}
```

```text
  |
3 |     println!("{}", x);
  |                    ^ use of possibly uninitialized `x`
```

これは、基本的な分岐の解析に基づいています。`x` を最初に使う前に、すべての分岐が `x` に値を代入していなければなりません。短く言うために、「`x` は init である」「`x` は uninit である」という言い方もします。

興味深いことに、すべての分岐がちょうど 1 回だけ代入するのであれば、初期化を遅らせるために変数を可変にする必要はありません。ただし、この解析は定数の解析のようなものを利用しません。そのため、次のコードはコンパイルできます。

```rust
fn main() {
    let x: i32;

    if true {
        x = 1;
    } else {
        x = 2;
    }

    println!("{}", x);
}
```

しかし、次のコードはコンパイルできません。

```rust,compile_fail
fn main() {
    let x: i32;
    if true {
        x = 1;
    }
    println!("{}", x);
}
```

```text
  |
6 |     println!("{}", x);
  |                    ^ use of possibly uninitialized `x`
```

一方で、次のコードはコンパイルできます。

```rust
fn main() {
    let x: i32;
    if true {
        x = 1;
        println!("{}", x);
    }
    // Don't care that there are branches where it's not initialized
    // since we don't use the value in those branches
}
```

もちろん、この解析は実際の値を考慮しませんが、依存関係と制御フローについては比較的高度に理解しています。たとえば、次のコードは動きます。

```rust
let x: i32;

loop {
    // Rust doesn't understand that this branch will be taken unconditionally,
    // because it relies on actual values.
    if true {
        // But it does understand that it will only be taken once because
        // we unconditionally break out of it. Therefore `x` doesn't
        // need to be marked as mutable.
        x = 0;
        break;
    }
}
// It also knows that it's impossible to get here without reaching the break.
// And therefore that `x` must be initialized here!
println!("{}", x);
```

変数から値がムーブされると、その値の型が Copy でなければ、その変数は論理的に未初期化になります。つまり、次のとおりです。

```rust
fn main() {
    let x = 0;
    let y = Box::new(0);
    let z1 = x; // x is still valid because i32 is Copy
    let z2 = y; // y is now logically uninitialized because Box isn't Copy
}
```

しかし、この例で `y` に代入し直すには、`y` を可変として宣言する必要が*あります*。Safe Rust のプログラムが、`y` の値が変わったことを観測できるからです。

```rust
fn main() {
    let mut y = Box::new(0);
    let z = y; // y is now logically uninitialized because Box isn't Copy
    y = Box::new(1); // reinitialize y
}
```

それ以外の点では、`y` はまったく新しい変数のようなものです。
