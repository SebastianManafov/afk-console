const fs = require('node:fs')
const path = require('node:path')
const webpack = require('webpack')

const destination = path.resolve(__dirname, '../public/pov-viewer/worker.js')
const compiler = webpack({
  mode: 'production',
  target: 'webworker',
  entry: path.resolve(__dirname, '../viewer-client/pov-worker.cjs'),
  output: {
    path: path.dirname(destination),
    filename: path.basename(destination),
    iife: true
  },
  devtool: false,
  // The Minecraft data bundle is too large for terser in the default Node
  // heap. It is still a self-contained worker and CSP-safe without minifying.
  optimization: { minimize: false },
  resolve: {
    alias: {
      'prismarine-chunk$': path.resolve(__dirname, '../viewer-client/pov-chunk.cjs'),
      'prismarine-nbt$': path.resolve(__dirname, '../viewer-client/pov-nbt.cjs'),
      'prismarine-registry$': path.resolve(__dirname, '../viewer-client/pov-registry.cjs'),
      'minecraft-data$': path.resolve(__dirname, '../viewer-client/pov-minecraft-data.cjs')
    },
    fallback: { fs: false, path: false, zlib: false }
  },
  plugins: [
    new webpack.ProvidePlugin({ process: 'process/browser', Buffer: ['buffer', 'Buffer'] })
  ]
})

const run = async () => {
  const stats = await new Promise((resolve, reject) => {
    compiler.run((error, result) => error ? reject(error) : resolve(result))
  })
  if (stats.hasErrors()) throw new Error(stats.toString({ all: false, errors: true }))
  await new Promise((resolve, reject) => compiler.close(error => error ? reject(error) : resolve()))

  let worker = fs.readFileSync(destination, 'utf8')
  const before = 'if (neighbor.position.y < 0) continue'
  const after = 'if (false) continue'
  const matches = worker.split(before).length - 1
  if (matches !== 2) throw new Error(`POV worker patch expected 2 match(es) but found ${matches}: ${before}`)
  worker = worker.split(before).join(after)
  fs.writeFileSync(destination, worker)
  console.log(`[pov] Built CSP-safe 1.21.4 worker with negative-height support: ${path.relative(process.cwd(), destination)}`)
}

run().catch(error => {
  console.error(error)
  process.exitCode = 1
})
