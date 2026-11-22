{% raw %}
# PhantomData {#phantomdata}

unsafe なコードを扱っていると、型やライフタイムが論理的には構造体に結び付いているのに、実際にはどのフィールドの一部にもなっていない、という状況によく陥ります。これが最もよく起こるのはライフタイムです。たとえば、`&'a [T]` のための `Iter` は、（おおよそ）次のように定義されています。

```rust
struct Iter<'a, T: 'a> {
    ptr: *const T,
    end: *const T,
}
```

しかし、`'a` は構造体の本体の中で使われていないので、*境界がありません*。[これが歴史的に引き起こしてきた問題のため][unused-param]、境界のないライフタイムや型は、構造体の定義では*禁止*されています。したがって、本体の中で何とかしてこれらの型に言及しなければなりません。これを正しく行うことは、変性とドロップチェックを正しくするために必要です。

[unused-param]: https://rust-lang.github.io/rfcs/0738-variance.html#the-corner-case-unused-parameters-and-parameters-that-are-only-used-unsafely

これには、特別なマーカー型である `PhantomData` を使います。`PhantomData` は領域を一切消費しませんが、静的解析の目的では、指定した型のフィールドがあるかのように見せかけます。この方法は、望む変性の種類を型システムに明示的に伝えるよりも間違いにくいと判断されました。同時に、自動トレイト（auto trait）や、ドロップチェックが必要とする情報といった、ほかの便利なものも提供してくれます。

Iter は論理的にはたくさんの `&'a T` を含んでいるので、`PhantomData` にはまさにそれを見せかけるよう伝えます。

```rust
use std::marker;

struct Iter<'a, T: 'a> {
    ptr: *const T,
    end: *const T,
    _marker: marker::PhantomData<&'a T>,
}
```

これだけです。ライフタイムには境界が付き、イテレータは `'a` と `T` に対して共変になります。すべてが「とにかく動く」のです。

## ジェネリックパラメータとドロップチェック {#generic-parameters-and-drop-checking}

以前は、考慮すべきことがもうひとつありました。

まさにこの文書には、かつて次のように書かれていました。

> もうひとつの重要な例は Vec で、これは（おおよそ）次のように定義されています。
>
> ```rust
> struct Vec<T> {
>     data: *const T, // *const for variance!
>     len: usize,
>     cap: usize,
> }
> ```
>
> 前の例とは違って、すべてがちょうど望みどおりになっている*ように見えます*。Vec へのジェネリック引数はどれも、少なくとも 1 つのフィールドに現れています。準備万端です。
>
> いいえ、違います。
>
> ドロップチェッカーは気前よく、`Vec<T>` は T 型の値を一切所有していないと判断します。その結果、ドロップチェックの健全性を判定するうえで、Vec がデストラクタの中で T をドロップすることを心配する必要はない、と結論します。そしてその結果、人々は Vec のデストラクタを使って不健全な状態を作り出せるようになってしまいます。
>
> 私たちが T 型の値を*実際に*所有しており、したがって*私たちが*ドロップされるときに T をいくつかドロップするかもしれない、ということをドロップチェッカーに伝えるには、まさにそのことを述べる `PhantomData` を追加しなければなりません。
>
> ```rust
> use std::marker;
>
> struct Vec<T> {
>     data: *const T, // *const for variance!
>     len: usize,
>     cap: usize,
>     _owns_T: marker::PhantomData<T>,
> }
> ```

しかし、[RFC 1238](https://rust-lang.github.io/rfcs/1238-nonparametric-dropck.html) 以降、**これはもう正しくありませんし、必要でもありません**。

仮に次のように書いたとします。

```rust
struct Vec<T> {
    data: *const T, // `*const` for variance!
    len: usize,
    cap: usize,
}

# #[cfg(any())]
impl<T> Drop for Vec<T> { /* … */ }
```

すると、この `impl<T> Drop for Vec<T>` が存在することによって、Rust はその `Vec<T>` が `T` 型の値を*所有している*（より正確には、`Drop` の実装の中で `T` 型の値を使うかもしれない）とみなします。そのため Rust は、`Vec<T>` がドロップされるときに、それらの値が*ダングリング*になることを許しません。

したがって、型がすでに `Drop impl` を持っている場合、**`_owns_T: PhantomData<T>` フィールドを追加するのは*余計*であり、ドロップチェックに関しては何の効果もありません**（変性と自動トレイトには引き続き影響します）。

  - （高度な例外的ケース: `PhantomData` を含む型が `Drop` の impl をまったく持っていないのに、それでもドロップグルー（drop glue）を持っている場合（ドロップグルーを持つ*別の*フィールドがあることによって）、ここで述べたドロップチェックと `#[may_dangle]` についての考慮事項は同じように当てはまります。その場合、`PhantomData<T>` フィールドがあると、それを含む型がスコープを抜けるたびに、`T` がドロップ可能であることが要求されます。）

___

しかし、この状況では、制限が厳しすぎるコードになってしまうことがあります。そこで標準ライブラリは、不安定で `unsafe` な属性を使って、まさにこの文書が警告していた、昔の「検査なし」のドロップチェックの動作に戻しています。それが `#[may_dangle]` 属性です。

### 例外: 標準ライブラリとその不安定な `#[may_dangle]` という特別な場合 {#an-exception-the-special-case-of-the-standard-library-and-its-unstable-may_dangle}

自分のライブラリのコードを書いているだけなら、この節は読み飛ばしてかまいません。しかし、標準ライブラリが実際の `Vec` の定義で何をしているのかに興味があるなら、健全性のために今でも `_owns_T: PhantomData<T>` フィールドを使う必要があることに気づくでしょう。

<details markdown="1">
<summary>理由を見るにはここをクリック</summary>

次の例を考えてみましょう。

```rust
fn main() {
    let mut v: Vec<&str> = Vec::new();
    let s: String = "Short-lived".into();
    v.push(&s);
    drop(s);
} // <- `v` is dropped here
```

昔ながらの `impl<T> Drop for Vec<T> {` という定義では、上のコードは[拒否されます][is denied]。

[is denied]: https://rust.godbolt.org/z/ans15Kqz3

実際、この場合には `Vec</* T = */ &'s str>` という、`'s` の間生きる `str` への参照のベクタがあります。しかし `let s: String` のほうは `Vec` より先にドロップされます。そのため、`Vec` がドロップされ、`impl<'s> Drop for Vec<&'s str> {` が使われる時点では、`'s` は**期限が切れています**。

つまり、もしこのような `Drop` が使われるとすれば、それは*期限の切れた*、すなわち*ダングリング*なライフタイム `'s` を扱うことになります。しかしこれは Rust の原則に反します。Rust では既定で、関数シグネチャに関わる参照はすべてダングリングではなく、参照外ししても有効だからです。

Rust がこのコード片を保守的に拒否しなければならないのは、そのためです。

それでも、本物の `Vec` の場合、`Drop` の impl は `&'s str` を気にしません。*`&'s str` はそれ自身のドロップグルーを持たないからです*。`Drop` の impl がしたいのは、裏にあるバッファを解放することだけです。

言い換えれば、`Vec` を特別扱いするか、`Vec` の何か特別な性質に頼ることで、上のコード片が何とか受け入れられるとうれしいわけです。`Vec` は、*自分が保持している `&'s str` をドロップ時に使わないと約束する*ことができそうです。

これは、`#[may_dangle]` で表現できる種類の `unsafe` な約束です。

```rust
unsafe impl<#[may_dangle] 's> Drop for Vec<&'s str> { /* … */ }
```

あるいは、もっと一般的には次のように書きます。

```rust
unsafe impl<#[may_dangle] T> Drop for Vec<T> { /* … */ }
```

これが、ドロップされるインスタンスの型パラメータはダングリングであってはならない、という Rust のドロップチェッカーの保守的な仮定から抜ける `unsafe` な方法です。

そして、標準ライブラリのようにこれを行う場合は、`T` がそれ自身のドロップグルーを持つ場合に注意する必要があります。ここでは、`&'s str` を `struct PrintOnDrop<'s> /* = */ (&'s str);` に置き換えることを想像してください。この構造体は `Drop` の impl を持ち、その中で内側の `&'s str` が参照外しされて画面に出力されるものとします。

実際、`Drop for Vec<T> {` は、裏にあるバッファを解放する前に、`T` がドロップグルーを持つなら、それぞれの `T` の要素を推移的にドロップしなければなりません。`PrintOnDrop<'s>` の場合で言えば、`Drop for Vec<PrintOnDrop<'s>>` は、裏にあるバッファを解放する前に、`PrintOnDrop<'s>` の要素を推移的にドロップしなければならないということです。

ですから、`'s` は `#[may_dangle]` だ、と言ったのは、緩すぎる言い方でした。本当に言いたいのは、「`'s` は、推移的なドロップグルーに関わらない限り、ダングリングであってよい」ということです。あるいはもっと一般的に、「`T` は、推移的なドロップグルーに関わらない限り、ダングリングであってよい」ということです。この「例外の例外」は、**私たちが `T` を所有している**ときには、いつでも広く起こる状況です。そのため Rust の `#[may_dangle]` は、この適用除外を知っているだけの賢さを備えています。ジェネリックパラメータが構造体のフィールドによって*所有する形で保持されている場合*には、`#[may_dangle]` は無効になります。

こうして、標準ライブラリは最終的に次のようになっています。

```rust
# #[cfg(any())]
// we pinky-swear not to use `T` when dropping a `Vec`…
unsafe impl<#[may_dangle] T> Drop for Vec<T> {
    fn drop(&mut self) {
        unsafe {
            if mem::needs_drop::<T>() {
                /* … except here, that is, … */
                ptr::drop_in_place::<[T]>(/* … */);
            }
            // …
            dealloc(/* … */)
            // …
        }
    }
}

struct Vec<T> {
    // … except for the fact that a `Vec` owns `T` items and
    // may thus be dropping `T` items on drop!
    _owns_T: core::marker::PhantomData<T>,

    ptr: *const T, // `*const` for variance (but this does not express ownership of a `T` *per se*)
    len: usize,
    cap: usize,
}
```

</details>

___

割り当てを所有する生ポインタは、とても広く使われるパターンです。そのため、標準ライブラリ自身の型は、毎回同じ部品をひとまとめにして使っています。

* 変性とヌルポインタ最適化のための `NonNull<T>`
* `PhantomData<T>`
* `T` が含まれているかのような `Send`/`Sync` の impl

（長年にわたり、標準ライブラリはこれらを内部用の `Unique<T>` 型としてまとめていました。この型は一度も安定化されず、その後削除されました。）

## `PhantomData` のパターンの表 {#table-of-phantomdata-patterns}

`PhantomData` の素晴らしい使い方をすべてまとめた表を、次に示します。

| 幽霊型（Phantom type）      | `'a` の変性      | `T` の変性        | `Send`/`Sync`<br/>（またはそれが無いこと） | ドロップグルーの中でダングリングな `'a` や `T`<br/>（*たとえば* `#[may_dangle] Drop`） |
|-----------------------------|:----------------:|:-----------------:|:-----------------------------------------:|:------------------------------------------------:|
| `PhantomData<T>`            | -                | **共**変          | 受け継ぐ                                  | 許されない（「`T` を所有する」）                 |
| `PhantomData<&'a T>`        | **共**変         | **共**変          | `Send + Sync`<br/>には<br/>`T : Sync` が必要 | 許される                                         |
| `PhantomData<&'a mut T>`    | **共**変         | **非**変          | 受け継ぐ                                  | 許される                                         |
| `PhantomData<*const T>`     | -                | **共**変          | `!Send + !Sync`                           | 許される                                         |
| `PhantomData<*mut T>`       | -                | **非**変          | `!Send + !Sync`                           | 許される                                         |
| `PhantomData<fn(T)>`        | -                | **反**変          | `Send + Sync`                             | 許される                                         |
| `PhantomData<fn() -> T>`    | -                | **共**変          | `Send + Sync`                             | 許される                                         |
| `PhantomData<fn(T) -> T>`   | -                | **非**変          | `Send + Sync`                             | 許される                                         |
| `PhantomData<Cell<&'a ()>>` | **非**変         | -                 | `Send + !Sync`                            | 許される                                         |

  - 注: 自動トレイト `Unpin` から外れるには、代わりに専用の [`PhantomPinned`] 型が必要です。

[`PhantomPinned`]: https://doc.rust-lang.org/core/marker/struct.PhantomPinned.html
{% endraw %}
