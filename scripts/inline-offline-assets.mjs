import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const outputDirectory = resolve(process.argv[2] ?? 'offline-dist')
const htmlPath = resolve(outputDirectory, 'index.html')
let html

try {
  html = await readFile(htmlPath, 'utf8')
} catch {
  throw new Error('OFFLINE_INDEX_NOT_FOUND')
}

const scriptUrls = []
const styleUrls = []
html = html
  .replace(/<script\b[^>]*\bsrc="([^"?]+)(?:\?[^\"]*)?"[^>]*><\/script>/g, (_, url) => {
    scriptUrls.push(url)
    return ''
  })
  .replace(/<link\b[^>]*\bhref="([^"?]+)(?:\?[^\"]*)?"[^>]*>/g, (_, url) => {
    styleUrls.push(url)
    return ''
  })

const readAsset = (url) => readFile(resolve(outputDirectory, url.replace(/^\.\//, '')), 'utf8')
const styles = await Promise.all(styleUrls.map(readAsset))
const scripts = await Promise.all(scriptUrls.map(readAsset))
const inlineStyles = styles.map((source) => `<style>${source}</style>`).join('')
const inlineScripts = scripts.map((source) => `<script type="module">${source.replace(/<\/script/gi, '<\\/script')}</script>`).join('')

// Use callback replacements. React's bundle contains `$&` and `$\`` tokens;
// passing it as a replacement string would expand those tokens with parts of
// index.html and corrupt the generated script.
html = html
  .replace('</head>', () => `${inlineStyles}</head>`)
  .replace('</body>', () => `${inlineScripts}</body>`)
await writeFile(htmlPath, html)
