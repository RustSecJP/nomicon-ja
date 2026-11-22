{% raw %}
# IntoIter {#intoiter}

イテレータを書く作業に進みましょう。`iter` と `iter_mut` は、Deref の魔法のおかげですでに書かれています。しかし、Vec が提供していてスライスには提供できない興味深いイテレータが 2 つあります。`into_iter` と `drain` です。

IntoIter は Vec を値で消費するので、その要素を値で返すことができます。これを可能にするために、IntoIter は Vec の割り当ての管理を引き受ける必要があります。

IntoIter は、両端から読めるように、DoubleEnded でもある必要があります。後ろから読むのは `pop` を呼ぶだけで実装できますが、前から読むのはもっと難しくなります。`remove(0)` を呼ぶこともできますが、それはとんでもなく高くつきます。そこで代わりに、ptr::read だけを使って、バッファをまったく変更せずに、Vec のどちらの端からも値をコピーして取り出すことにします。

そのために、配列の反復でごく一般的な C のイディオムを使います。ポインタを 2 つ作ります。1 つは配列の先頭を指し、もう 1 つは末尾の 1 要素先を指します。どちらかの端から要素が欲しいときは、その端で指されている値を読み出し、ポインタを 1 つ動かします。2 つのポインタが等しくなったら、終わりだと分かります。

なお、読み出しとオフセットの順序は、`next` と `next_back` で逆になります。`next_back` では、ポインタは常に、次に読みたい要素の直後にあります。一方 `next` では、ポインタは常に、次に読みたい要素の位置にあります。なぜそうなのかを理解するために、1 つを除くすべての要素がすでに返された場合を考えてみましょう。

配列は次のようになっています。

```text
          S  E
[X, X, X, O, X, X, X]
```

もし E が、次に返したい要素を直接指していたとしたら、返す要素がもう無い場合と区別が付かなくなってしまいます。

反復の最中には実際のところ気にしないのですが、IntoIter がドロップされたときに解放できるよう、Vec の割り当ての情報も保持しておく必要があります。

そこで、次の構造体を使うことにします。

<!-- ignore: simplified code -->
```rust
pub struct IntoIter<T> {
    buf: NonNull<T>,
    cap: usize,
    start: *const T,
    end: *const T,
}
```

そして、初期化は最終的に次のようになります。

<!-- ignore: simplified code -->
```rust
impl<T> IntoIterator for Vec<T> {
    type Item = T;
    type IntoIter = IntoIter<T>;
    fn into_iter(self) -> IntoIter<T> {
        // Make sure not to drop Vec since that would free the buffer
        let vec = ManuallyDrop::new(self);

        // Can't destructure Vec since it's Drop
        let ptr = vec.ptr;
        let cap = vec.cap;
        let len = vec.len;

        IntoIter {
            buf: ptr,
            cap,
            start: ptr.as_ptr(),
            end: if cap == 0 {
                // can't offset off this pointer, it's not allocated!
                ptr.as_ptr()
            } else {
                unsafe { ptr.as_ptr().add(len) }
            },
        }
    }
}
```

前向きの反復は次のとおりです。

<!-- ignore: simplified code -->
```rust
impl<T> Iterator for IntoIter<T> {
    type Item = T;
    fn next(&mut self) -> Option<T> {
        if self.start == self.end {
            None
        } else {
            unsafe {
                let result = ptr::read(self.start);
                self.start = self.start.offset(1);
                Some(result)
            }
        }
    }

    fn size_hint(&self) -> (usize, Option<usize>) {
        let len = (self.end as usize - self.start as usize)
                  / mem::size_of::<T>();
        (len, Some(len))
    }
}
```

そして、後ろ向きの反復は次のとおりです。

<!-- ignore: simplified code -->
```rust
impl<T> DoubleEndedIterator for IntoIter<T> {
    fn next_back(&mut self) -> Option<T> {
        if self.start == self.end {
            None
        } else {
            unsafe {
                self.end = self.end.offset(-1);
                Some(ptr::read(self.end))
            }
        }
    }
}
```

IntoIter は割り当ての所有権を持つので、それを解放するために Drop を実装する必要があります。しかしそれだけでなく、自身が含む要素のうち、まだ返されていないものをドロップするためにも Drop を実装したいところです。

<!-- ignore: simplified code -->
```rust
impl<T> Drop for IntoIter<T> {
    fn drop(&mut self) {
        if self.cap != 0 {
            // drop any remaining elements
            for _ in &mut *self {}
            let layout = Layout::array::<T>(self.cap).unwrap();
            unsafe {
                alloc::dealloc(self.buf.as_ptr() as *mut u8, layout);
            }
        }
    }
}
```
{% endraw %}
