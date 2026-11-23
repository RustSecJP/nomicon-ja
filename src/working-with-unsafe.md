# Unsafe と付き合う {#working-with-unsafe}

Rust が私たちに与えてくれる道具では、たいていの場合、Unsafe Rust を、スコープで区切られた、白か黒かの二択という形でしか語れません。残念ながら、現実はそれよりずっと複雑です。たとえば、次のおもちゃのような関数を考えてみましょう。

```rust
fn index(idx: usize, arr: &[u8]) -> Option<u8> {
    if idx < arr.len() {
        unsafe {
            Some(*arr.get_unchecked(idx))
        }
    } else {
        None
    }
}
```

この関数は安全で、正しく動きます。添字が範囲内にあることを確認し、範囲内であれば、検査なしで配列に添字アクセスします。このように、unsafe を使って正しく実装された関数を*健全（sound）* であると言います。これは、安全なコードがその関数を通じて未定義動作を引き起こすことはできない、という意味です（思い出してください、これこそが Safe Rust のただ 1 つの基本的な性質です）。

しかし、こんなささいな関数でさえ、unsafe ブロックの範囲がどこまでなのかは疑わしいものです。`<` を `<=` に変えてみましょう。

```rust
fn index(idx: usize, arr: &[u8]) -> Option<u8> {
    if idx <= arr.len() {
        unsafe {
            Some(*arr.get_unchecked(idx))
        }
    } else {
        None
    }
}
```

このプログラムは、今や*不健全（unsound）* です。Safe Rust から未定義動作を引き起こせます。それなのに、*私たちが変更したのは安全なコードだけ*です。これが安全性の根本的な問題です。つまり、安全性は局所的ではありません。unsafe な操作が健全かどうかは、どうしても、それ以外の「安全な」操作が作り上げた状態に左右されます。

unsafe の世界に踏み込んだからといって、ほかのあらゆる種類の悪いことまで考えなければならなくなるわけではない、という意味では、安全性にはモジュール性があります。たとえば、スライスに検査なしで添字アクセスしたからといって、スライスが null かもしれない、未初期化メモリを含んでいるかもしれない、と突然心配しなければならなくなるわけではありません。根本的には何も変わりません。しかし、プログラムは本質的に状態を持つものであり、unsafe な操作はほかの任意の状態に左右されうる、という意味では、安全性にモジュール性は*ありません*。

この非局所性は、実際に持続する状態を取り入れると、はるかにひどくなります。`Vec` の単純な実装を考えてみましょう。

```rust
use std::ptr;

// Note: This definition is naive. See the chapter on implementing Vec.
pub struct Vec<T> {
    ptr: *mut T,
    len: usize,
    cap: usize,
}

// Note this implementation does not correctly handle zero-sized types.
// See the chapter on implementing Vec.
impl<T> Vec<T> {
    pub fn push(&mut self, elem: T) {
        if self.len == self.cap {
            // not important for this example
            self.reallocate();
        }
        unsafe {
            ptr::write(self.ptr.add(self.len), elem);
            self.len += 1;
        }
    }
    # fn reallocate(&mut self) { }
}

# fn main() {}
```

このコードは十分に単純なので、無理なく点検でき、形式ばらない検証もできます。ここで、次のメソッドを追加することを考えてみましょう。

<!-- ignore: simplified code -->
```rust,ignore
fn make_room(&mut self) {
    // grow the capacity
    self.cap += 1;
}
```

このコードは 100% Safe Rust ですが、同時に、完全に不健全でもあります。容量を変更すると、Vec の不変条件（`cap` が Vec に割り当てられた領域を反映していること）が破られます。これは、Vec のほかの部分では防ぎようがありません。容量のフィールドを検証する方法はないので、Vec はそれを信頼する*しかない*のです。

この `unsafe` なコードは構造体のフィールドの不変条件に頼っているので、関数 1 つをまるごと汚染するだけでは済みません。*モジュール*をまるごと汚染します。一般に、unsafe なコードの範囲を限定する確実な方法は、プライバシー（非公開）を使ってモジュールの境界で区切ることだけです。

とはいえ、これは*完璧に*うまくいきます。`make_room` が存在しても、Vec の健全性にとって問題には*なりません*。これを公開（public）にしていないからです。この関数を呼び出せるのは、この関数を定義しているモジュールだけです。また、`make_room` は Vec の非公開フィールドに直接アクセスしているので、Vec と同じモジュールの中にしか書けません。

したがって、複雑な不変条件に頼りながら、完全に安全な抽象を書くことができます。これは、Safe Rust と Unsafe Rust の関係にとって*決定的に重要*です。

Unsafe なコードは*ある程度の* Safe なコードを信頼しなければならないが、*ジェネリックな* Safe なコードは信頼すべきでない、ということはすでに見ました。プライバシーが unsafe なコードにとって重要なのも、似た理由からです。プライバシーがあるおかげで、私たちは、世の中のあらゆる安全なコードが私たちの信頼する状態をいじらないと信頼する、などということをせずに済みます。

安全性は生きています！
