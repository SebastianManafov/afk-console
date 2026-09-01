const fs = require('node:fs')
const path = require('node:path')

const source = require.resolve('prismarine-viewer/public/worker.js')
const destination = path.resolve(__dirname, '../public/pov-viewer/worker.js')
let worker = fs.readFileSync(source, 'utf8')

// The upstream worker contains its own minecraft-data snapshot. RCC receives
// modern chunks in the same serialized column format, so use the latest worker
// schema it knows while retaining RCC's matching block-state models/textures.
const replacements = [
  [
    'world=new World(e.version)',
    'world=new World(e.version==="26.1.2"?"1.21.4":e.version)',
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
