function itemAssetName (name) {
  return String(name || '')
    .replace(/^minecraft:/i, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '_')
}

function itemIconUrl (version, name) {
  const assetName = itemAssetName(name)
  if (!assetName || !version) return null
  return `item-icons/${encodeURIComponent(String(version))}/${encodeURIComponent(assetName)}.png`
}

module.exports = { itemAssetName, itemIconUrl }
