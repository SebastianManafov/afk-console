const POSE_EYE_HEIGHTS = Object.freeze({
  standing: 1.62,
  crouching: 1.27,
  swimming: 0.4,
  sleeping: 0.2,
  fall_flying: 0.4
})

const POSE_TRANSFORMS = Object.freeze({
  standing: { rotationX: 0, y: 0, z: 0 },
  crouching: { rotationX: 0.14, y: -0.18, z: 0 },
  swimming: { rotationX: Math.PI / 2, y: 0.4, z: 0 },
  sleeping: { rotationX: Math.PI / 2, y: 0.2, z: 0 },
  fall_flying: { rotationX: Math.PI / 2, y: 0.4, z: 0 }
})

function playerPoseEyeHeight (pose) {
  return POSE_EYE_HEIGHTS[pose] || POSE_EYE_HEIGHTS.standing
}

function findPlayerModel (entityRoot) {
  if (!entityRoot || !Array.isArray(entityRoot.children)) return null
  const direct = entityRoot.children.find(child => child?.isSkinnedMesh)
  if (direct) return direct
  for (const child of entityRoot.children) {
    if (typeof child?.traverse !== 'function') continue
    let model = null
    child.traverse(candidate => {
      if (!model && candidate?.isSkinnedMesh) model = candidate
    })
    if (model) return model
  }
  return null
}

function applyPlayerPose (entityRoot, pose) {
  const model = findPlayerModel(entityRoot)
  const transform = POSE_TRANSFORMS[pose] || POSE_TRANSFORMS.standing
  if (!model) return false

  model.userData ||= {}
  const base = model.userData.rccPoseBaseTransform ||= {
    position: { x: model.position.x, y: model.position.y, z: model.position.z },
    rotation: { x: model.rotation.x, y: model.rotation.y, z: model.rotation.z }
  }
  model.position.set(base.position.x, base.position.y + transform.y, base.position.z + transform.z)
  model.rotation.set(base.rotation.x + transform.rotationX, base.rotation.y, base.rotation.z)
  return true
}

module.exports = { POSE_EYE_HEIGHTS, POSE_TRANSFORMS, findPlayerModel, applyPlayerPose, playerPoseEyeHeight }
