const { Vec3 } = require('vec3')

// prismarine-viewer 1.33.0 incorrectly skips cullable faces when the
// neighbouring block's Y coordinate is negative. Keep the upstream geometry
// implementation, but hide only that obsolete coordinate check from it. The
// actual position is retained for liquid-height lookups.
class GeometryPosition extends Vec3 {
  constructor (position) {
    super(position.x, 0, position.z)
    this.actualY = position.y
  }

  offset (x, y, z) {
    return new Vec3(this.x + x, this.actualY + y, this.z + z)
  }
}

function adaptBlock (block, cache) {
  if (!block?.position || block.position.y >= 0) return block
  let adapted = cache.get(block)
  if (!adapted) {
    adapted = new Proxy(block, {
      get (target, property, receiver) {
        if (property === 'position') return new GeometryPosition(Reflect.get(target, property, receiver))
        return Reflect.get(target, property, receiver)
      }
    })
    cache.set(block, adapted)
  }
  return adapted
}

function createGeometryWorld (world) {
  const cache = new WeakMap()
  return {
    getBlock (position) {
      return adaptBlock(world.getBlock(position), cache)
    }
  }
}

module.exports = { createGeometryWorld }
