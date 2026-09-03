/* global document, window, requestAnimationFrame */
global.THREE = require('three')
const { Viewer } = require('prismarine-viewer/viewer')
const { io } = require('socket.io-client')
const { itemIconUrl } = require('./item-icons.cjs')
const { createControlSession } = require('./control-session.cjs')
const { findPlayerModel, applyPlayerPose, playerPoseEyeHeight } = require('./player-pose.cjs')

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
  console.info(`[POV] ${label} ${JSON.stringify({ ...viewerDiagnostics, loadedChunks, meshes, ...extra })}`)
}
for (const worker of viewer.world.workers || []) {
  const onmessage = worker.onmessage
  worker.onerror = (event) => reportViewerState('worker error', { message: event?.message || 'unknown worker error', filename: event?.filename, lineno: event?.lineno })
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
// PrismarineJS 1.33.0 only marks the legacy Y 0..255 range dirty when a chunk
// arrives. Modern 1.21.4 Java worlds extend from -64 through 319, so chunks
// outside that range otherwise receive valid data that never gets meshed.
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
const accountId = new URLSearchParams(window.location.search).get('accountId') || ''
const socket = io({ path: '/pov-viewer/socket.io', query: { accountId } })
socket.on('viewerDiagnostics', (data) => {
  if (data.stage === 'chunk' || data.stage === 'init') viewerDiagnostics.chunks = data.loaded || viewerDiagnostics.chunks
  reportViewerState(`server ${data.stage}`, data)
})
const playerList = document.getElementById('playerList')
const players = document.getElementById('players')
const minimap = document.getElementById('minimap')
const minimapContext = minimap.getContext('2d')
const heartMeter = document.getElementById('heartMeter')
const foodMeter = document.getElementById('foodMeter')
const armorMeter = document.getElementById('armorMeter')
const xpLevel = document.getElementById('xpLevel')
const mcHotbar = document.getElementById('mcHotbar')
const offhandItem = document.getElementById('offhandItem')
const offhandIcon = document.getElementById('offhandIcon')
const chatOverlay = document.getElementById('chatOverlay')
const inventoryPanel = document.getElementById('inventoryPanel')
const closeInventory = document.getElementById('closeInventory')
const armorSlots = [...document.querySelectorAll('.armor-slot')]
const inventoryMainSlots = document.getElementById('inventoryMainSlots')
const inventoryHotbar = document.getElementById('inventoryHotbar')
const craftingGrid = document.getElementById('craftingGrid')
const craftingOutput = document.getElementById('craftingOutput')

const keys = new Set()
let freecam = false
let yaw = 0
let pitch = 0
let lastFrame = performance.now()
let botPosition = null
let botYaw = 0
let botPitch = 0
let botPose = 'standing'
let lastReceivedSelfEntityPose = null
let lastReceivedPositionPose = null
let poseDiagnosticPending = false
let selectedSlot = 0
let itemRenderVersion = '1.21.4'
let selfEntityId = null
const entities = new Map()

const controlSession = createControlSession({
  emit: (event, payload, options = {}) => {
    const channel = options.volatile ? socket.volatile : socket
    if (payload === undefined) channel.emit(event)
    else channel.emit(event, payload)
  },
  onRevoked: () => {
    keys.clear()
    if (document.pointerLockElement === renderer.domElement) document.exitPointerLock()
  }
})

function postParent (message) {
  if (window.parent !== window) window.parent.postMessage(message, window.location.origin)
}

window.addEventListener('message', (event) => {
  if (event.source !== window.parent || event.origin !== window.location.origin) return
  const message = event.data
  if (!message || typeof message !== 'object' || message.accountId !== accountId) return
  if (message.type === 'rcc-pov-activation' || message.type === 'povActivation') {
    if (message.mode === 'bot' || message.mode === 'freecam') setMode(message.mode)
    if (message.active !== true) keys.clear()
    controlSession.setParentActive(message.active === true)
    if (message.active !== true && document.pointerLockElement === renderer.domElement) document.exitPointerLock()
  }
})
postParent({ type: 'rcc-pov-ready', accountId })

function setInventoryVisible (visible) {
  inventoryPanel.hidden = !visible
  if (visible && document.pointerLockElement) document.exitPointerLock()
}

closeInventory.onclick = () => setInventoryVisible(false)
function lockPointer () {
  try {
    const result = renderer.domElement.requestPointerLock?.()
    if (result?.catch) result.catch(() => {})
  } catch {}
}
function setMode (nextMode) {
  const nextFreecam = nextMode === 'freecam'
  if (nextFreecam === freecam) return
  keys.clear()
  freecam = nextFreecam
  controlSession.setBotPov(!freecam)
  if (freecam && botPosition) {
    yaw = botYaw
    pitch = botPitch
    viewer.camera.position.set(botPosition.x, botPosition.y + playerPoseEyeHeight(botPose), botPosition.z)
  } else if (!freecam && botPosition) {
    yaw = botYaw
    pitch = botPitch
    setBotCamera(botPosition, botYaw, botPitch)
  }
  syncSelfVisibility()
}

const PLAYER_POSES = new Set(['standing', 'crouching', 'swimming', 'sleeping', 'fall_flying'])
function poseDiagnosticValue (value) {
  if (value === undefined) return 'undefined'
  try { return JSON.stringify(value) } catch { return String(value) }
}
function modelRotationX (model) {
  return typeof model?.rotation?.x === 'number' ? model.rotation.x : 'n/a'
}
function modelDescription (model) {
  if (!model) return 'none'
  return `name=${model.name || '<unnamed>'} type=${model.type || model.constructor?.name || '<unknown>'}`
}
function rootType (root) {
  return root?.type || root?.constructor?.name || 'none'
}
function modelHierarchy (root, selectedModel) {
  const directChildren = Array.isArray(root?.children) ? root.children : []
  let skinnedMeshes = 0
  const visit = (node) => {
    if (!node) return
    if (node.isSkinnedMesh) skinnedMeshes += 1
    for (const child of Array.isArray(node.children) ? node.children : []) visit(child)
  }
  visit(root)
  return {
    entityFound: Boolean(root),
    rootType: rootType(root),
    children: directChildren.map(child => ({ name: child?.name || '<unnamed>', type: child?.type || child?.constructor?.name || '<unknown>', isSkinnedMesh: Boolean(child?.isSkinnedMesh) })),
    skinnedMeshes,
    selectedModel: modelDescription(selectedModel)
  }
}
function logPoseApplication (root, pose, stage) {
  const beforeModel = findPlayerModel(root)
  const beforeRotationX = modelRotationX(beforeModel)
  const applied = applyPlayerPose(root, pose)
  const afterModel = findPlayerModel(root)
  const hierarchy = modelHierarchy(root, afterModel)
  console.info(`[POSE MODEL] ${stage} ${poseDiagnosticValue(hierarchy)} applyResult=${applied} rotationBefore=${beforeRotationX} rotationAfter=${modelRotationX(afterModel)}`)
  return applied
}
function logPoseAfterViewerUpdate (root) {
  const model = findPlayerModel(root)
  console.info(`[POSE MODEL AFTER UPDATE] ${poseDiagnosticValue(modelHierarchy(root, model))} rotation=${modelRotationX(model)}`)
}
function setBotPose (pose, forceDiagnostic = false) {
  const previousPose = botPose
  if (PLAYER_POSES.has(pose)) botPose = pose
  const changed = botPose !== previousPose
  viewer.playerHeight = playerPoseEyeHeight(botPose)
  const mesh = selfEntityId === null ? null : viewer.entities.entities[selfEntityId]
  if (changed || forceDiagnostic) {
    poseDiagnosticPending = true
    console.info(`[POSE CLIENT] botPose=${botPose} incoming=${poseDiagnosticValue(pose)} entityFound=${Boolean(mesh)} selfEntityId=${poseDiagnosticValue(selfEntityId)}`)
    logPoseApplication(mesh, botPose, 'applyPlayerPose from setBotPose')
  } else if (mesh) {
    applyPlayerPose(mesh, botPose)
  }
}
function setBotCamera (pos, nextYaw, nextPitch) {
  viewer.playerHeight = playerPoseEyeHeight(botPose)
  viewer.setFirstPersonCamera(pos, nextYaw, nextPitch)
}
function updateRenderedEntity (entity) {
  if (!entity || entity.id === undefined || entity.id === null) return
  if (entity.delete) {
    if (viewer.entities.entities[entity.id]) viewer.updateEntity(entity)
    return
  }
  const isSelf = selfEntityId !== null && entity.id === selfEntityId
  viewer.updateEntity(entity)
  const pose = isSelf ? botPose : entity.pose
  if (isSelf && poseDiagnosticPending) {
    const mesh = viewer.entities.entities[entity.id]
    logPoseAfterViewerUpdate(mesh)
    if (PLAYER_POSES.has(pose)) logPoseApplication(mesh, pose, 'applyPlayerPose after viewer.updateEntity')
    poseDiagnosticPending = false
  } else if (PLAYER_POSES.has(pose)) {
    const mesh = viewer.entities.entities[entity.id]
    if (mesh) applyPlayerPose(mesh, pose)
  }
}
function syncSelfVisibility () {
  const mesh = selfEntityId === null ? null : viewer.entities.entities[selfEntityId]
  if (mesh) mesh.visible = freecam
}
renderer.domElement.addEventListener('click', lockPointer)
const movementControls = { KeyW: 'forward', KeyS: 'back', KeyA: 'left', KeyD: 'right', Space: 'jump', ShiftLeft: 'sneak', ShiftRight: 'sneak', ControlLeft: 'sprint', ControlRight: 'sprint' }
document.addEventListener('keydown', (event) => {
  keys.add(event.code)
  if (event.code === 'KeyE' && !event.repeat) setInventoryVisible(inventoryPanel.hidden)
  if (event.code === 'Escape' && !inventoryPanel.hidden) setInventoryVisible(false)
  if (event.code === 'Tab') { event.preventDefault(); playerList.hidden = false }
  if (event.code === 'KeyM' && !event.repeat) minimap.hidden = !minimap.hidden
  if (!freecam && movementControls[event.code] && !event.repeat) controlSession.keyDown(movementControls[event.code])
  if (!freecam && /^Digit[1-9]$/.test(event.code)) { selectedSlot = Number(event.code.slice(5)) - 1; controlSession.action('hotbar', { slot: selectedSlot }) }
})
document.addEventListener('keyup', (event) => {
  keys.delete(event.code)
  if (event.code === 'Tab') playerList.hidden = true
  if (!freecam && movementControls[event.code]) controlSession.keyUp(movementControls[event.code])
})
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === renderer.domElement
  if (!locked) keys.clear()
  controlSession.setPointerLocked(locked)
})
document.addEventListener('mousemove', (event) => {
  if (document.pointerLockElement !== renderer.domElement) return
  yaw -= event.movementX * .0022
  pitch = Math.max(-Math.PI / 2 + .01, Math.min(Math.PI / 2 - .01, pitch - event.movementY * .0022))
  if (!freecam) { botYaw = yaw; botPitch = pitch; controlSession.look(botYaw, botPitch) }
})
renderer.domElement.addEventListener('mousedown', (event) => {
  if (freecam || document.pointerLockElement !== renderer.domElement) return
  if (event.button === 0) controlSession.action('attack')
  if (event.button === 2) controlSession.action('use', { enabled: true })
})
renderer.domElement.addEventListener('mouseup', (event) => { if (event.button === 2) controlSession.action('use', { enabled: false }) })
renderer.domElement.addEventListener('contextmenu', (event) => event.preventDefault())
renderer.domElement.addEventListener('wheel', (event) => {
  if (freecam) return
  selectedSlot = (selectedSlot + (event.deltaY > 0 ? 1 : 8)) % 9
  controlSession.action('hotbar', { slot: selectedSlot })
}, { passive: true })

const releaseOnFocusLoss = (reason) => { keys.clear(); controlSession.releaseControl(reason); if (document.pointerLockElement === renderer.domElement) document.exitPointerLock() }
window.addEventListener('blur', () => releaseOnFocusLoss('window blur'))
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') releaseOnFocusLoss('tab hidden') })
window.addEventListener('pagehide', () => controlSession.cleanup('page hidden'))
window.addEventListener('beforeunload', () => controlSession.cleanup('page unloading'))

socket.on('connect', () => { controlSession.setSocketConnected(true) })
socket.on('disconnect', () => { keys.clear(); controlSession.setSocketConnected(false) })
socket.on('viewerControlCapabilities', (capabilities) => {
  if (!capabilities || capabilities.accountId !== accountId) return
  controlSession.setCapability(capabilities.canControl === true)
})
socket.on('viewerControlGranted', (grant) => {
  if (grant?.accountId !== accountId) return
  controlSession.setLeaseGranted(true)
})
socket.on('viewerControlDenied', () => {
  controlSession.serverDenied()
})
socket.on('viewerControlRevoked', (revocation) => controlSession.serverRevoked(revocation?.reason || 'server revoked control'))
socket.on('viewerUnavailable', () => {
  setTimeout(() => { socket.disconnect(); socket.connect() }, 2000)
})
socket.on('version', (version) => {
  itemRenderVersion = String(version)
  if (!version) return
  if (!viewer.setVersion(version)) return
  viewer.listen(socket)
})
socket.on('position', ({ pos, yaw: nextBotYaw, pitch: nextBotPitch, pose }) => {
  if (pose !== lastReceivedPositionPose) {
    lastReceivedPositionPose = pose
    console.info(`[POSE CLIENT] positionPose=${poseDiagnosticValue(pose)} botPose=${botPose} exact payload=${poseDiagnosticValue({ pos, yaw: nextBotYaw, pitch: nextBotPitch, pose })}`)
  }
  botPosition = pos
  setBotPose(pose)
  if (selfEntityId !== null) {
    updateRenderedEntity({ id: selfEntityId, pos, yaw: nextBotYaw, pitch: nextBotPitch, pose: botPose })
    syncSelfVisibility()
  }
  if (!freecam) {
    yaw = nextBotYaw; pitch = nextBotPitch
    setBotCamera(pos, nextBotYaw, nextBotPitch)
  }
})
socket.on('selfEntity', (entity) => {
  if (entity?.pose !== lastReceivedSelfEntityPose) {
    lastReceivedSelfEntityPose = entity?.pose
    console.info(`[POSE CLIENT] selfEntityPose=${poseDiagnosticValue(entity?.pose)} botPose=${botPose} exact payload=${poseDiagnosticValue(entity)}`)
  }
  selfEntityId = entity.id
  setBotPose(entity.pose, true)
  updateRenderedEntity(entity)
  syncSelfVisibility()
  if (!freecam && botPosition) setBotCamera(botPosition, botYaw, botPitch)
})
socket.on('entity', (entity) => {
  if (entity.delete) {
    entities.delete(entity.id)
  } else {
    entities.set(entity.id, { ...(entities.get(entity.id) || {}), ...entity })
  }
  updateRenderedEntity(entity)
})
socket.on('hud', (nextHud) => {
  document.body.classList.add('live')
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

function itemLabel(item) {
  if (!item) return ''
  return String(item.displayName || item.name || '').replace(/_/g, ' ')
}
function makeItemFallback (item) {
  const fallback = document.createElement('span')
  fallback.className = 'item-fallback'
  fallback.textContent = itemLabel(item).slice(0, 2).toUpperCase()
  return fallback
}
function setItemIcon (target, item) {
  target.replaceChildren()
  if (!item) return
  const url = itemIconUrl(itemRenderVersion, item.name)
  const fallback = makeItemFallback(item)
  if (!url) { target.append(fallback); return }
  const icon = document.createElement('img')
  icon.className = 'item-icon'
  icon.alt = ''
  icon.src = url
  icon.addEventListener('error', () => icon.replaceWith(fallback), { once: true })
  target.append(icon)
}
function fillSlot (slot, item) {
  slot.replaceChildren()
  slot.classList.toggle('empty', !item)
  if (!item) {
    slot.removeAttribute('title')
    slot.removeAttribute('aria-label')
    return
  }
  const label = itemLabel(item)
  slot.title = label
  slot.setAttribute('aria-label', `${label}${item.count > 1 ? ` x${item.count}` : ''}`)
  setItemIcon(slot, item)
  if (item.count > 1) {
    const count = document.createElement('span')
    count.className = 'item-count'
    count.textContent = item.count
    slot.append(count)
  }
}
function makeSlot (item, selected = false) {
  const slot = document.createElement('div')
  slot.className = `inventory-slot mc-slot${selected ? ' selected' : ''}`
  fillSlot(slot, item)
  return slot
}
function renderSlots (container, items, count, selected = -1) {
  const values = Array.isArray(items) ? items : []
  container.replaceChildren(...Array.from({ length: count }, (_, index) => makeSlot(values[index] || null, index === selected)))
}
function renderMinecraftHud (data) {
  const hearts = Math.max(0, Math.min(10, Math.ceil((data.health || 0) / 2)))
  const foods = Math.max(0, Math.min(10, Math.ceil((data.food || 0) / 2)))
  armorMeter.textContent = '\u2662'.repeat(Math.max(0, data.armor || 0))
  heartMeter.textContent = '\u2665'.repeat(hearts) + '\u2661'.repeat(10 - hearts)
  foodMeter.textContent = '\u25cf'.repeat(foods) + '\u25cb'.repeat(10 - foods)
  xpLevel.textContent = data.experience || 0
  renderSlots(mcHotbar, data.hotbar, 9, data.selectedSlot)
  renderSlots(inventoryMainSlots, data.inventory, 27)
  renderSlots(inventoryHotbar, data.hotbar, 9, data.selectedSlot)
  const armor = Array.isArray(data.armorItems) ? data.armorItems : []
  armorSlots.forEach((slot, index) => fillSlot(slot, armor[index] || null))
  if (craftingGrid.childElementCount === 0) renderSlots(craftingGrid, [], 4)
  fillSlot(craftingOutput, null)
  offhandItem.hidden = !data.offhand
  setItemIcon(offhandIcon, data.offhand)
}
function updateFreecam(delta) {
  if (!freecam) return
  const speed = (keys.has('ControlLeft') || keys.has('ControlRight') ? 18 : 7) * delta
  const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0)
  const side = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0)
  const vertical = (keys.has('Space') ? 1 : 0) - (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 1 : 0)
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
  minimapContext.fillStyle = '#b9d5bd'; minimapContext.fillRect(size / 2 - 3, size / 2 - 3, 6, 6)
  for (const entity of entities.values()) {
    if (!entity.pos || !entity.username) continue
    const x = size / 2 + (entity.pos.x - botPosition.x) * 3
    const y = size / 2 + (entity.pos.z - botPosition.z) * 3
    if (x < 5 || y < 5 || x > size - 5 || y > size - 5) continue
    minimapContext.fillStyle = '#c9958f'; minimapContext.beginPath(); minimapContext.arc(x, y, 3, 0, Math.PI * 2); minimapContext.fill()
  }
}
requestAnimationFrame(animate)
window.addEventListener('resize', () => {
  viewer.camera.aspect = window.innerWidth / window.innerHeight; viewer.camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight)
})
