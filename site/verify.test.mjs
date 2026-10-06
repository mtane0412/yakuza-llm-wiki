// site/verify.mjs のテスト
//
// 仕様:
// - 一時ディレクトリに最小限の成果物を作り、verify.mjs を子プロセスとして実行して検出結果を確かめる
// - 実行方法: node --test site/
import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const verifyScript = path.join(path.dirname(fileURLToPath(import.meta.url)), "verify.mjs")

/**
 * 指定した HTML を index.html として持つ一時的な出力ディレクトリを作り、verify.mjs を実行する。
 * @param html index.html の内容
 * @returns verify.mjs の標準エラー出力
 */
function runVerifyWithIndexHtml(html) {
  const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), "verify-test-"))
  try {
    fs.writeFileSync(path.join(publicDir, "index.html"), html)
    fs.writeFileSync(path.join(publicDir, "山口組.html"), "<html><head></head></html>")
    return spawnSync(process.execPath, [verifyScript, publicDir], { encoding: "utf8" }).stderr
  } finally {
    fs.rmSync(publicDir, { recursive: true, force: true })
  }
}

test("class 属性が href 属性より前にある内部リンクのリンク切れも検出する", () => {
  const stderr = runVerifyWithIndexHtml('<html><head></head><a class="internal" href="./存在しないページ">壊れたリンク</a></html>')
  assert.match(stderr, /内部リンク切れが 1 件あります/)
  assert.match(stderr, /存在しないページ/)
})

test("href 属性が class 属性より前にある内部リンクのリンク切れも検出する", () => {
  const stderr = runVerifyWithIndexHtml('<html><head></head><a href="./存在しないページ" class="internal alias">壊れたリンク</a></html>')
  assert.match(stderr, /内部リンク切れが 1 件あります/)
})

test("実在するページへの内部リンクはリンク切れとして扱わない", () => {
  const stderr = runVerifyWithIndexHtml('<html><head></head><a class="internal" href="./山口組">山口組</a></html>')
  assert.doesNotMatch(stderr, /内部リンク切れ/)
})

test("internal クラスを持たない外部リンクは検査しない", () => {
  const stderr = runVerifyWithIndexHtml('<html><head></head><a href="https://example.com/missing" class="external">外部</a></html>')
  assert.doesNotMatch(stderr, /内部リンク切れ/)
})
