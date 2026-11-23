# 例外安全性 {#exception-safety}

プログラムは巻き戻し（unwinding）を控えめに使うべきですが、パニックする*可能性のある*コードはたくさんあります。None を unwrap したり、範囲外の添字でアクセスしたり、0 で割ったりすると、プログラムはパニックします。デバッグビルドでは、あらゆる算術演算が、オーバーフローすればパニックする可能性があります。よほど注意深く、どのコードが実行されるかを厳密に管理しない限り、ほとんど何でも巻き戻しを起こす可能性があり、それに備えておく必要があります。

巻き戻しに備えができていることは、プログラミングの世界では広く*例外安全性*（exception safety）と呼ばれています。Rust では、気にかけるべき例外安全性に 2 つの水準があります。

* unsafe なコードでは、メモリ安全性を破らないという程度には例外安全で*なければなりません*。これを*最小限*の例外安全性と呼ぶことにします。

* 安全なコードでは、プログラムが正しいことを行うという程度まで例外安全であることが*望ましい*です。これを*最大限*の例外安全性と呼ぶことにします。

Rust の多くの場面と同じように、巻き戻しに関しても、unsafe なコードは、安全なコードの出来が悪い場合に対処できるようにしておかなければなりません。健全でない状態を一時的に作るコードは、パニックによってその状態が使われてしまわないよう注意しなければなりません。一般にこれは、そのような状態が存在する間はパニックしないコードだけが実行されるようにするか、パニックが起きたときにその状態を片付けるガードを作ることを意味します。これは必ずしも、パニックが目撃する状態が完全に一貫した状態であることを意味しません。保証する必要があるのは、それが*安全な*状態であることだけです。

unsafe なコードのほとんどは末端（葉）のようなものなので、例外安全にするのはかなり簡単です。実行されるコードをすべて管理しており、そのほとんどはパニックしえないからです。しかし、unsafe なコードが、呼び出し側から渡されたコードを繰り返し呼び出しながら、一時的に未初期化のデータの配列を扱うことは珍しくありません。そのようなコードは、注意深く例外安全性を考慮する必要があります。

## Vec::push_all {#vecpush_all}

`Vec::push_all` は、特殊化（specialization）なしに、スライスによる Vec の拡張を確実に効率よく行うための一時しのぎの手法です。単純な実装は次のとおりです。

<!-- ignore: simplified code -->
```rust,ignore
impl<T: Clone> Vec<T> {
    fn push_all(&mut self, to_push: &[T]) {
        self.reserve(to_push.len());
        unsafe {
            let end_ptr = self.as_mut_ptr().add(self.len());

            // can't overflow because we just reserved this
            self.set_len(self.len() + to_push.len());

            for (i, x) in to_push.iter().enumerate() {
                end_ptr.add(i).write(x.clone());
            }
        }
    }
}
```

容量があると確実に分かっている Vec に対して、容量と `len` の検査を余分に行うのを避けるために、`push` を使わずに済ませています。ロジックは完全に正しいのですが、このコードには微妙な問題が 1 つあります。例外安全ではないのです。`set_len`、`add`、`write` はどれも問題ありません。見落としていたパニックの爆弾は `clone` です。

Clone は私たちにはまったく制御できず、パニックするのもまったく自由です。パニックすると、この関数は Vec の長さが大きすぎる値に設定されたまま途中で抜けてしまいます。その Vec が参照されたり、ドロップされたりすると、未初期化のメモリが読まれてしまいます。

この場合の修正はかなり簡単です。クローン*できた*値が確実にドロップされることを保証したいなら、ループの各反復で `len` を設定すればよいのです。未初期化のメモリが観測されないことだけを保証したいなら、ループの後で `len` を設定すればよいのです。

## BinaryHeap::sift_up {#binaryheapsift_up}

ヒープの中で要素を上へ浮かび上がらせる処理は、Vec を拡張するよりも少し複雑です。擬似コードは次のとおりです。

```text
bubble_up(heap, index):
    while index != 0 && heap[index] < heap[parent(index)]:
        heap.swap(index, parent(index))
        index = parent(index)
```

このコードをそのまま Rust に書き写してもまったく問題ありませんが、性能の面で厄介な性質があります。`self` の要素が、何度も何度も無駄に入れ替えられるのです。できれば次のようにしたいところです。

```text
bubble_up(heap, index):
    let elem = heap[index]
    while index != 0 && elem < heap[parent(index)]:
        heap[index] = heap[parent(index)]
        index = parent(index)
    heap[index] = elem
```

このコードでは、各要素のコピーが最小限で済みます（実のところ、一般には elem を 2 回コピーすることが必要です）。しかし今度は、例外安全性の問題が表に出てきます。常に、ある 1 つの値のコピーが 2 つ存在しているのです。この関数の中でパニックすると、何かが二重にドロップされてしまいます。残念ながら、コードを完全に制御できているわけでもありません。この比較はユーザーが定義したものだからです。

Vec の場合と違って、ここでの修正はそれほど簡単ではありません。1 つの方法は、ユーザー定義のコードと unsafe なコードを 2 つの別々の段階に分けることです。

```text
bubble_up(heap, index):
    let end_index = index;
    while end_index != 0 && heap[index] < heap[parent(end_index)]:
        end_index = parent(end_index)

    let elem = heap[index]
    while index != end_index:
        heap[index] = heap[parent(index)]
        index = parent(index)
    heap[index] = elem
```

ユーザー定義のコードが吹き飛んでも、もう問題ありません。ヒープの状態にはまだ実際には手を付けていないからです。ヒープをいじり始めた後は、信頼できるデータと関数だけを扱っているので、パニックの心配はありません。

この設計には満足できないかもしれません。これではごまかしだ、と。しかも、複雑なヒープの走査を *2 回*行わなければなりません。よろしい、覚悟を決めましょう。信頼できないコードと unsafe なコードを*本当に*混ぜ合わせてみましょう。

Rust に Java のような `try` と `finally` があれば、次のように書けます。

```text
bubble_up(heap, index):
    let elem = heap[index]
    try:
        while index != 0 && elem < heap[parent(index)]:
            heap[index] = heap[parent(index)]
            index = parent(index)
    finally:
        heap[index] = elem
```

基本的な考え方は単純です。比較がパニックしたら、宙に浮いた要素を論理的に未初期化の位置に放り込んで、そのまま抜け出すだけです。このヒープを観測する人は、*一貫していない*かもしれないヒープを目にすることになりますが、少なくとも二重ドロップは起こりません。アルゴリズムが正常に終了した場合、この操作は、いずれにせよ最後に行う後始末とちょうど一致します。

残念ながら、Rust にはそのような構文が無いので、自前で作る必要があります。そのためには、アルゴリズムの状態を別の構造体に格納し、その構造体に「finally」のロジックを担うデストラクタを持たせます。パニックしてもしなくても、そのデストラクタが実行され、後片付けをしてくれます。

<!-- ignore: simplified code -->
```rust,ignore
struct Hole<'a, T: 'a> {
    data: &'a mut [T],
    /// `elt` is always `Some` from new until drop.
    elt: Option<T>,
    pos: usize,
}

impl<'a, T> Hole<'a, T> {
    fn new(data: &'a mut [T], pos: usize) -> Self {
        unsafe {
            let elt = ptr::read(&data[pos]);
            Hole {
                data,
                elt: Some(elt),
                pos,
            }
        }
    }

    fn pos(&self) -> usize { self.pos }

    fn removed(&self) -> &T { self.elt.as_ref().unwrap() }

    fn get(&self, index: usize) -> &T { &self.data[index] }

    unsafe fn move_to(&mut self, index: usize) {
        let index_ptr: *const _ = &self.data[index];
        let hole_ptr = &mut self.data[self.pos];
        ptr::copy_nonoverlapping(index_ptr, hole_ptr, 1);
        self.pos = index;
    }
}

impl<'a, T> Drop for Hole<'a, T> {
    fn drop(&mut self) {
        // fill the hole again
        unsafe {
            let pos = self.pos;
            ptr::write(&mut self.data[pos], self.elt.take().unwrap());
        }
    }
}

impl<T: Ord> BinaryHeap<T> {
    fn sift_up(&mut self, pos: usize) {
        unsafe {
            // Take out the value at `pos` and create a hole.
            let mut hole = Hole::new(&mut self.data, pos);

            while hole.pos() != 0 {
                let parent = parent(hole.pos());
                if hole.removed() <= hole.get(parent) { break }
                hole.move_to(parent);
            }
            // Hole will be unconditionally filled here; panic or not!
        }
    }
}
```
