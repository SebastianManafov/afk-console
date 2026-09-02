import { join } from "node:path";
import { resolve } from "node:path";
import { rm } from "node:fs/promises";
import type { ConfigReader, ConfigStore } from "./config.js";
import { BotService } from "./bot-service.js";
import { AppEvents } from "./events.js";
import type { AppConfig, BotSnapshot } from "./types.js";
import type { WebhookNotifier } from "./webhook.js";
import { selectPrimarySnapshot } from "./snapshot-policy.js";
import { selectRoutedAccountId } from "./routing-policy.js";
import type { ViewerControlInput } from "./viewer-control.js";

export class MultiBotManager {
  private readonly bots = new Map<string, BotService>();
  private readonly proxyKeys = new Map<string, string>();
  private readonly connectionQueue: Array<{ accountId: string; reconnect: boolean }> = [];
  private activeConnection: string | null = null;
  private queueReleaseTimer: NodeJS.Timeout | null = null;

  constructor(private readonly config: ConfigStore, private readonly events: AppEvents, private readonly webhook: WebhookNotifier, private readonly dataDir: string) {
    this.sync();
  }

  get sell() { return this.primary().sell; }
  get spawner() { return this.primary().spawner; }

  viewerBot(accountId?: string): import("mineflayer").Bot | null {
    if (accountId) return this.bots.get(accountId)?.viewerBot() || null;
    for (const bot of this.bots.values()) {
      const target = bot.viewerBot();
      if (target) return target;
    }
    return null;
  }

  sync(): void {
    const root = this.config.get();
    const configured = new Set(root.accounts.map((account) => account.id));
    let releasedConnection = false;
    for (const [id, bot] of this.bots) if (!configured.has(id)) {
      releasedConnection = this.releaseQueuedAccount(id) || releasedConnection;
      this.bots.delete(id);
      this.proxyKeys.delete(id);
      bot.dispose();
    }
    for (const account of root.accounts) {
      const proxy = account.proxyId ? root.proxies.find((item) => item.id === account.proxyId) ?? null : null;
      const proxyKey = proxy ? `${proxy.id}|${proxy.host}|${proxy.port}|${proxy.username}|${proxy.password}` : "direct";
      if (this.bots.has(account.id) && this.proxyKeys.get(account.id) === proxyKey) continue;
      if (this.bots.has(account.id)) {
        releasedConnection = this.releaseQueuedAccount(account.id) || releasedConnection;
        const previous = this.bots.get(account.id)!;
        this.bots.delete(account.id);
        previous.dispose();
      }
      const childEvents = new AppEvents(false);
      childEvents.on("log", (entry) => this.events.log(entry.level, `${this.accountName(account.id)}/${entry.source}`, entry.message));
      childEvents.on("chat", (entry) => this.events.emit("chat", { ...entry, accountId: account.id, accountName: this.accountName(account.id) }));
      childEvents.on("viewerControlRevoked", (payload) => this.events.emit("viewerControlRevoked", payload));
      childEvents.on("state", () => { this.events.state(this.snapshot()); this.handleQueuedConnectionState(account.id); });
      this.bots.set(account.id, new BotService(this.reader(account.id), childEvents, this.webhook, join(this.dataDir, "accounts", account.id), account.id, proxy));
      this.proxyKeys.set(account.id, proxyKey);
    }
    if (releasedConnection && this.connectionQueue.length) queueMicrotask(() => this.pumpConnectionQueue());
  }

  connect(accountIds?: string[]): void {
    this.sync();
    const selected = accountIds === undefined ? null : new Set(accountIds);
    for (const account of this.config.get().accounts) if (account.enabled && !account.paused && (!selected || selected.has(account.id))) {
      const bot = this.bots.get(account.id);
      if (!bot) continue;
      const snapshot = bot.snapshot();
      if (!snapshot.authenticated && !snapshot.authenticating) { bot.authenticate(); continue; }
      if (!snapshot.authenticating) this.enqueueConnection(account.id, false);
    }
    this.pumpConnectionQueue();
  }
  stop(accountIds?: string[]): void {
    const selected = accountIds === undefined ? null : new Set(accountIds);
    for (let index = this.connectionQueue.length - 1; index >= 0; index -= 1) if (!selected || selected.has(this.connectionQueue[index]!.accountId)) this.connectionQueue.splice(index, 1);
    for (const [id, bot] of this.bots) if (!selected || selected.has(id)) bot.stop();
  }
  reconnect(accountIds?: string[]): void {
    this.sync();
    const selected = accountIds === undefined ? null : new Set(accountIds);
    const accounts = new Map(this.config.get().accounts.map((account) => [account.id, account]));
    for (const [id] of this.bots) if ((!selected || selected.has(id)) && accounts.get(id)?.enabled && !accounts.get(id)?.paused) this.enqueueConnection(id, true);
    this.pumpConnectionQueue();
  }
  login(accountId: string): void {
    this.sync(); const account = this.config.get().accounts.find((item) => item.id === accountId); const bot = this.bots.get(accountId);
    if (!account || !bot) throw new Error("Account not found");
    if (account.paused) throw new Error("Account is paused. Resume it first");
    if (!account.username.trim()) throw new Error("Enter the Microsoft email address for this account first");
    if (["connecting", "reconnecting"].includes(bot.snapshot().connection)) throw new Error("Connection attempt is already running");
    bot.authenticate();
  }
  sendChat(message: string, accountId?: string): void { this.routedBot(accountId).sendChat(message); }
  control(input: Record<string, unknown>, accountId?: string): Promise<void> { return this.routedBot(accountId).control(input); }
  acquireViewerControl(accountId: string, controllerId: string): void { this.viewerBotService(accountId).acquireViewerControl(accountId, controllerId); }
  heartbeatViewerControl(accountId: string, controllerId: string): boolean { return this.viewerBotService(accountId).heartbeatViewerControl(accountId, controllerId); }
  viewerControl(accountId: string, controllerId: string, input: ViewerControlInput): Promise<void> { return this.viewerBotService(accountId).viewerControl(accountId, controllerId, input); }
  releaseViewerControl(accountId: string, controllerId: string, reason?: string): boolean { return this.viewerBotService(accountId).releaseViewerControl(accountId, controllerId, reason); }
  onViewerControlRevoked(listener: (payload: { accountId: string; reason: string }) => void): () => void {
    const handler = (payload: unknown) => {
      if (!payload || typeof payload !== "object") return;
      const value = payload as { accountId?: unknown; reason?: unknown };
      if (typeof value.accountId === "string" && typeof value.reason === "string") listener({ accountId: value.accountId, reason: value.reason });
    };
    this.events.on("viewerControlRevoked", handler);
    return () => this.events.off("viewerControlRevoked", handler);
  }
  takeOver(accountId?: string): boolean {
    const target = this.routedBot(accountId);
    const stopped = target.sell.cancel() || target.spawner.cancel();
    if (!stopped) throw new Error("No macro is running for this account");
    return true;
  }
  runSell(accountIds?: string[]): void { this.runMacro("sell", accountIds); }
  runSpawner(accountIds?: string[]): void { this.runMacro("spawner", accountIds); }
  applyConfig(): void { this.sync(); for (const bot of this.bots.values()) bot.applyConfig(); this.events.state(this.snapshot()); }

  async logout(accountId: string): Promise<void> {
    const account = this.config.get().accounts.find((item) => item.id === accountId);
    if (!account) throw new Error("Account not found");
    this.bots.get(accountId)?.stop();
    const accountsRoot = resolve(this.dataDir, "accounts");
    const authDirectory = resolve(accountsRoot, accountId, "auth");
    if (!authDirectory.startsWith(`${accountsRoot}\\`) && !authDirectory.startsWith(`${accountsRoot}/`)) throw new Error("Invalid account path");
    await rm(authDirectory, { recursive: true, force: true });
    this.events.log("info", "auth", `Microsoft authentication removed for ${account.name}`);
    this.events.state(this.snapshot());
  }

  snapshot(): BotSnapshot {
    const root = this.config.get();
    const snapshots = [...this.bots.values()].map((bot) => { const snapshot = bot.snapshot(); return { ...snapshot, paused: root.accounts.find((account) => account.id === snapshot.accountId)?.paused ?? false }; });
    const primary = selectPrimarySnapshot(snapshots) ?? this.primary().snapshot();
    return { ...primary, bots: snapshots.map((item) => ({ ...item, bots: undefined })) };
  }

  private primary(): BotService {
    const bot = this.bots.values().next().value as BotService | undefined;
    if (!bot) throw new Error("No account configured");
    return bot;
  }
  private routedBot(accountId?: string): BotService {
    const snapshots = [...this.bots.values()].map((bot) => bot.snapshot());
    const selectedId = selectRoutedAccountId(snapshots, accountId);
    const bot = this.bots.get(selectedId);
    if (!bot) throw new Error("Account not found");
    return bot;
  }

  private viewerBotService(accountId: string): BotService {
    const bot = this.bots.get(accountId);
    if (!bot) throw new Error("Account not found");
    return bot;
  }

  private enqueueConnection(accountId: string, reconnect: boolean): void {
    if (this.activeConnection === accountId || this.connectionQueue.some((item) => item.accountId === accountId)) return;
    this.assertNoDuplicateDirectProfile(accountId);
    const status = this.bots.get(accountId)?.snapshot().connection;
    if (!reconnect && status !== "offline") return;
    this.connectionQueue.push({ accountId, reconnect });
    this.events.log("info", "queue", `Account ${accountId} added to the connection queue`);
  }

  private assertNoDuplicateDirectProfile(accountId: string): void {
    const root = this.config.get();
    const requested = root.accounts.find((account) => account.id === accountId);
    if (!requested || requested.proxyId) return;
    const requestedServer = root.servers.find((server) => server.id === requested.serverId);
    if (!requestedServer) return;
    for (const [otherId, bot] of this.bots) {
      if (otherId === accountId || !["connecting", "reconnecting", "online"].includes(bot.snapshot().connection)) continue;
      const other = root.accounts.find((account) => account.id === otherId);
      if (!other || other.proxyId || other.serverId === requested.serverId) continue;
      const otherServer = root.servers.find((server) => server.id === other.serverId);
      if (otherServer?.host === requestedServer.host && otherServer.port === requestedServer.port) throw new Error(`Duplicate direct connection blocked: ${requestedServer.host}:${requestedServer.port} is already used by another server profile`);
    }
  }

  private pumpConnectionQueue(): void {
    if (this.activeConnection) return;
    const next = this.connectionQueue.shift();
    if (!next) return;
    const bot = this.bots.get(next.accountId);
    if (!bot) return this.pumpConnectionQueue();
    this.activeConnection = next.accountId;
    try {
      if (next.reconnect) bot.reconnect();
      else bot.connect();
    } catch (error) {
      this.events.log("error", "queue", `Connection for ${next.accountId} failed: ${error instanceof Error ? error.message : String(error)}`);
      this.activeConnection = null;
      this.scheduleQueuePump();
    }
  }

  private handleQueuedConnectionState(accountId: string): void {
    if (this.activeConnection !== accountId || this.queueReleaseTimer) return;
    const snapshot = this.bots.get(accountId)?.snapshot();
    if (!snapshot || !["online", "offline"].includes(snapshot.connection)) return;
    this.queueReleaseTimer = setTimeout(() => {
      this.queueReleaseTimer = null;
      const current = this.bots.get(accountId)?.snapshot();
      if (current && !["online", "offline"].includes(current.connection)) return;
      this.activeConnection = null;
      this.pumpConnectionQueue();
    }, 2_000);
    this.queueReleaseTimer.unref();
  }

  private scheduleQueuePump(): void {
    const timer = setTimeout(() => this.pumpConnectionQueue(), 2_000);
    timer.unref();
  }

  private runMacro(kind: "sell" | "spawner", accountIds?: string[]): void {
    const selected = accountIds === undefined ? null : new Set(accountIds);
    const online = [...this.bots.entries()].filter(([id, bot]) => (!selected || selected.has(id)) && bot.snapshot().connection === "online");
    if (!online.length) throw new Error("No selected account is online");
    const targets = online.filter(([, bot]) => !bot.snapshot().controlLock.locked);
    if (!targets.length) throw new Error(`Macro locked: ${online[0]![1].snapshot().controlLock.reason ?? "Account is busy"}`);
    for (const [id, bot] of online) if (bot.snapshot().controlLock.locked) this.events.log("warn", "macro", `${this.accountName(id)} skipped: ${bot.snapshot().controlLock.reason}`);
    for (const [, bot] of targets) void bot[kind].runNow();
  }

  private accountName(accountId: string): string {
    return this.config.get().accounts.find((account) => account.id === accountId)?.name ?? accountId;
  }

  private releaseQueuedAccount(accountId: string): boolean {
    for (let index = this.connectionQueue.length - 1; index >= 0; index -= 1) if (this.connectionQueue[index]!.accountId === accountId) this.connectionQueue.splice(index, 1);
    if (this.activeConnection !== accountId) return false;
    if (this.queueReleaseTimer) clearTimeout(this.queueReleaseTimer);
    this.queueReleaseTimer = null;
    this.activeConnection = null;
    return true;
  }

  private reader(accountId: string): ConfigReader {
    return { get: () => {
      const root = this.config.get();
      const account = root.accounts.find((item) => item.id === accountId);
      if (!account) return root;
      const server = root.servers.find((item) => item.id === account.serverId);
      if (!server) return root;
      return {
        ...root,
        connection: { profileName: server.name, host: server.host, port: server.port, version: server.version, username: account.username, autoConnect: account.autoConnect, reconnectEnabled: account.reconnectEnabled, reconnectDelaysSeconds: account.reconnectDelaysSeconds, autoGuiJoinEnabled: server.autoGuiJoinEnabled, autoGuiJoinTitleIncludes: server.autoGuiJoinTitleIncludes, autoGuiJoinSlot: server.autoGuiJoinSlot, autoGuiJoinDelayMs: server.autoGuiJoinDelayMs, joinCommand: server.joinCommand, worldChangeCommand: server.worldChangeCommand, antiAfkEnabled: server.antiAfkEnabled, antiAfkMinSeconds: server.antiAfkMinSeconds, antiAfkMaxSeconds: server.antiAfkMaxSeconds, spamEnabled: server.spamEnabled, spamMessage: server.spamMessage, spamIntervalSeconds: server.spamIntervalSeconds },
        sell: account.sell ?? root.sell,
        spawner: account.spawner ?? root.spawner
      } satisfies AppConfig;
    } };
  }
}
