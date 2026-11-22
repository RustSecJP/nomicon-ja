{% raw %}
# Deref {#deref}

よし。まずまずの最小限のスタックを実装できました。push でき、pop でき、後片付けもできます。しかし、当然欲しくなる機能がまだ山ほどあります。特に、ちゃんとした配列はあるのに、スライスの機能が何もありません。これは実はかなり簡単に解決できます。`Deref<Target=[T]>` を実装すればよいのです。こうすると、この Vec は魔法のように、さまざまな状況でスライスへ型強制され、スライスのように振る舞うようになります。

必要なのは `slice::from_raw_parts` だけです。これは空のスライスを正しく扱ってくれます。後でゼロサイズ型への対応を整えれば、それらに対してもそのまま動きます。

<!-- ignore: simplified code -->
```rust
use std::ops::Deref;

impl<T> Deref for Vec<T> {
    type Target = [T];
    fn deref(&self) -> &[T] {
        unsafe {
            std::slice::from_raw_parts(self.ptr.as_ptr(), self.len)
        }
    }
}
```

DerefMut も実装しましょう。

<!-- ignore: simplified code -->
```rust
use std::ops::DerefMut;

impl<T> DerefMut for Vec<T> {
    fn deref_mut(&mut self) -> &mut [T] {
        unsafe {
            std::slice::from_raw_parts_mut(self.ptr.as_ptr(), self.len)
        }
    }
}
```

これで、`len`、`first`、`last`、添字アクセス、スライス、ソート、`iter`、`iter_mut`、そのほかスライスが提供するあらゆる便利な機能が手に入りました。素晴らしい。
{% endraw %}
