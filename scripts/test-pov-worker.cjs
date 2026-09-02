const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { Worker } = require('node:worker_threads')
const Chunk = require('prismarine-chunk')('1.21.4')
const mcData = require('minecraft-data')('1.21.4')
const { Vec3 } = require('vec3')

const builtWorker = path.resolve(__dirname, '../public/pov-viewer/worker.js')
const runnableWorker = path.join(os.tmpdir(), `rcc-pov-worker-${process.pid}.cjs`)
const workerSource = fs.readFileSync(builtWorker, 'utf8')
if (/\beval\s*\(/.test(workerSource)) {
  throw new Error('POV browser worker still contains CSP-blocked eval() code')
}
fs.writeFileSync(runnableWorker, [
  "const { parentPort } = require('node:worker_threads')",
  'globalThis.self = { onmessage: null }',
  'globalThis.postMessage = (value, transferList) => parentPort.postMessage(value, transferList)',
  'parentPort.on("message", data => globalThis.self.onmessage?.({ data }));',
  workerSource
].join('\n'))

const worker = new Worker(runnableWorker)
const timeout = setTimeout(() => finish(new Error('POV worker timed out before producing geometry')), 10_000)
const blockStates = path.resolve(__dirname, '../public/pov-viewer/blocksStates/1.21.4.json')
const chunk = new Chunk()
const stoneState = mcData.blocksByName.stone.defaultState
for (const y of [-64, 64, 288]) {
  for (let x = 0; x < 16; x++) {
    for (let z = 0; z < 16; z++) chunk.setBlockStateId(new Vec3(x, y, z), stoneState)
  }
}
const serializedChunk = chunk.toJson()
const roundTrippedChunk = Chunk.fromJson(serializedChunk)
for (const y of [-64, 64, 288]) {
  if (roundTrippedChunk.getBlockStateId(new Vec3(0, y, 0)) !== stoneState) {
    throw new Error(`1.21.4 chunk serialization changed the stone state at Y=${y}`)
  }
}
const expectedKeys = new Set(['0,-64,0', '0,64,0', '0,288,0'])

function finish (error) {
  clearTimeout(timeout)
  worker.terminate()
  fs.rmSync(runnableWorker, { force: true })
  if (error) {
    console.error(error)
    process.exitCode = 1
  }
}

worker.on('error', finish)
worker.on('message', message => {
  if (message.type !== 'geometry') return
  if (message.geometry.positions.length === 0) {
    finish(new Error('POV worker returned empty geometry outside Y 0..255'))
    return
  }
  expectedKeys.delete(message.key)
  if (expectedKeys.size === 0) {
    console.log(`[pov] Geometry test passed for 1.21.4 at Y=-64, Y=64 and Y=288`)
    finish()
  }
})

worker.postMessage({ type: 'version', version: '1.21.4' })
worker.postMessage({ type: 'blockStates', json: JSON.parse(fs.readFileSync(blockStates, 'utf8')) })
worker.postMessage({ type: 'chunk', x: 0, z: 0, chunk: serializedChunk })
for (const y of [-64, 64, 288]) worker.postMessage({ type: 'dirty', x: 0, y, z: 0, value: true })
