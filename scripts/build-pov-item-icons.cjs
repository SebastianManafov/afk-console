const fs = require('node:fs')
const path = require('node:path')
const minecraftAssets = require('minecraft-assets')
const { itemAssetName } = require('../viewer-client/item-icons.cjs')
const { referenceItemAssets, referenceHudAssets } = require('../viewer-client/pov-reference-assets.cjs')

const renderVersions = ['1.21.4']
const destinationRoot = path.resolve(__dirname, '../public/pov-viewer/item-icons')
const hudDestinationRoot = path.resolve(__dirname, '../public/pov-viewer/ui-assets')
const windowDestinationRoot = path.resolve(hudDestinationRoot, 'container')
const prefix = 'data:image/png;base64,'
const windowTextures = ['generic_54', 'hopper', 'dispenser', 'furnace', 'blast_furnace', 'smoker']
const windowSprites = ['slot_highlight_back', 'slot_highlight_front']

function writeReferenceHudAssets () {
  fs.mkdirSync(hudDestinationRoot, { recursive: true })
  for (const [name, image] of Object.entries(referenceHudAssets)) {
    fs.writeFileSync(path.join(hudDestinationRoot, `${name}.webp`), Buffer.from(image, 'base64'))
  }
}

function writeVersionIcons (version) {
  const assets = minecraftAssets(version)
  if (!assets) throw new Error(`No Minecraft assets available for render profile ${version}`)
  const destination = path.join(destinationRoot, version)
  fs.mkdirSync(destination, { recursive: true })
  const generated = new Set()

  for (const item of assets.itemsArray || []) {
    const name = itemAssetName(item?.name)
    if (!name || generated.has(name)) continue
    try {
      const image = assets.getImageContent(item.name)
      if (!image?.startsWith(prefix)) continue
      fs.writeFileSync(path.join(destination, `${name}.png`), Buffer.from(image.slice(prefix.length), 'base64'))
      generated.add(name)
    } catch {
      // Some technical entries have no standalone texture; the browser shows
      // its readable fallback for those items.
    }
  }

  // Keep the item sprites visible in the supplied reference capture pixel
  // identical where available; all other items use the matching render profile.
  for (const [name, image] of Object.entries(referenceItemAssets)) {
    const assetName = itemAssetName(name)
    fs.writeFileSync(path.join(destination, `${assetName}.png`), Buffer.from(image, 'base64'))
    generated.add(assetName)
  }

  if (generated.size === 0) throw new Error(`No item icons generated for render profile ${version}`)
  fs.writeFileSync(path.join(destination, 'manifest.json'), `${JSON.stringify({ version, items: [...generated].sort() }, null, 2)}\n`)
  console.log(`[pov] Generated ${generated.size} item icons for ${version}: ${path.relative(process.cwd(), destination)}`)
}

function writeVersionWindowAssets (version) {
  const assets = minecraftAssets(version)
  if (!assets?.directory) throw new Error(`No Minecraft GUI assets available for render profile ${version}`)
  const destination = path.join(windowDestinationRoot, version)
  fs.mkdirSync(destination, { recursive: true })
  const generated = []
  for (const name of windowTextures) {
    const source = path.join(assets.directory, 'gui', 'container', `${name}.png`)
    if (!fs.statSync(source).isFile()) throw new Error(`Minecraft GUI texture is missing: ${name}`)
    fs.copyFileSync(source, path.join(destination, `${name}.png`))
    generated.push(name)
  }
  for (const name of windowSprites) {
    const source = path.join(assets.directory, 'gui', 'sprites', 'container', `${name}.png`)
    if (!fs.statSync(source).isFile()) throw new Error(`Minecraft GUI sprite is missing: ${name}`)
    fs.copyFileSync(source, path.join(destination, `${name}.png`))
    generated.push(name)
  }
  fs.writeFileSync(path.join(destination, 'manifest.json'), `${JSON.stringify({ version, textures: windowTextures, sprites: windowSprites }, null, 2)}\n`)
  console.log(`[pov] Generated ${generated.length} Minecraft GUI assets for ${version}: ${path.relative(process.cwd(), destination)}`)
}

writeReferenceHudAssets()
for (const version of renderVersions) {
  writeVersionIcons(version)
  writeVersionWindowAssets(version)
}
