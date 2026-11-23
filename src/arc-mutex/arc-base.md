# 基本のコード {#base-code}

私たちの `Arc` の実装のレイアウトが決まったので、基本的なコードを書いていきましょう。

## Arc を構築する {#constructing-the-arc}

まず、`Arc<T>` を構築する方法が必要です。

これはかなり単純です。`ArcInner<T>` をボックスに入れ、それへの `NonNull<T>` ポインタを得るだけです。

<!-- ignore: simplified code -->
```rust,ignore
impl<T> Arc<T> {
    pub fn new(data: T) -> Arc<T> {
        // We start the reference count at 1, as that first reference is the
        // current pointer.
        let boxed = Box::new(ArcInner {
            rc: AtomicUsize::new(1),
            data,
        });
        Arc {
            // It is okay to call `.unwrap()` here as we get a pointer from
            // `Box::into_raw` which is guaranteed to not be null.
            ptr: NonNull::new(Box::into_raw(boxed)).unwrap(),
            phantom: PhantomData,
        }
    }
}
```

## Send と Sync {#send-and-sync}

並行処理のプリミティブを作っているので、スレッドをまたいで送れる必要があります。そこで、マーカートレイトの `Send` と `Sync` を実装します。これらについて詳しくは、[`Send` と `Sync` の節](../send-and-sync.html)を参照してください。

これが問題ないのは、次の理由からです。

* `Arc` の中の値への可変参照を得られるのは、その `Arc` がそのデータを参照する唯一の `Arc` である場合に限られます（これは `Drop` の中でしか起こりません）。
* 共有された可変な参照カウントには、アトミック操作を使っています。

<!-- ignore: simplified code -->
```rust,ignore
unsafe impl<T: Sync + Send> Send for Arc<T> {}
unsafe impl<T: Sync + Send> Sync for Arc<T> {}
```

`T: Sync + Send` という境界が必要です。この境界を付けなければ、スレッド安全でない値を、`Arc` を通じてスレッドの境界を越えて共有できてしまい、データ競合や不健全性を引き起こすおそれがあるからです。

たとえば、この境界が無ければ、`Arc<Rc<u32>>` は `Sync` や `Send` になります。すると、`Arc` の中から `Rc` をクローンして取り出し、（まったく新しい `Rc` を作ることなく）別のスレッドへ送れてしまいます。`Rc` はスレッド安全ではないので、これはデータ競合を生みます。

## `ArcInner` を取得する {#getting-the-arcinner}

`NonNull<T>` ポインタを参照外しして `&T` にするには、`NonNull::as_ref` を呼びます。これは一般的な `as_ref` 関数とは違って unsafe なので、次のように呼ばなければなりません。

<!-- ignore: simplified code -->
```rust,ignore
unsafe { self.ptr.as_ref() }
```

このコード片は、このコードの中で何度か使います（たいていは `let` 束縛を伴います）。

この unsafe が問題ないのは、この `Arc` が生きている間、内部のポインタが有効であることが保証されているからです。

## Deref {#deref}

よろしい。これで `Arc` を作れるようになりました（そして、もうすぐ正しくクローンしたり破棄したりできるようになります）。しかし、中のデータにはどうやってたどり着けばよいのでしょうか。

ここで必要なのは、`Deref` の実装です。

このトレイトをインポートする必要があります。

<!-- ignore: simplified code -->
```rust,ignore
use std::ops::Deref;
```

そして、実装は次のとおりです。

<!-- ignore: simplified code -->
```rust,ignore
impl<T> Deref for Arc<T> {
    type Target = T;

    fn deref(&self) -> &T {
        let inner = unsafe { self.ptr.as_ref() };
        &inner.data
    }
}
```

かなり単純でしょう。これは単に、`NonNull` ポインタを参照外しして `ArcInner<T>` を得て、その中のデータへの参照を取得しているだけです。

## コード {#code}

この節のコードをすべてまとめると、次のようになります。

<!-- ignore: simplified code -->
```rust,ignore
use std::ops::Deref;

impl<T> Arc<T> {
    pub fn new(data: T) -> Arc<T> {
        // We start the reference count at 1, as that first reference is the
        // current pointer.
        let boxed = Box::new(ArcInner {
            rc: AtomicUsize::new(1),
            data,
        });
        Arc {
            // It is okay to call `.unwrap()` here as we get a pointer from
            // `Box::into_raw` which is guaranteed to not be null.
            ptr: NonNull::new(Box::into_raw(boxed)).unwrap(),
            phantom: PhantomData,
        }
    }
}

unsafe impl<T: Sync + Send> Send for Arc<T> {}
unsafe impl<T: Sync + Send> Sync for Arc<T> {}


impl<T> Deref for Arc<T> {
    type Target = T;

    fn deref(&self) -> &T {
        let inner = unsafe { self.ptr.as_ref() };
        &inner.data
    }
}
```
