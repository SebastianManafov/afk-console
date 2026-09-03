const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const util = require('node:util')

const command = process.argv[2]

function writeStderr(message) {
  const text = String(message)
    .replace(/(["']?(?:access[_-]?token|refresh[_-]?token|authorization|token)["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi, '$1[redacted]')
    .replace(/\b[A-Za-z0-9_-]{80,}\b/g, '[redacted]')
  process.stderr.write(`${text}\n`)
}

function usage() {
  writeStderr('Usage: node scripts/get-access-token.cjs <msa|minecraft|prism> [Minecraft player name]')
}

function addPrismCandidate(candidates, value) {
  if (!value || typeof value !== 'string') return
  const normalized = value.endsWith('.json') ? value : path.join(value, 'accounts.json')
  if (!candidates.includes(normalized)) candidates.push(normalized)
}

function prismAccountsPath() {
  const candidates = []
  addPrismCandidate(candidates, process.env.PRISM_LAUNCHER_ACCOUNTS)
  addPrismCandidate(candidates, process.env.PRISMLAUNCHER_DATA_DIR)

  const home = os.homedir()
  if (process.platform === 'win32') {
    addPrismCandidate(candidates, process.env.APPDATA)
    addPrismCandidate(candidates, path.join(home, 'AppData', 'Roaming', 'PrismLauncher'))
  } else if (process.platform === 'darwin') {
    addPrismCandidate(candidates, path.join(home, 'Library', 'Application Support', 'PrismLauncher'))
  } else {
    addPrismCandidate(candidates, process.env.XDG_DATA_HOME ? path.join(process.env.XDG_DATA_HOME, 'PrismLauncher') : '')
    addPrismCandidate(candidates, path.join(home, '.local', 'share', 'PrismLauncher'))
    addPrismCandidate(candidates, path.join(home, '.var', 'app', 'org.prismlauncher.PrismLauncher', 'data', 'PrismLauncher'))
  }

  return candidates.find((candidate) => fs.existsSync(candidate)) || null
}

function getPrismToken(profileName) {
  const file = prismAccountsPath()
  if (!file) {
    throw new Error('Prism Launcher accounts.json was not found. Set PRISM_LAUNCHER_ACCOUNTS to its path.')
  }

  let document
  try {
    document = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    throw new Error('Prism Launcher accounts.json could not be read.')
  }

  const accounts = Array.isArray(document?.accounts) ? document.accounts : []
  const candidates = accounts
    .map((account) => ({
      name: typeof account?.profile?.name === 'string' ? account.profile.name.trim() : '',
      token: typeof account?.ygg?.token === 'string' ? account.ygg.token.trim() : ''
    }))
    .filter((account) => account.name && account.token && account.token !== '0' && account.token !== 'offline')

  if (!candidates.length) throw new Error('No Minecraft Java account with a final access token was found in Prism Launcher.')

  let selected
  if (profileName) {
    selected = candidates.find((account) => account.name.toLowerCase() === profileName.toLowerCase())
    if (!selected) throw new Error('The requested Minecraft player name was not found in Prism Launcher.')
  } else if (candidates.length === 1) {
    selected = candidates[0]
  } else {
    throw new Error('Prism Launcher has multiple Minecraft accounts. Pass the player name as the second argument.')
  }

  return selected.token
}

function redirectAuthflowConsoleToStderr() {
  const original = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    debug: console.debug
  }
  const redirect = (...args) => writeStderr(util.format(...args))
  console.log = redirect
  console.info = redirect
  console.warn = redirect
  console.debug = redirect
  return () => {
    console.log = original.log
    console.info = original.info
    console.warn = original.warn
    console.debug = original.debug
  }
}

async function getAuthflowToken(kind) {
  const { Authflow, Titles } = require('prismarine-auth')
  const cacheDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'rcc-access-token-'))
  const restoreConsole = redirectAuthflowConsoleToStderr()
  try {
    const flow = new Authflow('rcc-access-token-helper', cacheDirectory, {
      authTitle: Titles.MinecraftNintendoSwitch,
      deviceType: 'Nintendo',
      flow: 'live'
    }, (data) => {
      if (data?.message) writeStderr(String(data.message))
    })

    if (kind === 'msa') {
      const token = await flow.getMsaToken()
      if (typeof token !== 'string' || !token.trim()) throw new Error('Microsoft did not return an access token.')
      return token.trim()
    }

    const result = await flow.getMinecraftJavaToken({ fetchProfile: true })
    if (typeof result?.token !== 'string' || !result.token.trim()) throw new Error('Minecraft Services did not return an access token.')
    if (!result.profile?.id || !result.profile?.name) throw new Error('The Minecraft Java profile could not be validated.')
    return result.token.trim()
  } finally {
    restoreConsole()
    fs.rmSync(cacheDirectory, { recursive: true, force: true })
  }
}

async function main() {
  if (command === 'prism') return getPrismToken(process.argv[3])
  if (command === 'msa' || command === 'minecraft') return getAuthflowToken(command)
  usage()
  process.exitCode = 2
  return null
}

main()
  .then((token) => {
    if (token) process.stdout.write(`${token}\n`)
  })
  .catch(() => {
    writeStderr('Could not obtain the requested access token. No token was written to stdout.')
    process.exitCode = 1
  })
