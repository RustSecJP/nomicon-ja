# 借用の分割 {#splitting-borrows}

可変参照が持つ相互排他の性質は、複合的な構造を扱うときに大きな制約になることがあります。借用チェッカー（borrow checker、別名 borrowck）は基本的なことをいくつか理解していますが、かなり簡単につまずきます。それでも構造体については十分に理解していて、1 つの構造体の互いに素な（disjoint）フィールドを同時に借用できることを知っています。そのため、次のコードは今の Rust で動きます。

```rust
struct Foo {
    a: i32,
    b: i32,
    c: i32,
}

let mut x = Foo {a: 0, b: 0, c: 0};
let a = &mut x.a;
let b = &mut x.b;
let c = &x.c;
*b += 1;
let c2 = &x.c;
*a += 10;
println!("{} {} {} {}", a, b, c, c2);
```

しかし borrowck は、配列やスライスをまったく理解していません。そのため、次のコードは動きません。

```rust,compile_fail
let mut x = [1, 2, 3];
let a = &mut x[0];
let b = &mut x[1];
println!("{} {}", a, b);
```

```text
error[E0499]: cannot borrow `x[..]` as mutable more than once at a time
 --> src/lib.rs:4:18
  |
3 |     let a = &mut x[0];
  |                  ---- first mutable borrow occurs here
4 |     let b = &mut x[1];
  |                  ^^^^ second mutable borrow occurs here
5 |     println!("{} {}", a, b);
6 | }
  | - first borrow ends here

error: aborting due to previous error
```

この単純な例なら borrowck が理解できてもおかしくはありませんでした。しかし、木のような一般のコンテナ型で互いに素であることを borrowck に理解させるのは、明らかに望みがありません。異なるキーが実際に同じ値に対応して*いる*場合は、なおさらです。

私たちのしていることが問題ないと borrowck に「教える」には、unsafe なコードに降りていく必要があります。たとえば、可変スライスは `split_at_mut` という関数を公開しています。この関数はスライスを消費して、2 つの可変スライスを返します。1 つは指定した位置より左側のすべて、もう 1 つは右側のすべてです。2 つのスライスは重ならず、したがってエイリアスしないので、これが安全であることは直感的に分かります。しかし、その実装にはいくらかの unsafe が必要です。

```rust
# use std::slice::from_raw_parts_mut;
# struct FakeSlice<T>(T);
# impl<T> FakeSlice<T> {
# fn len(&self) -> usize { unimplemented!() }
# fn as_mut_ptr(&mut self) -> *mut T { unimplemented!() }
pub fn split_at_mut(&mut self, mid: usize) -> (&mut [T], &mut [T]) {
    let len = self.len();
    let ptr = self.as_mut_ptr();

    unsafe {
        assert!(mid <= len);

        (from_raw_parts_mut(ptr, mid),
         from_raw_parts_mut(ptr.add(mid), len - mid))
    }
}
# }
```

これは、実は少し微妙な話です。同じ値を指す `&mut` を 2 つ作ることが決してないように、生ポインタ（raw pointer）を通して、まったく新しいスライスを明示的に組み立てています。

しかし、もっと微妙なのは、可変参照を返すイテレータの仕組みです。イテレータのトレイトは次のように定義されています。

```rust
trait Iterator {
    type Item;

    fn next(&mut self) -> Option<Self::Item>;
}
```

この定義では、Self::Item は `self` と*何の*つながりも持ちません。つまり、`next` を何度か続けて呼び、その結果をすべて*同時に*持ち続けることができます。値渡しのイテレータは、まさにこのとおりの意味論を持つので、これでまったく問題ありません。共有参照でも、実は問題ありません。共有参照は、同じものを指す参照をいくつでも認めるからです（ただし、イテレータは共有されているものとは別のオブジェクトである必要があります）。

ところが、可変参照ではこれが厄介なことになります。一見すると、可変参照はこの API とまったく相容れないように思えるかもしれません。同じオブジェクトを指す可変参照がいくつもできてしまうからです。

しかし、これは実際には*動きます*。それはまさに、イテレータが使い切りのオブジェクトだからです。IterMut が返すものは、どれも多くて 1 回しか返されません。そのため、同じデータを指す可変参照を複数返すことは、実際には決してありません。

意外かもしれませんが、可変イテレータは多くの型で、unsafe なコードを使わずに実装できます。

たとえば、単方向の連結リストは次のとおりです。

```rust
# fn main() {}
type Link<T> = Option<Box<Node<T>>>;

struct Node<T> {
    elem: T,
    next: Link<T>,
}

pub struct LinkedList<T> {
    head: Link<T>,
}

pub struct IterMut<'a, T: 'a>(Option<&'a mut Node<T>>);

impl<T> LinkedList<T> {
    fn iter_mut(&mut self) -> IterMut<T> {
        IterMut(self.head.as_mut().map(|node| &mut **node))
    }
}

impl<'a, T> Iterator for IterMut<'a, T> {
    type Item = &'a mut T;

    fn next(&mut self) -> Option<Self::Item> {
        self.0.take().map(|node| {
            self.0 = node.next.as_mut().map(|node| &mut **node);
            &mut node.elem
        })
    }
}
```

可変スライスは次のとおりです。

```rust
# fn main() {}
use std::mem;

pub struct IterMut<'a, T: 'a>(&'a mut[T]);

impl<'a, T> Iterator for IterMut<'a, T> {
    type Item = &'a mut T;

    fn next(&mut self) -> Option<Self::Item> {
        let slice = mem::take(&mut self.0);
        if slice.is_empty() { return None; }

        let (l, r) = slice.split_at_mut(1);
        self.0 = r;
        l.get_mut(0)
    }
}

impl<'a, T> DoubleEndedIterator for IterMut<'a, T> {
    fn next_back(&mut self) -> Option<Self::Item> {
        let slice = mem::take(&mut self.0);
        if slice.is_empty() { return None; }

        let new_len = slice.len() - 1;
        let (l, r) = slice.split_at_mut(new_len);
        self.0 = l;
        r.get_mut(0)
    }
}
```

そして、二分木は次のとおりです。

```rust
# fn main() {}
use std::collections::VecDeque;

type Link<T> = Option<Box<Node<T>>>;

struct Node<T> {
    elem: T,
    left: Link<T>,
    right: Link<T>,
}

pub struct Tree<T> {
    root: Link<T>,
}

struct NodeIterMut<'a, T: 'a> {
    elem: Option<&'a mut T>,
    left: Option<&'a mut Node<T>>,
    right: Option<&'a mut Node<T>>,
}

enum State<'a, T: 'a> {
    Elem(&'a mut T),
    Node(&'a mut Node<T>),
}

pub struct IterMut<'a, T: 'a>(VecDeque<NodeIterMut<'a, T>>);

impl<T> Tree<T> {
    pub fn iter_mut(&mut self) -> IterMut<T> {
        let mut deque = VecDeque::new();
        if let Some(root) = self.root.as_mut() {
            deque.push_front(root.iter_mut());
        }
        IterMut(deque)
    }
}

impl<T> Node<T> {
    pub fn iter_mut(&mut self) -> NodeIterMut<T> {
        NodeIterMut {
            elem: Some(&mut self.elem),
            left: self.left.as_deref_mut(),
            right: self.right.as_deref_mut(),
        }
    }
}

impl<'a, T> Iterator for NodeIterMut<'a, T> {
    type Item = State<'a, T>;

    fn next(&mut self) -> Option<Self::Item> {
        self.left.take().map(State::Node).or_else(|| {
            self.elem
                .take()
                .map(State::Elem)
                .or_else(|| self.right.take().map(State::Node))
        })
    }
}

impl<'a, T> DoubleEndedIterator for NodeIterMut<'a, T> {
    fn next_back(&mut self) -> Option<Self::Item> {
        self.right.take().map(State::Node).or_else(|| {
            self.elem
                .take()
                .map(State::Elem)
                .or_else(|| self.left.take().map(State::Node))
        })
    }
}

impl<'a, T> Iterator for IterMut<'a, T> {
    type Item = &'a mut T;
    fn next(&mut self) -> Option<Self::Item> {
        loop {
            match self.0.front_mut().and_then(Iterator::next) {
                Some(State::Elem(elem)) => return Some(elem),
                Some(State::Node(node)) => self.0.push_front(node.iter_mut()),
                None => {
                    self.0.pop_front()?;
                }
            }
        }
    }
}

impl<'a, T> DoubleEndedIterator for IterMut<'a, T> {
    fn next_back(&mut self) -> Option<Self::Item> {
        loop {
            match self.0.back_mut().and_then(DoubleEndedIterator::next_back) {
                Some(State::Elem(elem)) => return Some(elem),
                Some(State::Node(node)) => self.0.push_back(node.iter_mut()),
                None => {
                    self.0.pop_back()?;
                }
            }
        }
    }
}
```

これらはどれも完全に安全で、安定版の Rust で動きます。これは結局のところ、先ほど見た単純な構造体の場合から導かれるものです。Rust は、可変参照をその下のフィールドへ安全に分割できることを理解しています。そのうえで、参照を永久に消費することを Option で表現できます（スライスの場合は、空のスライスに置き換えることで表現します）。
