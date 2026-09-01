const $ = (id) => document.getElementById(id)
const worldRestartPrefs = JSON.parse(localStorage.getItem('rcc-world-restart') || '{}')
if ($('worldRestartEnabled')) $('worldRestartEnabled').checked = worldRestartPrefs.enabled === true
if ($('worldRestartMessage')) $('worldRestartMessage').value = worldRestartPrefs.message || 'Die Welt wird in ... Sekunden neugestartet'
if ($('worldRestartWait')) $('worldRestartWait').value = worldRestartPrefs.waitMinutes || 3
$('saveMacros')?.addEventListener('click', () => { localStorage.setItem('rcc-world-restart', JSON.stringify({ enabled: $('worldRestartEnabled')?.checked === true, message: $('worldRestartMessage')?.value || '', waitMinutes: Number($('worldRestartWait')?.value || 3) })); toast('World-restart reconnect gespeichert') })
let state = null
let config = null
let socket = null
let logEntries = []
let currentAuthAccountId = null
let currentReconnectAccountId = null
let activeControlAccountId = null
let editingProfileId = null
let lastProfilesSignature = ''
let selectedConnectAccountIds = null
let sessionRole = sessionStorage.getItem('rcc-role') || 'admin'
let hiddenEmailAccountIds = new Set(JSON.parse(localStorage.getItem('rcc-hidden-emails') || '[]'))

function maskedEmail(value) {
  return '*'.repeat(Math.max(8, String(value || '').length))
}

function setEmailHidden(accountId, hidden) {
  if (hidden) hiddenEmailAccountIds.add(accountId)
  else hiddenEmailAccountIds.delete(accountId)
  localStorage.setItem('rcc-hidden-emails', JSON.stringify([...hiddenEmailAccountIds]))
}

document.querySelector('#sellScheduleEnd').closest('.form-grid').insertAdjacentHTML('beforeend', '<label>Sell GUI title<input id="sellGuiTitle"></label><label>Content last slot<input id="sellContentLastSlot" type="number" min="0" max="89"></label><label>Confirm slot<input id="sellConfirmSlot" type="number" min="0" max="89"></label>')
document.querySelector('#spawnerScheduleEnd').closest('.form-grid').insertAdjacentHTML('beforeend', '<label>Home oben<input id="spawnerHomeTop"></label><label>Home unten<input id="spawnerHomeBottom"></label><label>Home AFK<input id="spawnerHomeAfk"></label><label>W/S/D duration (ms)<input id="spawnerMovementMs" type="number" min="50" max="5000"></label><label class="inline-check"><input id="spawnerAutoDetect" type="checkbox"> Auto-detect GUI slots</label><label class="inline-check"><input id="spawnerOrderEnabled" type="checkbox"> Deliver bones to highest order</label><label>Order command<input id="spawnerOrderCommand"></label><label>Order list title<input id="spawnerOrderTitle"></label><label>Delivery GUI title<input id="spawnerOrderDeliverTitle"></label><label>Highest order fallback slot<input id="spawnerOrderHighestSlot" type="number" min="0" max="89"></label><label>Whole inventory slot<input id="spawnerOrderDeliverSlot" type="number" min="0" max="89"></label><label>Order content last slot<input id="spawnerOrderContentLastSlot" type="number" min="0" max="89"></label><label>Order page left slot<input id="spawnerOrderPageLeftSlot" type="number" min="0" max="89"></label><label>Order page right slot<input id="spawnerOrderPageRightSlot" type="number" min="0" max="89"></label><label>Max order pages<input id="spawnerOrderMaxPages" type="number" min="1" max="100"></label><label>Human delay min (ms)<input id="spawnerOrderDelayMin" type="number" min="100" max="10000"></label><label>Human delay max (ms)<input id="spawnerOrderDelayMax" type="number" min="100" max="10000"></label><label class="inline-check"><input id="spawnerOrderAutoDetect" type="checkbox"> Auto-detect highest order and whole inventory</label>')
const spawnerGrid = document.querySelector('#spawnerMode').closest('.form-grid')
const importantSpawnerFields = new Set(['spawnerMode', 'spawnerDropItem', 'spawnerMin', 'spawnerMax', 'spawnerOrderEnabled'])
const spawnerAdvanced = document.createElement('details')
spawnerAdvanced.className = 'advanced-settings'
spawnerAdvanced.innerHTML = '<summary>Erweiterte Einstellungen</summary><p>Befehle, GUI-Erkennung, Slots, Zeitplan und Delays. Die Standardwerte passen zum bekannten HugoSMP-Aufbau.</p><div class="form-grid advanced-grid"></div>'
const spawnerAdvancedGrid = spawnerAdvanced.querySelector('.advanced-grid')
for (const label of [...spawnerGrid.children]) {
  const input = label.querySelector('input,select')
  if (!input || !importantSpawnerFields.has(input.id)) spawnerAdvancedGrid.append(label)
}
spawnerGrid.after(spawnerAdvanced)
document.querySelector('[data-view="macros"] .toolbar').insertAdjacentHTML('afterend', '<div id="macroTargets" class="panel macro-targets"><b>Apply to accounts</b><div id="macroTargetChecks" class="check-list horizontal"></div><button id="previewMacros" class="btn dark">Preview without clicks</button></div><pre id="macroPreview" class="panel preview-output hidden"></pre>')
document.querySelector('.danger-zone').insertAdjacentHTML('beforebegin', '<div class="panel"><div class="section-heading"><div><h2>AFK automation</h2><p>Join- und Weltwechselbefehle, natürliche Aktivität und geplante Chat-Nachrichten.</p></div><span class="section-badge">Per server</span></div><div class="form-grid"><label>Join command<input id="settingJoinCommand" maxlength="256" placeholder="/server survival"></label><label>World-change command<input id="settingWorldCommand" maxlength="256" placeholder="/server survival"></label><label>Chat timer message<input id="settingSpamMessage" maxlength="256" placeholder="/server survival"></label><label>Chat interval (sec)<input id="settingSpamInterval" type="number" min="10" max="86400"></label><label>Anti-AFK min (sec)<input id="settingAntiAfkMin" type="number" min="10" max="3600"></label><label>Anti-AFK max (sec)<input id="settingAntiAfkMax" type="number" min="10" max="3600"></label></div><div class="check-list horizontal"><label><input id="settingAntiAfk" type="checkbox"> Random anti-AFK activity</label><label><input id="settingSpamEnabled" type="checkbox"> Enable chat timer</label></div></div>')
document.querySelector('.danger-zone').insertAdjacentHTML('beforebegin', '<div class="panel"><div class="section-heading"><div><h2>System check</h2><p>Prüft die lokale Laufzeitkonfiguration, ohne Minecraft zu verbinden.</p></div><button id="runSystemCheck" class="btn dark">Check now</button></div><div id="systemCheckOutput" class="connection-health"><span class="health-chip">Noch nicht geprüft</span></div></div>')

async function api(path, options = {}) {
  let response
  try { response = await fetch(path, { headers: { 'content-type': 'application/json' }, ...options }) }
  catch { throw new Error('Dashboard-Server nicht erreichbar. Bitte den lokalen Server neu starten.') }
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`)
  return body
}

function toast(message, error = false) {
  const element = $('toast'); element.textContent = message; element.style.borderColor = error ? '#ff6672' : '#00db91'; element.classList.remove('hidden')
  clearTimeout(toast.timer); toast.timer = setTimeout(() => element.classList.add('hidden'), 3000)
}

async function boot() {
  const info = await api('/api/auth/info').catch(() => ({ totpRequired: false, role: null }))
  if (info.role) { sessionRole = info.role; sessionStorage.setItem('rcc-role', sessionRole) }
  try { showApp(await api('/api/state')) } catch { $('totpField').classList.toggle('hidden', !info.totpRequired); $('totp').required = info.totpRequired; $('login').classList.remove('hidden') }
}

function showApp(data) {
  $('login').classList.add('hidden'); $('app').classList.remove('hidden')
  const versionScript = document.createElement('script'); versionScript.src = '/app-version.js'; versionScript.onload = () => { if (window.RCC_VERSION) $('appVersion').textContent = window.RCC_VERSION }; document.head.append(versionScript)
  state = data.state; config = data.config
  logEntries = (data.logs || []).map((entry) => ({ ...entry, system: true, message: `[${entry.source}] ${entry.message}` }))
  renderConsole()
  renderState(); renderConfig();
  const requestedPage = location.hash.slice(1) || 'servers'
  showPage(document.querySelector(`[data-view="${requestedPage}"]`) ? requestedPage : 'servers')
  connectSocket()
}

function connectSocket() {
  socket?.close()
  socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`)
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data)
    if (message.type === 'initial') { state = message.state; config = message.config; renderState(); renderConfig() }
    if (message.type === 'state') { state = message.state; renderState() }
    if (message.type === 'log') addChat({ ...message.entry, message: `[${message.entry.source}] ${message.entry.message}` }, true)
    if (message.type === 'chat') addChat({ ...message.entry, level: 'chat' })
  }
  socket.onclose = () => setTimeout(connectSocket, 2500)
}

function showPage(name) {
  document.querySelectorAll('.page').forEach((page) => page.classList.toggle('hidden', page.dataset.view !== name))
  document.querySelectorAll('[data-page]').forEach((button) => button.classList.toggle('active', button.dataset.page === name))
  const label = (document.querySelector(`nav [data-page="${name}"]`)?.textContent.trim() || name).replace(/^[^A-Za-z0-9]+/, '')
  $('pageTitle').textContent = label
  $('app').classList.remove('nav-open')
  history.replaceState(null, '', `#${name}`)
}

function botSnapshots() { return state?.bots?.length ? state.bots : state ? [state] : [] }
function botForAccount(accountId) { return botSnapshots().find((bot) => (bot.accountId || 'primary') === accountId) || null }
function renderOperationalAccountSelectors() {
  const bots = botSnapshots()
  const validIds = new Set(config.accounts.map((account) => account.id))
  if (!activeControlAccountId || !validIds.has(activeControlAccountId)) activeControlAccountId = bots.find((bot) => bot.connection === 'online')?.accountId || state.accountId || config.accounts[0]?.id || null
  const signature = JSON.stringify(config.accounts.map((account) => ({ id: account.id, name: account.name, status: botForAccount(account.id)?.connection || 'offline', paused: account.paused })))
  const options = config.accounts.map((account) => {
    const bot = botForAccount(account.id)
    const status = account.paused ? 'Paused' : labelStatus(bot?.connection || 'offline')
    return `<option value="${escapeHtml(account.id)}">${escapeHtml(account.name)} · ${escapeHtml(status)}</option>`
  }).join('')
  document.querySelectorAll('.operational-account-select').forEach((select) => {
    if (select.dataset.signature !== signature) { select.innerHTML = options; select.dataset.signature = signature }
    select.value = activeControlAccountId || ''
    select.onchange = () => { activeControlAccountId = select.value; renderState() }
  })
}
function activeControlSnapshot() { return activeControlAccountId ? botForAccount(activeControlAccountId) || state : state }
function selectedMacroSnapshot() {
  const accountId = $('macroAccountSelect')?.value
  if (accountId === 'global') {
    const selectedTargets = [...document.querySelectorAll('.macro-target:checked')]
    if (selectedTargets.length === 1) return botForAccount(selectedTargets[0].value) || state
  }
  return accountId && accountId !== 'global' ? botForAccount(accountId) || state : state
}

function renderState() {
  if (!state) return
  const bots = botSnapshots()
  renderOperationalAccountSelectors()
  const operationalState = activeControlSnapshot()
  const online = operationalState.connection === 'online'
  const badge = $('connectionBadge'); badge.className = `status ${operationalState.connection}`; badge.textContent = labelStatus(operationalState.connection)
  const connectStatus = $('connectStatus'); if (connectStatus) { connectStatus.className = `status ${state.connection}`; connectStatus.textContent = labelStatus(state.connection) }
  const activeAccount = config.accounts.find((account) => account.id === activeControlAccountId)
  const name = operationalState.username || activeAccount?.name || activeAccount?.username || 'Microsoft Account'
  $('movementName').textContent = name
  $('profileCount').textContent = `${bots.filter((bot) => bot.connection === 'online').length}/${config?.accounts?.length || 1}`
  $('consoleConnection').textContent = labelStatus(operationalState.connection); $('consoleReconnects').textContent = operationalState.reconnectAttempt; $('consoleMemory').textContent = `${state.memoryMb} MB`
  const reconnectingBots = bots.filter((bot) => bot.connection === 'reconnecting' && bot.reconnectAt)
  const reconnectingBot = reconnectingBots.sort((left, right) => Date.parse(left.reconnectAt) - Date.parse(right.reconnectAt))[0] || null
  currentReconnectAccountId = reconnectingBot?.accountId || null
  $('reconnectPanel').classList.toggle('hidden', !reconnectingBot)
  $('reconnectCountdown').textContent = reconnectingBot ? `${Math.max(0, Math.ceil((Date.parse(reconnectingBot.reconnectAt) - Date.now()) / 1000))} s` : '—'
  if ($('reconnectAccountName')) {
    const reconnectAccount = config.accounts.find((item) => item.id === reconnectingBot?.accountId)
    $('reconnectAccountName').textContent = reconnectingBot ? `${reconnectAccount?.name || reconnectingBot.username || 'Account'}${reconnectingBots.length > 1 ? ` (+${reconnectingBots.length - 1})` : ''}` : '—'
  }
  const transition = operationalState.worldTransition || { state: 'stable', message: '' }
  const worldLoading = online && transition.state !== 'stable'
  $('worldLoadingPanel').classList.toggle('hidden', !worldLoading)
  if (worldLoading) $('worldLoadingText').textContent = `${transition.message || 'Neue Welt wird geladen'} · Steuerung und Makros pausiert`
  const authBot = bots.find((bot) => bot.authCode) || (state.authCode ? state : null)
  const auth = authBot?.authCode
  $('authPanel').classList.toggle('hidden', !auth)
  currentAuthAccountId = authBot?.accountId || null
  if (auth) { const account = config.accounts.find((item) => item.id === authBot.accountId); $('authAccountName').textContent = account?.name || authBot.username || 'Account'; $('authCode').textContent = auth.userCode; $('authLink').href = auth.verificationUri; $('authExpires').textContent = formatDuration(Math.max(0, Math.ceil((Date.parse(auth.expiresAt) - Date.now()) / 1000))) }
  $('serverNotice').classList.toggle('hidden', !operationalState.serverNotice)
  if (operationalState.serverNotice) { $('serverNoticeTitle').textContent = operationalState.serverNotice.type === 'restart' ? 'Serverneustart erkannt' : 'Wartung erkannt'; $('serverNoticeText').textContent = operationalState.serverNotice.message }
  $('connect').disabled = bots.every((bot) => bot.connection !== 'offline')
  $('stop').disabled = bots.every((bot) => bot.connection === 'offline')
  const macroSnapshot = selectedMacroSnapshot() || state
  const sellRuntime = macroSnapshot.sell || state.sell
  const spawnerRuntime = macroSnapshot.spawner || state.spawner
  $('sellPhase').textContent = sellRuntime.phase; $('spawnerPhase').textContent = spawnerRuntime.phase
  $('sellRuns').textContent = sellRuntime.runs; $('sellSuccess').textContent = sellRuntime.successes; $('spawnerSuccess').textContent = spawnerRuntime.successes
  $('spawnerRuns').textContent = spawnerRuntime.runs
  $('sellRuntime').textContent = sellRuntime.startedAt ? formatDuration(Math.floor((Date.now() - Date.parse(sellRuntime.startedAt)) / 1000)) : '—'
  $('spawnerRuntime').textContent = spawnerRuntime.startedAt ? formatDuration(Math.floor((Date.now() - Date.parse(spawnerRuntime.startedAt)) / 1000)) : '—'
  $('sellError').textContent = sellRuntime.error || ''; $('spawnerError').textContent = spawnerRuntime.error || ''
  $('nextRun').textContent = spawnerRuntime.nextRun ? new Date(spawnerRuntime.nextRun).toLocaleString('de-DE', { day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'
  const selectedMacroTargets = [...document.querySelectorAll('.macro-target:checked')].map((input) => botForAccount(input.value)).filter(Boolean)
  const runnableMacroTargets = selectedMacroTargets.length ? selectedMacroTargets : $('macroAccountSelect').value === 'global' ? [] : [macroSnapshot]
  const hasOnlineMacroTarget = runnableMacroTargets.some((bot) => bot?.connection === 'online')
  $('sellNow').disabled = !hasOnlineMacroTarget || !$('sellEnabled').checked; $('spawnerNow').disabled = !hasOnlineMacroTarget || !$('spawnerEnabled').checked
  $('sneakToggle').checked = operationalState.sneak; $('movementSneak').textContent = String(operationalState.sneak)
  $('health').textContent = operationalState.health ?? '—'; $('food').textContent = operationalState.food ?? '—'
  $('coordinates').textContent = operationalState.position ? `x${operationalState.position.x}, y${operationalState.position.y}, z${operationalState.position.z}` : '—'
  $('arrowGuard').classList.toggle('blocked', spawnerRuntime.phase === 'ARROW_FILTER_ABORT')
  const locked = Boolean(operationalState.controlLock?.locked)
  $('controlLockBanner').classList.toggle('hidden', !locked)
  $('controlLockReason').textContent = operationalState.controlLock?.reason || ''
  document.querySelectorAll('[data-view="movement"] .control-grid button, [data-view="movement"] .control-grid input, [data-view="movement"] .control-grid select').forEach((element) => { element.disabled = !online || locked })
  renderDiagnostics()
  renderInventory()
  $('useInventory').disabled = !online || locked
  document.querySelectorAll('[data-view="inventory"] .slot, [data-view="pov"] .slot').forEach((element) => { element.disabled = !online || locked })
  $('chatInput').disabled = !online
  $('chatForm').querySelector('button').disabled = !online
  renderProfiles()
  renderPovBots()
}

let povSortAscending = true
function renderPovBots() {
  const grid = $('povBotGrid'); if (!grid || !config) return
  const query = ($('povSearch')?.value || '').trim().toLowerCase()
  const bots = botSnapshots().map((bot) => ({ bot, account: config.accounts.find((account) => account.id === bot.accountId) })).filter(({ account, bot }) => !query || (account?.name || bot.username || '').toLowerCase().includes(query)).sort((left, right) => { const a = left.account?.name || left.bot.username || ''; const b = right.account?.name || right.bot.username || ''; return povSortAscending ? a.localeCompare(b) : b.localeCompare(a) })
  grid.replaceChildren(...bots.map(({ bot, account }) => { const card = document.createElement('article'); const accountId = bot.accountId || 'primary'; const name = account?.name || bot.username || 'Primary account'; const status = bot.connection || 'offline'; card.className = 'pov-bot-card'; card.innerHTML = `<div class="pov-card-header"><span class="drag-handle">⠿</span><span class="player-head">${escapeHtml(name.slice(0, 1).toUpperCase())}</span><span class="pov-card-name">${escapeHtml(name)}</span><span class="pov-card-status ${status}">${escapeHtml(labelStatus(status))}</span><button class="icon-button pov-fullscreen" title="Fullscreen">↗</button></div><div class="pov-card-screen"><iframe title="${escapeHtml(name)} live POV" allow="fullscreen" src="/pov-viewer/?viewer=3&accountId=${encodeURIComponent(accountId)}"></iframe>${status !== 'online' ? `<div class="pov-card-overlay">${status === 'connecting' ? 'Connecting…' : 'Connect'}</div>` : ''}</div>`; card.querySelector('.pov-fullscreen').onclick = () => card.requestFullscreen?.(); return card }))
}
$('povSearch')?.addEventListener('input', renderPovBots)
$('povSort')?.addEventListener('click', () => { povSortAscending = !povSortAscending; renderPovBots() })

function renderDiagnostics() {
  const bots = state.bots?.length ? state.bots : [state]
  const select = $('diagnosticAccount'); const previous = select.value
  select.innerHTML = bots.map((bot) => { const account = config.accounts.find((item) => item.id === bot.accountId); return `<option value="${escapeHtml(bot.accountId || 'primary')}">${escapeHtml(account?.name || bot.username || 'Primary account')}</option>` }).join('')
  select.value = bots.some((bot) => (bot.accountId || 'primary') === previous) ? previous : (bots[0]?.accountId || 'primary')
  const bot = bots.find((item) => (item.accountId || 'primary') === select.value) || bots[0]
  if (!bot) return
  const transition = bot.worldTransition || { state: 'stable', message: 'Bereit' }
  const lock = bot.controlLock || { locked: false, reason: null }
  $('connectionHealth').innerHTML = `<span class="health-chip">Status: <b>${escapeHtml(labelStatus(bot.connection))}</b></span><span class="health-chip">Welt: <b>${escapeHtml(transition.message)}</b></span><span class="health-chip ${lock.locked ? 'locked' : ''}">Steuerung: <b>${escapeHtml(lock.locked ? lock.reason : 'frei')}</b></span>`
  const entries = [...(bot.diagnostics || [])].reverse()
  $('diagnosticTimeline').innerHTML = entries.length ? entries.map((entry) => `<div class="diagnostic-entry ${escapeHtml(entry.status)}"><time>${new Date(entry.at).toLocaleTimeString('de-DE')}</time><b>${escapeHtml(entry.stage)}</b><span>${escapeHtml(entry.message)}</span></div>`).join('') : '<div class="empty-row">Noch keine Diagnoseereignisse.</div>'
}

function connectionFromProfiles(servers = config.servers, accounts = config.accounts, base = config.connection) {
  const server = servers[0]
  const account = accounts[0]
  if (!server || !account) return { ...base }
  return {
    ...base,
    profileName: server.name,
    host: server.host,
    port: server.port,
    version: server.version,
    username: account.username,
    autoConnect: account.autoConnect,
    reconnectEnabled: account.reconnectEnabled,
    reconnectDelaysSeconds: [...account.reconnectDelaysSeconds],
    autoGuiJoinEnabled: server.autoGuiJoinEnabled,
    autoGuiJoinTitleIncludes: server.autoGuiJoinTitleIncludes,
    autoGuiJoinSlot: server.autoGuiJoinSlot,
    autoGuiJoinDelayMs: server.autoGuiJoinDelayMs,
    joinCommand: server.joinCommand,
    worldChangeCommand: server.worldChangeCommand,
    antiAfkEnabled: server.antiAfkEnabled,
    antiAfkMinSeconds: server.antiAfkMinSeconds,
    antiAfkMaxSeconds: server.antiAfkMaxSeconds,
    spamEnabled: server.spamEnabled,
    spamMessage: server.spamMessage,
    spamIntervalSeconds: server.spamIntervalSeconds
  }
}

function renderConfig() {
  if (!config) return
  const connection = connectionFromProfiles(); const webhook = config.webhook
  const macroSelect = $('macroAccountSelect'); const selectedId = macroSelect.value || 'global'; macroSelect.innerHTML = '<option value="global">Global defaults</option>' + config.accounts.map((account) => `<option value="${escapeHtml(account.id)}">${escapeHtml(account.name)}</option>`).join(''); macroSelect.value = config.accounts.some((account) => account.id === selectedId) ? selectedId : 'global'
  const selectedAccount = config.accounts.find((account) => account.id === macroSelect.value)
  const sell = selectedAccount?.sell || config.sell; const spawner = selectedAccount?.spawner || config.spawner
  $('profileName').textContent = connection.profileName
  if ($('serverCardName')) $('serverCardName').textContent = connection.profileName
  if ($('serverCardAddress')) $('serverCardAddress').textContent = `${connection.host}:${connection.port}`
  $('settingProfileName').value = connection.profileName
  $('settingHost').value = connection.host
  $('settingVersion').value = connection.version
  $('settingPort').value = connection.port
  $('settingUsername').value = connection.username
  $('settingAutoConnect').checked = connection.autoConnect
  $('settingJoinCommand').value = connection.joinCommand || ''
  $('settingWorldCommand').value = connection.worldChangeCommand || ''
  $('settingAntiAfk').checked = Boolean(connection.antiAfkEnabled)
  $('settingAntiAfkMin').value = connection.antiAfkMinSeconds
  $('settingAntiAfkMax').value = connection.antiAfkMaxSeconds
  $('settingSpamEnabled').checked = Boolean(connection.spamEnabled)
  $('settingSpamMessage').value = connection.spamMessage || ''
  $('settingSpamInterval').value = connection.spamIntervalSeconds
  $('sellEnabled').checked = sell.enabled; $('spawnerEnabled').checked = spawner.enabled
  $('sellCommand').value = sell.command; $('sellFillDelay').value = sell.fillDelayMs; $('sellConfirmDelay').value = sell.confirmDelayMs
  $('sellPauseMin').value = sell.minPauseMs; $('sellPauseMax').value = sell.maxPauseMs; $('sellScheduleStart').value = sell.scheduleStart; $('sellScheduleEnd').value = sell.scheduleEnd
  $('sellGuiTitle').value = sell.guiTitleIncludes; $('sellContentLastSlot').value = sell.contentLastSlot; $('sellConfirmSlot').value = sell.confirmSlot
  $('sellExcludeHotbar').checked = sell.excludeHotbar; $('sellOnlyFull').checked = sell.onlyFullStacks; $('sellConfirmPartial').checked = sell.confirmPartial; $('sellAutoReopen').checked = sell.autoReopen; $('sellShiftClick').checked = sell.useShiftClick
  $('spawnerMode').value = spawner.mode; $('spawnerClickDelay').value = spawner.clickDelayMs; $('spawnerDropItem').value = spawner.dropItemNames?.[0] || 'bone'; $('spawnerMin').value = spawner.minIntervalMinutes; $('spawnerMax').value = spawner.maxIntervalMinutes
  $('spawnerDropAllSlot').value = spawner.dropAllSlot; $('spawnerSellAllSlot').value = spawner.sellAllSlot; $('spawnerPageLeftSlot').value = spawner.pageLeftSlot; $('spawnerPageRightSlot').value = spawner.pageRightSlot; $('spawnerScheduleStart').value = spawner.scheduleStart; $('spawnerScheduleEnd').value = spawner.scheduleEnd
  $('spawnerHomeTop').value = spawner.homeTopCommand; $('spawnerHomeBottom').value = spawner.homeBottomCommand; $('spawnerHomeAfk').value = spawner.afkHomeCommand; $('spawnerMovementMs').value = spawner.movementStepMs; $('spawnerAutoDetect').checked = spawner.autoDetectSlots
  $('spawnerOrderEnabled').checked = spawner.orderEnabled; $('spawnerOrderCommand').value = spawner.orderCommand; $('spawnerOrderTitle').value = spawner.orderGuiTitleIncludes; $('spawnerOrderDeliverTitle').value = spawner.orderDeliverGuiTitleIncludes; $('spawnerOrderHighestSlot').value = spawner.orderHighestSlot; $('spawnerOrderDeliverSlot').value = spawner.orderDeliverAllSlot; $('spawnerOrderContentLastSlot').value = spawner.orderContentLastSlot; $('spawnerOrderPageLeftSlot').value = spawner.orderPageLeftSlot; $('spawnerOrderPageRightSlot').value = spawner.orderPageRightSlot; $('spawnerOrderMaxPages').value = spawner.orderMaxPages; $('spawnerOrderDelayMin').value = spawner.orderMinDelayMs; $('spawnerOrderDelayMax').value = spawner.orderMaxDelayMs; $('spawnerOrderAutoDetect').checked = spawner.orderAutoDetect
  $('spawnerSkeletonFilter').checked = spawner.skeletonFilter; $('spawnerArrowAbort').checked = spawner.arrowAbort
  $('webhookEnabled').checked = webhook.enabled; $('webhookUsername').value = webhook.username; $('webhookUrl').value = ''
  $('webhookUrl').placeholder = webhook.url === 'configured' ? 'Configured ••••••••••••' : 'https://discord.com/api/webhooks/...'
  $('notifyConnect').checked = webhook.notifyConnect; $('notifyDisconnect').checked = webhook.notifyDisconnect; $('notifyKick').checked = webhook.notifyKick; $('notifySuccess').checked = webhook.notifyMacroSuccess; $('notifyError').checked = webhook.notifyMacroError; $('notifyArrow').checked = webhook.notifyArrowAbort
  $('webhookState').textContent = webhook.url === 'configured' ? 'Configured' : 'Not configured'
  const selectedTargets = new Set([...document.querySelectorAll('.macro-target:checked')].map((input) => input.value))
  $('macroTargetChecks').innerHTML = config.accounts.map((account) => `<label><input class="macro-target" type="checkbox" value="${escapeHtml(account.id)}" ${selectedTargets.has(account.id) ? 'checked' : ''}> ${escapeHtml(account.name)}</label>`).join('')
  document.querySelectorAll('.macro-target').forEach((input) => { input.onchange = renderState })
  renderProfiles()
}

function renderProfiles() {
  if (!config || !state) return
  const botMap = new Map((state.bots || [state]).map((bot) => [bot.accountId || 'primary', bot]))
  const signature = JSON.stringify({ servers: config.servers, proxies: config.proxies, accounts: config.accounts, bots: [...botMap].map(([id, bot]) => ({ id, connection: bot.connection, authenticated: bot.authenticated, authenticating: bot.authenticating, hasAuthCode: Boolean(bot.authCode), authExpiresAt: bot.authExpiresAt, paused: bot.paused, lastError: bot.lastError, worldTransition: bot.worldTransition?.state, controlLocked: bot.controlLock?.locked })) })
  if (signature === lastProfilesSignature) return
  lastProfilesSignature = signature
  if ($('serversTable')) {
    $('serversTable').innerHTML = ''
    config.servers.forEach((server) => {
      const users = config.accounts.filter((account) => account.serverId === server.id)
      const onlineCount = users.filter((account) => botMap.get(account.id)?.connection === 'online').length
      const row = document.createElement('tr')
      row.innerHTML = `<td><span class="server-gem">${escapeHtml(server.name.slice(0, 1).toUpperCase())}</span></td><td><b>${escapeHtml(server.name)}</b></td><td><span class="status ${onlineCount ? 'online' : 'offline'}">${onlineCount}/${users.length}</span></td><td>${users.length}</td><td><code>${escapeHtml(server.host)}:${server.port}</code></td><td>${escapeHtml(server.version)}</td><td><div class="row-actions"><button class="btn dark open-server">Open</button><button class="btn dark test-server">Test</button><button class="btn dark edit-profile">Edit</button><button class="btn red delete-profile">Delete</button></div></td>`
      row.querySelector('.open-server').onclick = () => showPage('connect')
      row.querySelector('.test-server').onclick = async () => { try { const result = await api('/api/server/test', { method: 'POST', body: JSON.stringify({ serverId: server.id }) }); toast(`Server erreichbar · ${result.latencyMs} ms · kein Minecraft-Login`) } catch (error) { toast(error.message, true) } }
      row.querySelector('.edit-profile').onclick = () => openProfileDialog('server', server)
      row.querySelector('.delete-profile').onclick = () => deleteServerProfile(server)
      $('serversTable').append(row)
    })
  }
  if ($('accountsTable')) {
    $('accountsTable').innerHTML = ''
    config.accounts.forEach((account) => {
      const bot = botMap.get(account.id); const status = bot?.connection || 'offline'
      const serverOptions = config.servers.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === account.serverId ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('')
      const proxyOptions = `<option value="">Direct</option>` + config.proxies.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === account.proxyId ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('')
      const row = document.createElement('tr')
      const tokenWarning = bot?.authExpiresAt && Date.parse(bot.authExpiresAt) - Date.now() < 900_000 ? '<small class="token-warning">Token renewal soon</small>' : ''
      const connectionAction = bot?.authenticating ? 'Microsoft Login läuft …' : bot?.connection === 'online' ? 'Reconnect' : bot?.authenticated ? 'Connect' : 'Microsoft Login'
      const connectionError = bot?.lastError ? `<small class="connection-error">${escapeHtml(bot.lastError)}</small>` : ''
      const loginDisabledReason = account.paused ? 'Pausierte Accounts müssen zuerst fortgesetzt werden' : bot?.authenticating ? 'Microsoft-Anmeldung läuft bereits' : ['connecting', 'reconnecting'].includes(status) ? 'Verbindungsaufbau läuft bereits' : ''
      const emailHidden = hiddenEmailAccountIds.has(account.id)
      const visibleEmail = account.username || 'Not configured'
      row.innerHTML = `<td><span class="player-head">${escapeHtml(account.name.slice(0, 1).toUpperCase())}</span></td><td><b>${escapeHtml(account.name)}</b><span class="email-visibility"><small class="account-email">${escapeHtml(emailHidden ? maskedEmail(visibleEmail) : visibleEmail)}</small><button type="button" class="email-toggle" aria-pressed="${emailHidden}" title="E-Mail ${emailHidden ? 'einblenden' : 'ausblenden'}">${emailHidden ? 'Einblenden' : 'Ausblenden'}</button></span></td><td><select class="server-assignment">${serverOptions}</select></td><td><select class="proxy-assignment">${proxyOptions}</select></td><td><span class="status ${account.paused ? 'offline' : status}">${account.paused ? 'Paused' : labelStatus(status)}</span>${connectionError}</td><td><span class="status ${bot?.authenticated ? 'online' : bot?.authenticating ? 'connecting' : 'offline'}">${bot?.authenticated ? 'Signed in' : bot?.authenticating ? 'Waiting for Microsoft' : 'Login required'}</span>${tokenWarning}</td><td><div class="reconnect-rule"><label><input class="reconnect-enabled" type="checkbox" ${account.reconnectEnabled ? 'checked' : ''}> Auto reconnect</label><input class="reconnect-delays" value="${escapeHtml(account.reconnectDelaysSeconds.join(','))}" title="Seconds, comma separated"></div><div class="account-actions"><button class="btn dark account-edit">Edit</button><button class="btn dark account-pause">${account.paused ? 'Resume' : 'Pause'}</button><button class="btn green account-login" ${loginDisabledReason ? `disabled title="${escapeHtml(loginDisabledReason)}"` : ''}>${connectionAction}</button><button class="btn dark account-logout" ${bot?.authenticated && !bot?.authenticating ? '' : 'disabled'}>Logout</button><button class="btn red account-delete" ${config.accounts.length <= 1 ? 'disabled title="Der letzte Account kann nicht gelöscht werden"' : ''}>Delete</button></div></td>`
      row.querySelector('.email-toggle').onclick = (event) => {
        const hidden = !hiddenEmailAccountIds.has(account.id)
        setEmailHidden(account.id, hidden)
        row.querySelector('.account-email').textContent = hidden ? maskedEmail(visibleEmail) : visibleEmail
        event.currentTarget.textContent = hidden ? 'Einblenden' : 'Ausblenden'
        event.currentTarget.title = `E-Mail ${hidden ? 'einblenden' : 'ausblenden'}`
        event.currentTarget.setAttribute('aria-pressed', String(hidden))
      }
      row.querySelector('.server-assignment').onchange = (event) => switchAccountConnection(account.id, { serverId: event.target.value }, bot?.connection === 'online', 'Serverprofil')
      row.querySelector('.proxy-assignment').onchange = (event) => switchAccountConnection(account.id, { proxyId: event.target.value || null }, bot?.connection === 'online', 'Proxyprofil')
      row.querySelector('.account-login').onclick = () => bot?.authenticated ? connectAccounts([account.id], bot.connection === 'online') : loginMicrosoftAccount(account.id)
      row.querySelector('.account-edit').onclick = () => openProfileDialog('account', account)
      row.querySelector('.account-pause').onclick = () => pauseAccount(account.id, !account.paused)
      row.querySelector('.reconnect-enabled').onchange = (event) => updateAccount(account.id, { reconnectEnabled: event.target.checked })
      row.querySelector('.reconnect-delays').onchange = (event) => { const delays = event.target.value.split(',').map(Number).filter((value) => Number.isFinite(value) && value > 0); updateAccount(account.id, { reconnectDelaysSeconds: delays }) }
      row.querySelector('.account-logout').onclick = () => logoutMicrosoftAccount(account.id, account.name)
      row.querySelector('.account-delete').onclick = () => deleteAccount(account.id, account.name)
      $('accountsTable').append(row)
    })
  }
  if ($('connectAccounts')) {
    const validAccountIds = new Set(config.accounts.map((account) => account.id))
    if (selectedConnectAccountIds === null) selectedConnectAccountIds = new Set(config.accounts.filter((account) => !account.paused).map((account) => account.id))
    else selectedConnectAccountIds = new Set([...selectedConnectAccountIds].filter((id) => validAccountIds.has(id) && !config.accounts.find((account) => account.id === id)?.paused))
    $('connectAccounts').innerHTML = ''
    config.accounts.forEach((account) => {
      const bot = botMap.get(account.id); const server = config.servers.find((item) => item.id === account.serverId); const proxy = config.proxies.find((item) => item.id === account.proxyId); const status = bot?.connection || 'offline'; const row = document.createElement('tr')
      const selected = selectedConnectAccountIds.has(account.id) && !account.paused
      row.innerHTML = `<td><span class="player-head">${escapeHtml(account.name.slice(0, 1).toUpperCase())}</span></td><td><b>${escapeHtml(account.name)}</b>${account.paused ? '<small class="block token-warning">Paused</small>' : ''}</td><td><span class="status ${account.paused ? 'offline' : status}">${account.paused ? 'Paused' : labelStatus(status)}</span></td><td>${escapeHtml(server?.name || 'Missing')}</td><td>${escapeHtml(proxy?.name || 'Direct')}</td><td>${account.sell || account.spawner ? 'Individual' : 'Global'}</td><td><input class="account-select" data-account-id="${escapeHtml(account.id)}" type="checkbox" ${selected ? 'checked' : ''} ${account.paused ? 'disabled title="Account ist pausiert"' : ''}></td>`
      row.querySelector('.account-select').onchange = (event) => { if (event.target.checked) selectedConnectAccountIds.add(account.id); else selectedConnectAccountIds.delete(account.id) }
      $('connectAccounts').append(row)
    })
  }
  if ($('proxyCards')) {
    $('proxyCards').innerHTML = config.proxies.length ? '' : '<div class="panel placeholder"><h2>No proxies configured</h2><p>Accounts connect directly through the current host runtime.</p></div>'
    config.proxies.forEach((proxy) => { const card = document.createElement('div'); card.className = 'server-card'; card.innerHTML = `<span class="server-gem large">P</span><div><b>${escapeHtml(proxy.name)}</b><small>${escapeHtml(proxy.host)}:${proxy.port}</small></div><div class="card-actions"><button class="btn dark test-proxy">Test</button><button class="btn dark edit-profile">Edit</button><button class="btn red delete-profile">Delete</button></div>`; card.querySelector('.test-proxy').onclick = async () => { try { const result = await api('/api/proxy/test', { method: 'POST', body: JSON.stringify({ proxyId: proxy.id, serverId: config.servers[0].id }) }); toast(`Proxy OK · ${result.latencyMs} ms`) } catch (error) { toast(error.message, true) } }; card.querySelector('.edit-profile').onclick = () => openProfileDialog('proxy', proxy); card.querySelector('.delete-profile').onclick = () => deleteProxyProfile(proxy); $('proxyCards').append(card) })
  }
  reapplyFilters()
}

function renderInventory() {
  if (!state) return
  const snapshot = activeControlSnapshot()
  const bySlot = new Map((snapshot.inventory || []).map((item) => [item.slot, item]))
  fillSlots($('inventoryGrid'), Array.from({ length: 27 }, (_, i) => i + 9), bySlot)
  fillSlots($('hotbar'), Array.from({ length: 9 }, (_, i) => i + 36), bySlot)
}

function fillSlots(container, slots, bySlot) {
  container.innerHTML = ''
  slots.forEach((slot, index) => {
    const item = bySlot.get(slot); const element = document.createElement('button'); element.className = `slot ${index === 0 && slots.length === 9 ? 'hot-selected' : ''}`
    element.title = item ? `${item.displayName} · ${item.name} · Slot ${slot}` : `Empty · Slot ${slot}`
    if (item) element.innerHTML = `<b>${escapeHtml(item.displayName)}</b><span>${item.count}</span>`
    if (slots.length === 9) element.onclick = () => {
      const mode = $('inventoryActionMode')?.value || 'inspect'
      if (mode === 'drop-one' || mode === 'drop-stack') {
        if (!item) return toast('Dieser Slot ist leer', true)
        if (mode === 'drop-stack' && !confirm(`${item.count}× ${item.displayName} wirklich droppen?`)) return
        return control({ action: 'dropSlot', slot, stack: mode === 'drop-stack' })
      }
      return control({ action: 'hotbar', slot: index })
    }
    else element.onclick = async () => {
      const mode = $('inventoryActionMode').value
      if (mode === 'inspect') return toast(item ? `${item.displayName} · ${item.count} · Slot ${slot}` : `Slot ${slot} ist leer`)
      if (!item) return toast('Dieser Slot ist leer', true)
      if (mode === 'drop-stack' && !confirm(`${item.count}× ${item.displayName} wirklich droppen?`)) return
      if (mode === 'shift') return control({ action: 'inventoryClick', slot, shift: true })
      if (mode === 'offhand') return control({ action: 'offhand', slot })
      return control({ action: 'dropSlot', slot, stack: mode === 'drop-stack' })
    }
    container.append(element)
  })
}

function escapeHtml(value) { const div = document.createElement('div'); div.textContent = value; return div.innerHTML }
function labelStatus(value) { return ({ online: 'Online', connecting: 'Connecting', reconnecting: 'Reconnecting', offline: 'Offline' })[value] || value }
function formatDuration(seconds) { const s = Math.max(0, Number(seconds) || 0); const h = Math.floor(s / 3600); const m = Math.floor(s % 3600 / 60); return h ? `${h}h ${m}m` : `${m}m ${s % 60}s` }
function addChat(entry, system = false) { logEntries.push({ ...entry, system }); if (logEntries.length > 500) logEntries.shift(); renderConsole() }
function renderConsole() { if (!$('chat')) return; const filter = $('logFilter')?.value || 'all'; const accountId = $('chatAccountSelect')?.value; const account = config?.accounts?.find((item) => item.id === accountId); const visible = logEntries.filter((entry) => (!accountId || entry.accountId === accountId || (!entry.accountId && account && entry.message.includes(`[${account.name}/`))) && (filter === 'all' || (filter === 'chat' ? !entry.system : ['warn', 'error'].includes(entry.level)))); $('chat').innerHTML = ''; visible.forEach((entry) => { const row = document.createElement('p'); row.className = `log-${entry.level || 'info'}`; row.textContent = `${new Date(entry.at).toLocaleTimeString('de-DE')} ${entry.system ? 'SYSTEM ' : ''}${entry.message}`; $('chat').append(row) }); $('chat').scrollTop = $('chat').scrollHeight }
async function control(body) { try { await api('/api/bot/control', { method: 'POST', body: JSON.stringify({ ...body, accountId: activeControlAccountId }) }) } catch (error) { toast(error.message, true) } }
$('runSystemCheck').onclick = async () => { try { const result = await api('/api/system-check'); const labels = { nodeVersion: 'Node', provider: 'Runtime', dataDirConfigured: 'Data dir', dataWritable: 'Writable', autoConnectAllowed: 'Auto-connect', sessionSecretConfigured: 'Session secret', encryptionKeyDedicated: 'Encryption key' }; $('systemCheckOutput').innerHTML = Object.entries(result).map(([key, value]) => `<span class="health-chip ${value === false ? 'locked' : ''}">${escapeHtml(labels[key] || key)}: <b>${escapeHtml(String(value))}</b></span>`).join('') } catch (error) { toast(error.message, true) } }
$('takeOver').onclick = async () => { try { await api('/api/bot/take-over', { method: 'POST', body: JSON.stringify({ accountId: activeControlAccountId }) }); toast('Makro beendet · manuelle Steuerung frei') } catch (error) { toast(error.message, true) } }
$('chatAccountSelect').addEventListener('change', renderConsole)
$('diagnosticAccount').onchange = renderDiagnostics
$('copyDiagnostics').onclick = async () => {
  const bots = state.bots?.length ? state.bots : [state]
  const bot = bots.find((item) => (item.accountId || 'primary') === $('diagnosticAccount').value) || bots[0]
  const account = config.accounts.find((item) => item.id === bot?.accountId)
  const report = [`RCC Diagnose · ${account?.name || bot?.username || 'Account'}`, `Status: ${bot?.connection}`, `Server: ${bot?.server}`, `Welt: ${bot?.worldTransition?.message || 'unbekannt'}`, `Steuerung: ${bot?.controlLock?.locked ? bot.controlLock.reason : 'frei'}`, '', ...(bot?.diagnostics || []).map((entry) => `${entry.at} [${entry.status.toUpperCase()}] ${entry.stage}: ${entry.message}`)].join('\n')
  try { await navigator.clipboard.writeText(report); toast('Diagnose kopiert') } catch { toast('Kopieren wurde vom Browser blockiert', true) }
}
function selectedAccountIds() { return [...document.querySelectorAll('.account-select:checked:not(:disabled)')].map((input) => input.dataset.accountId) }
function selectedAccountsOrWarn() { const ids = selectedAccountIds(); if (!ids.length) { toast('Bitte mindestens einen Account auswählen.', true); return null } return ids }
function macroTargetIds(requireSelection = false) { const checked = [...document.querySelectorAll('.macro-target:checked')].map((input) => input.value); if (checked.length) return checked; const selected = $('macroAccountSelect').value; if (selected !== 'global') return [selected]; if (requireSelection) { toast('Bitte zuerst mindestens einen Makro-Account auswählen.', true); return null } return config.accounts.map((account) => account.id) }
function applyFilter(input) {
  const scope = input.closest('.table-panel') || input.closest('.page')
  if (!scope) return
  const query = input.value.trim().toLowerCase()
  scope.querySelectorAll('tbody tr,.server-card').forEach((row) => row.classList.toggle('hidden', !row.textContent.toLowerCase().includes(query)))
}
function reapplyFilters() { document.querySelectorAll('.filter').forEach(applyFilter) }
async function saveProfilePatch(patch) {
  const servers = patch.servers ?? config.servers
  const accounts = patch.accounts ?? config.accounts
  const normalizedPatch = { ...patch, connection: connectionFromProfiles(servers, accounts, { ...config.connection, ...(patch.connection || {}) }) }
  const result = await api('/api/settings', { method: 'PUT', body: JSON.stringify(normalizedPatch) }); config = result.config; renderConfig(); renderState()
}
async function updateAccount(id, patch) { try { await saveProfilePatch({ accounts: config.accounts.map((account) => account.id === id ? { ...account, ...patch } : account) }); toast('Account aktualisiert'); return true } catch (error) { toast(error.message, true); return false } }
async function switchAccountConnection(accountId, patch, wasOnline, label) {
  if (!await updateAccount(accountId, patch)) return
  toast(`${label} gespeichert${wasOnline ? ' · wird erst beim nächsten manuellen Connect verwendet' : ''}`)
}
function confirmLiveConnection(reconnect = false) { return confirm(`${reconnect ? 'Neu verbinden' : 'Verbinden'} stellt jetzt eine echte Verbindung zum ausgewählten Minecraft-Server her. Fortfahren?`) }
async function connectAccounts(accountIds, reconnect = false) {
  if (!confirmLiveConnection(reconnect)) return
  try {
    await api(reconnect ? '/api/bot/reconnect' : '/api/bot/connect', { method: 'POST', body: JSON.stringify({ accountIds }) })
    toast(reconnect ? 'Neuverbinden gestartet' : 'Verbindung gestartet')
  } catch (error) { toast(error.message, true) }
}
async function pauseAccount(accountId, paused) { try { const result = await api('/api/account/pause', { method: 'POST', body: JSON.stringify({ accountId, paused }) }); config = result.config; renderConfig(); renderState(); toast(paused ? 'Account pausiert' : 'Account fortgesetzt') } catch (error) { toast(error.message, true) } }
async function loginMicrosoftAccount(accountId) { try { await api('/api/account/login', { method: 'POST', body: JSON.stringify({ accountId }) }); showPage('connect'); toast('Neuer Microsoft-Code wird erstellt …') } catch (error) { toast(error.message, true) } }
async function logoutMicrosoftAccount(accountId, name) { if (!confirm(`Microsoft-Anmeldung für „${name}“ wirklich entfernen? Der OAuth-Token wird lokal gelöscht.`)) return; try { await api('/api/account/logout', { method: 'POST', body: JSON.stringify({ accountId }) }); toast('Microsoft-Anmeldung entfernt') } catch (error) { toast(error.message, true) } }
async function deleteAccount(accountId, name) { if (!confirm(`Account „${name}“ samt lokalem OAuth-Token wirklich löschen?`)) return; try { const result = await api('/api/account', { method: 'DELETE', body: JSON.stringify({ accountId }) }); config = result.config; await saveProfilePatch({ accounts: config.accounts }); toast('Account gelöscht') } catch (error) { toast(error.message, true) } }

document.querySelectorAll('[data-page]').forEach((button) => button.addEventListener('click', () => showPage(button.dataset.page)))
document.querySelectorAll('.configure-account,.configure-server').forEach((button) => button.addEventListener('click', () => showPage('settings')))
document.querySelector('.nav-label button').onclick = () => openProfileDialog('server')
document.querySelector('.profile').onclick = () => showPage('connect')
document.querySelectorAll('button').forEach((button) => {
  const label = button.textContent.trim()
  if (label === 'Import' || label === 'Import backup') button.onclick = () => $('importSettings').click()
})
document.querySelectorAll('.filter').forEach((input) => input.addEventListener('input', () => applyFilter(input)))
$('openNav').onclick = () => $('app').classList.add('nav-open'); $('closeNav').onclick = () => $('app').classList.remove('nav-open')
$('loginForm').addEventListener('submit', async (event) => { event.preventDefault(); try { const login = await api('/api/login', { method: 'POST', body: JSON.stringify({ password: $('password').value, totp: $('totp').value }) }); sessionRole = login.role || 'admin'; sessionStorage.setItem('rcc-role', sessionRole); showApp(await api('/api/state')) } catch (error) { $('loginError').textContent = error.message } })
$('logout').onclick = async () => { await api('/api/logout', { method: 'POST' }); sessionStorage.removeItem('rcc-role'); location.reload() }
$('connect').onclick = () => { const accountIds = selectedAccountsOrWarn(); if (accountIds) connectAccounts(accountIds) }
$('stop').onclick = () => { const accountIds = selectedAccountsOrWarn(); if (accountIds) api('/api/bot/stop', { method: 'POST', body: JSON.stringify({ accountIds }) }).catch((error) => toast(error.message, true)) }
$('settingsStop').onclick = () => { if (confirm('Alle verbundenen Bots trennen?')) api('/api/bot/stop', { method: 'POST', body: JSON.stringify({}) }).catch((error) => toast(error.message, true)) }
$('reconnect').onclick = () => { const accountIds = selectedAccountsOrWarn(); if (accountIds) connectAccounts(accountIds, true) }
$('cancelReconnect').onclick = () => {
  if (!currentReconnectAccountId) return toast('Kein aktiver Reconnect gefunden.', true)
  api('/api/bot/stop', { method: 'POST', body: JSON.stringify({ accountIds: [currentReconnectAccountId] }) }).then(() => toast('Reconnect für diesen Account abgebrochen')).catch((error) => toast(error.message, true))
}
$('copyAuthCode').onclick = async () => { try { await navigator.clipboard.writeText($('authCode').textContent); toast('Gerätecode kopiert') } catch { toast('Kopieren nicht möglich', true) } }
$('refreshAuthCode').onclick = () => currentAuthAccountId ? loginMicrosoftAccount(currentAuthAccountId) : toast('Account nicht gefunden', true)
$('logFilter').onchange = renderConsole
$('chatForm').addEventListener('submit', async (event) => { event.preventDefault(); try { await api('/api/bot/chat', { method: 'POST', body: JSON.stringify({ message: $('chatInput').value, accountId: activeControlAccountId }) }); $('chatInput').value = '' } catch (error) { toast(error.message, true) } })
$('moveBtn').onclick = () => control({ action: 'move', direction: $('moveDirection').value, blocks: Number($('moveBlocks').value) })
document.querySelectorAll('[data-look]').forEach((button) => button.onclick = () => { const [yaw, pitch] = button.dataset.look.split(',').map(Number); control({ action: 'look', yaw, pitch }) })
$('lookBtn').onclick = () => control({ action: 'look', yaw: Number($('yaw').value), pitch: Number($('pitch').value) })
$('sneakToggle').onchange = (event) => control({ action: 'sneak', enabled: event.target.checked })
$('jumpToggle').onchange = (event) => control({ action: 'jump', enabled: event.target.checked })
$('swingBtn').onclick = () => control({ action: 'swing' }); $('useBtn').onclick = $('useInventory').onclick = () => control({ action: 'use' })
$('sellNow').onclick = () => { const accountIds = macroTargetIds(true); if (accountIds) api('/api/macro/sell/run', { method: 'POST', body: JSON.stringify({ accountIds }) }).catch((error) => toast(error.message, true)) }
$('spawnerNow').onclick = () => { const accountIds = macroTargetIds(true); if (accountIds) api('/api/macro/spawner/run', { method: 'POST', body: JSON.stringify({ accountIds }) }).catch((error) => toast(error.message, true)) }
$('previewMacros').onclick = async () => { try { const accountIds = macroTargetIds(false); const result = await api('/api/macro/preview', { method: 'POST', body: JSON.stringify({ accountIds }) }); $('macroPreview').textContent = result.plans.map((plan) => `${plan.name} (${plan.online ? 'online' : 'offline'})\nSELL: ${plan.sell.join(' → ')}\nSPAWNER: ${plan.spawner.join(' → ')}`).join('\n\n'); $('macroPreview').classList.remove('hidden') } catch (error) { toast(error.message, true) } }
$('sellEnabled').onchange = () => saveMacros(); $('spawnerEnabled').onchange = () => saveMacros(); $('saveMacros').onclick = () => saveMacros(true)
$('macroAccountSelect').onchange = () => { renderConfig(); renderState() }

async function saveMacros(notify = false) {
  try {
    const sellChanges = { enabled: $('sellEnabled').checked, command: $('sellCommand').value, guiTitleIncludes: $('sellGuiTitle').value.trim(), contentLastSlot: Number($('sellContentLastSlot').value), confirmSlot: Number($('sellConfirmSlot').value), fillDelayMs: Number($('sellFillDelay').value), confirmDelayMs: Number($('sellConfirmDelay').value), minPauseMs: Number($('sellPauseMin').value), maxPauseMs: Number($('sellPauseMax').value), scheduleStart: $('sellScheduleStart').value, scheduleEnd: $('sellScheduleEnd').value, excludeHotbar: $('sellExcludeHotbar').checked, onlyFullStacks: $('sellOnlyFull').checked, confirmPartial: $('sellConfirmPartial').checked, autoReopen: $('sellAutoReopen').checked, useShiftClick: $('sellShiftClick').checked }
    const dropItem = $('spawnerDropItem').value.trim() || 'bone'
    const spawnerChanges = { enabled: $('spawnerEnabled').checked, mode: $('spawnerMode').value, clickDelayMs: Number($('spawnerClickDelay').value), dropAllSlot: Number($('spawnerDropAllSlot').value), sellAllSlot: Number($('spawnerSellAllSlot').value), pageLeftSlot: Number($('spawnerPageLeftSlot').value), pageRightSlot: Number($('spawnerPageRightSlot').value), minIntervalMinutes: Number($('spawnerMin').value), maxIntervalMinutes: Number($('spawnerMax').value), scheduleStart: $('spawnerScheduleStart').value, scheduleEnd: $('spawnerScheduleEnd').value, homeTopCommand: $('spawnerHomeTop').value.trim(), homeBottomCommand: $('spawnerHomeBottom').value.trim(), afkHomeCommand: $('spawnerHomeAfk').value.trim(), movementStepMs: Number($('spawnerMovementMs').value), autoDetectSlots: $('spawnerAutoDetect').checked, orderEnabled: $('spawnerOrderEnabled').checked, orderCommand: $('spawnerOrderCommand').value.trim(), orderGuiTitleIncludes: $('spawnerOrderTitle').value.trim(), orderDeliverGuiTitleIncludes: $('spawnerOrderDeliverTitle').value.trim(), orderHighestSlot: Number($('spawnerOrderHighestSlot').value), orderDeliverAllSlot: Number($('spawnerOrderDeliverSlot').value), orderContentLastSlot: Number($('spawnerOrderContentLastSlot').value), orderPageLeftSlot: Number($('spawnerOrderPageLeftSlot').value), orderPageRightSlot: Number($('spawnerOrderPageRightSlot').value), orderMaxPages: Number($('spawnerOrderMaxPages').value), orderMinDelayMs: Number($('spawnerOrderDelayMin').value), orderMaxDelayMs: Number($('spawnerOrderDelayMax').value), orderAutoDetect: $('spawnerOrderAutoDetect').checked, skeletonFilter: $('spawnerSkeletonFilter').checked, arrowAbort: $('spawnerArrowAbort').checked, dropItemNames: [dropItem, dropItem.startsWith('minecraft:') ? dropItem : `minecraft:${dropItem}`] }
    const selectedId = $('macroAccountSelect').value
    const bulkIds = new Set([...document.querySelectorAll('.macro-target:checked')].map((input) => input.value))
    const withMacroChanges = (account) => ({ ...account, sell: { ...(account.sell || config.sell), ...sellChanges }, spawner: { ...(account.spawner || config.spawner), ...spawnerChanges } })
    const patch = bulkIds.size
      ? { accounts: config.accounts.map((account) => bulkIds.has(account.id) ? withMacroChanges(account) : account) }
      : selectedId === 'global'
        ? { sell: { ...config.sell, ...sellChanges }, spawner: { ...config.spawner, ...spawnerChanges } }
        : { accounts: config.accounts.map((account) => account.id === selectedId ? withMacroChanges(account) : account) }
    const result = await api('/api/settings', { method: 'PUT', body: JSON.stringify(patch) }); config = result.config; renderConfig(); renderState(); if (notify) toast('Macro settings saved')
  } catch (error) { toast(error.message, true) }
}

$('addWebhook').onclick = () => $('webhookUrl').focus()
function openProfileDialog(type, item = null) {
  editingProfileId = item?.id || null; $('profileType').value = type; $('profileForm').reset(); $('profileType').value = type
  const account = type === 'account'; const proxy = type === 'proxy'; const server = type === 'server'
  $('profileDialogTitle').textContent = `${type === 'account' ? 'Account' : type === 'proxy' ? 'Proxy' : 'Server'} ${item ? 'bearbeiten' : 'hinzufügen'}`
  $('profileDialogHint').textContent = account ? 'Erhält einen eigenen OAuth-Ordner und eigene Makroeinstellungen.' : proxy ? 'HTTP-CONNECT-Proxy; Zugangsdaten werden verschlüsselt.' : 'Minecraft Java Serverprofil.'
  document.querySelectorAll('.profile-server-field').forEach((field) => field.classList.toggle('hidden', account))
  document.querySelectorAll('.profile-port-field').forEach((field) => field.classList.toggle('hidden', account))
  document.querySelectorAll('.profile-version-field').forEach((field) => field.classList.toggle('hidden', !server))
  document.querySelectorAll('.profile-account-field').forEach((field) => field.classList.toggle('hidden', !account))
  document.querySelectorAll('.profile-proxy-field').forEach((field) => field.classList.toggle('hidden', !proxy))
  document.querySelectorAll('.profile-auto-gui-field').forEach((field) => field.classList.toggle('hidden', !server))
  $('profileInputHost').required = server || proxy; $('profileInputPort').required = server || proxy; $('profileInputEmail').required = account
  $('profileInputPort').value = server ? '25565' : proxy ? '8080' : ''
  $('profileInputVersion').value = config.servers[0]?.version || config.connection.version
  $('profileAutoGuiSlot').value = '0'; $('profileAutoGuiDelay').value = '750'
  if (item) { $('profileInputName').value = item.name; $('profileInputHost').value = item.host || ''; $('profileInputPort').value = item.port || ''; $('profileInputVersion').value = item.version || config.servers[0]?.version || config.connection.version; $('profileInputEmail').value = account ? item.username || '' : ''; $('profileInputUser').value = proxy ? item.username || '' : ''; $('profileInputPassword').value = ''; $('profileAutoGuiEnabled').checked = Boolean(item.autoGuiJoinEnabled); $('profileAutoGuiTitle').value = item.autoGuiJoinTitleIncludes || ''; $('profileAutoGuiSlot').value = String(item.autoGuiJoinSlot ?? 0); $('profileAutoGuiDelay').value = String(item.autoGuiJoinDelayMs ?? 750) }
  $('profileDialog').showModal()
}
$('addServerProfile').onclick = () => openProfileDialog('server')
$('addAccountProfile').onclick = () => openProfileDialog('account')
$('addProxyProfile').onclick = () => openProfileDialog('proxy')
$('closeProfileDialog').onclick = $('cancelProfileDialog').onclick = () => $('profileDialog').close()
async function deleteServerProfile(server) { if (config.servers.length <= 1) return toast('Der letzte Server kann nicht gelöscht werden.', true); if (config.accounts.some((account) => account.serverId === server.id)) return toast('Server ist noch einem Account zugewiesen.', true); if (!confirm(`Server „${server.name}“ löschen?`)) return; try { await saveProfilePatch({ servers: config.servers.filter((item) => item.id !== server.id) }); toast('Server gelöscht') } catch (error) { toast(error.message, true) } }
async function deleteProxyProfile(proxy) { if (!confirm(`Proxy „${proxy.name}“ löschen und betroffene Accounts auf Direct stellen?`)) return; try { await saveProfilePatch({ proxies: config.proxies.filter((item) => item.id !== proxy.id), accounts: config.accounts.map((account) => account.proxyId === proxy.id ? { ...account, proxyId: null } : account) }); toast('Proxy gelöscht') } catch (error) { toast(error.message, true) } }
$('profileForm').onsubmit = async (event) => {
  event.preventDefault(); const type = $('profileType').value; const name = $('profileInputName').value.trim()
  try {
    if (type === 'server') { const item = { id: editingProfileId || `server-${Date.now()}`, name, host: $('profileInputHost').value.trim(), port: Number($('profileInputPort').value), version: $('profileInputVersion').value.trim(), autoGuiJoinEnabled: $('profileAutoGuiEnabled').checked, autoGuiJoinTitleIncludes: $('profileAutoGuiTitle').value.trim(), autoGuiJoinSlot: Number($('profileAutoGuiSlot').value), autoGuiJoinDelayMs: Number($('profileAutoGuiDelay').value) }; await saveProfilePatch({ servers: editingProfileId ? config.servers.map((server) => server.id === editingProfileId ? item : server) : [...config.servers, item] }) }
    if (type === 'account') {
      const email = $('profileInputEmail').value.trim(); const previous = config.accounts.find((account) => account.id === editingProfileId)
      if (previous && previous.username !== email && !confirm('Die E-Mail wurde geändert. Die bisherige Microsoft-Anmeldung wird dabei entfernt. Fortfahren?')) return
      if (previous && previous.username !== email) await api('/api/account/logout', { method: 'POST', body: JSON.stringify({ accountId: previous.id }) })
      const item = previous ? { ...previous, name, username: email } : { id: `account-${Date.now()}`, name, username: email, serverId: config.servers[0].id, proxyId: null, enabled: true, paused: false, autoConnect: false, reconnectEnabled: true, reconnectDelaysSeconds: [5, 15, 30, 60], sell: structuredClone(config.sell), spawner: structuredClone(config.spawner) }
      await saveProfilePatch({ accounts: previous ? config.accounts.map((account) => account.id === previous.id ? item : account) : [...config.accounts, item] })
    }
    if (type === 'proxy') { const previous = config.proxies.find((proxy) => proxy.id === editingProfileId); const item = { id: editingProfileId || `proxy-${Date.now()}`, name, host: $('profileInputHost').value.trim(), port: Number($('profileInputPort').value), username: $('profileInputUser').value.trim(), password: $('profileInputPassword').value || previous?.password || '' }; await saveProfilePatch({ proxies: editingProfileId ? config.proxies.map((proxy) => proxy.id === editingProfileId ? item : proxy) : [...config.proxies, item] }) }
    $('profileDialog').close(); editingProfileId = null; toast('Profil gespeichert')
  } catch (error) { toast(error.message, true) }
}
$('saveWebhook').onclick = async () => {
  try {
    const webhook = { ...config.webhook, enabled: $('webhookEnabled').checked, username: $('webhookUsername').value, notifyConnect: $('notifyConnect').checked, notifyDisconnect: $('notifyDisconnect').checked, notifyKick: $('notifyKick').checked, notifyMacroSuccess: $('notifySuccess').checked, notifyMacroError: $('notifyError').checked, notifyArrowAbort: $('notifyArrow').checked }
    if ($('webhookUrl').value.trim()) webhook.url = $('webhookUrl').value.trim()
    const result = await api('/api/settings', { method: 'PUT', body: JSON.stringify({ webhook }) }); config = result.config; renderConfig(); $('webhookMessage').textContent = 'Saved'; toast('Webhook saved')
  } catch (error) { $('webhookMessage').textContent = error.message }
}

function applyTheme(theme) { document.documentElement.dataset.theme = theme; localStorage.setItem('rcc-theme', theme) }
function toggleTheme() { applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark') }
$('themeToggle').onclick = $('settingsTheme').onclick = toggleTheme
applyTheme(localStorage.getItem('rcc-theme') || 'dark')
$('exportSettings').onclick = () => { const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `rcc-backup-${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(link.href) }
$('importSettings').onchange = async (event) => { try { if (!confirm('Das Backup überschreibt die aktuelle Konfiguration. Wirklich fortfahren?')) return; const imported = JSON.parse(await event.target.files[0].text()); const result = await api('/api/settings', { method: 'PUT', body: JSON.stringify(imported) }); config = result.config; renderConfig(); toast('Backup importiert') } catch (error) { toast(error.message, true) } finally { event.target.value = '' } }
$('emergencyStop').onclick = async () => { if (!confirm('Alle Bots trennen und sämtliche Makros sofort deaktivieren?')) return; try { const result = await api('/api/emergency-stop', { method: 'POST' }); config = result.config; renderConfig(); toast('Not-Aus ausgeführt') } catch (error) { toast(error.message, true) } }
$('testWebhook').onclick = async () => { try { await api('/api/webhook/test', { method: 'POST' }); toast('Test webhook sent') } catch (error) { toast(error.message, true) } }

$('saveConnection').onclick = async () => {
  try {
    const firstServer = { ...config.servers[0], name: $('settingProfileName').value.trim(), host: $('settingHost').value.trim(), port: Number($('settingPort').value), version: $('settingVersion').value.trim(), joinCommand: $('settingJoinCommand').value.trim(), worldChangeCommand: $('settingWorldCommand').value.trim(), antiAfkEnabled: $('settingAntiAfk').checked, antiAfkMinSeconds: Number($('settingAntiAfkMin').value), antiAfkMaxSeconds: Number($('settingAntiAfkMax').value), spamEnabled: $('settingSpamEnabled').checked, spamMessage: $('settingSpamMessage').value.trim(), spamIntervalSeconds: Number($('settingSpamInterval').value) }
    const firstAccount = { ...config.accounts[0], username: $('settingUsername').value.trim(), autoConnect: $('settingAutoConnect').checked }
    const servers = [firstServer, ...config.servers.slice(1)]
    const accounts = [firstAccount, ...config.accounts.slice(1)]
    const connection = connectionFromProfiles(servers, accounts)
    const result = await api('/api/settings', { method: 'PUT', body: JSON.stringify({ connection, servers, accounts }) })
    config = result.config; renderConfig(); renderState(); $('connectionMessage').textContent = connection.username ? 'Gespeichert. Microsoft Login kannst du jetzt unter Accounts starten.' : 'Connection profile saved.'; toast('Connection profile saved')
  } catch (error) { $('connectionMessage').textContent = error.message; toast(error.message, true) }
}
$('saveConnection').textContent = 'Save connection profile'

const initialPage = location.hash.slice(1) || 'servers'; showPage(document.querySelector(`[data-view="${initialPage}"]`) ? initialPage : 'servers')
setInterval(renderState, 1000)
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {})
boot()
