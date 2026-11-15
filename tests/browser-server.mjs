import { mkdir, writeFile } from 'node:fs/promises'
import { startFixtureHost } from './host.mjs'

const cwd = new URL('./workspace/', import.meta.url).pathname
await mkdir(`${cwd}/images`, { recursive: true })
await writeFile(`${cwd}/index.html`, `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>可视化测试</title>
<style id="theme-tokens" media="all" nonce="test-nonce">h1{color:rgb(30,70,160)}.hero{padding:24px}</style>
<script>window.__originalScript = true</script></head>
<body class="demo"><main class="hero"><h1>原始标题</h1><p>原始文本</p>
<img src="images/pixel.svg" alt="原始图片"><video controls src="movie.mp4"></video>
<svg viewBox="0 0 10 10"><rect width="10" height="10" fill="red"/></svg>
<span class="dsh-formula" data-latex="a^2+b^2=c^2" data-display="false"><span class="katex"><math><semantics><annotation encoding="application/x-tex">a^2+b^2=c^2</annotation></semantics></math></span></span>
</main><script>document.body.dataset.scriptRan = 'yes'</script></body></html>`)
await writeFile(`${cwd}/images/pixel.svg`, '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="blue"/></svg>')
const host = await startFixtureHost(cwd, 43189)
console.log(`Fixture host: ${host.origin}`)
process.on('SIGTERM', async () => { await host.close(); process.exit(0) })
