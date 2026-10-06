#!/usr/bin/env bash
# wiki/ を Quartz で静的サイトとしてビルドするスクリプト
#
# 仕様:
# - バージョンを固定した Quartz を site/.quartz/ に取得し（Git 管理外）、プラグインを lockfile どおりに復元する
# - site/quartz.config.yaml と site/custom.scss を Quartz に配置し、wiki/ を content/ にコピーしてビルドする
# - 公開するのは wiki/ のみで、raw/ と templates/ はコピーしない
# - 検索エンジンに載せないため、出力したすべての HTML の <head> 直後に robots メタタグ（noindex, nofollow）を挿入し、
#   Cloudflare Workers Static Assets 用の site/_headers（X-Robots-Tag）を成果物にコピーする
# - 最後に site/verify.mjs で成果物を検証し、違反があれば失敗する
#
# 使い方:
#   site/build.sh            # site/.quartz/public/ にビルドして検証する
#   site/build.sh --serve    # ローカルプレビュー（http://localhost:8080）。robots メタタグの挿入と検証は行わない
#   site/build.sh --serve --port 8090 --wsPort 3011   # --serve 以降の引数は quartz build にそのまま渡す
#
# 注意:
# - Node.js 22 以上が必要
# - ~/.npmrc に min-release-age を設定している場合、Quartz の git 依存の準備処理と衝突して npm ci が失敗する。
#   その場合は npm_config_userconfig=/dev/null site/build.sh のように、ユーザー設定を外して実行する
set -euo pipefail

QUARTZ_REPO="https://github.com/jackyzha0/quartz.git"
QUARTZ_VERSION="v5.0.0"
ROBOTS_META='<meta name="robots" content="noindex, nofollow">'

SITE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SITE_DIR")"
QUARTZ_DIR="$SITE_DIR/.quartz"

# 1. Quartz の取得（取得済みの場合はバージョンが一致するかを確認する）
if [ ! -d "$QUARTZ_DIR/.git" ]; then
  git clone --quiet --depth 1 --branch "$QUARTZ_VERSION" "$QUARTZ_REPO" "$QUARTZ_DIR"
fi
current_version="$(git -C "$QUARTZ_DIR" describe --tags --exact-match 2>/dev/null || true)"
if [ "$current_version" != "$QUARTZ_VERSION" ]; then
  echo "site/.quartz の Quartz が $QUARTZ_VERSION ではありません（現在: ${current_version:-不明}）。site/.quartz を削除して再実行してください。" >&2
  exit 1
fi

cd "$QUARTZ_DIR"

# 2. 依存関係とプラグインの復元
if [ ! -d node_modules ]; then
  npm ci --no-audit --no-fund
fi
npx quartz plugin restore

# 2.1 graph プラグインへの応急処置
# graph プラグインは @quartz-community/utils の getFullSlugFromUrl() で現在ページの slug を得るが、
# この関数は window.location.pathname をデコードせずに返す。そのため日本語のページ名がパーセントエンコードのまま
# 索引（contentIndex.json）と照合され、グラフビューが空になる。またサブパス配信（GitHub Pages の /yakuza-llm-wiki/）では
# パスの先頭にリポジトリ名が残り、同様に照合に失敗する。
# Quartz 本体の getFullSlug() と同じく document.body.dataset.slug を返すように、ビルド済みの dist を書き換える。
#
# 注意: Quartz を更新して graph プラグインのコミットが変わったら、このスクリプトは停止する。
# 上流で修正済みかを確認し、修正済みならこの応急処置を削除する。未修正なら置換が当たることを確かめてから
# GRAPH_PLUGIN_COMMIT を更新する。
GRAPH_PLUGIN_COMMIT="701bda442cf08f521e88ec326b12a7559320eef4"

patch_graph_slug() {
  local plugin_dir=".quartz/plugins/graph"
  local locked_commit
  locked_commit="$(node -p 'require("./quartz.lock.json").plugins.graph.commit')"
  if [ "$locked_commit" != "$GRAPH_PLUGIN_COMMIT" ]; then
    echo "graph プラグインのコミットが変わりました（想定: $GRAPH_PLUGIN_COMMIT、lockfile: $locked_commit）。" >&2
    echo "site/build.sh の patch_graph_slug の説明に従って、応急処置の要否を確認してください。" >&2
    exit 1
  fi

  local file
  for file in "$plugin_dir/dist/index.js" "$plugin_dir/dist/components/index.js"; do
    # plugin restore は既存のプラグインを再取得しないため、適用済みの場合は何もしない
    if grep -q '(){return document.body.dataset.slug}' "$file"; then
      continue
    fi
    perl -0pi -e 's/function (\w+)\(\)\{let (\w+)=window\.location\.pathname;return \2\.endsWith\("\/"\)&&\(\2=\2\.slice\(0,-1\)\),\2\.startsWith\("\/"\)&&\(\2=\2\.slice\(1\)\),\2\}/function $1(){return document.body.dataset.slug}/g' "$file"
    if ! grep -q '(){return document.body.dataset.slug}' "$file"; then
      echo "graph プラグインへの応急処置を適用できませんでした: $file" >&2
      exit 1
    fi
  done
}
patch_graph_slug

# 3. 設定・スタイル・コンテンツの配置
cp "$SITE_DIR/quartz.config.yaml" quartz.config.yaml
cp "$SITE_DIR/custom.scss" quartz/styles/custom.scss
rm -rf content
cp -R "$REPO_ROOT/wiki" content

# 4. ビルド
if [ "${1:-}" = "--serve" ]; then
  exec npx quartz build "$@"
fi
rm -rf public
npx quartz build

# 5. robots メタタグの挿入（Quartz に robots を設定する項目がないため、出力後に挿入する）
find public -name '*.html' -print0 | xargs -0 perl -pi -e "s|<head>|<head>$ROBOTS_META|"
cp "$SITE_DIR/_headers" public/_headers

# 6. 成果物の検証
node "$SITE_DIR/verify.mjs" "$QUARTZ_DIR/public"
