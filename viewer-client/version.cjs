const supportedVersions = ['1.8.8', '1.9.4', '1.10.2', '1.11.2', '1.12.2', '1.13.2', '1.14.4', '1.15.2', '1.16.1', '1.16.4', '1.17.1', '1.18.1', '1.19', '1.20.1', '1.21.1', '1.21.4', '26.1.2']

function getVersion (version) {
  if (supportedVersions.includes(version)) return version
  if (String(version).startsWith('26.1')) return '26.1.2'
  if (version === '1.21.4') return '1.21.4'
  return null
}

module.exports = { getVersion, supportedVersions }
