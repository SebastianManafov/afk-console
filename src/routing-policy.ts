import type { BotSnapshot } from "./types.js";

export function selectRoutedAccountId(snapshots: BotSnapshot[], requestedAccountId?: string): string {
  if (requestedAccountId !== undefined) {
    if (!snapshots.some((snapshot) => snapshot.accountId === requestedAccountId)) throw new Error("Account nicht gefunden");
    return requestedAccountId;
  }
  const online = snapshots.filter((snapshot) => snapshot.connection === "online");
  if (online.length > 1) throw new Error("Mehrere Accounts sind online; accountId ist erforderlich");
  const selected = online[0] ?? snapshots[0];
  if (!selected?.accountId) throw new Error("Kein Account konfiguriert");
  return selected.accountId;
}
