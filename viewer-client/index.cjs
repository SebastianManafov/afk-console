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
const socket = io({ path: '/pov-viewer/socket.io' })
const keys = new Set()
let freecam = false
let yaw = 0
let pitch = 0
let lastFrame = performance.now()
let botPosition = null

const followButton = document.getElementById('follow')
const freecamButton = document.getElementById('freecam')
const status = document.getElementById('status')
function setMode(nextFreecam) {
  freecam = nextFreecam
  followButton.classList.toggle('active', !freecam)
  freecamButton.classList.toggle('active', freecam)
  if (freecam && botPosition) viewer.camera.position.set(botPosition.x, botPosition.y + 1.62, botPosition.z)
}
followButton.onclick = () => setMode(false)
freecamButton.onclick = () => { setMode(true); renderer.domElement.requestPointerLock?.() }
renderer.domElement.addEventListener('click', () => { if (freecam) renderer.domElement.requestPointerLock?.() })
document.addEventListener('keydown', (event) => { keys.add(event.code); if (event.code === 'KeyF') setMode(!freecam) })
document.addEventListener('keyup', (event) => keys.delete(event.code))
document.addEventListener('mousemove', (event) => {
  if (!freecam || document.pointerLockElement !== renderer.domElement) return
  yaw -= event.movementX * .0022
  pitch = Math.max(-Math.PI / 2 + .01, Math.min(Math.PI / 2 - .01, pitch - event.movementY * .0022))
})

socket.on('connect', () => { status.textContent = 'Live verbunden' })
socket.on('disconnect', () => { status.textContent = 'Verbindung getrennt' })
socket.on('viewerUnavailable', (message) => {
  status.textContent = `${message} · neuer Versuch …`
  setTimeout(() => { socket.disconnect(); socket.connect() }, 2000)
})
socket.on('version', (version) => {
  if (!viewer.setVersion(version)) { status.textContent = `Viewer unterstützt ${version} nicht`; return }
  viewer.listen(socket)
})
socket.on('position', ({ pos, yaw: botYaw, pitch: botPitch }) => {
  botPosition = pos
  if (!freecam) viewer.setFirstPersonCamera(pos, botYaw, botPitch)
})

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
  updateFreecam(delta); viewer.update(); renderer.render(viewer.scene, viewer.camera)
}
requestAnimationFrame(animate)
window.addEventListener('resize', () => {
  viewer.camera.aspect = window.innerWidth / window.innerHeight; viewer.camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight)
})
