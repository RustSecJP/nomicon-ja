{% raw %}
# insert と remove {#insert-and-remove}

スライスが提供して*いない*ものに `insert` と `remove` があるので、次はこれらを実装しましょう。

insert では、対象の添字以降にあるすべての要素を右へ 1 つずらす必要があります。そのためには `ptr::copy` を使う必要があります。これは C の `memmove` の Rust 版です。これは、メモリのあるかたまりをある位置から別の位置へコピーするもので、コピー元とコピー先が重なっている場合も正しく扱います（ここでは間違いなく重なります）。

添字 `i` に挿入する場合、古い len を使って、`[i .. len]` を `[i+1 .. len+1]` へずらしたいわけです。

<!-- ignore: simplified code -->
```rust
pub fn insert(&mut self, index: usize, elem: T) {
    // Note: `<=` because it's valid to insert after everything
    // which would be equivalent to push.
    assert!(index <= self.len, "index out of bounds");
    if self.len == self.cap { self.grow(); }

    unsafe {
        // ptr::copy(src, dest, len): "copy from src to dest len elems"
        ptr::copy(
            self.ptr.as_ptr().add(index),
            self.ptr.as_ptr().add(index + 1),
            self.len - index,
        );
        ptr::write(self.ptr.as_ptr().add(index), elem);
    }

    self.len += 1;
}
```

remove は逆の動きをします。*新しい* len を使って、`[i+1 .. len + 1]` のすべての要素を `[i .. len]` へずらす必要があります。

<!-- ignore: simplified code -->
```rust
pub fn remove(&mut self, index: usize) -> T {
    // Note: `<` because it's *not* valid to remove after everything
    assert!(index < self.len, "index out of bounds");
    unsafe {
        self.len -= 1;
        let result = ptr::read(self.ptr.as_ptr().add(index));
        ptr::copy(
            self.ptr.as_ptr().add(index + 1),
            self.ptr.as_ptr().add(index),
            self.len - index,
        );
        result
    }
}
```
{% endraw %}
