const fs = require('node:fs')
const path = require('node:path')

const source = require.resolve('prismarine-viewer/public/worker.js')
const destination = path.resolve(__dirname, '../public/pov-viewer/worker.js')
let worker = fs.readFileSync(source, 'utf8')

// Keep the worker identical to Prismarine Viewer except for the browser-safe
// Node fallback and the modern negative-height section indexes below.
const replacements = [
  [
    'if(!__webpack_require__.g.self){const r=eval("require"),',
    'if(typeof self==="undefined"&&typeof require==="function"){const r=require,',
    1
  ],
  [
    'i&&i.sections[Math.floor(a/16)]?dirtySections[s]=t',
    'i&&i.sections[(a-(Number.isFinite(i.minY)?i.minY:0)>>4)]?dirtySections[s]=t',
    1
  ],
  [
    'l&&l.sections[Math.floor(n/16)]',
    'l&&l.sections[(n-(Number.isFinite(l.minY)?l.minY:0)>>4)]',
    1
  ],
  [
    'position.y<0)continue',
    'position.y<-(1/0))continue',
    2
  ]
]

for (const [before, after, expectedMatches] of replacements) {
  const matches = worker.split(before).length - 1
  if (matches !== expectedMatches) {
    throw new Error(`POV worker patch expected ${expectedMatches} match(es) but found ${matches}: ${before}`)
  }
  worker = worker.split(before).join(after)
}

fs.mkdirSync(path.dirname(destination), { recursive: true })
fs.writeFileSync(destination, worker)
console.log(`[pov] Patched modern-version and negative-height worker: ${path.relative(process.cwd(), destination)}`)
