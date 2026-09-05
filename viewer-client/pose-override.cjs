const PLAYER_POSES = new Set(['standing', 'crouching', 'swimming', 'sleeping', 'fall_flying'])

function validPose (pose) {
  return PLAYER_POSES.has(pose) ? pose : null
}

function createPoseOverrideState (initialPose = 'standing') {
  let serverPose = validPose(initialPose) || 'standing'
  let clientOverride = false

  return {
    setServerPose (pose) {
      const nextPose = validPose(pose)
      if (nextPose) serverPose = nextPose
    },
    setClientOverride (enabled) {
      clientOverride = enabled === true
    },
    currentPose () {
      return clientOverride ? 'swimming' : serverPose
    },
    isClientOverrideEnabled () {
      return clientOverride
    }
  }
}

module.exports = { createPoseOverrideState }
