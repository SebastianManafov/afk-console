const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'))
const [major, minor, patch] = packageJson.version.split('.').map(Number)
const baseVersion = major === 0 ? `v1${patch ? `.${patch}` : ''}` : `v${major}${minor ? `.${minor}` : ''}${patch ? `.${patch}` : ''}`
let revision = 'dev'
try {
  revision = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: path.join(__dirname, '..'), encoding: 'utf8' }).trim() || revision
} catch {}
const display = `${baseVersion}+${revision}`
fs.writeFileSync(path.join(__dirname, '..', 'public', 'app-version.js'), `window.RCC_VERSION=${JSON.stringify(display)};\n`)
