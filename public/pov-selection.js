export class PovSelectionController {
  constructor ({ sendActivation = () => {}, setCardMaximized = () => {}, onSelectionChanged = () => {}, onModeChanged = () => {}, initialMode = 'bot' } = {}) {
    this.sendActivation = sendActivation
    this.setCardMaximized = setCardMaximized
    this.onSelectionChanged = onSelectionChanged
    this.onModeChanged = onModeChanged
    this.activeAccountId = null
    this.awaitingReady = false
    this.mode = normalizePovMode(initialMode)
  }

  setMode (mode) {
    if (mode !== 'bot' && mode !== 'freecam') return false
    if (mode === this.mode) return false
    this.mode = mode
    this.onModeChanged(this.mode)
    if (this.activeAccountId) this.sendActivation(this.activeAccountId, true, this.mode)
    return true
  }

  select (accountId) {
    if (!accountId) return this.clear()
    const previous = this.activeAccountId
    if (previous && previous !== accountId) {
      this.sendActivation(previous, false)
      this.setCardMaximized(previous, false)
    }
    this.activeAccountId = accountId
    this.awaitingReady = false
    this.onSelectionChanged(accountId)
    this.setCardMaximized(accountId, true)
    this.sendActivation(accountId, true, this.mode)
    return accountId
  }

  switch (accountId) {
    return this.select(accountId)
  }

  minimize (accountId = this.activeAccountId) {
    if (!accountId || accountId !== this.activeAccountId) return false
    this.sendActivation(accountId, false)
    this.setCardMaximized(accountId, false)
    this.activeAccountId = null
    this.awaitingReady = false
    this.onSelectionChanged(null)
    return true
  }

  clear () {
    if (!this.activeAccountId) return false
    return this.minimize(this.activeAccountId)
  }

  prepareRebuild () {
    if (!this.activeAccountId) return null
    this.sendActivation(this.activeAccountId, false)
    this.awaitingReady = true
    return this.activeAccountId
  }

  handleReady (accountId) {
    if (accountId !== this.activeAccountId) return false
    this.awaitingReady = false
    this.sendActivation(accountId, true, this.mode)
    return true
  }

  replay (accountId = this.activeAccountId) {
    if (!accountId || accountId !== this.activeAccountId) return false
    this.sendActivation(accountId, true, this.mode)
    return true
  }

  isSelected (accountId) {
    return accountId === this.activeAccountId
  }
}

function normalizePovMode (mode) {
  return mode === 'freecam' ? 'freecam' : 'bot'
}

export function createPovSelectionController (options) {
  return new PovSelectionController(options)
}
