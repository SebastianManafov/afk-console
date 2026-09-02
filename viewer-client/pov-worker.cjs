/* global postMessage, self */

const { Vec3 } = require('vec3')
const { World } = require('prismarine-viewer/viewer/lib/world')
const { getSectionGeometry } = require('prismarine-viewer/viewer/lib/models')
const { createGeometryWorld } = require('./pov-geometry.cjs')

let blocksStates = null
let world = null
let geometryWorld = null

function sectionKey (x, y, z) {
  return `${x},${y},${z}`
}

function sectionIndex (chunk, y) {
  const minY = Number.isFinite(chunk?.minY) ? chunk.minY : 0
  return (y - minY) >> 4
}

const dirtySections = {}

function setSectionDirty (pos, value = true) {
  const x = Math.floor(pos.x / 16) * 16
  const y = Math.floor(pos.y / 16) * 16
  const z = Math.floor(pos.z / 16) * 16
  const chunk = world.getColumn(x, z)
  const key = sectionKey(x, y, z)
  if (!value) {
    delete dirtySections[key]
    postMessage({ type: 'sectionFinished', key })
  } else if (chunk && chunk.sections[sectionIndex(chunk, y)]) {
    dirtySections[key] = value
  } else {
    postMessage({ type: 'sectionFinished', key })
  }
}

self.onmessage = ({ data }) => {
  if (data.type === 'version') {
    world = new World(data.version)
    geometryWorld = createGeometryWorld(world)
  } else if (data.type === 'blockStates') {
    blocksStates = data.json
  } else if (data.type === 'dirty') {
    const loc = new Vec3(data.x, data.y, data.z)
    setSectionDirty(loc, data.value)
  } else if (data.type === 'chunk') {
    world.addColumn(data.x, data.z, data.chunk)
  } else if (data.type === 'unloadChunk') {
    world.removeColumn(data.x, data.z)
  } else if (data.type === 'blockUpdate') {
    const loc = new Vec3(data.pos.x, data.pos.y, data.pos.z).floored()
    world.setBlockStateId(loc, data.stateId)
  } else if (data.type === 'reset') {
    world = null
    geometryWorld = null
    blocksStates = null
  }
}

setInterval(() => {
  if (world === null || blocksStates === null) return
  const sections = Object.keys(dirtySections)

  if (sections.length === 0) return

  for (const key of sections) {
    let [x, y, z] = key.split(',')
    x = parseInt(x, 10)
    y = parseInt(y, 10)
    z = parseInt(z, 10)
    const chunk = world.getColumn(x, z)
    if (chunk && chunk.sections[sectionIndex(chunk, y)]) {
      delete dirtySections[key]
      const geometry = getSectionGeometry(x, y, z, geometryWorld, blocksStates)
      const transferable = [geometry.positions.buffer, geometry.normals.buffer, geometry.colors.buffer, geometry.uvs.buffer]
      postMessage({ type: 'geometry', key, geometry }, transferable)
    }
    postMessage({ type: 'sectionFinished', key })
  }
}, 50)
