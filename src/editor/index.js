import grapesjs from 'grapesjs'
import katex from 'katex'
import 'grapesjs/dist/css/grapes.min.css'
import './style.css'

const PREFIX = '/dsh-artifacts'
const token = document.querySelector('#app').dataset.token
const $ = selector => document.querySelector(selector)
let revision = ''
let originalHtml = ''
let selected = null
let dirty = false
let saving = false
let editor
let presentation = false
let activeSlide = 0
let currentRevision = ''
let lastSelectedId = ''

function status(message, timeout = 2500) {
  $('#status').textContent = message
  clearTimeout(status.timer)
  if (timeout && message) status.timer = setTimeout(() => { $('#status').textContent = '' }, timeout)
}

function setDirty(value = true) {
  dirty = value
  $('#dirty').hidden = !value
}

function mediaUrl(value) {
  return `${PREFIX}/media/${token}/${value.split(/[\\/]+/).filter(Boolean).map(encodeURIComponent).join('/')}`
}

function rewriteCssUrls(style) {
  return style.replace(/url\((['"]?)(?!data:|https?:|\/)([^)'"]+)\1\)/gi, (_, quote, value) => `url(${quote}${mediaUrl(value.trim())}${quote})`)
}

function rewriteResources(root) {
  const attributes = ['src', 'poster']
  root.querySelectorAll('*').forEach(element => {
    attributes.forEach(attribute => {
      const value = element.getAttribute(attribute)
      if (value && !/^(?:[a-z]+:|\/\/|#|\/)/i.test(value)) element.setAttribute(attribute, mediaUrl(value))
    })
    if (element.tagName === 'LINK' && element.getAttribute('href') && !/^(?:[a-z]+:|\/\/|#|\/)/i.test(element.getAttribute('href'))) {
      element.setAttribute('href', mediaUrl(element.getAttribute('href')))
    }
    const style = element.getAttribute('style')
    if (style) element.setAttribute('style', rewriteCssUrls(style))
  })
  return root
}

function restoreResources(html) {
  return html.replaceAll(`${PREFIX}/media/${token}/`, '__DSH_MEDIA__').replace(/__DSH_MEDIA__([^\s"'()<>]+)/g, (_, value) => value.split('/').map(decodeURIComponent).join('/'))
}

function latexOf(component) {
  return component?.getAttributes?.()['data-latex'] || ''
}

function formulaComponent(component) {
  let current = component
  while (current) {
    if (latexOf(current)) return current
    current = current.parent?.()
  }
  return null
}

function formulaHtml(latex, displayMode = true) {
  return katex.renderToString(latex, { displayMode, throwOnError: true, output: 'mathml', strict: 'warn' })
}

function escapeAttribute(value) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function formulaBlock(latex, displayMode = true) {
  return `<span class="dsh-formula" data-latex="${escapeAttribute(latex)}" data-display="${displayMode}">${formulaHtml(latex, displayMode)}</span>`
}

function addBlocks(editor) {
  const blocks = editor.BlockManager
  blocks.add('heading', { label: '标题', category: '文本', media: 'H', content: '<h2>双击编辑标题</h2>', activate: true })
  blocks.add('text', { label: '文本', category: '文本', media: '¶', content: '<p>双击编辑这段文字。可以调整字体、颜色、间距和对齐方式。</p>', activate: true })
  blocks.add('button', { label: '按钮', category: '文本', media: '▣', content: '<a href="#" style="display:inline-block;padding:10px 18px;border-radius:6px;background:#4d6bfe;color:white;text-decoration:none">按钮文字</a>' })
  blocks.add('image', { label: '图片', category: '媒体', media: '▧', content: { type: 'image', attributes: { src: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22640%22 height=%22360%22%3E%3Crect width=%22100%25%22 height=%22100%25%22 fill=%22%23e9edf5%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 text-anchor=%22middle%22 fill=%22%23747c8c%22 font-size=%2224%22%3E替换图片%3C/text%3E%3C/svg%3E', alt: '图片' } }, activate: true })
  blocks.add('video', { label: '视频', category: '媒体', media: '▶', content: '<video controls preload="metadata" style="max-width:100%;width:640px">你的浏览器不支持视频。请在右侧属性中填写视频地址。</video>', activate: true })
  blocks.add('audio', { label: '音频', category: '媒体', media: '♫', content: '<audio controls src="" style="width:100%"></audio>' })
  blocks.add('rectangle', { label: '矩形', category: '图案', media: '■', content: '<svg viewBox="0 0 240 140" width="240" height="140" role="img" aria-label="矩形"><rect x="4" y="4" width="232" height="132" rx="12" fill="#4d6bfe"/></svg>' })
  blocks.add('circle', { label: '圆形', category: '图案', media: '●', content: '<svg viewBox="0 0 160 160" width="160" height="160" role="img" aria-label="圆形"><circle cx="80" cy="80" r="72" fill="#20b486"/></svg>' })
  blocks.add('star', { label: '星形', category: '图案', media: '★', content: '<svg viewBox="0 0 200 200" width="180" height="180" role="img" aria-label="星形"><path d="M100 8 124 72 192 76 140 120 158 188 100 150 42 188 60 120 8 76 76 72Z" fill="#f5b82e"/></svg>' })
  blocks.add('line', { label: '分割线', category: '图案', media: '—', content: '<hr style="border:0;border-top:2px solid #cbd2df;margin:24px 0">' })
  blocks.add('formula-inline', { label: '行内公式', category: '公式', media: '∑', content: formulaBlock('E = mc^2', false), activate: true })
  blocks.add('formula-block', { label: '块级公式', category: '公式', media: 'ƒ', content: `<div style="text-align:center;padding:16px">${formulaBlock('\\int_{a}^{b} f(x)\\,dx = F(b)-F(a)', true)}</div>`, activate: true })
  blocks.add('two-columns', { label: '两栏', category: '布局', media: '▥', content: '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px"><div><h3>左侧标题</h3><p>双击编辑内容</p></div><div><h3>右侧标题</h3><p>双击编辑内容</p></div></div>' })
  blocks.add('section', { label: '卡片', category: '布局', media: '▢', content: '<section style="padding:24px;border:1px solid #e2e5eb;border-radius:12px;background:#fff"><h3>卡片标题</h3><p>在这里编辑卡片内容。</p></section>' })
}

function addTypes(editor) {
  editor.DomComponents.addType('local-video', {
    isComponent: element => element.tagName === 'VIDEO',
    model: { defaults: { tagName: 'video', traits: [
      { name: 'src', label: '视频地址' }, { name: 'poster', label: '封面图片' },
      { type: 'checkbox', name: 'controls', label: '显示控制条', valueTrue: '', valueFalse: undefined },
      { type: 'checkbox', name: 'loop', label: '循环播放', valueTrue: '', valueFalse: undefined },
      { type: 'checkbox', name: 'muted', label: '静音', valueTrue: '', valueFalse: undefined },
    ] } },
  })
  editor.DomComponents.addType('formula', {
    isComponent: element => element.hasAttribute?.('data-latex'),
    model: { defaults: { traits: [
      { type: 'text', name: 'data-latex', label: 'LaTeX 公式', changeProp: true },
      { type: 'checkbox', name: 'data-display', label: '块级显示', changeProp: true },
    ] } },
  })
}

function serializeDocument() {
  const output = new DOMParser().parseFromString(originalHtml, 'text/html')
  const bodyHtml = restoreResources(editor.getHtml())
  output.body.innerHTML = bodyHtml
  const wrapperAttributes = editor.getWrapper().getAttributes()
  Object.entries(wrapperAttributes).forEach(([name, value]) => {
    if (name !== 'id' || value !== 'wrapper') output.body.setAttribute(name, value)
  })
  output.head.querySelectorAll('style[data-dsh-artifacts], style[data-dsh-visual-editor]').forEach(element => element.remove())
  const css = restoreResources(editor.getCss({ avoidProtected: true }))
  if (css.trim()) {
    const style = output.createElement('style')
    style.setAttribute('data-dsh-artifacts', '')
    style.textContent = `\n${css}\n`
    output.head.appendChild(style)
  }
  const doctype = output.doctype ? `<!DOCTYPE ${output.doctype.name}${output.doctype.publicId ? ` PUBLIC "${output.doctype.publicId}"` : ''}${output.doctype.systemId ? ` "${output.doctype.systemId}"` : ''}>\n` : '<!DOCTYPE html>\n'
  return doctype + output.documentElement.outerHTML
}

async function api(path, options = {}) {
  const response = await fetch(`${PREFIX}/api/${path}`, { credentials: 'same-origin', ...options })
  const value = await response.json()
  if (!response.ok || !value.ok) throw new Error(value.error?.message || `请求失败 (${response.status})`)
  return value
}

async function save() {
  if (saving) return
  saving = true
  $('#save').disabled = true
  status('正在保存…', 0)
  try {
    const html = serializeDocument()
    const value = await api('save', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, revision, html }),
    })
    revision = value.revision
    currentRevision = revision
    originalHtml = html
    renderVersions(value.versions)
    setDirty(false)
    status('已保存到原 HTML 文件')
  } catch (cause) {
    status(cause.message, 8000)
    if (/其他程序修改/.test(cause.message)) window.alert(cause.message)
  } finally { saving = false; $('#save').disabled = false }
}

function editFormula(component) {
  const formula = formulaComponent(component)
  if (!formula) return
  $('#latex').value = latexOf(formula)
  $('#formula-error').textContent = ''
  $('#formula-dialog').showModal()
  $('#apply-formula').onclick = event => {
    event.preventDefault()
    try {
      const latex = $('#latex').value.trim()
      if (!latex) throw new Error('请输入 LaTeX 公式')
      const display = formula.getAttributes()['data-display'] !== 'false'
      formula.components(formulaHtml(latex, display))
      formula.addAttributes({ 'data-latex': latex, 'data-display': String(display) })
      editor.trigger('component:update')
      setDirty()
      $('#formula-dialog').close()
    } catch (cause) { $('#formula-error').textContent = cause.message }
  }
}

function cssPath(element) {
  if (!element) return ''
  const ownStableId = element.getAttribute('data-dsh-artifact-id')
  if (ownStableId) return `${element.tagName.toLowerCase()}[data-dsh-artifact-id="${ownStableId}"]`
  if (element.id) return `#${CSS.escape(element.id)}`
  const parts = []
  let current = element
  while (current && current.tagName !== 'BODY' && parts.length < 6) {
    const stable = current.getAttribute('data-dsh-artifact-id')
    let part = current.tagName.toLowerCase()
    if (stable) part += `[data-dsh-artifact-id="${stable}"]`
    else if (current.classList.length) part += `.${[...current.classList].slice(0, 2).map(CSS.escape).join('.')}`
    else {
      const siblings = [...current.parentElement?.children || []].filter(item => item.tagName === current.tagName)
      if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`
    }
    parts.unshift(part)
    if (stable) break
    current = current.parentElement
  }
  return parts.join(' > ')
}

function selectionChanged(component) {
  selected = component || null
  $('#selection-bar').hidden = !selected
  if (!selected) {
    window.parent.postMessage({ channel: 'dsh-artifacts:selection', token, selection: null }, location.origin)
    return
  }
  const tag = selected.get('tagName') || 'element'
  const formula = formulaComponent(selected)
  const element = selected.getEl?.()
  let id = element?.getAttribute('data-dsh-artifact-id')
  if (!id) {
    id = `el-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
    selected.addAttributes({ 'data-dsh-artifact-id': id })
  }
  lastSelectedId = id
  $('#selection-name').textContent = formula ? '公式' : tag.toUpperCase()
  $('#edit-formula').hidden = !formula
  $('#upload-media').hidden = !['img', 'video'].includes(tag)
  const computed = element ? getComputedStyle(element) : null
  const slide = element?.closest('.slide, [data-slide], .slides > section, body > section')
  window.parent.postMessage({ channel: 'dsh-artifacts:selection', token, selection: {
    id, selector: cssPath(element), tag, text: (element?.innerText || element?.getAttribute('alt') || '').trim().slice(0, 2000),
    html: (element?.outerHTML || selected.toHTML()).slice(0, 8000), slide: slide ? [...slide.parentElement.children].indexOf(slide) + 1 : null,
    styles: computed ? Object.fromEntries(['display', 'position', 'left', 'top', 'width', 'height', 'color', 'backgroundColor', 'fontSize', 'fontWeight', 'textAlign', 'zIndex'].map(key => [key, computed[key]])) : {},
  } }, location.origin)
}

function slideComponents() {
  if (!editor) return []
  const found = editor.getWrapper().find('.slide, [data-slide], .slides > section')
  if (found.length) return found
  const body = editor.getWrapper()
  return (body.components?.().models || []).filter(component => component.get('tagName') === 'section')
}

function activateSlide(index) {
  const slides = slideComponents()
  if (!slides.length) return
  activeSlide = Math.max(0, Math.min(index, slides.length - 1))
  const canvasBody = editor.Canvas.getDocument().body
  canvasBody.querySelectorAll('.dsh-artifact-mode-hidden').forEach(element => element.classList.remove('dsh-artifact-mode-hidden'))
  ;[...canvasBody.children].forEach(element => element.classList.remove('dsh-artifact-slide-root'))
  slides.forEach((slide, position) => {
    const element = slide.getEl()
    if (element) element.classList.toggle('dsh-artifact-active-slide', presentation && position === activeSlide)
  })
  let root = slides[activeSlide].getEl()
  let branch = root
  while (presentation && branch?.parentElement && branch.parentElement !== canvasBody) {
    ;[...branch.parentElement.children].forEach(sibling => { if (sibling !== branch) sibling.classList.add('dsh-artifact-mode-hidden') })
    branch = branch.parentElement
  }
  while (root && root.parentElement !== canvasBody) root = root.parentElement
  if (root && presentation) root.classList.add('dsh-artifact-slide-root')
  $('#slide-list').innerHTML = ''
  slides.forEach((slide, position) => {
    const button = document.createElement('button')
    button.className = `slide-card${position === activeSlide ? ' active' : ''}`
    const text = slide.getEl()?.innerText?.trim().replace(/\s+/g, ' ').slice(0, 45) || '空白页'
    button.textContent = `${String(position + 1).padStart(2, '0')}  ${text}`
    button.onclick = () => activateSlide(position)
    $('#slide-list').appendChild(button)
  })
}

function fitCanvas() {
  if (!editor || !presentation) return
  const area = $('.canvas-area')
  const zoom = Math.min(90, (area.clientWidth - 32) / 13.76, (area.clientHeight - 32) / 8.16)
  editor.Canvas.setZoom(Math.max(20, Math.floor(zoom)))
  editor.Canvas.setCoords(0, 0)
  editor.Canvas.getFrame()?.set({ x: (area.clientWidth - 1376) / 2, y: (area.clientHeight - 816) / 2 })
}

function setPresentation(value) {
  presentation = value
  $('#mode-slides').classList.toggle('active', value)
  $('#mode-page').classList.toggle('active', !value)
  document.querySelectorAll('.device').forEach(button => { button.hidden = value })
  const canvasDocument = editor?.Canvas.getDocument()
  if (!canvasDocument) return
  canvasDocument.body.classList.toggle('dsh-artifact-presenting', value)
  let style = canvasDocument.querySelector('#dsh-artifact-canvas-mode')
  if (!style) { style = canvasDocument.createElement('style'); style.id = 'dsh-artifact-canvas-mode'; canvasDocument.head.appendChild(style) }
  style.textContent = value ? `
    body.dsh-artifact-presenting{margin:0;background:#dfe3ea;min-width:100%;min-height:100%;padding:48px!important;overflow:auto}
    body.dsh-artifact-presenting>:not(.dsh-artifact-slide-root){display:none!important}
    body.dsh-artifact-presenting .slide,body.dsh-artifact-presenting [data-slide],body.dsh-artifact-presenting .slides>section,body.dsh-artifact-presenting>section{display:none!important;position:relative;width:1280px;height:720px;margin:0 auto;background:white;overflow:hidden;box-shadow:0 8px 32px #27314833}
    body.dsh-artifact-presenting .dsh-artifact-mode-hidden{display:none!important}
    body.dsh-artifact-presenting .dsh-artifact-active-slide{display:block!important;position:absolute!important;left:48px;top:48px;margin:0!important}
    body.dsh-artifact-presenting .dsh-artifact-active-slide *{max-width:100%}
  ` : ''
  activateSlide(activeSlide)
  if (value) { editor.setDevice('artifact-slide'); requestAnimationFrame(fitCanvas) }
  else { editor.setDevice('desktop'); editor.Canvas.setZoom(100); editor.Canvas.setCoords(0, 0); editor.Canvas.getFrame()?.set({ x: 0, y: 0 }) }
}

function addSlide() {
  let slides = slideComponents()
  const content = `<section class="slide" data-slide style="position:relative;width:1280px;height:720px;background:#fff;overflow:hidden"><h1 data-dsh-artifact-id="slide-title-${Date.now().toString(36)}" style="position:absolute;left:72px;top:64px;margin:0;font-size:48px">双击编辑标题</h1><p style="position:absolute;left:74px;top:150px;font-size:24px;color:#64748b">从这里开始这一页</p></section>`
  if (!slides.length) {
    editor.getWrapper().append(content)
    slides = slideComponents()
    document.querySelector('[data-left="slides"]').click()
  } else {
    const parent = slides.at(-1).parent()
    parent.append(content)
  }
  setDirty()
  activateSlide(slideComponents().length - 1)
}

function nudgeSelected(key, amount) {
  if (!selected || selected === editor.getWrapper()) return false
  const element = selected.getEl()
  if (!element) return false
  const computed = getComputedStyle(element)
  if (computed.position === 'static') selected.addStyle({ position: 'absolute', left: `${element.offsetLeft}px`, top: `${element.offsetTop}px` })
  const property = key === 'ArrowLeft' || key === 'ArrowRight' ? 'left' : 'top'
  const direction = key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 1
  const current = parseFloat(selected.getStyle()[property] ?? computed[property]) || 0
  selected.addStyle({ [property]: `${current + direction * amount}px` })
  setDirty()
  return true
}

function layer(direction) {
  if (!selected) return
  const style = selected.getStyle()
  const z = Number.parseInt(style['z-index'] || getComputedStyle(selected.getEl()).zIndex, 10) || 0
  selected.addStyle({ 'z-index': String(Math.max(0, z + direction)) })
  setDirty()
}

function align(kind) {
  if (!selected) return
  const element = selected.getEl()
  if (!element) return
  selected.addStyle({ position: 'absolute', left: kind === 'left' ? '0px' : `${Math.max(0, (element.parentElement.clientWidth - element.offsetWidth) / 2)}px` })
  setDirty()
}

function renderVersions(versions = []) {
  $('#version-list').innerHTML = ''
  if (!versions.length) { $('#version-list').textContent = '保存后会出现历史版本'; return }
  versions.forEach(version => {
    const button = document.createElement('button')
    button.className = 'version-card'
    button.textContent = `${version.createdAt.replace('T', ' ').replace('Z', '')} · ${version.revision.slice(0, 7)}`
    button.title = '恢复此版本（会先备份当前磁盘版本）'
    button.onclick = async () => {
      if (!window.confirm('恢复这个历史版本？当前磁盘版本会先保留。')) return
      try {
        const old = await api(`history?token=${encodeURIComponent(token)}&id=${encodeURIComponent(version.id)}`)
        await api('save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, revision, html: old.html }) })
        location.reload()
      } catch (cause) { status(cause.message, 8000) }
    }
    $('#version-list').appendChild(button)
  })
}

async function preview() {
  status('正在生成预览…', 0)
  try {
    const value = await api('draft', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, html: serializeDocument() }) })
    $('#preview-frame').src = value.url
    $('#preview-modal').hidden = false
    status('')
  } catch (cause) { status(cause.message, 6000) }
}

async function initialize() {
  const value = await api(`document?token=${encodeURIComponent(token)}`)
  originalHtml = value.html
  revision = value.revision
  currentRevision = value.revision
  renderVersions(value.versions)
  $('#file-name').textContent = value.path.split(/[\\/]/).pop()
  $('#file-name').title = value.path

  const source = new DOMParser().parseFromString(originalHtml, 'text/html')
  const canvasStyles = []
  source.head.querySelectorAll('link[rel~="stylesheet"][href]').forEach(link => {
    const href = link.getAttribute('href')
    if (/^(?:[a-z]+:|\/\/|\/)/i.test(href)) canvasStyles.push(href)
    else canvasStyles.push(mediaUrl(href))
  })

  editor = grapesjs.init({
    container: '#gjs', fromElement: false, height: '100%', storageManager: false,
    noticeOnUnload: false, showOffsets: true, dragMode: 'absolute',
    blockManager: { appendTo: '#blocks' }, layerManager: { appendTo: '#layers' },
    traitManager: { appendTo: '#traits' }, styleManager: { appendTo: '#styles' },
    deviceManager: { devices: [
      { id: 'desktop', name: 'Desktop', width: '' },
      { id: 'artifact-slide', name: 'Slide', width: '1376px', height: '816px' },
      { id: 'tablet', name: 'Tablet', width: '768px', widthMedia: '900px' },
      { id: 'mobile', name: 'Mobile', width: '390px', widthMedia: '480px' },
    ] },
    parser: { optionsHtml: { allowScripts: true, allowUnsafeAttr: true } },
    canvas: { scripts: [], styles: canvasStyles },
  })
  addTypes(editor)
  addBlocks(editor)
  const sectorNames = { general: '布局', flex: '弹性布局', dimension: '尺寸与位置', typography: '文字', decorations: '外观', extra: '其他' }
  editor.I18n.addMessages({ en: { styleManager: { sectors: sectorNames } } })
  editor.StyleManager.getSectors().each(sector => sector.set('name', sectorNames[sector.getId()] || sector.get('name')))
  editor.StyleManager.render()
  window.__dshVisualEditor = editor

  const inlineCss = rewriteCssUrls([...source.head.querySelectorAll('style')].map(style => style.media ? `@media ${style.media} {\n${style.textContent}\n}` : style.textContent).join('\n'))
  rewriteResources(source.body)
  editor.setComponents(source.body.innerHTML)
  editor.setStyle(inlineCss)
  editor.UndoManager.start()
  editor.on('update', () => setDirty())
  editor.on('component:selected', selectionChanged)
  editor.on('component:deselected', () => selectionChanged(null))
  editor.on('component:dblclick', component => { if (formulaComponent(component)) editFormula(component) })
  editor.on('component:update', () => {
    if (selected && lastSelectedId === selected.getAttributes?.()['data-dsh-artifact-id']) selectionChanged(selected)
    if (presentation) slideComponents().forEach((slide, position) => slide.getEl()?.classList.toggle('dsh-artifact-active-slide', position === activeSlide))
  })
  const slides = slideComponents()
  if (slides.length > 1 || source.querySelector('.slides, .slide, [data-slide]')) setPresentation(true)
  else activateSlide(0)
  const resizeObserver = new ResizeObserver(() => { if (presentation) requestAnimationFrame(fitCanvas) })
  resizeObserver.observe($('.canvas-area'))
  window.addEventListener('pagehide', () => resizeObserver.disconnect(), { once: true })
  status('双击改文字，拖拽移动，手柄缩放；选中后可在侧栏底部指挥 Agent', 5000)
}

$('#save').addEventListener('click', save)
$('#undo').addEventListener('click', () => editor?.UndoManager.undo())
$('#redo').addEventListener('click', () => editor?.UndoManager.redo())
$('#preview').addEventListener('click', preview)
$('#close-preview').addEventListener('click', () => { $('#preview-modal').hidden = true; $('#preview-frame').src = 'about:blank' })
$('#edit-formula').addEventListener('click', () => editFormula(selected))
$('#delete-element').addEventListener('click', () => { selected?.remove(); selectionChanged(null) })
$('#duplicate-element').addEventListener('click', () => {
  if (!selected || selected === editor.getWrapper()) return
  const parent = selected.parent()
  const clone = selected.clone()
  const attributes = clone.getAttributes(); delete attributes.id; attributes['data-dsh-artifact-id'] = ''
  clone.addAttributes(attributes)
  clone.find('[data-dsh-artifact-id]').forEach(component => component.addAttributes({ 'data-dsh-artifact-id': '' }))
  parent.collection.add(clone, { at: selected.index() + 1 })
  editor.select(clone); setDirty()
})
$('#bring-front').addEventListener('click', () => layer(1))
$('#send-back').addEventListener('click', () => layer(-1))
$('#align-left').addEventListener('click', () => align('left'))
$('#align-center').addEventListener('click', () => align('center'))
$('#add-slide').addEventListener('click', addSlide)
$('#mode-page').addEventListener('click', () => setPresentation(false))
$('#mode-slides').addEventListener('click', () => { setPresentation(true); document.querySelector('[data-left="slides"]').click() })
$('#desktop').addEventListener('click', () => editor?.setDevice('desktop'))
$('#tablet').addEventListener('click', () => editor?.setDevice('tablet'))
$('#mobile').addEventListener('click', () => editor?.setDevice('mobile'))
;['desktop', 'tablet', 'mobile'].forEach(id => $(`#${id}`).addEventListener('click', () => {
  document.querySelectorAll('.device').forEach(button => button.classList.remove('active'))
  $(`#${id}`).classList.add('active')
}))
document.querySelectorAll('[data-left]').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('[data-left]').forEach(item => item.classList.toggle('active', item === button))
  $('#blocks').hidden = button.dataset.left !== 'blocks'
  $('#layers').hidden = button.dataset.left !== 'layers'
  $('#slides').hidden = button.dataset.left !== 'slides'
}))
document.querySelectorAll('[data-right]').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('[data-right]').forEach(item => item.classList.toggle('active', item === button))
  ;['styles', 'traits', 'history'].forEach(id => { $(`#${id}`).hidden = button.dataset.right !== id })
}))
$('#upload-media').addEventListener('click', () => {
  $('#media-file').accept = selected?.get('tagName') === 'video' ? 'video/*' : 'image/*'
  $('#media-file').click()
})
$('#media-file').addEventListener('change', async event => {
  const file = event.target.files[0]
  if (!file || !selected) return
  if (file.size > 8 * 1024 * 1024) return status('内嵌媒体不能超过 8 MiB；更大的文件请填写项目内相对路径', 6000)
  const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file) })
  selected.addAttributes({ src: data })
  if (selected.get('tagName') === 'img') selected.addAttributes({ alt: file.name })
  setDirty()
  event.target.value = ''
})
window.addEventListener('keydown', event => {
  if (event.key.startsWith('Arrow') && !['INPUT', 'TEXTAREA'].includes(event.target.tagName) && !event.target.isContentEditable) {
    if (nudgeSelected(event.key, event.shiftKey ? 10 : 1)) event.preventDefault()
    return
  }
  if (event.key === 'Delete' && selected && !['INPUT', 'TEXTAREA'].includes(event.target.tagName) && !event.target.isContentEditable) { selected.remove(); selectionChanged(null); return }
  if (!(event.ctrlKey || event.metaKey)) return
  if (event.key.toLowerCase() === 's') { event.preventDefault(); save() }
  if (event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? editor?.UndoManager.redo() : editor?.UndoManager.undo() }
  if (event.key.toLowerCase() === 'd' && selected) { event.preventDefault(); $('#duplicate-element').click() }
})

setInterval(async () => {
  if (!revision || document.hidden || !$('#preview-modal').hidden || saving) return
  try {
    const value = await api(`status?token=${encodeURIComponent(token)}`)
    if (value.revision === currentRevision) return
    currentRevision = value.revision
    if (!dirty) { status('Agent 已更新文件，正在刷新…', 0); location.reload() }
    else status('磁盘文件已更新。你的未保存修改仍保留，请先另存或处理后手动刷新', 0)
  } catch { /* Offline polling must not interrupt editing. */ }
}, 4000)
window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = '' } })

initialize().catch(cause => { console.error(cause); status(`无法打开编辑器：${cause.message}`, 0) })
