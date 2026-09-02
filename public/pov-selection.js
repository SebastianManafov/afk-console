export class PovSelectionController {
  constructor ({ sendActivation = () => {}, setCardMaximized = () => {}, onSelectionChanged = () => {} } = {}) {
    this.sendActivation = sendActivation
    this.setCardMaximized = setCardMaximized
    this.onSelectionChanged = onSelectionChanged
    this.activeAccountId = null
    this.awaitingReady = false
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
    this.sendActivation(accountId, true)
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
    this.sendActivation(accountId, true)
    return true
  }

  replay (accountId = this.activeAccountId) {
    if (!accountId || accountId !== this.activeAccountId) return false
    this.sendActivation(accountId, true)
    return true
  }

  isSelected (accountId) {
    return accountId === this.activeAccountId
  }
}

export function createPovSelectionController (options) {
  return new PovSelectionController(options)
}
