# 出典とライセンス

- 原文: The Rustonomicon の `src/` — https://github.com/rust-lang/nomicon （公開ページ https://doc.rust-lang.org/nomicon/ ）
- 原著者: The Rust Project の貢献者
- ライセンス: MIT または Apache-2.0。全文は `LICENSE-MIT.txt` と `LICENSE-APACHE.txt` に、原文リポジトリのファイルのまま収録。
- 訳した版: 2026-10-17 時点（コミット b0bb569883a3e65ab19d4f1adf1b8dbc1629d0a6）
- 変更点: 日本語への翻訳（全 63 章。コードブロックとその中のコメントは原文のまま）。サイトは原文と同じ mdBook（0.5.1）と原文の `book.toml`・`theme/nomicon.css` で作り、見た目を原文にそろえている。原文から変えたのは次のとおり。章どうしのリンクの `.md` を `.html` に変更。見出しに原文と同じリンク先の目印（`{#...}`）を付与。原文では doc.rust-lang.org 内の相対リンクだった The Reference・標準ライブラリ・The Book へのリンクを、`https://doc.rust-lang.org/` から始まる絶対リンクに変更。`book.toml` に `language = "ja"`・`site-url`・各ページの先頭に「非公式な日本語訳」の帯を出す CSS と JavaScript（`theme/rustsecjp-ja.*`・`theme/nomicon-config.js`）を追加し、`git-repository-url` をこのリポジトリに変更。目次（`SUMMARY.md`）の題名を日本語に。図（`img/`）は原文のまま収録。
- この翻訳は Rust Project の確認や公認を受けたものではありません。
- 翻訳日: 2026-11-22
