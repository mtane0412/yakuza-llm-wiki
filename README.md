# Yakuza LLM Wiki

日本のヤクザの歴史を深く理解するための、LLM が構築・保守する個人知識ベースです。
Andrej Karpathy が提唱した「LLM Wiki」パターンを採用しています。

RAG のように質問のたびに資料を検索し直すのではなく、LLM がソースを読むたびに wiki へ知識を統合し、相互リンク・矛盾の指摘・総合的な見立てを**蓄積**していきます。

## 構成

```
.
├── CLAUDE.md        # スキーマ: LLM が従う規約とワークフロー（最重要）
├── AGENTS.md        # CLAUDE.md を読まないエージェント向けの案内
├── templates/       # ページ種別ごとのテンプレート
├── raw/             # 生ソース（不変。人間が収集し、LLM は読むだけ）
│   ├── articles/  books/  papers/  documents/  media/  assets/
│   └── private/     # Git 管理外。著作権上公開できない原本
└── wiki/            # LLM が書く wiki
    ├── index.md     # 全ページのカタログ
    ├── log.md       # 追記専用の時系列ログ
    ├── overview.md  # 全体の俯瞰と見立て
    ├── sources/  people/  organizations/  events/
    ├── concepts/  eras/  places/  syntheses/
```

## 使い方

1. このリポジトリを [Obsidian](https://obsidian.md/) の Vault として開きます（wiki の閲覧とグラフビュー用）。
2. 隣で Claude Code などの LLM エージェントを起動します。
3. ソースを `raw/` に置き、エージェントに指示します。

| 操作 | 指示の例 |
|------|----------|
| Ingest | 「`raw/documents/警察白書_令和5年版_第2章.md` を取り込んで」 |
| Query | 「山一抗争の原因について、ソースごとの説明の違いを比較して」 |
| Lint | 「wiki を lint して」 |

詳細なルールは [CLAUDE.md](CLAUDE.md) を参照してください。

## 注意事項

- **著作権**: 本リポジトリは公開リポジトリです。著作権で保護された資料の全文は `raw/private/`（Git 管理外）に置き、公開部分には書誌情報・要約・正当な範囲の引用のみを含めます。
- **編集方針**: 暴力団や暴力の美化を目的としません。歴史を構造と因果から理解するための、出典に基づく記述的な知識ベースです。
- **正確性**: wiki の内容は LLM が生成したものであり、誤りを含む可能性があります。重要な事実は必ず出典を確認してください。
