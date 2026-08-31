import type { BotSnapshot } from "./types.js";

const CONNECTION_PRIORITY: Record<BotSnapshot["connection"], number> = {
  online: 0,
  connecting: 1,
  reconnecting: 2,
  offline: 3
};

/** Pick the most useful aggregate state without changing the per-account order. */
export function selectPrimarySnapshot(snapshots: BotSnapshot[]): BotSnapshot | null {
  let selected: BotSnapshot | null = null;
  for (const snapshot of snapshots) {
    if (!selected || CONNECTION_PRIORITY[snapshot.connection] < CONNECTION_PRIORITY[selected.connection]) selected = snapshot;
  }
  return selected;
}
