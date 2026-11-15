import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'

async function openEditor(page, path = 'index.html') {
  const response = await page.request.post('/dsh-artifacts/api/open', { data: { sessionId: 'session-1', path } })
  expect(response.ok()).toBeTruthy()
  const opened = await response.json()
  await page.goto(opened.url)
  await page.waitForFunction(() => !!window.__dshVisualEditor)
  await expect(page.locator('#status')).toHaveText('', { timeout: 15000 })
  return opened
}

test('loads local editor without browser errors and preserves the original document', async ({ page }) => {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await openEditor(page)
  const counts = await page.evaluate(() => {
    const editor = window.__dshVisualEditor
    return {
      heading: editor.getWrapper().find('h1').length,
      images: editor.getWrapper().find('img').length,
      videos: editor.getWrapper().find('video').length,
      formulas: editor.getWrapper().find('[data-latex]').length,
      svg: editor.getWrapper().find('svg').length,
      videoType: editor.getWrapper().find('video')[0].get('type'),
    }
  })
  expect(counts).toEqual({ heading: 1, images: 1, videos: 1, formulas: 1, svg: 1, videoType: 'local-video' })
  expect(errors).toEqual([])
  await expect(page.locator('#blocks')).toContainText('视频')
  await expect(page.locator('#blocks')).toContainText('公式')
  await expect(page.locator('#blocks')).toContainText('图案')
})

test('edits rendered content, inserts all required block types and saves', async ({ page }) => {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await openEditor(page)
  await page.evaluate(() => {
    const editor = window.__dshVisualEditor
    editor.getWrapper().find('h1')[0].components('可视化修改后的标题')
    for (const id of ['text', 'image', 'video', 'rectangle', 'circle', 'star', 'formula-inline']) {
      editor.addComponents(editor.BlockManager.get(id).get('content'))
    }
  })
  await page.evaluate(() => {
    const editor = window.__dshVisualEditor
    const formula = editor.getWrapper().find('[data-latex]').at(-1)
    editor.select(formula)
  })
  await page.locator('#edit-formula').click()
  await page.locator('#latex').fill('x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}')
  await page.locator('#apply-formula').click()
  await page.locator('#save').click()
  await expect(page.locator('#dirty')).toBeHidden()
  const html = await readFile(new URL('./workspace/index.html', import.meta.url), 'utf8')
  expect(html).toContain('可视化修改后的标题')
  expect(html).toContain('<video')
  expect(html).toContain('<img')
  expect(html).toContain('<svg')
  expect(html).toContain('data-latex="x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}"')
  expect(html).toContain('<math')
  expect(html).toContain('window.__originalScript = true')
  expect(html).toContain("document.body.dataset.scriptRan = 'yes'")
  expect(html).toContain('<style id="theme-tokens" media="all" nonce="test-nonce">')
  expect(errors).toEqual([])
})

test('publishes precise selected-element context for the Agent', async ({ page }) => {
  await openEditor(page)
  await page.evaluate(() => {
    window.__selectionMessage = null
    window.addEventListener('message', event => {
      if (event.data?.channel === 'dsh-artifacts:selection') window.__selectionMessage = event.data
    })
    window.__dshVisualEditor.select(window.__dshVisualEditor.getWrapper().find('h1')[0])
  })
  await expect(page.locator('#selection-name')).toHaveText('H1')
  const message = await page.evaluate(() => window.__selectionMessage)
  expect(message.selection.tag).toBe('h1')
  expect(message.selection.text.length).toBeGreaterThan(0)
  expect(message.selection.selector).toContain('data-dsh-artifact-id')
  expect(message.selection.html).toContain(message.selection.text)
  expect(message.selection.styles).toHaveProperty('fontSize')
})

test('switches to slide canvas, adds slides and applies PPT layout commands', async ({ page }) => {
  await openEditor(page)
  await page.locator('#mode-slides').click()
  await page.locator('#add-slide').click()
  await page.locator('#add-slide').click()
  await expect(page.locator('.slide-card')).toHaveCount(2)
  const bounds = await page.evaluate(() => ({
    canvas: document.querySelector('.canvas-area').getBoundingClientRect().toJSON(),
    frame: document.querySelector('.gjs-frame').getBoundingClientRect().toJSON(),
  }))
  expect(bounds.frame.left).toBeGreaterThanOrEqual(bounds.canvas.left)
  expect(bounds.frame.right).toBeLessThanOrEqual(bounds.canvas.right)
  expect(bounds.frame.top).toBeGreaterThanOrEqual(bounds.canvas.top)
  expect(bounds.frame.bottom).toBeLessThanOrEqual(bounds.canvas.bottom)
  const fittedZoom = await page.evaluate(() => window.__dshVisualEditor.Canvas.getZoom())
  await page.locator('#zoom-in').click()
  expect(await page.evaluate(() => window.__dshVisualEditor.Canvas.getZoom())).toBe(Math.min(200, fittedZoom + 10))
  await page.locator('#fit-canvas').click()
  expect(await page.evaluate(() => window.__dshVisualEditor.Canvas.getZoom())).toBe(fittedZoom)
  await page.setViewportSize({ width: 1000, height: 800 })
  await page.waitForTimeout(250)
  const resized = await page.evaluate(() => ({
    canvas: document.querySelector('.canvas-area').getBoundingClientRect().toJSON(),
    frame: document.querySelector('.gjs-frame').getBoundingClientRect().toJSON(),
  }))
  expect(resized.frame.right).toBeLessThanOrEqual(resized.canvas.right)
  expect(resized.frame.bottom).toBeLessThanOrEqual(resized.canvas.bottom)
  await page.setViewportSize({ width: 650, height: 800 })
  await expect(page.locator('.right-panel')).toBeHidden()
  await page.setViewportSize({ width: 1440, height: 950 })
  await page.evaluate(() => {
    const editor = window.__dshVisualEditor
    editor.select(editor.getWrapper().find('h1')[0])
  })
  await page.locator('#align-center').click()
  await page.locator('#bring-front').click()
  const style = await page.evaluate(() => window.__dshVisualEditor.getWrapper().find('h1')[0].getStyle())
  expect(style.position).toBe('absolute')
  expect(style['z-index']).toBe('1')
  await page.locator('#save').click()
  await expect(page.locator('#dirty')).toBeHidden()
  const html = await readFile(new URL('./workspace/index.html', import.meta.url), 'utf8')
  expect((html.match(/data-slide/g) || []).length).toBe(2)
  await page.locator('#mode-page').click()
  const pageMode = await page.evaluate(() => ({ zoom: window.__dshVisualEditor.Canvas.getZoom(), x: window.__dshVisualEditor.Canvas.getFrame().get('x') }))
  expect(pageMode).toEqual({ zoom: 100, x: 0 })
})

test('opens imported ITRC PPTX as editable native slides and saves text and image changes', async ({ page }) => {
  test.skip(!existsSync(new URL('./workspace/ITRC-native.html', import.meta.url)), 'requires PPTX converter dependencies')
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await openEditor(page, 'ITRC-native.html')
  await page.locator('[data-left="slides"]').click()
  await expect(page.locator('.slide-card')).toHaveCount(6)
  const counts = await page.evaluate(() => ({
    texts: window.__dshVisualEditor.getWrapper().find('[data-ppt-role="text"]').length,
    pictures: window.__dshVisualEditor.getWrapper().find('[data-ppt-role="picture"]').length,
    slides: window.__dshVisualEditor.getWrapper().find('[data-slide]').length,
  }))
  expect(counts).toEqual({ texts: 31, pictures: 13, slides: 6 })
  await page.evaluate(() => {
    const editor = window.__dshVisualEditor
    const title = editor.getWrapper().find('[data-ppt-role="text"]').at(0)
    title.components('插件内编辑标题')
    editor.select(title)
  })
  await page.locator('#align-center').click()
  await page.evaluate(() => {
    const editor = window.__dshVisualEditor
    editor.select(editor.getWrapper().find('[data-ppt-role="picture"]').at(0))
  })
  await page.locator('#bring-front').click()
  await page.locator('#save').click()
  await expect(page.locator('#dirty')).toBeHidden()
  const html = await readFile(new URL('./workspace/ITRC-native.html', import.meta.url), 'utf8')
  expect(html).toContain('插件内编辑标题')
  expect((html.match(/data-slide/g) || []).length).toBeGreaterThanOrEqual(6)
  expect(errors).toEqual([])
})

test('previews unsaved changes and returns to the same editor state', async ({ page }) => {
  await openEditor(page)
  await page.evaluate(() => { window.__dshVisualEditor.getWrapper().find('h1')[0].components('未保存预览') })
  await page.locator('#preview').click()
  await expect(page.locator('#preview-modal')).toBeVisible()
  const preview = page.frameLocator('#preview-frame')
  await expect(preview.locator('h1').first()).toHaveText('未保存预览')
  await page.locator('#close-preview').click()
  const text = await page.evaluate(() => window.__dshVisualEditor.getWrapper().find('h1')[0].components().map(component => component.get('content')).join(''))
  expect(text).toBe('未保存预览')
})
