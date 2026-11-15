import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFile, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { startFixtureHost } from './host.mjs'

const converterAvailable = spawnSync(process.env.DSH_ARTIFACTS_PYTHON || 'python3', ['-c', 'import pptx,fitz,PIL'], { stdio: 'ignore' }).status === 0 && spawnSync('libreoffice', ['--version'], { stdio: 'ignore' }).status === 0

async function fixture(t) {
  const cwd = await mkdtemp(join(tmpdir(), 'dsh-pptx-test-'))
  await copyFile(new URL('./fixtures/ITRC-template.pptx', import.meta.url), join(cwd, 'ITRC-template.pptx'))
  const host = await startFixtureHost(cwd)
  t.after(() => host.close())
  return { cwd, host }
}

test('imports PPTX into native editable Artifacts HTML and opens it', { skip: !converterAvailable && 'requires Python converter dependencies and LibreOffice' }, async t => {
  const { cwd, host } = await fixture(t)
  const response = await fetch(`${host.origin}/dsh-artifacts/api/import-pptx`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: 'session-1', path: 'ITRC-template.pptx' }),
  })
  const responseText = await response.text()
  assert.equal(response.status, 200, responseText)
  const opened = JSON.parse(responseText)
  assert.equal(opened.converted, true)
  assert.match(opened.token, /^[A-Za-z0-9_-]+$/)
  const document = await fetch(`${host.origin}/dsh-artifacts/api/document?token=${opened.token}`).then(res => res.json())
  assert.equal((document.html.match(/data-ppt-role="text"/g) || []).length, 31)
  assert.equal((document.html.match(/data-ppt-role="picture"/g) || []).length, 13)
  assert.equal((document.html.match(/class="slide" data-slide=/g) || []).length, 6)
  assert.match(document.html, /class="slides"/)
  assert.match(document.html, /width:1280px;height:720px/)
  assert.match(document.html, /北京航空航天大学/)
  assert.match(document.html, /data:image\/png;base64/)
  assert.doesNotMatch(document.html, /<script/i)
  assert.ok(document.html.length < 16 * 1024 * 1024)
  assert.ok(await readFile(join(cwd, 'ITRC-template.html'), 'utf8'))
  const second = await fetch(`${host.origin}/dsh-artifacts/api/import-pptx`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: 'session-1', path: 'ITRC-template.pptx' }),
  })
  assert.equal(second.status, 400)
})

test('rejects PPTX import path traversal and output symlink escape', async t => {
  const { cwd, host } = await fixture(t)
  const outside = await fetch(`${host.origin}/dsh-artifacts/api/import-pptx`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: 'session-1', path: '../outside.pptx' }),
  })
  assert.equal(outside.status, 403)
  const outsideDirectory = await mkdtemp(join(tmpdir(), 'dsh-pptx-outside-'))
  await writeFile(join(outsideDirectory, 'target.html'), 'do not overwrite')
  await symlink(join(outsideDirectory, 'target.html'), join(cwd, 'escape.html'))
  const escaped = await fetch(`${host.origin}/dsh-artifacts/api/import-pptx`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: 'session-1', path: 'ITRC-template.pptx', outputPath: 'escape.html', overwrite: true }),
  })
  assert.equal(escaped.status, 403)
  assert.equal(await readFile(join(outsideDirectory, 'target.html'), 'utf8'), 'do not overwrite')
})
