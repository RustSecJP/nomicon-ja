# The Rustonomicon（Rust 公式ドキュメント日本語訳）

> **これは Rust 公式ドキュメント [The Rustonomicon](https://doc.rust-lang.org/nomicon/) の、非公式な日本語訳です。** Rust Project による確認や公認を受けたものではありません。
>
> **読むのはこちら: https://rustsecjp.github.io/nomicon-ja/**
>
> This is an unofficial Japanese translation of "The Rustonomicon".

The Rustonomicon（通称 Nomicon）は、unsafe Rust のプログラムを正しく書くために理解しておかなければならない細部を掘り下げる本です。safe と unsafe の関係、データ表現、所有権とライフタイム、型変換、未初期化メモリ、例外安全性、並行性を扱い、`Vec` と `Arc` を実際に実装し、他言語との相互運用（FFI）までを説明します。全 63 章を訳しています。

原文は未完成の文書であり、今も更新が続いています。この README は日本語訳の案内だけを載せています（原文リポジトリの README にあるビルド手順などは訳していません）。

## 訳した版

| | |
|---|---|
| 原文の版 | 2026-10-17 時点（コミット [`b0bb569`](https://github.com/rust-lang/nomicon/commit/b0bb569883a3e65ab19d4f1adf1b8dbc1629d0a6)） |
| 翻訳日 | 2026-11-22 |

原文がこの版より後に更新されている場合、訳は古い内容のままです。

## 出典とライセンス

- 原文: https://doc.rust-lang.org/nomicon/ （ソース: [rust-lang/nomicon](https://github.com/rust-lang/nomicon) の `src/`）
- 原著者: The Rust Project の貢献者
- ライセンス: MIT または Apache-2.0。全文は [LICENSE-MIT.txt](LICENSE-MIT.txt) と [LICENSE-APACHE.txt](LICENSE-APACHE.txt)。
- 訳した版: 2026-10-17 時点（コミット b0bb569883a3e65ab19d4f1adf1b8dbc1629d0a6）
- 変更点: 日本語への翻訳。mdBook から Jekyll 向けの書式への変換。詳しくは [NOTICE.md](NOTICE.md)。

誤訳の指摘や訳語の提案は、Issue か Pull Request でお願いします。

RustSecJP は非公式のコミュニティです。Rust Project、Rust Foundation、RustSec とは提携していません。
