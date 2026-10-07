// 静的サイトのビルド成果物を検証するスクリプト
//
// 仕様:
// - 引数で渡された出力ディレクトリ（既定は site/.quartz/public）を走査し、公開してよい状態かを検査する
// - 検査項目:
//   1. トップページ（index.html）が存在すること
//   2. すべての HTML に noindex, nofollow の robots メタタグが入っていること
//   3. 検索エンジン向けのサイトマップ（sitemap.xml）と RSS（index.xml）が出力されていないこと
//   4. 生ソース（raw/）・テンプレート（templates/）が公開されていないこと
//   5. CLAUDE.md 2.4 の独自コールアウト（contradiction / disputed / bias / question）の CSS が含まれていること
//   6. ページ内の内部リンクがすべて実在するページを指していること
//   7. グラフビューのスクリプトが URL のパスを slug として使っていないこと
//      （日本語のページ名がパーセントエンコードのまま索引と照合され、グラフが空になる不具合への応急処置を確認する。
//        応急処置は site/build.sh の patch_graph_slug を参照）
//   8. Cloudflare Workers Static Assets 用の _headers が、全パス（/*）に X-Robots-Tag: noindex, nofollow を付けること
//   9. グラフビューのスクリプトがラベルを画面の 4 倍の解像度で描いていないこと
//      （iPhone の Safari がテクスチャのメモリ不足でページを強制再読み込みする不具合への応急処置を確認する。
//        応急処置は site/build.sh の patch_graph_label_resolution を参照）
// - 1 件でも違反があれば違反内容を列挙して終了コード 1 で終了する

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const siteDir = path.dirname(fileURLToPath(import.meta.url))
const publicDir = path.resolve(process.argv[2] ?? path.join(siteDir, ".quartz", "public"))

const ROBOTS_META = '<meta name="robots" content="noindex, nofollow">'
const CUSTOM_CALLOUTS = ["contradiction", "disputed", "bias", "question"]
// @quartz-community/utils の getFullSlugFromUrl() が minify された形（例: let u=window.location.pathname;return u.endsWith("/")…）
const RAW_PATHNAME_SLUG = /let (\w+)=window\.location\.pathname;return \1\.endsWith\("\/"\)/
// graph プラグインがラベル（PIXI.Text）に指定する解像度が minify された形
const QUADRUPLE_LABEL_RESOLUTION = /resolution:window\.devicePixelRatio\*4\b/

/**
 * ディレクトリ配下のファイルを再帰的に列挙する。
 * @param dir 走査するディレクトリの絶対パス
 * @returns publicDir からの相対パス（POSIX 形式）の配列
 */
function listFiles(dir) {
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(publicDir, path.join(entry.parentPath, entry.name)))
    .map((rel) => rel.split(path.sep).join("/"))
}

/**
 * 内部リンクの href が、出力ディレクトリ内の実在するファイルを指しているかを判定する。
 * Quartz は拡張子なしのリンク（例: ../concepts/上納金）を出力するため、.html とフォルダの index.html も候補にする。
 * @param fromFile リンク元 HTML の相対パス
 * @param href a 要素の href 属性値
 * @returns 実在する場合は true
 */
function resolvesToExistingFile(fromFile, href) {
  const target = decodeURIComponent(href.split("#")[0].split("?")[0])
  if (target === "") return true
  const joined = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), target))
  const base = joined.replace(/\/$/, "")
  const candidates = [joined, `${base}.html`, path.posix.join(base, "index.html")]
  return candidates.some((candidate) => fs.existsSync(path.join(publicDir, candidate)))
}

/**
 * HTML から、internal クラスを持つ a 要素の href 属性値を列挙する。
 * Quartz は既存のクラスに internal を追加するため、class と href の属性順に依存せずに読み取る。
 * @param html 検査対象の HTML
 * @returns 内部リンクの href 属性値の配列
 */
function internalLinkHrefs(html) {
  const hrefs = []
  for (const [tag] of html.matchAll(/<a\s[^>]*>/g)) {
    const className = tag.match(/\sclass="([^"]*)"/)?.[1]
    const href = tag.match(/\shref="([^"]*)"/)?.[1]
    if (href !== undefined && className?.split(/\s+/).includes("internal")) hrefs.push(href)
  }
  return hrefs
}

function main() {
  if (!fs.existsSync(publicDir)) {
    console.error(`出力ディレクトリが存在しません: ${publicDir}`)
    process.exit(1)
  }

  const errors = []
  const files = listFiles(publicDir)
  const htmlFiles = files.filter((file) => file.endsWith(".html"))

  // 1. トップページ
  if (!files.includes("index.html")) errors.push("index.html が存在しません")

  // 2. noindex
  const withoutRobots = htmlFiles.filter(
    (file) => !fs.readFileSync(path.join(publicDir, file), "utf8").includes(ROBOTS_META),
  )
  if (withoutRobots.length > 0) {
    errors.push(`robots メタタグのない HTML が ${withoutRobots.length} 件あります（例: ${withoutRobots[0]}）`)
  }

  // 3. サイトマップと RSS
  for (const file of ["sitemap.xml", "index.xml"]) {
    if (files.includes(file)) errors.push(`${file} が出力されています`)
  }

  // 4. 生ソース・テンプレート
  const leaked = files.filter((file) => /^(raw|templates)\//.test(file))
  if (leaked.length > 0) errors.push(`公開対象外のファイルが ${leaked.length} 件あります（例: ${leaked[0]}）`)

  // 5. 独自コールアウトの CSS
  const css = files
    .filter((file) => file.endsWith(".css"))
    .map((file) => fs.readFileSync(path.join(publicDir, file), "utf8"))
    .join("\n")
  for (const name of CUSTOM_CALLOUTS) {
    if (!css.includes(`[data-callout=${name}]`) && !css.includes(`[data-callout="${name}"]`)) {
      errors.push(`コールアウト ${name} の CSS がありません`)
    }
  }

  // 6. 内部リンク切れ
  const brokenLinks = []
  let checkedLinks = 0
  for (const file of htmlFiles) {
    const html = fs.readFileSync(path.join(publicDir, file), "utf8")
    for (const href of internalLinkHrefs(html)) {
      checkedLinks++
      if (!resolvesToExistingFile(file, href)) brokenLinks.push(`${file} → ${href}`)
    }
  }
  if (brokenLinks.length > 0) {
    errors.push(`内部リンク切れが ${brokenLinks.length} 件あります:\n    ${brokenLinks.slice(0, 20).join("\n    ")}`)
  }

  // 7. グラフビューの slug 取得
  const unpatchedScripts = files
    .filter((file) => file.endsWith(".js"))
    .filter((file) => RAW_PATHNAME_SLUG.test(fs.readFileSync(path.join(publicDir, file), "utf8")))
  if (unpatchedScripts.length > 0) {
    errors.push(`URL のパスを slug として使うスクリプトが残っています（グラフビューが空になる）: ${unpatchedScripts.join(", ")}`)
  }

  // 8. _headers による X-Robots-Tag
  const headersPath = path.join(publicDir, "_headers")
  const headers = fs.existsSync(headersPath) ? fs.readFileSync(headersPath, "utf8") : ""
  if (!/^\/\*\n(?:[ \t]+.*\n)*?[ \t]+X-Robots-Tag: noindex, nofollow$/m.test(headers)) {
    errors.push("_headers に /* 向けの X-Robots-Tag: noindex, nofollow がありません")
  }

  // 9. グラフビューのラベルの解像度
  const highResolutionLabelScripts = files
    .filter((file) => file.endsWith(".js"))
    .filter((file) => QUADRUPLE_LABEL_RESOLUTION.test(fs.readFileSync(path.join(publicDir, file), "utf8")))
  if (highResolutionLabelScripts.length > 0) {
    errors.push(
      `グラフのラベルを画面の 4 倍の解像度で描くスクリプトが残っています（iPhone の Safari がメモリ不足で落ちる）: ${highResolutionLabelScripts.join(", ")}`,
    )
  }

  if (errors.length > 0) {
    console.error(`検証に失敗しました（${publicDir}）:\n  - ${errors.join("\n  - ")}`)
    process.exit(1)
  }
  console.log(`検証に成功しました: HTML ${htmlFiles.length} 件、内部リンク ${checkedLinks} 件`)
}

main()
