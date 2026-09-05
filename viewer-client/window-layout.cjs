const CHEST_TEXTURE_WIDTH = 176

function getWindowLayout (state) {
  const type = String(state?.type || '').toLowerCase()
  const inventoryStart = integer(state?.inventoryStart)
  const topSlots = inventoryStart === null ? 0 : inventoryStart
  const normalized = type.replace(/^minecraft:/, '')

  if (normalized === 'hopper' || topSlots === 5 && normalized.includes('hopper')) {
    return { kind: 'hopper', asset: 'hopper', width: CHEST_TEXTURE_WIDTH, height: 133, playerY: 51, topSlots: 5 }
  }
  if (normalized === 'dispenser' || normalized === 'dropper' || topSlots === 9 && (normalized.includes('dispenser') || normalized.includes('dropper'))) {
    return { kind: 'dispenser', asset: 'dispenser', width: CHEST_TEXTURE_WIDTH, height: 166, playerY: 84, topSlots: 9 }
  }
  if (normalized === 'furnace' || normalized === 'blast_furnace' || normalized === 'smoker') {
    return { kind: 'furnace', asset: normalized, width: CHEST_TEXTURE_WIDTH, height: 166, playerY: 84, topSlots: 3 }
  }

  const chestRows = chestRowCount(normalized, topSlots)
  return {
    kind: 'chest',
    asset: 'generic_54',
    width: CHEST_TEXTURE_WIDTH,
    height: 114 + chestRows * 18,
    playerY: 32 + chestRows * 18,
    rows: chestRows,
    topSlots: chestRows * 9
  }
}

function chestRowCount (type, topSlots) {
  const match = type.match(/(?:generic_9x|chest_)([1-6])/)
  if (match) return Number(match[1])
  if (type === 'chest' || type === 'container' || type === 'generic_9x') {
    return clampRows(Math.ceil(topSlots / 9))
  }
  if (topSlots >= 9 && topSlots <= 54 && topSlots % 9 === 0) return topSlots / 9
  return clampRows(Math.ceil(topSlots / 9) || 3)
}

function windowSlotPosition (layout, slot, inventoryStart) {
  if (!layout || !Number.isInteger(slot) || !Number.isInteger(inventoryStart)) return null
  if (slot < 0 || slot >= inventoryStart + 36) return null
  if (slot < inventoryStart) {
    if (layout.kind === 'chest') {
      const columns = 9
      return { x: 8 + (slot % columns) * 18, y: 18 + Math.floor(slot / columns) * 18 }
    }
    if (layout.kind === 'hopper') return slot < 5 ? { x: 44 + slot * 18, y: 20 } : null
    if (layout.kind === 'dispenser') {
      return slot < 9 ? { x: 62 + (slot % 3) * 18, y: 17 + Math.floor(slot / 3) * 18 } : null
    }
    if (layout.kind === 'furnace') {
      return slot === 0 ? { x: 56, y: 17 } : slot === 1 ? { x: 56, y: 53 } : slot === 2 ? { x: 116, y: 35 } : null
    }
    return null
  }

  const offset = slot - inventoryStart
  if (offset < 0 || offset >= 36) return null
  const row = Math.floor(offset / 9)
  const column = offset % 9
  return {
    x: 8 + column * 18,
    y: offset < 27 ? layout.playerY + row * 18 : layout.playerY + 58
  }
}

function clampRows (rows) {
  return Math.max(1, Math.min(6, Number.isFinite(rows) ? Math.floor(rows) : 3))
}

function integer (value) {
  return Number.isInteger(value) ? value : null
}

module.exports = { getWindowLayout, windowSlotPosition, chestRowCount }
