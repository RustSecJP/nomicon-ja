# 解放 {#deallocating}

次に、大量のリソースを盛大にリークしないよう、Drop を実装すべきです。最も簡単な方法は、None が返るまで `pop` を呼び続け、その後でバッファを解放することです。なお、`T: !Drop` であれば `pop` の呼び出しは不要です。理論上は、`T` が `needs_drop` かどうかを Rust に尋ねて、`pop` の呼び出しを省くことができます。しかし実際には、LLVM はこのような副作用の無い単純なコードを取り除くのが*本当に*得意なので、取り除かれていないと気付かない限り、わざわざそうする必要は無いでしょう（この場合は取り除かれます）。

`self.cap == 0` のときは、`alloc::dealloc` を呼んではいけません。この場合、実際にはメモリを何も割り当てていないからです。

<!-- ignore: simplified code -->
```rust,ignore
impl<T> Drop for Vec<T> {
    fn drop(&mut self) {
        if self.cap != 0 {
            while let Some(_) = self.pop() { }
            let layout = Layout::array::<T>(self.cap).unwrap();
            unsafe {
                alloc::dealloc(self.ptr.as_ptr() as *mut u8, layout);
            }
        }
    }
}
```
