const fs = require('node:fs')
const path = require('node:path')
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'))
const [major, minor, patch] = packageJson.version.split('.').map(Number)
const display = major === 0 ? `v1${patch ? `.${patch}` : ''}` : `v${major}${minor ? `.${minor}` : ''}${patch ? `.${patch}` : ''}`
fs.writeFileSync(path.join(__dirname, '..', 'public', 'app-version.js'), `window.RCC_VERSION=${JSON.stringify(display)};\n`)
