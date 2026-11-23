# ドロップ {#dropping}

次に、参照カウントを減らし、それが十分に小さくなったらデータをドロップする方法が必要です。そうしないと、データはヒープ上で永遠に生き続けます。

そのためには、`Drop` を実装します。

基本的には、次のことを行う必要があります。

1. 参照カウントをデクリメントする
2. データへの参照が 1 つしか残っていない場合は、次のことを行う
3. データの使用と削除の順序が入れ替わるのを防ぐために、データをアトミックにフェンスする
4. 内部のデータをドロップする

まず、`ArcInner` にアクセスする必要があります。

<!-- ignore: simplified code -->
```rust,ignore
let inner = unsafe { self.ptr.as_ref() };
```

次に、参照カウントをデクリメントする必要があります。コードを簡潔にするために、`fetch_sub` の戻り値（デクリメントする前の参照カウントの値）が `1` と等しくない場合（つまり、自分がデータへの最後の参照ではない場合）は、そこでリターンしてしまうこともできます。

<!-- ignore: simplified code -->
```rust,ignore
if inner.rc.fetch_sub(1, Ordering::Release) != 1 {
    return;
}
```

その次に、データの使用とデータの削除の順序が入れ替わるのを防ぐために、アトミックなフェンスを作る必要があります。[標準ライブラリの `Arc` の実装][3]には、次のように説明されています。

> このフェンスは、データの使用とデータの削除の順序が入れ替わるのを防ぐために必要です。
> 参照カウントの減算には `Release` が指定されているので、この `Acquire` のフェンスと同期します。
> つまり、データの使用は参照カウントの減算より前に起こり、参照カウントの減算はこのフェンスより前に起こり、
> このフェンスはデータの削除より前に起こります。
>
> [Boost のドキュメント][1]で説明されているとおりです。
>
> > あるスレッドでの（既存の参照を通じた）オブジェクトへのあらゆるアクセスが、
> > 別のスレッドでそのオブジェクトを削除する*より前に起こる*ように強制することが重要です。
> > これは、参照を手放した後の「release」操作
> > （この参照を通じたオブジェクトへのアクセスは、当然それより前に起こっていなければなりません）と、
> > オブジェクトを削除する前の「acquire」操作によって
> > 実現されます。
>
> 特に、Arc の中身は通常は不変ですが、`Mutex<T>` のようなものに対して内部的な書き込みを行うことは可能です。
> Mutex は削除されるときにロックを取得されないので、スレッド A での書き込みを、スレッド B で動くデストラクタから
> 見えるようにするために、Mutex の同期ロジックに頼ることはできません。
>
> また、ここの Acquire のフェンスは、おそらく Acquire のロードに置き換えられることにも注意してください。
> そうすれば、競合の激しい状況で性能が向上する可能性があります。
> [2] を参照してください。
>
> [1]: https://www.boost.org/doc/libs/1_55_0/doc/html/atomic/usage_examples.html
> [2]: https://github.com/rust-lang/rust/pull/41714

[3]: https://github.com/rust-lang/rust/blob/e1884a8e3c3e813aada8254edfa120e85bf5ffca/library/alloc/src/sync.rs#L1440-L1467

これを行うには、次のようにします。

```rust
# use std::sync::atomic::Ordering;
use std::sync::atomic;
atomic::fence(Ordering::Acquire);
```

最後に、データそのものをドロップできます。`Box::from_raw` を使って、ボックスに入った `ArcInner<T>` とそのデータをドロップします。これは `NonNull<T>` ではなく `*mut T` を受け取るので、`NonNull::as_ptr` を使って変換しなければなりません。

<!-- ignore: simplified code -->
```rust,ignore
unsafe { Box::from_raw(self.ptr.as_ptr()); }
```

これが安全なのは、自分が `ArcInner` への最後のポインタを持っていて、そのポインタが有効であると分かっているからです。

それでは、これらをすべて `Drop` の実装の中にまとめましょう。

<!-- ignore: simplified code -->
```rust,ignore
impl<T> Drop for Arc<T> {
    fn drop(&mut self) {
        let inner = unsafe { self.ptr.as_ref() };
        if inner.rc.fetch_sub(1, Ordering::Release) != 1 {
            return;
        }
        // This fence is needed to prevent reordering of the use and deletion
        // of the data.
        atomic::fence(Ordering::Acquire);
        // This is safe as we know we have the last pointer to the `ArcInner`
        // and that its pointer is valid.
        unsafe { Box::from_raw(self.ptr.as_ptr()); }
    }
}
```
