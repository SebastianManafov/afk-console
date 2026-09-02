import type { BotSnapshot } from "./types.js";

export function selectRoutedAccountId(snapshots: BotSnapshot[], requestedAccountId?: string): string {
  if (requestedAccountId !== undefined) {
    if (!snapshots.some((snapshot) => snapshot.accountId === requestedAccountId)) throw new Error("Account not found");
    return requestedAccountId;
  }
  const online = snapshots.filter((snapshot) => snapshot.connection === "online");
  if (online.length > 1) throw new Error("Multiple accounts are online; accountId is required");
  const selected = online[0] ?? snapshots[0];
  if (!selected?.accountId) throw new Error("No account configured");
  return selected.accountId;
}
