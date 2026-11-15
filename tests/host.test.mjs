import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { encodeMediaPath, isWithin, rewriteResourceUrls } from '../src/index.js'
import { startFixtureHost } from './host.mjs'

async function fixture(t) {
  const cwd = await mkdtemp(join(tmpdir(), 'dsh-hve-test-'))
  await writeFile(join(cwd, 'index.html'), '<!doctype html><html><head><title>Demo</title></head><body><h1>Hello</h1><img src="images/a.png"><video src="media/a.mp4"></video></body></html>')
  await mkdir(join(cwd, 'images'))
  await writeFile(join(cwd, 'images/a.png'), Buffer.from([137, 80, 78, 71]))
  await mkdir(join(cwd, 'pages'))
  await writeFile(join(cwd, 'pages/about.htm'), '<h1>About</h1>')
  const host = await startFixtureHost(cwd)
  t.after(() => host.close())
  return { cwd, host }
}

async function open(host, path = 'index.html') {
  const response = await fetch(`${host.origin}/dsh-artifacts/api/open`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: 'session-1', path }) })
  assert.equal(response.status, 200)
  return response.json()
}

test('workspace containment handles siblings and path traversal', () => {
  assert.equal(isWithin('/work/a', '/work/a/page.html'), true)
  assert.equal(isWithin('/work/a', '/work/ab/page.html'), false)
  assert.equal(isWithin('/work/a', '/work/a/../secret'), false)
  assert.equal(encodeMediaPath('images/a b.png'), 'images/a%20b.png')
})

test('preview resource rewriting preserves absolute, data and anchor URLs', () => {
  const source = '<img src="a b.png"><img src="data:image/png;base64,xx"><a href="#top">Top</a><video poster="cover.jpg"></video>'
  const output = rewriteResourceUrls(source, value => `/media/${encodeMediaPath(value)}`)
  assert.match(output, /src="\/media\/a%20b.png"/)
  assert.match(output, /src="data:image\/png;base64,xx"/)
  assert.match(output, /href="#top"/)
  assert.match(output, /poster="\/media\/cover.jpg"/)
})

test('lists project HTML, opens and reads a document', async t => {
  const { host } = await fixture(t)
  const list = await fetch(`${host.origin}/dsh-artifacts/api/list?sessionId=session-1`).then(res => res.json())
  assert.deepEqual(list.files.map(file => file.name).sort(), ['index.html', 'pages/about.htm'])
  const opened = await open(host)
  const document = await fetch(`${host.origin}/dsh-artifacts/api/document?token=${opened.token}`).then(res => res.json())
  assert.match(document.html, /<h1>Hello<\/h1>/)
  assert.match(document.revision, /^[a-f0-9]{64}$/)
})

test('serves local media with its content type', async t => {
  const { host } = await fixture(t)
  const opened = await open(host)
  const response = await fetch(`${host.origin}/dsh-artifacts/media/${opened.token}/images/a.png`)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'image/png')
  assert.deepEqual([...await response.arrayBuffer().then(Buffer.from)], [137, 80, 78, 71])
})

test('rejects paths and symlinks outside the project', async t => {
  const { cwd, host } = await fixture(t)
  assert.equal((await fetch(`${host.origin}/dsh-artifacts/api/open`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: 'session-1', path: '../outside.html' }) })).status, 403)
  const outside = join(tmpdir(), `dsh-hve-outside-${Date.now()}.html`)
  await writeFile(outside, '<h1>secret</h1>')
  await symlink(outside, join(cwd, 'escape.html'))
  assert.equal((await fetch(`${host.origin}/dsh-artifacts/api/open`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: 'session-1', path: 'escape.html' }) })).status, 403)
  const outsideDirectory = await mkdtemp(join(tmpdir(), 'dsh-artifacts-outside-'))
  await writeFile(join(outsideDirectory, 'secret.html'), '<h1>secret</h1>')
  await symlink(outsideDirectory, join(cwd, 'linked-directory'), 'dir')
  const list = await fetch(`${host.origin}/dsh-artifacts/api/list?sessionId=session-1`).then(res => res.json())
  assert.equal(list.files.some(file => file.name.includes('secret.html')), false)
})

test('atomically saves and rejects stale revisions without overwriting', async t => {
  const { cwd, host } = await fixture(t)
  const opened = await open(host)
  const document = await fetch(`${host.origin}/dsh-artifacts/api/document?token=${opened.token}`).then(res => res.json())
  const updated = document.html.replace('Hello', 'Visual edit')
  const save = await fetch(`${host.origin}/dsh-artifacts/api/save`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: opened.token, revision: document.revision, html: updated }) })
  assert.equal(save.status, 200)
  assert.match(await readFile(join(cwd, 'index.html'), 'utf8'), /Visual edit/)
  await writeFile(join(cwd, 'index.html'), '<h1>External edit</h1>')
  const conflict = await fetch(`${host.origin}/dsh-artifacts/api/save`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: opened.token, revision: document.revision, html: updated }) })
  assert.equal(conflict.status, 409)
  assert.equal(await readFile(join(cwd, 'index.html'), 'utf8'), '<h1>External edit</h1>')
})

test('keeps bounded restorable history and reports Agent disk updates', async t => {
  const { cwd, host } = await fixture(t)
  const opened = await open(host)
  let document = await fetch(`${host.origin}/dsh-artifacts/api/document?token=${opened.token}`).then(res => res.json())
  const original = document.html
  for (let index = 0; index < 22; index++) {
    const response = await fetch(`${host.origin}/dsh-artifacts/api/save`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: opened.token, revision: document.revision, html: `<h1>Revision ${index}</h1>` }) })
    assert.equal(response.status, 200)
    document = await response.json()
  }
  assert.equal(document.versions.length, 20)
  const old = await fetch(`${host.origin}/dsh-artifacts/api/history?token=${opened.token}&id=${encodeURIComponent(document.versions.at(-1).id)}`).then(res => res.json())
  assert.equal(old.html, '<h1>Revision 1</h1>')
  assert.notEqual(old.html, original)
  await writeFile(join(cwd, 'index.html'), '<h1>Agent update</h1>')
  const status = await fetch(`${host.origin}/dsh-artifacts/api/status?token=${opened.token}`).then(res => res.json())
  assert.notEqual(status.revision, status.savedRevision)
})

test('serializes concurrent saves without temporary-file collisions', async t => {
  const { host } = await fixture(t)
  const opened = await open(host)
  const document = await fetch(`${host.origin}/dsh-artifacts/api/document?token=${opened.token}`).then(res => res.json())
  const saves = await Promise.all(Array.from({ length: 12 }, (_, index) => fetch(`${host.origin}/dsh-artifacts/api/save`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: opened.token, revision: document.revision, html: `<h1>Concurrent ${index}</h1>` }) })))
  assert.equal(saves.filter(response => response.status === 200).length, 1)
  assert.equal(saves.filter(response => response.status === 409).length, 11)
})

test('preview runs in an opaque sandbox and serves unsaved drafts', async t => {
  const { host } = await fixture(t)
  const opened = await open(host)
  const draft = await fetch(`${host.origin}/dsh-artifacts/api/draft`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: opened.token, html: '<h1>Draft</h1><img src="images/a.png">' }) })
  assert.equal(draft.status, 200)
  const response = await fetch(`${host.origin}${(await draft.json()).url}`)
  assert.match(response.headers.get('content-security-policy'), /^sandbox allow-scripts/)
  assert.doesNotMatch(response.headers.get('content-security-policy'), /allow-same-origin/)
  assert.match(await response.text(), /src="\/dsh-artifacts\/media\/[^/]+\/images\/a.png"/)
})
