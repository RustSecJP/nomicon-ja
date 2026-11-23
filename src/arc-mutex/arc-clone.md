# クローン {#cloning}

基本的なコードが用意できたので、次は `Arc` をクローンする方法が必要です。

基本的には、次のことを行う必要があります。

1. アトミックな参照カウントをインクリメントする
2. 内部のポインタから、`Arc` の新しいインスタンスを構築する

まず、`ArcInner` にアクセスする必要があります。

<!-- ignore: simplified code -->
```rust,ignore
let inner = unsafe { self.ptr.as_ref() };
```

アトミックな参照カウントは、次のように更新できます。

<!-- ignore: simplified code -->
```rust,ignore
let old_rc = inner.rc.fetch_add(1, Ordering::???);
```

しかし、ここではどの順序付け（ordering）を使うべきでしょうか。クローンの最中に内部の値を変更することはないので、クローン時にアトミックな同期を必要とするコードは実際にはありません。したがって、ここでは Relaxed の順序付けを使えます。これは happens-before 関係を何も意味しませんが、アトミックではあります。一方、Arc を `Drop` するときには、参照カウントをデクリメントする際にアトミックに同期する必要があります。これについては、[`Arc` の `Drop` 実装の節](arc-drop.html)で詳しく説明します。アトミックな関係と Relaxed の順序付けについて詳しくは、[アトミック操作の節](../atomics.html)を参照してください。

したがって、コードは次のようになります。

<!-- ignore: simplified code -->
```rust,ignore
let old_rc = inner.rc.fetch_add(1, Ordering::Relaxed);
```

`Ordering` を使うために、インポートをもう 1 つ追加する必要があります。

```rust
use std::sync::atomic::Ordering;
```

しかし、現時点のこの実装には問題が 1 つあります。誰かが大量の Arc を `mem::forget` することにしたらどうなるでしょうか。これまでに書いた（そしてこれから書く）コードは、メモリ上にある Arc の数を参照カウントが正確に表していると仮定しています。しかし `mem::forget` があると、これは成り立ちません。そのため、Arc が `Drop` されず、参照カウントがデクリメントされないまま、この Arc から次々とクローンが作られると、オーバーフローが起こりえます。これは解放後使用（use-after-free）を引き起こし、**とてつもなくまずい**ことになります。

これに対処するには、参照カウントがある任意の値（参照カウントは `AtomicUsize` として保存しているので、`usize::MAX` より小さい値）を超えていないかを確認し、*何か*をする必要があります。

標準ライブラリの実装は、いずれかのスレッドで参照カウントが `isize::MAX`（`usize::MAX` のおよそ半分）に達したら、単にプログラムをアボートすることにしています（通常のコードではまず起こりえない場合であり、もし起こるなら、そのプログラムはおそらくひどく異常だからです）。これは、およそ 20 億個（一部の 64 ビットマシンではおよそ **900 京**個）ものスレッドが同時に参照カウントをインクリメントしていることはおそらくない、という仮定に基づいています。私たちもこのようにします。

この動作を実装するのはかなり簡単です。

<!-- ignore: simplified code -->
```rust,ignore
if old_rc >= isize::MAX as usize {
    std::process::abort();
}
```

次に、`Arc` の新しいインスタンスを返す必要があります。

<!-- ignore: simplified code -->
```rust,ignore
Self {
    ptr: self.ptr,
    phantom: PhantomData
}
```

それでは、これらをすべて `Clone` の実装の中にまとめましょう。

<!-- ignore: simplified code -->
```rust,ignore
use std::sync::atomic::Ordering;

impl<T> Clone for Arc<T> {
    fn clone(&self) -> Arc<T> {
        let inner = unsafe { self.ptr.as_ref() };
        // Using a relaxed ordering is alright here as we don't need any atomic
        // synchronization here as we're not modifying or accessing the inner
        // data.
        let old_rc = inner.rc.fetch_add(1, Ordering::Relaxed);

        if old_rc >= isize::MAX as usize {
            std::process::abort();
        }

        Self {
            ptr: self.ptr,
            phantom: PhantomData,
        }
    }
}
```
