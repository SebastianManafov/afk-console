const HEARTBEAT_MS = 1000
const LOOK_INTERVAL_MS = 25
const MOVEMENT_CONTROLS = new Set(['forward', 'back', 'left', 'right', 'jump', 'sneak', 'sprint'])

class ControlSession {
  constructor (options = {}) {
    this.emitEvent = typeof options.emit === 'function' ? options.emit : () => {}
    this.now = options.now || (() => Date.now())
    this.setInterval = options.setInterval || globalThis.setInterval.bind(globalThis)
    this.clearInterval = options.clearInterval || globalThis.clearInterval.bind(globalThis)
    this.setTimeout = options.setTimeout || globalThis.setTimeout.bind(globalThis)
    this.clearTimeout = options.clearTimeout || globalThis.clearTimeout.bind(globalThis)
    this.onStateChange = typeof options.onStateChange === 'function' ? options.onStateChange : () => {}
    this.onRevoked = typeof options.onRevoked === 'function' ? options.onRevoked : () => {}
    this.heartbeatMs = options.heartbeatMs || HEARTBEAT_MS
    this.lookIntervalMs = options.lookIntervalMs || LOOK_INTERVAL_MS
    this.adminCapable = false
    this.parentActive = false
    this.pointerLocked = false
    this.botPov = true
    this.socketConnected = false
    this.leaseGranted = false
    this.acquireRequested = false
    this.pressed = new Set()
    this.held = new Set()
    this.activeUse = false
    this.heartbeatTimer = null
    this.lookTimer = null
    this.pendingLook = null
    this.disposed = false
  }

  get canControl () {
    return !this.disposed && this.adminCapable && this.parentActive && this.botPov && this.pointerLocked && this.socketConnected && this.leaseGranted
  }

  get canAcquire () {
    return !this.disposed && this.adminCapable && this.parentActive && this.botPov && this.pointerLocked && this.socketConnected
  }

  get pressedControls () {
    return new Set(this.pressed)
  }

  setCapability (canControl) {
    this.adminCapable = canControl === true
    this.reconcile('capability changed')
  }

  setAdminCapability (canControl) {
    this.setCapability(canControl)
  }

  setParentActive (active) {
    this.parentActive = active === true
    this.reconcile(this.parentActive ? 'parent activated' : 'parent deactivated')
  }

  setPointerLocked (locked) {
    this.pointerLocked = locked === true
    this.reconcile(this.pointerLocked ? 'pointer lock acquired' : 'pointer lock lost')
  }

  setMode (mode) {
    this.botPov = mode === 'bot' || mode === 'botPov' || mode === false
    this.reconcile(this.botPov ? 'Bot POV active' : 'Freecam active')
  }

  setBotPov (active) {
    this.setMode(active ? 'bot' : 'freecam')
  }

  setSocketConnected (connected) {
    this.socketConnected = connected === true
    this.reconcile(this.socketConnected ? 'socket connected' : 'socket disconnected')
  }

  onSocketConnected (connected) {
    this.setSocketConnected(connected)
  }

  setLeaseGranted (granted) {
    if (!granted) this.failSafe('lease not granted', false)
    this.leaseGranted = granted === true
    this.acquireRequested = false
    if (this.leaseGranted && this.canControl) {
      this.syncHeldControls()
      this.startHeartbeat()
    }
    else if (!this.leaseGranted) this.stopHeartbeat()
    this.onStateChange(this)
  }

  onLeaseGranted (granted = true) {
    this.setLeaseGranted(granted)
  }

  serverDenied () {
    this.acquireRequested = false
    this.onStateChange(this)
  }

  press (control) {
    if (typeof control !== 'string' || !MOVEMENT_CONTROLS.has(control) || this.held.has(control)) return false
    this.held.add(control)
    if (!this.canControl) return false
    this.pressed.add(control)
    this.emitReliable('botControl', { control, enabled: true })
    return true
  }

  keyDown (control) {
    return this.press(control)
  }

  release (control) {
    const wasHeld = this.held.delete(control)
    const wasPressed = this.pressed.delete(control)
    if (!wasHeld && !wasPressed) return false
    if (wasPressed && this.socketConnected && this.leaseGranted) this.emitReliable('botControl', { control, enabled: false })
    return true
  }

  keyUp (control) {
    return this.release(control)
  }

  look (yaw, pitch) {
    if (!this.canControl || !Number.isFinite(yaw) || !Number.isFinite(pitch)) return false
    this.pendingLook = { yaw, pitch }
    if (!this.lookTimer) this.lookTimer = this.setTimeout(() => this.flushLook(), this.lookIntervalMs)
    return true
  }

  action (action, payload = {}) {
    if (!this.canControl) return false
    if (action === 'use') {
      const enabled = payload.enabled !== false
      this.activeUse = enabled
      this.emitReliable('botAction', { ...payload, action, enabled })
      return true
    }
    if (action === 'attack' || action === 'hotbar') {
      this.emitReliable('botAction', { ...payload, action })
      return true
    }
    return false
  }

  serverRevoked (reason = 'server revoked control') {
    this.leaseGranted = false
    this.acquireRequested = false
    this.stopHeartbeat()
    this.failSafe(reason, false)
    this.onRevoked(reason, this)
    this.onStateChange(this)
  }

  releaseControl (reason = 'control released') {
    this.failSafe(reason, true)
    this.onStateChange(this)
  }

  cleanup (reason = 'viewer cleanup') {
    if (this.disposed) return
    this.disposed = true
    this.failSafe(reason, true)
    this.stopHeartbeat()
    this.onStateChange(this)
  }

  dispose (reason = 'viewer disposed') {
    this.cleanup(reason)
  }

  reconcile (reason) {
    if (this.canAcquire) {
      this.maybeAcquire()
      if (this.leaseGranted) this.startHeartbeat()
    } else {
      this.failSafe(reason, true)
    }
    this.onStateChange(this)
  }

  maybeAcquire () {
    if (this.leaseGranted || this.acquireRequested || !this.canAcquire) return
    this.acquireRequested = true
    this.emitReliable('viewerControlAcquire')
  }

  startHeartbeat () {
    if (this.heartbeatTimer || !this.leaseGranted) return
    this.heartbeatTimer = this.setInterval(() => {
      if (!this.canControl) {
        this.failSafe('control condition lost', true)
        return
      }
      this.emitReliable('viewerControlHeartbeat')
    }, this.heartbeatMs)
  }

  stopHeartbeat () {
    if (this.heartbeatTimer) this.clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = null
  }

  syncHeldControls () {
    if (!this.canControl) return
    for (const control of this.held) {
      if (this.pressed.has(control)) continue
      this.pressed.add(control)
      this.emitReliable('botControl', { control, enabled: true })
    }
  }

  flushLook () {
    this.lookTimer = null
    const latest = this.pendingLook
    this.pendingLook = null
    if (latest && this.canControl) {
      this.emitVolatile('botLook', latest)
      if (this.pendingLook && !this.lookTimer) this.lookTimer = this.setTimeout(() => this.flushLook(), this.lookIntervalMs)
    }
  }

  failSafe (reason, notifyServer) {
    const hadLease = this.leaseGranted
    const canNotify = notifyServer && this.socketConnected && this.leaseGranted
    const controls = [...this.pressed]
    this.pressed.clear()
    this.held.clear()
    if (canNotify) {
      for (const control of controls) this.emitReliable('botControl', { control, enabled: false })
      if (this.activeUse) this.emitReliable('botAction', { action: 'use', enabled: false })
      this.emitReliable('viewerControlRelease', { reason })
    }
    this.activeUse = false
    this.pendingLook = null
    if (this.lookTimer) this.clearTimeout(this.lookTimer)
    this.lookTimer = null
    if (hadLease) {
      this.leaseGranted = false
      this.acquireRequested = false
    }
    if (!this.canControl) this.stopHeartbeat()
  }

  emitReliable (event, payload) {
    this.emitEvent(event, payload, { reliable: true })
  }

  emitVolatile (event, payload) {
    this.emitEvent(event, payload, { volatile: true })
  }
}

function createControlSession (options) {
  return new ControlSession(options)
}

module.exports = { ControlSession, createControlSession, HEARTBEAT_MS, LOOK_INTERVAL_MS }
