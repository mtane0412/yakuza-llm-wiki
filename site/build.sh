#!/usr/bin/env bash
# wiki/ を Quartz で静的サイトとしてビルドするスクリプト
#
# 仕様:
# - バージョンを固定した Quartz を site/.quartz/ に取得し（Git 管理外）、プラグインを lockfile どおりに復元する
# - site/quartz.config.yaml と site/custom.scss を Quartz に配置し、wiki/ を content/ にコピーしてビルドする
# - 公開するのは wiki/ のみで、raw/ と templates/ はコピーしない
# - 検索エンジンに載せないため、出力したすべての HTML の <head> 直後に robots メタタグ（noindex, nofollow）を挿入する
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

# 6. 成果物の検証
node "$SITE_DIR/verify.mjs" "$QUARTZ_DIR/public"
