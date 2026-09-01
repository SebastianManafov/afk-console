const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { Worker } = require('node:worker_threads')
const Chunk = require('prismarine-chunk')('1.21.4')
const mcData = require('minecraft-data')('1.21.4')
const { Vec3 } = require('vec3')

const builtWorker = path.resolve(__dirname, '../public/pov-viewer/worker.js')
const runnableWorker = path.join(os.tmpdir(), `rcc-pov-worker-${process.pid}.cjs`)
const blockStates = path.resolve(__dirname, '../public/pov-viewer/blocksStates/26.1.2.json')
fs.copyFileSync(builtWorker, runnableWorker)

const chunk = new Chunk()
const stoneState = mcData.blocksByName.stone.defaultState
for (let x = 0; x < 16; x++) {
  for (let z = 0; z < 16; z++) chunk.setBlockStateId(new Vec3(x, -32, z), stoneState)
}

const worker = new Worker(runnableWorker)
const timeout = setTimeout(() => finish(new Error('POV worker timed out before producing geometry')), 10_000)

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
    finish(new Error('POV worker returned empty geometry for blocks below Y=0'))
    return
  }
  console.log(`[pov] Geometry test passed (${message.geometry.positions.length} positions below Y=0)`)
  finish()
})

worker.postMessage({ type: 'version', version: '26.1.2' })
worker.postMessage({ type: 'blockStates', json: JSON.parse(fs.readFileSync(blockStates, 'utf8')) })
worker.postMessage({ type: 'chunk', x: 0, z: 0, chunk: chunk.toJson() })
worker.postMessage({ type: 'dirty', x: 0, y: -32, z: 0, value: true })
