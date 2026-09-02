// The published prismarine-chunk entry imports Bedrock implementations too.
// Those imports pull prismarine-nbt/protodef into the browser worker, where
// protodef uses dynamic code generation and is rejected by the dashboard CSP. POV only needs
// the Java 1.21 chunk format, so keep the worker's dependency graph PC-only.
const createPcChunk = require('prismarine-chunk/src/pc/1.18/chunk.js')
const minecraftData = require('./pov-minecraft-data.cjs')

module.exports = version => createPcChunk(minecraftData(version))
