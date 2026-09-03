import type { BotSnapshot, MacroRuntime } from "./types.js";

export interface AutoGuiJoinDecision { allowed: boolean; reason: string }

export interface AutoGuiJoinConfig {
  autoGuiJoinEnabled: boolean;
  autoGuiJoinTitleIncludes: string;
  autoGuiJoinSlot: number;
  autoGuiJoinDelayMs: number;
}

export function decideAutoGuiJoin(title: string, availableSlots: number[], config: {
  autoGuiJoinEnabled: boolean; autoGuiJoinTitleIncludes: string; autoGuiJoinSlot: number;
}): AutoGuiJoinDecision {
  if (!config.autoGuiJoinEnabled) return { allowed: false, reason: "Auto-GUI join is disabled" };
  const expected = config.autoGuiJoinTitleIncludes.trim().toLocaleLowerCase("en-US");
  if (!expected) return { allowed: false, reason: "No safe window title configured" };
  if (!title.toLocaleLowerCase("en-US").includes(expected)) return { allowed: false, reason: "Window title does not match" };
  if (!availableSlots.includes(config.autoGuiJoinSlot)) return { allowed: false, reason: `Slot ${config.autoGuiJoinSlot} is empty` };
  return { allowed: true, reason: "Window and slot match" };
}

export function sameAutoGuiJoinConfig(left: AutoGuiJoinConfig, right: AutoGuiJoinConfig): boolean {
  return left.autoGuiJoinEnabled === right.autoGuiJoinEnabled
    && left.autoGuiJoinTitleIncludes === right.autoGuiJoinTitleIncludes
    && left.autoGuiJoinSlot === right.autoGuiJoinSlot
    && left.autoGuiJoinDelayMs === right.autoGuiJoinDelayMs;
}

export function determineControlLock(
  worldState: BotSnapshot["worldTransition"]["state"],
  sell: MacroRuntime,
  spawner: MacroRuntime,
  manualControlActive = false,
  viewerControlActive = false
): BotSnapshot["controlLock"] {
  if (worldState !== "stable") return { locked: true, reason: "World/server change in progress" };
  if (manualControlActive) return { locked: true, reason: "Manual controls are active" };
  if (sell.status === "running") return { locked: true, reason: "Sell macro is running" };
  if (spawner.status === "running") return { locked: true, reason: "Spawner macro is running" };
  if (viewerControlActive) return { locked: true, reason: "Viewer controls are active" };
  return { locked: false, reason: null };
}

export function isStablePlayState(
  connection: BotSnapshot["connection"],
  protocolState: unknown,
  worldState: BotSnapshot["worldTransition"]["state"]
): boolean {
  return connection === "online" && String(protocolState).toLowerCase() === "play" && worldState === "stable";
}

/**
 * Mineflayer requires both its public physics switch and the internal
 * position-sync/physics gate before control states can move the entity.
 */
export function isMovementReady(
  connection: BotSnapshot["connection"],
  protocolState: unknown,
  worldState: BotSnapshot["worldTransition"]["state"],
  physicsEnabled: unknown,
  mineflayerPhysicsReady: boolean
): boolean {
  return isStablePlayState(connection, protocolState, worldState) && physicsEnabled === true && mineflayerPhysicsReady;
}

export function isNewWorldStable(protocolState: unknown, hasEntity: boolean, elapsedMs: number): boolean {
  return String(protocolState).toLowerCase() === "play" && hasEntity && elapsedMs >= 1_500;
}
