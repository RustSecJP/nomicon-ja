{% raw %}
# サイズが 0 の型を扱う {#handling-zero-sized-types}

いよいよその時が来ました。サイズが 0 の型（zero-sized type、ZST）という亡霊と戦います。安全な Rust では、これを気にする必要は*決して*ありません。しかし Vec は生ポインタと生のメモリ確保を多用しており、サイズが 0 の型を気にしなければならないのは、まさにこの 2 つです。注意すべき点は 2 つあります。

* 生のアロケータ API は、確保サイズとして 0 を渡すと未定義動作（undefined behavior）になります。
* サイズが 0 の型では、生ポインタのオフセットは何もしない操作（no-op）になります。そのため、C 風のポインタによるイテレータが壊れます。

ありがたいことに、ポインタによるイテレータと確保の処理は、それぞれ `RawValIter` と `RawVec` に抽象化してあります。不思議なほど都合のよい話です。

## サイズが 0 の型を確保する {#allocating-zero-sized-types}

では、アロケータ API がサイズ 0 の確保に対応していないなら、いったい何を確保領域として保存すればよいのでしょうか。もちろん `NonNull::dangling()` です。ZST は値をちょうど 1 つしか持たないので、保存したり読み込んだりするときに考慮すべき状態がありません。そのため、ZST に対する操作はほとんどすべて no-op になります。これは実は `ptr::read` と `ptr::write` にも当てはまり、これらはポインタをまったく見ません。したがって、ポインタを変更する必要は一切ありません。

ただし、オーバーフローより先にメモリが尽きることに頼るという、これまでのやり方は、サイズが 0 の型ではもう成り立たないことに注意してください。サイズが 0 の型については、容量のオーバーフローを明示的に防がなければなりません。

現在の構成では、やるべきことは 3 つのガードを書くことだけです。`RawVec` の各メソッドに 1 つずつ書きます。

<!-- ignore: simplified code -->
```rust
impl<T> RawVec<T> {
    fn new() -> Self {
        // This branch should be stripped at compile time.
        let cap = if mem::size_of::<T>() == 0 { usize::MAX } else { 0 };

        // `NonNull::dangling()` doubles as "unallocated" and "zero-sized allocation"
        RawVec {
            ptr: NonNull::dangling(),
            cap,
        }
    }

    fn grow(&mut self) {
        // since we set the capacity to usize::MAX when T has size 0,
        // getting to here necessarily means the Vec is overfull.
        assert!(mem::size_of::<T>() != 0, "capacity overflow");

        let (new_cap, new_layout) = if self.cap == 0 {
            (1, Layout::array::<T>(1).unwrap())
        } else {
            // This can't overflow because we ensure self.cap <= isize::MAX.
            let new_cap = 2 * self.cap;

            // `Layout::array` checks that the number of bytes is <= usize::MAX,
            // but this is redundant since old_layout.size() <= isize::MAX,
            // so the `unwrap` should never fail.
            let new_layout = Layout::array::<T>(new_cap).unwrap();
            (new_cap, new_layout)
        };

        // Ensure that the new allocation doesn't exceed `isize::MAX` bytes.
        assert!(new_layout.size() <= isize::MAX as usize, "Allocation too large");

        let new_ptr = if self.cap == 0 {
            unsafe { alloc::alloc(new_layout) }
        } else {
            let old_layout = Layout::array::<T>(self.cap).unwrap();
            let old_ptr = self.ptr.as_ptr() as *mut u8;
            unsafe { alloc::realloc(old_ptr, old_layout, new_layout.size()) }
        };

        // If allocation fails, `new_ptr` will be null, in which case we abort.
        self.ptr = match NonNull::new(new_ptr as *mut T) {
            Some(p) => p,
            None => alloc::handle_alloc_error(new_layout),
        };
        self.cap = new_cap;
    }
}

impl<T> Drop for RawVec<T> {
    fn drop(&mut self) {
        let elem_size = mem::size_of::<T>();

        if self.cap != 0 && elem_size != 0 {
            unsafe {
                alloc::dealloc(
                    self.ptr.as_ptr() as *mut u8,
                    Layout::array::<T>(self.cap).unwrap(),
                );
            }
        }
    }
}
```

これで終わりです。サイズが 0 の型の push と pop に対応できました。ただし、（スライスへの Deref で提供されるもの以外の）私たちのイテレータは、まだ壊れたままです。

## サイズが 0 の型を反復する {#iterating-zero-sized-types}

サイズが 0 のオフセットは no-op です。つまり、現在の設計では `start` と `end` が常に同じ値で初期化され、イテレータは何も返しません。これに対する現在の解決策は、ポインタを整数にキャストし、加算してから、またポインタにキャストし直すことです。

<!-- ignore: simplified code -->
```rust
impl<T> RawValIter<T> {
    unsafe fn new(slice: &[T]) -> Self {
        RawValIter {
            start: slice.as_ptr(),
            end: if mem::size_of::<T>() == 0 {
                ((slice.as_ptr() as usize) + slice.len()) as *const _
            } else if slice.len() == 0 {
                slice.as_ptr()
            } else {
                slice.as_ptr().add(slice.len())
            },
        }
    }
}
```

今度は別のバグが生まれました。イテレータがまったく動かない代わりに、今度は*永遠に*動き続けます。イテレータの実装でも同じ手を使う必要があります。また、size_hint の計算コードは、ZST では 0 で割ってしまいます。2 つのポインタは基本的にバイトを指しているかのように扱うので、サイズ 0 のときは 1 で割るように対応づけるだけにします。`next` は次のようになります。

<!-- ignore: simplified code -->
```rust
fn next(&mut self) -> Option<T> {
    if self.start == self.end {
        None
    } else {
        unsafe {
            let result = ptr::read(self.start);
            self.start = if mem::size_of::<T>() == 0 {
                (self.start as usize + 1) as *const _
            } else {
                self.start.offset(1)
            };
            Some(result)
        }
    }
}
```

「バグ」に気づきましたか。ほかの誰も気づきませんでした。原著者も、何年も後にこのページへリンクを張ったときに、ようやくこの問題に気づいたのです。このコードは少々怪しいものです。イテレータのポインタを*カウンタ*として乱用すると、ポインタがアラインされていない状態になるからです。ZST を使うときの私たちの*たった 1 つの仕事*は、ポインタをアラインされた状態に保つことなのに、です。*額をぴしゃりと叩く*

生ポインタは常にアラインされている必要はないので、ポインタをカウンタとして使うという基本的な手そのものは*問題ありません*。しかし、`ptr::read` に渡すときには、間違いなくアラインされている*べき*です。ZST に対する `ptr::read` は no-op なので、これは*おそらく*不要な細かいこだわりです。それでも、*もう少しだけ*責任ある態度をとって、ZST の経路では `NonNull::dangling` から読むことにしましょう。

（あるいは、ZST の経路で `read_unaligned` を呼んでもかまいません。どちらでも問題ありません。どちらにしても、何もないところから値を作り出しているのであり、すべては何もしないコードにコンパイルされるからです。）

<!-- ignore: simplified code -->
```rust
impl<T> Iterator for RawValIter<T> {
    type Item = T;
    fn next(&mut self) -> Option<T> {
        if self.start == self.end {
            None
        } else {
            unsafe {
                if mem::size_of::<T>() == 0 {
                    self.start = (self.start as usize + 1) as *const _;
                    Some(ptr::read(NonNull::<T>::dangling().as_ptr()))
                } else {
                    let old_ptr = self.start;
                    self.start = self.start.offset(1);
                    Some(ptr::read(old_ptr))
                }
            }
        }
    }

    fn size_hint(&self) -> (usize, Option<usize>) {
        let elem_size = mem::size_of::<T>();
        let len = (self.end as usize - self.start as usize)
                  / if elem_size == 0 { 1 } else { elem_size };
        (len, Some(len))
    }
}

impl<T> DoubleEndedIterator for RawValIter<T> {
    fn next_back(&mut self) -> Option<T> {
        if self.start == self.end {
            None
        } else {
            unsafe {
                if mem::size_of::<T>() == 0 {
                    self.end = (self.end as usize - 1) as *const _;
                    Some(ptr::read(NonNull::<T>::dangling().as_ptr()))
                } else {
                    self.end = self.end.offset(-1);
                    Some(ptr::read(self.end))
                }
            }
        }
    }
}
```

これで終わりです。反復が動くようになりました。

最後にもう 1 つ考えておくべきことがあります。ベクタはドロップされるとき、生きている間に確保したメモリを解放します。ZST の場合、メモリは一切確保していません。実際のところ、確保することは決してありません。そのため現状のコードは健全ではありません。ベクタの中で ZST を模擬するために使っている `NonNull::dangling()` ポインタを、依然として解放しようとしているからです。確保していないものを解放しようとすれば、（当然のことながら、そしてもっともな理由で）未定義動作を引き起こします。これを直すために、`RawVec` の `Drop` トレイトの実装に手を加えて、サイズを持つ型だけを解放するようにします。

```rust
impl<T> Drop for RawVec<T> {
    fn drop(&mut self) {
        println!("RawVec<T> Drop called, deallocating memory");
        if self.cap != 0 && std::mem::size_of::<T>() > 0 {
            let layout = std::alloc::Layout::array::<T>(self.cap).unwrap();
            unsafe {
                std::alloc::dealloc(self.ptr.as_ptr() as *mut _, layout);
            }
        }
    }
}
```
{% endraw %}
