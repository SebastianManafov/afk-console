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
  if (!config.autoGuiJoinEnabled) return { allowed: false, reason: "Auto-GUI-Join ist deaktiviert" };
  const expected = config.autoGuiJoinTitleIncludes.trim().toLocaleLowerCase("de-DE");
  if (!expected) return { allowed: false, reason: "Kein sicherer Fenstertitel konfiguriert" };
  if (!title.toLocaleLowerCase("de-DE").includes(expected)) return { allowed: false, reason: "Fenstertitel passt nicht" };
  if (!availableSlots.includes(config.autoGuiJoinSlot)) return { allowed: false, reason: `Slot ${config.autoGuiJoinSlot} ist leer` };
  return { allowed: true, reason: "Fenster und Slot passen" };
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
  manualControlActive = false
): BotSnapshot["controlLock"] {
  if (worldState !== "stable") return { locked: true, reason: "Welt-/Serverwechsel läuft" };
  if (manualControlActive) return { locked: true, reason: "Manuelle Steuerung läuft" };
  if (sell.status === "running") return { locked: true, reason: "Sell-Makro läuft" };
  if (spawner.status === "running") return { locked: true, reason: "Spawner-Makro läuft" };
  return { locked: false, reason: null };
}

export function isStablePlayState(
  connection: BotSnapshot["connection"],
  protocolState: unknown,
  worldState: BotSnapshot["worldTransition"]["state"]
): boolean {
  return connection === "online" && String(protocolState).toLowerCase() === "play" && worldState === "stable";
}

export function isNewWorldStable(protocolState: unknown, hasEntity: boolean, elapsedMs: number): boolean {
  return String(protocolState).toLowerCase() === "play" && hasEntity && elapsedMs >= 1_500;
}
