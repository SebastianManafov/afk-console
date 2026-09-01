const fs = require('node:fs')
const path = require('node:path')

const source = require.resolve('prismarine-viewer/public/worker.js')
const destination = path.resolve(__dirname, '../public/pov-viewer/worker.js')
let worker = fs.readFileSync(source, 'utf8')

const replacements = [
  [
    'i&&i.sections[Math.floor(a/16)]?dirtySections[s]=t',
    'i&&i.sections[(a-(Number.isFinite(i.minY)?i.minY:0)>>4)]?dirtySections[s]=t'
  ],
  [
    'l&&l.sections[Math.floor(n/16)]',
    'l&&l.sections[(n-(Number.isFinite(l.minY)?l.minY:0)>>4)]'
  ]
]

for (const [before, after] of replacements) {
  const matches = worker.split(before).length - 1
  if (matches !== 1) {
    throw new Error(`POV worker patch expected one match but found ${matches}: ${before}`)
  }
  worker = worker.replace(before, after)
}

fs.mkdirSync(path.dirname(destination), { recursive: true })
fs.writeFileSync(destination, worker)
console.log(`[pov] Patched negative-height worker: ${path.relative(process.cwd(), destination)}`)
