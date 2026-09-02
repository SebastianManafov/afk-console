const fs = require('node:fs')
const path = require('node:path')

const version = '1.21.4'
const directory = path.resolve(__dirname, `../public/pov-viewer/item-icons/${version}`)
const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'))
const required = ['netherite_sword', 'diamond_pickaxe', 'golden_apple', 'golden_carrot', 'ender_pearl', 'obsidian', 'firework_rocket']

if (manifest.version !== version) throw new Error(`POV item icon manifest has unexpected version: ${manifest.version}`)
if (!Array.isArray(manifest.items) || manifest.items.length < 500) throw new Error(`POV item icon manifest is unexpectedly small: ${manifest.items?.length || 0}`)
for (const name of required) {
  if (!manifest.items.includes(name) || !fs.statSync(path.join(directory, `${name}.png`)).isFile()) {
    throw new Error(`POV item icon is missing: ${name}`)
  }
}
for (const name of ['hotbar', 'hotbarSelected', 'xpEmpty', 'xpFilled']) {
  if (!fs.statSync(path.resolve(__dirname, `../public/pov-viewer/ui-assets/${name}.webp`)).isFile()) {
    throw new Error(`POV HUD reference asset is missing: ${name}`)
  }
}
console.log(`[pov] Item icon test passed for ${manifest.items.length} ${version} items`)
