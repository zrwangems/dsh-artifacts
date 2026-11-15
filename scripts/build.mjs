import { build } from 'esbuild'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'

await rm('dist', { recursive: true, force: true })
await mkdir('dist', { recursive: true })
await build({
  entryPoints: ['src/editor/index.js'],
  bundle: true,
  minify: true,
  sourcemap: true,
  outfile: 'dist/editor.js',
  loader: { '.css': 'css', '.woff': 'file', '.woff2': 'file', '.ttf': 'file' },
  assetNames: 'fonts/[name]-[hash]',
  target: ['chrome110', 'firefox115', 'safari16'],
})
const template = await readFile('src/editor/editor.html', 'utf8')
await writeFile('dist/editor.html', template)
const client = await readFile('src/client.js', 'utf8')
const bundle = `window.__ModuleLoader__.load({\n  id: '@zrwangems/dsh-artifacts',\n  factory: (require) => {\n    const module = { exports: {} };\n    module.exports = (${client});\n    return module.exports;\n  },\n});\n`
await mkdir('lib', { recursive: true })
await writeFile('lib/client.js', bundle)
console.log('Built dist/editor.js, dist/editor.css, dist/editor.html and lib/client.js')
