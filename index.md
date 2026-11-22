# The Rustonomicon（Rust 公式ドキュメント日本語訳）

Rust 公式ドキュメント「The Rustonomicon」（通称 Nomicon）の、非公式な日本語訳です。The Rustonomicon は、unsafe Rust のプログラムを正しく書くために理解しておかなければならない細部を掘り下げる本です。safe と unsafe の関係、データ表現、所有権とライフタイム、型変換、未初期化メモリ、例外安全性、並行性を扱い、`Vec` と `Arc` を実際に実装し、他言語との相互運用（FFI）までを説明します。

> **ご注意**: この翻訳は Rust Project の確認や公認を受けたものではありません。原文は未完成の文書であり、今も更新が続いています。内容が食い違う場合は原文が優先されます。実際に unsafe なコードを書くときは、必ず最新の原文を確かめてください。

## 章の一覧 {#chapters}

- [The Rustonomicon（はじめに）](intro.html)
- [Safe と Unsafe のご紹介](meet-safe-and-unsafe.html)
  - [Safe と Unsafe の関わり方](safe-unsafe-meaning.html)
  - [Unsafe Rust でできること](what-unsafe-does.html)
  - [Unsafe と付き合う](working-with-unsafe.html)
- [Rust でのデータ表現](data.html)
  - [repr(Rust)](repr-rust.html)
  - [風変わりなサイズの型](exotic-sizes.html)
  - [そのほかの表現](other-reprs.html)
- [所有権とライフタイム](ownership.html)
  - [参照](references.html)
  - [エイリアシング](aliasing.html)
  - [ライフタイム](lifetimes.html)
  - [ライフタイムの限界](lifetime-mismatch.html)
  - [ライフタイムの省略](lifetime-elision.html)
  - [境界のないライフタイム](unbounded-lifetimes.html)
  - [高階トレイト境界（HRTB）](hrtb.html)
  - [部分型付けと変性](subtyping.html)
  - [ドロップチェック](dropck.html)
  - [PhantomData](phantom-data.html)
  - [借用の分割](borrow-splitting.html)
- [型変換](conversions.html)
  - [型強制](coercions.html)
  - [ドット演算子](dot-operator.html)
  - [キャスト](casts.html)
  - [トランスミュート](transmutes.html)
- [未初期化メモリを扱う](uninitialized.html)
  - [検査のある未初期化メモリ](checked-uninit.html)
  - [ドロップフラグ](drop-flags.html)
  - [検査のない未初期化メモリ](unchecked-uninit.html)
- [所有権に基づくリソース管理（OBRM）の危険](obrm.html)
  - [コンストラクタ](constructors.html)
  - [デストラクタ](destructors.html)
  - [リーク](leaking.html)
- [巻き戻し](unwinding.html)
  - [例外安全性](exception-safety.html)
  - [ポイズニング](poisoning.html)
- [並行性と並列性](concurrency.html)
  - [データ競合と競合状態](races.html)
  - [Send と Sync](send-and-sync.html)
  - [アトミック](atomics.html)
- [例: Vec を実装する](vec/vec.html)
  - [レイアウト](vec/vec-layout.html)
  - [メモリの割り当て](vec/vec-alloc.html)
  - [push と pop](vec/vec-push-pop.html)
  - [解放](vec/vec-dealloc.html)
  - [Deref](vec/vec-deref.html)
  - [insert と remove](vec/vec-insert-remove.html)
  - [IntoIter](vec/vec-into-iter.html)
  - [RawVec](vec/vec-raw.html)
  - [Drain](vec/vec-drain.html)
  - [サイズが 0 の型を扱う](vec/vec-zsts.html)
  - [最終的なコード](vec/vec-final.html)
- [Arc と Mutex を実装する](arc-mutex/arc-and-mutex.html)
  - [Arc を実装する](arc-mutex/arc.html)
    - [レイアウト](arc-mutex/arc-layout.html)
    - [基本のコード](arc-mutex/arc-base.html)
    - [クローン](arc-mutex/arc-clone.html)
    - [ドロップ](arc-mutex/arc-drop.html)
    - [最終的なコード](arc-mutex/arc-final.html)
- [他言語関数インターフェース（Foreign Function Interface）](ffi.html)
- [`std` の下](beneath-std.html)
  - [#[panic_handler]](panic-handler.html)

## 出典 {#source}

- 原文: [The Rustonomicon](https://doc.rust-lang.org/nomicon/)（ソースは [rust-lang/nomicon](https://github.com/rust-lang/nomicon) の `src/`）
- 原著者: The Rust Project の貢献者
- ライセンス: MIT または Apache-2.0
- 訳した版: 2026-10-17 時点（コミット `b0bb569`）
- 翻訳日: 2026-11-22
