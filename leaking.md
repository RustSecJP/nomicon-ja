{% raw %}
# リーク {#leaking}

所有権に基づくリソース管理は、組み合わせを簡単にするためのものです。オブジェクトを作るときにリソースを獲得し、オブジェクトが破棄されるときにリソースを解放します。破棄は代わりにやってもらえるので、リソースの解放を忘れることはありえませんし、解放はできるだけ早く行われます。これなら完璧で、私たちの問題はすべて解決したに違いありません。

何もかもがひどいもので、解決しなければならない新しい風変わりな問題が生まれています。

Rust はリソースのリーク（leak）をなくす、と信じたがる人はたくさんいます。実際上は、これはおおむね正しいと言えます。Safe Rust のプログラムが制御できない形でリソースをリークするのを見たら、驚くことでしょう。

しかし理論的な観点からは、どう見ても、これはまったく正しくありません。もっとも厳密な意味では、「リーク」はあまりに抽象的で、防ぎようがありません。プログラムの最初でコレクションを初期化し、デストラクタを持つオブジェクトを大量に詰め込み、その後はそのコレクションを一切参照しない無限のイベントループに入る、というのはごく簡単です。コレクションは何の役にも立たないまま居座り、プログラムが終了するまで貴重なリソースを抱え込み続けます（終了の時点では、どのみちそのリソースはすべて OS に回収されます）。

もっと限定した形のリークを考えることもできます。到達できない値をドロップしそこなうことです。Rust はこれも防ぎません。それどころか、Rust には*これを行うための関数があります*。`mem::forget` です。この関数は、渡された値を消費し、*そのうえでデストラクタを実行しません*。

以前の `mem::forget` は、使用に対する一種のリントとして、unsafe とされていました。デストラクタを呼びそこなうのは、一般に行儀のよいことではないからです（ただし、一部の特殊な unsafe コードでは役に立ちます）。しかし、これは維持できない立場だとおおむね判断されました。安全なコードでデストラクタを呼びそこなう方法は、たくさんあるからです。いちばん有名な例は、内部可変性（interior mutability）を使って参照カウント付きポインタの循環を作ることです。

安全なコードが、デストラクタのリークは起こらないと仮定するのは妥当です。デストラクタをリークするプログラムは、おそらく間違っているからです。しかし *unsafe* なコードは、安全であるために、デストラクタが実行されることに頼ることはできません。ほとんどの型では、これは問題になりません。デストラクタをリークすれば、その型は定義上アクセスできなくなるので、問題にならないでしょう？ たとえば、`Box<u8>` をリークすると、いくらかメモリを無駄にしますが、それでメモリ安全性が破られることはまずありません。

しかし、デストラクタのリークに注意しなければならないのは、*プロキシ*（proxy）型です。これは、別のオブジェクトへのアクセスを管理するものの、実際にはそれを所有していない型です。プロキシオブジェクトはかなり珍しいものです。気にする必要のあるプロキシオブジェクトは、さらに珍しいものです。それでも、ここでは標準ライブラリにある興味深い 3 つの例に注目します。

* `vec::Drain`
* `Rc`
* `thread::scoped::JoinGuard`

## Drain {#drain}

`drain` はコレクションの API で、コンテナを消費せずに、コンテナからデータをムーブして取り出します。これにより、`Vec` の中身すべての所有権を受け取った後で、その確保済みの領域を再利用できます。この API は、Vec の中身を値で返すイテレータ（Drain）を作ります。

さて、反復の途中にある Drain を考えてみましょう。ムーブされた値もあれば、まだムーブされていない値もあります。つまり、Vec の一部が今、論理的に未初期化のデータで埋まっているということです。値を取り除くたびに Vec のすべての要素を前へ詰め直すこともできますが、それでは性能にかなり壊滅的な影響が出ます。

そうする代わりに、Drain がドロップされるときに、Vec の裏にある記憶領域を直すようにしたいところです。Drain は、最後まで自分を走らせ、取り除かれなかった要素を前へ詰め直し（drain は部分範囲に対応しています）、それから Vec の `len` を直すべきです。巻き戻しに対しても安全です。簡単ですね。

では、次のコードを考えてみましょう。

<!-- ignore: simplified code -->
```rust
let mut vec = vec![Box::new(0); 4];

{
    // start draining, vec can no longer be accessed
    let mut drainer = vec.drain(..);

    // pull out two elements and immediately drop them
    drainer.next();
    drainer.next();

    // get rid of drainer, but don't call its destructor
    mem::forget(drainer);
}

// Oops, vec[0] was dropped, we're reading a pointer into free'd memory!
println!("{}", vec[0]);
```

これは、どう見てもよくありません。残念ながら、私たちは板挟みになっています。すべての段階で一貫した状態を保つには、莫大なコストがかかります（そして、この API の利点をすべて打ち消します）。一貫した状態を保たなければ、安全なコードで未定義動作が起こります（つまり、この API は健全でなくなります）。

では、どうすればよいのでしょうか。自明に一貫した状態を選べばよいのです。反復を始めるときに Vec の len を 0 にしておき、必要ならデストラクタで直します。こうすれば、すべてがふつうに実行された場合には、最小限のオーバーヘッドで望みどおりの振る舞いが得られます。しかし、誰かが反復の途中で*厚かましくも*私たちを mem::forget した場合でも、起こるのは*さらに多くのリーク*だけです（そして場合によっては、Vec が予想外の、しかしそれ以外の点では一貫した状態のままになります）。mem::forget が安全であることを受け入れた以上、これは間違いなく安全です。リークがさらなるリークを引き起こすことを、*リークの増幅*（leak amplification）と呼びます。

## Rc {#rc}

Rc は興味深い例です。一見すると、プロキシの値にはまったく見えないからです。何しろ、Rc は自分が指すデータを管理していて、ある値を指す Rc をすべてドロップすると、その値がドロップされます。Rc をリークしても、特に危険はなさそうに見えます。参照カウントが永久に増えたままになり、データの解放もドロップもできなくなりますが、それは Box とまったく同じに見えるでしょう？

いいえ。

Rc の簡略化した実装を考えてみましょう。

<!-- ignore: simplified code -->
```rust
struct Rc<T> {
    ptr: *mut RcBox<T>,
}

struct RcBox<T> {
    data: T,
    ref_count: usize,
}

impl<T> Rc<T> {
    fn new(data: T) -> Self {
        unsafe {
            // Wouldn't it be nice if heap::allocate worked like this?
            let ptr = heap::allocate::<RcBox<T>>();
            ptr::write(ptr, RcBox {
                data,
                ref_count: 1,
            });
            Rc { ptr }
        }
    }

    fn clone(&self) -> Self {
        unsafe {
            (*self.ptr).ref_count += 1;
        }
        Rc { ptr: self.ptr }
    }
}

impl<T> Drop for Rc<T> {
    fn drop(&mut self) {
        unsafe {
            (*self.ptr).ref_count -= 1;
            if (*self.ptr).ref_count == 0 {
                // drop the data and then free it
                ptr::read(self.ptr);
                heap::deallocate(self.ptr);
            }
        }
    }
}
```

このコードには、暗黙の、そして微妙な仮定が含まれています。メモリ上に `usize::MAX` 個を超える Rc は存在しえないので、`ref_count` は `usize` に収まる、という仮定です。しかし、この仮定自体が、`ref_count` がメモリ上の Rc の数を正確に反映していることを仮定しています。そして `mem::forget` があると、それは正しくないことが分かっています。`mem::forget` を使うと、`ref_count` をオーバーフローさせ、まだ Rc が残っているのにカウントを 0 まで下げることができます。そうすれば、内側のデータを思うままに解放後に使用できます。まずい、まずい、よくありません。

これは、`ref_count` を検査して*何か*をするだけで解決できます。標準ライブラリの立場は、単にアボートすることです。プログラムがひどく異常な状態になっているからです。それにしても、*まったくもう*、あまりにばかげた特殊ケースです。

## thread::scoped::JoinGuard {#threadscopedjoinguard}

> 注: この API はすでに std から削除されています。詳しくは
> [issue #24292](https://github.com/rust-lang/rust/issues/24292) を参照してください。
>
> この節をここに残しているのは、std の一部であるかどうかにかかわらず、
> この例が今も重要だと考えているからです。

thread::scoped API は、親のスタック上にあるデータを参照するスレッドを、そのデータについて同期を一切とらずに起動できるようにするためのものでした。そのために、共有されたデータのどれかがスコープを抜ける前に、親がそのスレッドを確実に join するようにしていました。

<!-- ignore: simplified code -->
```rust
pub fn scoped<'a, F>(f: F) -> JoinGuard<'a>
    where F: FnOnce() + Send + 'a
```

ここで `f` は、もう一方のスレッドが実行する何らかのクロージャです。`F: Send + 'a` と書くことは、このクロージャが `'a` の間生きるデータを閉じ込めていて、そのデータを所有しているか、またはそのデータが Sync であった（つまり `&data` が Send である）、と言っていることになります。

JoinGuard はライフタイムを持つので、閉じ込めたすべてのデータを、親スレッドで借用したままにします。つまり JoinGuard は、もう一方のスレッドが扱っているデータより長く生きることができません。JoinGuard がドロップ*される*ときには、親スレッドをブロックします。これにより、閉じ込められたデータのどれかが親でスコープを抜ける前に、子が確実に終了します。

使い方は次のようなものでした。

<!-- ignore: simplified code -->
```rust
let mut data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
{
    let mut guards = vec![];
    for x in &mut data {
        // Move the mutable reference into the closure, and execute
        // it on a different thread. The closure has a lifetime bound
        // by the lifetime of the mutable reference `x` we store in it.
        // The guard that is returned is in turn assigned the lifetime
        // of the closure, so it also mutably borrows `data` as `x` did.
        // This means we cannot access `data` until the guard goes away.
        let guard = thread::scoped(move || {
            *x *= 2;
        });
        // store the thread's guard for later
        guards.push(guard);
    }
    // All guards are dropped here, forcing the threads to join
    // (this thread blocks here until the others terminate).
    // Once the threads join, the borrow expires and the data becomes
    // accessible again in this thread.
}
// data is definitely mutated here.
```

原理的には、これは完全に動きます。Rust の所有権システムが、それを完璧に保証します。……ただし、安全であるために、デストラクタが呼ばれることに頼っている点を除けば、です。

<!-- ignore: simplified code -->
```rust
let mut data = Box::new(0);
{
    let guard = thread::scoped(|| {
        // This is at best a data race. At worst, it's also a use-after-free.
        *data += 1;
    });
    // Because the guard is forgotten, expiring the loan without blocking this
    // thread.
    mem::forget(guard);
}
// So the Box is dropped here while the scoped thread may or may not be trying
// to access it.
```

なんてことでしょう。ここでは、デストラクタが実行されることが API にとってかなり根本的なものでした。そのため、この API は捨てて、まったく別の設計に取り替えなければなりませんでした。
{% endraw %}
