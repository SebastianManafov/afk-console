const minecraftData = require('./pov-minecraft-data.cjs')

// The worker always supplies static Java registry data. This compatibility
// entry prevents the general registry loader from importing Bedrock/NBT code.
module.exports = value => typeof value === 'string' ? minecraftData(value) : value
