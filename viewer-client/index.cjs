/* global document, window, requestAnimationFrame */
global.THREE = require('three')
const { Viewer } = require('prismarine-viewer/viewer')
const { io } = require('socket.io-client')

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.outputEncoding = THREE.sRGBEncoding
document.body.prepend(renderer.domElement)
const viewer = new Viewer(renderer)
const viewerDiagnostics = { chunks: 0, geometries: 0, emptyGeometries: 0, finished: 0 }
function reportViewerState (label, extra = {}) {
  const loadedChunks = Object.keys(viewer.world.loadedChunks || {}).length
  const meshes = Object.keys(viewer.world.sectionMeshs || {}).length
  console.info('[POV]', label, { ...viewerDiagnostics, loadedChunks, meshes, ...extra })
}
for (const worker of viewer.world.workers || []) {
  const onmessage = worker.onmessage
  worker.onerror = (event) => reportViewerState('worker error', { message: event?.message || 'unbekannter Worker-Fehler', filename: event?.filename, lineno: event?.lineno })
  worker.onmessageerror = (event) => reportViewerState('worker message error', { data: event?.data })
  worker.onmessage = (event) => {
    const message = event?.data
    if (message?.type === 'geometry') {
      viewerDiagnostics.geometries += 1
      const positions = message.geometry?.positions?.length || 0
      if (positions === 0) viewerDiagnostics.emptyGeometries += 1
      if (viewerDiagnostics.geometries <= 3 || viewerDiagnostics.geometries % 25 === 0) reportViewerState('worker geometry', { key: message.key, positions })
    } else if (message?.type === 'sectionFinished') {
      viewerDiagnostics.finished += 1
    }
    onmessage?.(event)
  }
}
// PrismarineJS's 1.21.4 viewer only marks the legacy Y 0..255 range dirty
// when a chunk arrives. Modern Java worlds extend from -64 through 319, so a
// bot outside the legacy range otherwise receives valid chunks that never get
// meshed or displayed. Keep the 26.1 viewer path and its version mapping intact.
const addLegacyHeightColumn = viewer.world.addColumn.bind(viewer.world)
viewer.world.addColumn = (x, z, chunk) => {
  addLegacyHeightColumn(x, z, chunk)
  for (const [start, end] of [[-64, 0], [256, 320]]) {
    for (let y = start; y < end; y += 16) {
      const section = new THREE.Vector3(x, y, z)
      viewer.world.setSectionDirty(section)
      viewer.world.setSectionDirty(section.clone().add(new THREE.Vector3(-16, 0, 0)))
      viewer.world.setSectionDirty(section.clone().add(new THREE.Vector3(16, 0, 0)))
      viewer.world.setSectionDirty(section.clone().add(new THREE.Vector3(0, 0, -16)))
      viewer.world.setSectionDirty(section.clone().add(new THREE.Vector3(0, 0, 16)))
    }
  }
}
const socket = io({ path: '/pov-viewer/socket.io' })
socket.on('viewerDiagnostics', (data) => {
  if (data.stage === 'chunk') viewerDiagnostics.chunks = data.loaded || viewerDiagnostics.chunks
  if (data.stage === 'error') status.textContent = `POV-Fehler: ${data.message}`
  reportViewerState(`server ${data.stage}`, data)
})
const keys = new Set()
let freecam = false
let yaw = 0
let pitch = 0
let lastFrame = performance.now()
let botPosition = null
let botYaw = 0
let botPitch = 0
let selectedSlot = 0
let hudData = null
let selfEntityId = null
const entities = new Map()

const followButton = document.getElementById('follow')
const freecamButton = document.getElementById('freecam')
const status = document.getElementById('status')
const vitals = document.getElementById('vitals')
const playerList = document.getElementById('playerList')
const players = document.getElementById('players')
const minimap = document.getElementById('minimap')
const minimapContext = minimap.getContext('2d')
const heartMeter = document.getElementById('heartMeter')
const foodMeter = document.getElementById('foodMeter')
const armorMeter = document.getElementById('armorMeter')
const xpLevel = document.getElementById('xpLevel')
const mcHotbar = document.getElementById('mcHotbar')
const heldItemName = document.getElementById('heldItemName')
const offhandItem = document.getElementById('offhandItem')
const chatOverlay = document.getElementById('chatOverlay')
const inventoryPanel = document.getElementById('inventoryPanel')
const inventorySlots = document.getElementById('inventorySlots')
function lockPointer () {
  try {
    const result = renderer.domElement.requestPointerLock?.()
    if (result?.catch) result.catch(() => {})
  } catch {}
}
function setMode(nextFreecam) {
  if (nextFreecam && !freecam) socket.emit('releaseControls')
  freecam = nextFreecam
  followButton.classList.toggle('active', !freecam)
  freecamButton.classList.toggle('active', freecam)
  if (freecam && botPosition) viewer.camera.position.set(botPosition.x, botPosition.y + 1.62, botPosition.z)
  syncSelfVisibility()
}
function syncSelfVisibility () {
  const mesh = selfEntityId === null ? null : viewer.entities.entities[selfEntityId]
  if (mesh) mesh.visible = freecam
}
followButton.onclick = () => { setMode(false); lockPointer() }
freecamButton.onclick = () => { setMode(true); lockPointer() }
renderer.domElement.addEventListener('click', lockPointer)
const movementControls = { KeyW: 'forward', KeyS: 'back', KeyA: 'left', KeyD: 'right', Space: 'jump', ShiftLeft: 'sneak', ControlLeft: 'sprint' }
document.addEventListener('keydown', (event) => {
  keys.add(event.code)
  if (event.code === 'KeyF' && !event.repeat) setMode(!freecam)
  if (event.code === 'KeyE' && !event.repeat) { inventoryPanel.hidden = !inventoryPanel.hidden; if (!inventoryPanel.hidden && document.pointerLockElement) document.exitPointerLock() }
  if (event.code === 'Escape' && !inventoryPanel.hidden) inventoryPanel.hidden = true
  if (event.code === 'Tab') { event.preventDefault(); playerList.hidden = false }
  if (event.code === 'KeyM' && !event.repeat) minimap.hidden = !minimap.hidden
  if (!freecam && document.pointerLockElement === renderer.domElement && movementControls[event.code] && !event.repeat) socket.emit('botControl', { control: movementControls[event.code], enabled: true })
  if (!freecam && /^Digit[1-9]$/.test(event.code)) { selectedSlot = Number(event.code.slice(5)) - 1; socket.emit('botAction', { action: 'hotbar', slot: selectedSlot }) }
})
document.addEventListener('keyup', (event) => {
  keys.delete(event.code)
  if (event.code === 'Tab') playerList.hidden = true
  if (!freecam && movementControls[event.code]) socket.emit('botControl', { control: movementControls[event.code], enabled: false })
})
document.addEventListener('pointerlockchange', () => { if (document.pointerLockElement !== renderer.domElement) socket.emit('releaseControls') })
document.addEventListener('mousemove', (event) => {
  if (document.pointerLockElement !== renderer.domElement) return
  yaw -= event.movementX * .0022
  pitch = Math.max(-Math.PI / 2 + .01, Math.min(Math.PI / 2 - .01, pitch - event.movementY * .0022))
  if (!freecam) { botYaw = yaw; botPitch = pitch; socket.emit('botLook', { yaw: botYaw, pitch: botPitch }) }
})
renderer.domElement.addEventListener('mousedown', (event) => {
  if (freecam || document.pointerLockElement !== renderer.domElement) return
  if (event.button === 0) socket.emit('botAction', { action: 'attack' })
  if (event.button === 2) socket.emit('botAction', { action: 'use' })
})
renderer.domElement.addEventListener('contextmenu', (event) => event.preventDefault())
renderer.domElement.addEventListener('wheel', (event) => {
  if (freecam) return
  selectedSlot = (selectedSlot + (event.deltaY > 0 ? 1 : 8)) % 9
  socket.emit('botAction', { action: 'hotbar', slot: selectedSlot })
}, { passive: true })

socket.on('connect', () => { status.textContent = 'Live verbunden' })
socket.on('disconnect', () => { status.textContent = 'Verbindung getrennt' })
socket.on('viewerUnavailable', (message) => {
  status.textContent = `${message} · neuer Versuch …`
  setTimeout(() => { socket.disconnect(); socket.connect() }, 2000)
})
socket.on('version', (version) => {
  if (!version) { status.textContent = 'POV wartet auf die Minecraft-Version'; return }
  if (!viewer.setVersion(version)) { status.textContent = `Viewer unterstützt ${version} nicht`; return }
  viewer.listen(socket)
})
socket.on('position', ({ pos, yaw: botYaw, pitch: botPitch }) => {
  botPosition = pos
  if (selfEntityId !== null) {
    viewer.updateEntity({ id: selfEntityId, pos, yaw: botYaw, pitch: botPitch })
    syncSelfVisibility()
  }
  if (!freecam) {
    yaw = botYaw; pitch = botPitch
    viewer.setFirstPersonCamera(pos, botYaw, botPitch)
  }
})
socket.on('selfEntity', (entity) => {
  selfEntityId = entity.id
  viewer.updateEntity(entity)
  syncSelfVisibility()
})
socket.on('entity', (entity) => { if (entity.delete) entities.delete(entity.id); else entities.set(entity.id, { ...(entities.get(entity.id) || {}), ...entity }) })
socket.on('hud', (nextHud) => {
  document.body.classList.add('live')
  hudData = nextHud
  vitals.textContent = `❤ ${Math.ceil(nextHud.health ?? 0)} · 🍗 ${Math.ceil(nextHud.food ?? 0)} · XP ${nextHud.experience ?? 0}`
  players.replaceChildren(...(nextHud.players || []).map((player) => {
    const row = document.createElement('div'); row.className = 'player'
    const name = document.createElement('span'); name.textContent = player.username
    const ping = document.createElement('span'); ping.textContent = `${player.ping ?? '?'} ms`
    row.append(name, ping); return row
  }))
  renderMinecraftHud(nextHud)
})
socket.on('chatLine', (message) => {
  const line = document.createElement('div'); line.className = 'chat-line'; line.textContent = message
  chatOverlay.append(line); while (chatOverlay.children.length > 8) chatOverlay.firstChild.remove()
  setTimeout(() => line.remove(), 12500)
})
socket.on('controlError', (message) => { status.textContent = `Steuerung: ${message}` })

function itemLabel(item) {
  if (!item) return ''
  return String(item.displayName || item.name || '').replace(/_/g, ' ')
}
function makeSlot(item, selected = false) {
  const slot = document.createElement('div'); slot.className = `mc-slot${selected ? ' selected' : ''}`
  const glyph = document.createElement('span'); glyph.className = 'glyph'; glyph.textContent = item ? itemLabel(item).slice(0, 2).toUpperCase() : ''
  const name = document.createElement('span'); name.textContent = item ? itemLabel(item) : ''
  slot.title = itemLabel(item); slot.append(glyph, name)
  if (item?.count > 1) { const count = document.createElement('span'); count.className = 'count'; count.textContent = item.count; slot.append(count) }
  return slot
}
function renderMinecraftHud(data) {
  const hearts = Math.max(0, Math.min(10, Math.ceil((data.health || 0) / 2)))
  const foods = Math.max(0, Math.min(10, Math.ceil((data.food || 0) / 2)))
  heartMeter.textContent = '♥'.repeat(hearts) + '♡'.repeat(10 - hearts)
  foodMeter.textContent = '●'.repeat(foods) + '○'.repeat(10 - foods)
  armorMeter.textContent = '♢'.repeat(Math.max(0, data.armor || 0))
  xpLevel.textContent = data.experience || 0
  mcHotbar.replaceChildren(...(data.hotbar || Array(9).fill(null)).map((item, index) => makeSlot(item, index === data.selectedSlot)))
  heldItemName.textContent = itemLabel(data.heldItem) || 'Hand'
  offhandItem.hidden = !data.offhand; offhandItem.textContent = itemLabel(data.offhand)
  inventorySlots.replaceChildren(...(data.inventory || []).map((item) => {
    const slot = document.createElement('div'); slot.className = `inventory-slot${item ? '' : ' empty'}`
    slot.textContent = item ? `${itemLabel(item)}${item.count > 1 ? ` ×${item.count}` : ''}` : ''
    return slot
  }))
}

function updateFreecam(delta) {
  if (!freecam) return
  const speed = (keys.has('ControlLeft') ? 18 : 7) * delta
  const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0)
  const side = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0)
  const vertical = (keys.has('Space') ? 1 : 0) - (keys.has('ShiftLeft') ? 1 : 0)
  viewer.camera.position.x += (-Math.sin(yaw) * forward + Math.cos(yaw) * side) * speed
  viewer.camera.position.z += (-Math.cos(yaw) * forward - Math.sin(yaw) * side) * speed
  viewer.camera.position.y += vertical * speed
  viewer.camera.rotation.order = 'YXZ'; viewer.camera.rotation.y = yaw; viewer.camera.rotation.x = pitch
}
function animate(now) {
  requestAnimationFrame(animate)
  const delta = Math.min(.05, (now - lastFrame) / 1000); lastFrame = now
  updateFreecam(delta); drawMinimap(); viewer.update(); renderer.render(viewer.scene, viewer.camera)
}
function drawMinimap() {
  if (minimap.hidden || !botPosition) return
  const size = minimap.width; minimapContext.clearRect(0, 0, size, size)
  minimapContext.fillStyle = '#07101a'; minimapContext.fillRect(0, 0, size, size)
  minimapContext.strokeStyle = '#ffffff22'; minimapContext.beginPath(); minimapContext.arc(size / 2, size / 2, size / 2 - 4, 0, Math.PI * 2); minimapContext.stroke()
  minimapContext.fillStyle = '#55e6a5'; minimapContext.fillRect(size / 2 - 3, size / 2 - 3, 6, 6)
  for (const entity of entities.values()) {
    if (!entity.pos || !entity.username) continue
    const x = size / 2 + (entity.pos.x - botPosition.x) * 3
    const y = size / 2 + (entity.pos.z - botPosition.z) * 3
    if (x < 5 || y < 5 || x > size - 5 || y > size - 5) continue
    minimapContext.fillStyle = '#ff5f7a'; minimapContext.beginPath(); minimapContext.arc(x, y, 3, 0, Math.PI * 2); minimapContext.fill()
  }
}
requestAnimationFrame(animate)
window.addEventListener('resize', () => {
  viewer.camera.aspect = window.innerWidth / window.innerHeight; viewer.camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight)
})
