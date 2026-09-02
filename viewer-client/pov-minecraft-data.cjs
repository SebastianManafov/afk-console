const blocksArray = require('minecraft-data/minecraft-data/data/pc/1.21.4/blocks.json')
const blockCollisionShapes = require('minecraft-data/minecraft-data/data/pc/1.21.4/blockCollisionShapes.json')
const biomesArray = require('minecraft-data/minecraft-data/data/pc/1.21.4/biomes.json')
const tints = require('minecraft-data/minecraft-data/data/pc/1.21.4/tints.json')

function indexBy (items, field) {
  return items.reduce((index, item) => {
    index[item[field]] = item
    return index
  }, {})
}

const blocksById = indexBy(blocksArray, 'id')
const blocksByName = indexBy(blocksArray, 'name')
const blocksByStateId = {}
for (const block of blocksArray) {
  for (let stateId = block.minStateId; stateId <= block.maxStateId; stateId++) {
    blocksByStateId[stateId] = block
  }
}

const biomesById = indexBy(biomesArray, 'id')
const biomesByName = indexBy(biomesArray, 'name')

function compareVersion (left, right) {
  const parse = value => String(value).split('.').map(part => Number.parseInt(part, 10) || 0)
  const a = parse(left)
  const b = parse(right)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) - (b[i] || 0)
  }
  return 0
}

const version = {
  dataVersion: 4082,
  type: 'pc',
  majorVersion: '1.21',
  minecraftVersion: '1.21.4',
  version: 769,
  releaseType: 'release',
  '>=': other => compareVersion('1.21.4', other) >= 0,
  '>': other => compareVersion('1.21.4', other) > 0,
  '<=': other => compareVersion('1.21.4', other) <= 0,
  '<': other => compareVersion('1.21.4', other) < 0,
  '==': other => compareVersion('1.21.4', other) === 0
}

const data = {
  version,
  blocks: blocksById,
  blocksArray,
  blocksByName,
  blocksByStateId,
  blockCollisionShapes,
  biomes: biomesById,
  biomesArray,
  biomesByName,
  tints,
  // prismarine-block initializes legacy lookup tables even for modern Java.
  legacy: { pc: { blocks: {} } },
  supportFeature: feature => feature === 'blockStateId'
}

module.exports = () => data
module.exports.legacy = data.legacy
