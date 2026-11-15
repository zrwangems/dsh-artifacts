import { createHash, randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, readdir, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, extname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'dsh-artifacts'
export const inject = ['webServer', 'sessions']

const PREFIX = '/dsh-artifacts'
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const MAX_HTML_BYTES = 16 * 1024 * 1024
const MAX_MEDIA_BYTES = 128 * 1024 * 1024
const MAX_FILES = 500
const MAX_HISTORY = 20
const MAX_DOCUMENTS = 128
const MAX_PPTX_BYTES = 128 * 1024 * 1024
const PPTX_CONVERT_TIMEOUT = 180_000
const SKIPPED_DIRECTORIES = new Set(['node_modules', '.git', '.dsh', 'dist', 'build', 'coverage'])
const TYPES = {
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.bmp': 'image/bmp',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.otf': 'font/otf', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.wasm': 'application/wasm',
}

function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
}

function error(res, status, message, code = 'bad-request') {
  json(res, status, { ok: false, error: { code, message } })
}

async function body(req, limit = MAX_HTML_BYTES + 1024 * 1024) {
  const chunks = []
  let length = 0
  for await (const chunk of req) {
    length += chunk.length
    if (length > limit) throw new Error('请求体过大')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex')
}

export function isWithin(root, target) {
  const base = resolve(root)
  const path = resolve(target)
  return path === base || path.startsWith(base + sep)
}

export function encodeMediaPath(path) {
  return path.split(/[\\/]+/).filter(Boolean).map(encodeURIComponent).join('/')
}

function decodeSegments(value) {
  return value.split('/').filter(Boolean).map(part => decodeURIComponent(part))
}

async function atomicWrite(path, content, mode) {
  const temporary = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
  try {
    await writeFile(temporary, content, { encoding: 'utf8', mode })
    await rename(temporary, path)
  } catch (cause) {
    try { await unlink(temporary) } catch { /* The original failure is actionable. */ }
    throw cause
  }
}

async function safeRealpath(path) {
  const canonical = await realpath(path)
  return canonical
}

function contentType(path) {
  return TYPES[extname(path).toLowerCase()] || 'application/octet-stream'
}

async function sendFile(req, res, path, type = contentType(path), csp) {
  const info = await stat(path)
  res.writeHead(200, {
    'content-type': type,
    'content-length': info.size,
    'cache-control': 'no-cache',
    'x-content-type-options': 'nosniff',
    ...(csp ? { 'content-security-policy': csp } : {}),
  })
  if (req.method === 'HEAD') return res.end()
  const stream = createReadStream(path)
  stream.on('error', () => res.destroy())
  stream.pipe(res)
}

async function pruneHistory(directory) {
  const names = (await readdir(directory)).filter(name => name.endsWith('.html')).sort().reverse()
  await Promise.all(names.slice(MAX_HISTORY).flatMap(name => [
    unlink(resolve(directory, name)).catch(() => {}),
    unlink(resolve(directory, `${name}.json`)).catch(() => {}),
  ]))
}

async function backup(document, bytes) {
  await mkdir(document.historyDir, { recursive: true, mode: 0o700 })
  const canonical = await realpath(document.historyDir)
  if (!isWithin(document.cwd, canonical)) throw new Error('历史版本目录不能指向项目目录之外')
  const name = `${new Date().toISOString().replaceAll(':', '-')}-${process.hrtime.bigint().toString().padStart(20, '0')}-${document.revision}.html`
  await writeFile(resolve(document.historyDir, name), bytes, { mode: 0o600, flag: 'wx' })
  await writeFile(resolve(document.historyDir, `${name}.json`), JSON.stringify({ revision: document.revision, createdAt: new Date().toISOString() }), { mode: 0o600 })
  await pruneHistory(document.historyDir)
}

async function history(document) {
  let names = []
  try { names = await readdir(document.historyDir) } catch (cause) { if (cause.code === 'ENOENT') return []; throw cause }
  return names.filter(name => name.endsWith('.html')).sort().reverse().slice(0, MAX_HISTORY).map(name => ({
    id: name.slice(0, -5), revision: name.slice(-69, -5), createdAt: name.slice(0, 24),
  }))
}

function sessionCwd(ctx, sessionId) {
  const session = ctx.sessions?.get?.(sessionId)
  const cwd = session?.header?.cwd || session?.cwd
  if (typeof cwd !== 'string' || !cwd) throw new Error('找不到会话工作目录，请重新打开会话')
  return resolve(cwd)
}

async function listHtml(root, current = root, output = []) {
  if (output.length >= MAX_FILES) return output
  const entries = await readdir(current, { withFileTypes: true })
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (output.length >= MAX_FILES) break
    if (entry.name.startsWith('.') || SKIPPED_DIRECTORIES.has(entry.name)) continue
    const path = resolve(current, entry.name)
    if (entry.isDirectory()) await listHtml(root, path, output)
    else if (entry.isFile() && /\.(?:html?|pptx)$/i.test(entry.name)) output.push({ path, name: path.slice(root.length + 1) })
  }
  return output
}

function escapeHtml(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function rewriteResourceUrls(html, rewrite) {
  return html.replace(/\b(src|poster|href)=(["'])([^"']+)\2/gi, (match, attribute, quote, value) => {
    if (/^(?:[a-z]+:|\/\/|#|data:|blob:|\/)/i.test(value)) return match
    return `${attribute}=${quote}${escapeHtml(rewrite(value))}${quote}`
  })
}

export function apply(ctx) {
  const documents = new Map()
  const drafts = new Map()
  const saveQueues = new Map()

  function serialized(path, operation) {
    const previous = saveQueues.get(path) || Promise.resolve()
    const next = previous.catch(() => {}).then(operation)
    saveQueues.set(path, next)
    return next.finally(() => { if (saveQueues.get(path) === next) saveQueues.delete(path) })
  }

  function authorize(token) {
    const document = documents.get(token)
    if (!document) throw new Error('编辑链接已失效，请重新打开文件')
    return document
  }

  function ownedPath(document, candidate) {
    const path = resolve(candidate)
    if (!isWithin(document.cwd, path)) throw new Error('文件不在当前项目目录内')
    return path
  }

  async function open(sessionId, requestedPath) {
    const cwd = sessionCwd(ctx, sessionId)
    const path = ownedPath({ cwd }, resolve(cwd, requestedPath || 'index.html'))
    if (!/\.html?$/i.test(path)) throw new Error('只支持 .html 和 .htm 文件')
    const canonical = await safeRealpath(path)
    if (!isWithin(cwd, canonical)) throw new Error('文件符号链接指向项目目录之外')
    const info = await stat(canonical)
    if (!info.isFile() || info.size > MAX_HTML_BYTES) throw new Error('文件不存在、不是普通文件或超过 16 MiB')
    const bytes = await readFile(canonical)
    const token = randomBytes(24).toString('base64url')
    if (documents.size >= MAX_DOCUMENTS) {
      const oldest = documents.keys().next().value
      documents.delete(oldest)
      drafts.delete(oldest)
    }
    documents.set(token, { token, sessionId, cwd, path: canonical, revision: hash(bytes), mode: info.mode, historyDir: resolve(cwd, '.dsh', 'artifacts', hash(relative(cwd, canonical))) })
    return { ok: true, token, path: canonical, cwd, url: `${PREFIX}/editor?token=${encodeURIComponent(token)}` }
  }

  async function importPptx(sessionId, requestedPath, requestedOutput, overwrite = false) {
    const cwd = sessionCwd(ctx, sessionId)
    const source = ownedPath({ cwd }, resolve(cwd, requestedPath || ''))
    if (!/\.pptx$/i.test(source)) throw new Error('只支持 .pptx 文件；请先将旧版 .ppt 另存为 .pptx')
    const canonicalSource = await safeRealpath(source)
    if (!isWithin(cwd, canonicalSource)) throw new Error('PPTX 符号链接指向项目目录之外')
    const info = await stat(canonicalSource)
    if (!info.isFile() || info.size > MAX_PPTX_BYTES) throw new Error('PPTX 不存在、不是普通文件或超过 128 MiB')
    const output = ownedPath({ cwd }, requestedOutput ? resolve(cwd, requestedOutput) : canonicalSource.replace(/\.pptx$/i, '.html'))
    if (!/\.html?$/i.test(output)) throw new Error('输出文件必须使用 .html 或 .htm 后缀')
    if (output === canonicalSource) throw new Error('输出文件不能覆盖源 PPTX')
    const canonicalParent = await safeRealpath(dirname(output))
    if (!isWithin(cwd, canonicalParent)) throw new Error('输出目录指向项目目录之外')
    if (!overwrite) {
      try { await stat(output); throw new Error('目标 HTML 已存在，请更换输出路径或明确允许覆盖') } catch (cause) { if (cause.code !== 'ENOENT') throw cause }
    } else {
      try {
        const canonicalOutput = await safeRealpath(output)
        if (!isWithin(cwd, canonicalOutput)) throw new Error('输出文件符号链接指向项目目录之外')
      } catch (cause) { if (cause.code !== 'ENOENT') throw cause }
    }
    await serialized(output, async () => {
      const python = process.env.DSH_ARTIFACTS_PYTHON || (process.platform === 'win32' ? 'python' : 'python3')
      const script = resolve(ROOT, 'scripts/pptx_to_artifacts.py')
      await new Promise((resolvePromise, reject) => {
        const child = spawn(python, [script, canonicalSource, output, ...(overwrite ? ['--overwrite'] : [])], { shell: false, windowsHide: true })
        let stdout = ''
        let stderr = ''
        const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('PPTX 转换超过 180 秒，已停止')) }, PPTX_CONVERT_TIMEOUT)
        child.stdout.on('data', chunk => { stdout = (stdout + chunk).slice(-65536) })
        child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-65536) })
        child.on('error', cause => { clearTimeout(timer); reject(new Error(`无法启动 Python：${cause.message}。请安装 Python 3、LibreOffice 及 scripts/requirements-pptx.txt 中的依赖`)) })
        child.on('close', code => {
          clearTimeout(timer)
          if (code !== 0) return reject(new Error(`PPTX 转换失败：${stderr.trim() || stdout.trim() || `退出码 ${code}`}`))
          resolvePromise()
        })
      })
      const resultInfo = await stat(output)
      if (resultInfo.size > MAX_HTML_BYTES) {
        await unlink(output).catch(() => {})
        throw new Error('转换结果超过 16 MiB，请压缩 PPT 中的图片后重试')
      }
    })
    const opened = await open(sessionId, relative(cwd, output))
    return { ...opened, converted: true, source: canonicalSource }
  }

  const handler = async (req, res) => {
    const url = new URL(req.url || '/', 'http://dsh.local')
    const path = url.pathname
    try {
      if (path === `${PREFIX}/api/list`) {
        const sessionId = url.searchParams.get('sessionId') || ''
        const cwd = sessionCwd(ctx, sessionId)
        const files = await listHtml(cwd)
        json(res, 200, { ok: true, cwd, files, truncated: files.length >= MAX_FILES })
        return
      }
      if (path === `${PREFIX}/api/open`) {
        if (req.method !== 'POST') return error(res, 405, 'method not allowed')
        const input = await body(req, 64 * 1024)
        json(res, 200, await open(String(input.sessionId || ''), String(input.path || '')))
        return
      }
      if (path === `${PREFIX}/api/import-pptx`) {
        if (req.method !== 'POST') return error(res, 405, 'method not allowed')
        const input = await body(req, 64 * 1024)
        json(res, 200, await importPptx(String(input.sessionId || ''), String(input.path || ''), input.outputPath ? String(input.outputPath) : '', input.overwrite === true))
        return
      }
      if (path === `${PREFIX}/api/document`) {
        const document = authorize(url.searchParams.get('token') || '')
        const [html, versions] = await Promise.all([readFile(document.path, 'utf8'), history(document)])
        json(res, 200, { ok: true, html, revision: document.revision, path: document.path, relativePath: relative(document.cwd, document.path), versions })
        return
      }
      if (path === `${PREFIX}/api/status`) {
        const document = authorize(url.searchParams.get('token') || '')
        const bytes = await readFile(document.path)
        json(res, 200, { ok: true, revision: hash(bytes), savedRevision: document.revision })
        return
      }
      if (path === `${PREFIX}/api/history`) {
        const document = authorize(url.searchParams.get('token') || '')
        const id = url.searchParams.get('id') || ''
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z-\d{20}-[a-f0-9]{64}$/.test(id)) return error(res, 400, '版本编号无效')
        const historyPath = await safeRealpath(resolve(document.historyDir, `${id}.html`))
        if (!isWithin(document.cwd, historyPath) || !isWithin(document.historyDir, historyPath)) return error(res, 403, '历史版本不能指向项目目录之外')
        const bytes = await readFile(historyPath)
        if (Buffer.byteLength(bytes) > MAX_HTML_BYTES) return error(res, 413, '历史版本过大')
        json(res, 200, { ok: true, html: bytes.toString('utf8'), revision: hash(bytes) })
        return
      }
      if (path === `${PREFIX}/api/save`) {
        if (req.method !== 'POST') return error(res, 405, 'method not allowed')
        const input = await body(req)
        const document = authorize(String(input.token || ''))
        if (typeof input.html !== 'string') return error(res, 400, 'html is required')
        await serialized(document.path, async () => {
          const current = await readFile(document.path)
          if (hash(current) !== document.revision || input.revision !== document.revision) {
            return error(res, 409, '文件已被其他程序修改。未保存内容仍在编辑器中，请先处理磁盘版本', 'revision-conflict')
          }
          if (Buffer.byteLength(input.html) > MAX_HTML_BYTES) return error(res, 413, '保存后的文件超过 16 MiB')
          const canonical = await safeRealpath(document.path)
          if (!isWithin(document.cwd, canonical)) return error(res, 403, '文件符号链接已指向项目目录之外')
          await backup(document, current)
          await atomicWrite(canonical, input.html, document.mode)
          document.revision = hash(Buffer.from(input.html))
          drafts.delete(document.token)
          json(res, 200, { ok: true, revision: document.revision, versions: await history(document) })
        })
        return
      }
      if (path === `${PREFIX}/api/draft`) {
        if (req.method !== 'POST') return error(res, 405, 'method not allowed')
        const input = await body(req)
        const document = authorize(String(input.token || ''))
        if (typeof input.html !== 'string' || Buffer.byteLength(input.html) > MAX_HTML_BYTES) return error(res, 413, '预览内容无效或过大')
        drafts.set(document.token, input.html)
        json(res, 200, { ok: true, url: `${PREFIX}/preview?token=${encodeURIComponent(document.token)}` })
        return
      }
      if (path === `${PREFIX}/editor`) {
        const document = authorize(url.searchParams.get('token') || '')
        let html = await readFile(resolve(ROOT, 'dist/editor.html'), 'utf8')
        html = html.replaceAll('__TOKEN__', document.token)
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
        res.end(html)
        return
      }
      if (path.startsWith(`${PREFIX}/assets/`)) {
        const relative = decodeSegments(path.slice(`${PREFIX}/assets/`.length)).join('/')
        const asset = resolve(ROOT, 'dist', relative)
        if (!isWithin(resolve(ROOT, 'dist'), asset)) return error(res, 403, 'forbidden')
        await sendFile(req, res, asset)
        return
      }
      if (path.startsWith(`${PREFIX}/media/`)) {
        const rest = path.slice(`${PREFIX}/media/`.length)
        const separator = rest.indexOf('/')
        const document = authorize(separator < 0 ? '' : rest.slice(0, separator))
        const relative = decodeSegments(rest.slice(separator + 1)).join('/')
        const target = ownedPath(document, resolve(dirname(document.path), relative))
        const canonical = await safeRealpath(target)
        if (!isWithin(document.cwd, canonical)) return error(res, 403, 'media symlink outside workspace')
        const info = await stat(canonical)
        if (!info.isFile() || info.size > MAX_MEDIA_BYTES) return error(res, 413, 'media missing or too large')
        await sendFile(req, res, canonical)
        return
      }
      if (path === `${PREFIX}/preview`) {
        const document = authorize(url.searchParams.get('token') || '')
        const source = drafts.get(document.token) || await readFile(document.path, 'utf8')
        const media = value => `${PREFIX}/media/${document.token}/${encodeMediaPath(value)}`
        const preview = rewriteResourceUrls(source, media)
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
          'content-security-policy': "sandbox allow-scripts allow-forms allow-modals allow-popups allow-downloads; default-src * data: blob: 'unsafe-inline' 'unsafe-eval'; frame-ancestors 'self'",
        })
        res.end(preview)
        return
      }
      error(res, 404, 'not found', 'not-found')
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      const status = /失效|项目目录|forbidden|符号链接/.test(message) ? 403 : /ENOENT|找不到/.test(message) ? 404 : 400
      error(res, status, message)
    }
  }

  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: PREFIX, handler }), 'dsh-artifacts: routes')
  ctx.effect(() => () => { documents.clear(); drafts.clear() }, 'dsh-artifacts: cleanup')
}

export { atomicWrite, listHtml }
