const supportedVersions = ['1.21.4']

function getVersion (version) {
  if (supportedVersions.includes(version)) return version
  if (version === '1.21.4') return '1.21.4'
  return null
}

module.exports = { getVersion, supportedVersions }
