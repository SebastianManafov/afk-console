import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import type { AppConfig } from "./types.js";

export interface ConfigReader { get(): AppConfig }

const AUTO_GUI_DEFAULTS = { autoGuiJoinEnabled: false, autoGuiJoinTitleIncludes: "", autoGuiJoinSlot: 0, autoGuiJoinDelayMs: 750 };
const AUTOMATION_DEFAULTS = { joinCommand: "", worldChangeCommand: "", antiAfkEnabled: false, antiAfkMinSeconds: 45, antiAfkMaxSeconds: 90, spamEnabled: false, spamMessage: "", spamIntervalSeconds: 60 };
export const SUPPORTED_MINECRAFT_VERSIONS = ["1.21.4", "26.1"] as const;
export type SupportedMinecraftVersion = typeof SUPPORTED_MINECRAFT_VERSIONS[number];
const DEFAULT_MINECRAFT_VERSION: SupportedMinecraftVersion = "1.21.4";

function migrateMinecraftVersion(version: unknown): unknown {
  return typeof version === "string" && /^1\.21(?:\.\d+)?$/.test(version) ? DEFAULT_MINECRAFT_VERSION : version;
}

export const DEFAULT_CONFIG: AppConfig = {
  servers: [{ id: "hugosmp", name: "Hugosmp.net", host: process.env.MC_HOST || "hugosmp.net", port: Number(process.env.MC_PORT || 25565), version: process.env.MC_VERSION || DEFAULT_MINECRAFT_VERSION, ...AUTO_GUI_DEFAULTS, ...AUTOMATION_DEFAULTS }],
  proxies: [],
  accounts: [{ id: "primary", name: "Primary account", username: process.env.MC_USERNAME || "", serverId: "hugosmp", proxyId: null, enabled: true, paused: false, autoConnect: process.env.AUTO_CONNECT === "true", reconnectEnabled: true, reconnectDelaysSeconds: [5, 15, 30, 60], sell: null, spawner: null }],
  connection: {
    profileName: "Hugosmp.net",
    host: process.env.MC_HOST || "hugosmp.net",
    port: Number(process.env.MC_PORT || 25565),
    version: process.env.MC_VERSION || DEFAULT_MINECRAFT_VERSION,
    username: process.env.MC_USERNAME || "",
    autoConnect: process.env.AUTO_CONNECT === "true"
    ,reconnectEnabled: true,
    reconnectDelaysSeconds: [5, 15, 30, 60],
    ...AUTO_GUI_DEFAULTS,
    ...AUTOMATION_DEFAULTS
  },
  sell: {
    enabled: false,
    command: "/sell",
    guiTitleIncludes: "items verkaufen",
    contentLastSlot: 34,
    confirmSlot: 35,
    fillDelayMs: 150,
    confirmDelayMs: 400,
    excludeHotbar: true,
    onlyFullStacks: false,
    confirmPartial: true,
    autoReopen: true,
    useShiftClick: true
    ,minPauseMs: 80,
    maxPauseMs: 220,
    scheduleStart: "00:00",
    scheduleEnd: "23:59"
  },
  spawner: {
    enabled: false,
    homeCommand: "/home spawner",
    homeTopCommand: "/home oben",
    homeBottomCommand: "/home unten",
    afkHomeCommand: "/home afk",
    movementStepMs: 300,
    autoDetectSlots: true,
    orderEnabled: false,
    orderCommand: "/order bone",
    orderGuiTitleIncludes: "orders",
    orderDeliverGuiTitleIncludes: "beliefern",
    orderAutoDetect: true,
    orderHighestSlot: 2,
    orderDeliverAllSlot: 6,
    orderContentLastSlot: 35,
    orderPageLeftSlot: 48,
    orderPageRightSlot: 50,
    orderMaxPages: 30,
    orderMinDelayMs: 450,
    orderMaxDelayMs: 1100,
    minIntervalMinutes: 60,
    maxIntervalMinutes: 60,
    clickDelayMs: 250,
    maxPages: 30,
    mode: "ALWAYS",
    skeletonFilter: false,
    dropItemNames: ["bone", "minecraft:bone"],
    arrowAbort: true,
    arrowItemNames: ["arrow", "minecraft:arrow"],
    guiTitleIncludes: "spawner",
    contentLastSlot: 44,
    sellAllSlot: 45,
    pageLeftSlot: 48,
    pageRightSlot: 50,
    dropAllSlot: 53,
    scheduleStart: "00:00",
    scheduleEnd: "23:59"
  },
  webhook: {
    enabled: false,
    url: "",
    username: "Remote Console Client (RCC)",
    notifyConnect: true,
    notifyDisconnect: true,
    notifyKick: true,
    notifyMacroSuccess: true,
    notifyMacroError: true,
    notifyArrowAbort: true
  }
};

function mergeConfig(input: Partial<AppConfig>): AppConfig {
  const merged = {
    servers: (input.servers !== undefined ? input.servers : structuredClone(DEFAULT_CONFIG.servers)).map((server) => ({ ...AUTO_GUI_DEFAULTS, ...AUTOMATION_DEFAULTS, ...server })),
    proxies: input.proxies ?? structuredClone(DEFAULT_CONFIG.proxies),
    accounts: input.accounts !== undefined ? input.accounts : structuredClone(DEFAULT_CONFIG.accounts),
    connection: { ...DEFAULT_CONFIG.connection, ...input.connection },
    sell: { ...DEFAULT_CONFIG.sell, ...input.sell },
    spawner: { ...DEFAULT_CONFIG.spawner, ...input.spawner },
    webhook: { ...DEFAULT_CONFIG.webhook, ...input.webhook }
  };
  if (!input.servers && input.connection) merged.servers[0] = { id: "hugosmp", name: merged.connection.profileName, host: merged.connection.host, port: merged.connection.port, version: merged.connection.version, autoGuiJoinEnabled: merged.connection.autoGuiJoinEnabled, autoGuiJoinTitleIncludes: merged.connection.autoGuiJoinTitleIncludes, autoGuiJoinSlot: merged.connection.autoGuiJoinSlot, autoGuiJoinDelayMs: merged.connection.autoGuiJoinDelayMs, joinCommand: merged.connection.joinCommand, worldChangeCommand: merged.connection.worldChangeCommand, antiAfkEnabled: merged.connection.antiAfkEnabled, antiAfkMinSeconds: merged.connection.antiAfkMinSeconds, antiAfkMaxSeconds: merged.connection.antiAfkMaxSeconds, spamEnabled: merged.connection.spamEnabled, spamMessage: merged.connection.spamMessage, spamIntervalSeconds: merged.connection.spamIntervalSeconds };
  if (!input.accounts && input.connection) merged.accounts[0] = { ...merged.accounts[0]!, name: merged.connection.profileName, username: merged.connection.username, autoConnect: merged.connection.autoConnect };
  merged.accounts = merged.accounts.map((account) => ({
    ...DEFAULT_CONFIG.accounts[0]!,
    ...account,
    sell: account.sell ? { ...DEFAULT_CONFIG.sell, ...account.sell } : null,
    spawner: account.spawner ? { ...DEFAULT_CONFIG.spawner, ...account.spawner } : null
  }));
  return merged;
}

export class ConfigStore {
  private value: AppConfig = structuredClone(DEFAULT_CONFIG);
  private readonly file: string;
  private readonly encryptionKey: Buffer | null;

  constructor(dataDir: string, encryptionSecret = process.env.CONFIG_ENCRYPTION_KEY || process.env.SESSION_SECRET || "") {
    this.file = join(dataDir, "config.json");
    if (encryptionSecret && encryptionSecret.length < 32) throw new Error("CONFIG_ENCRYPTION_KEY muss mindestens 32 Zeichen lang sein");
    this.encryptionKey = encryptionSecret ? createHash("sha256").update(encryptionSecret).digest() : null;
  }

  async load(): Promise<AppConfig> {
    try {
      const stored = JSON.parse(await readFile(this.file, "utf8")) as Partial<AppConfig>;
      if (stored.webhook?.url?.startsWith("enc:v1:")) stored.webhook.url = this.decrypt(stored.webhook.url);
      for (const proxy of stored.proxies ?? []) if (proxy.password?.startsWith("enc:v1:")) proxy.password = this.decrypt(proxy.password);
      if (stored.connection) stored.connection.version = migrateMinecraftVersion(stored.connection.version) as string;
      if (stored.servers) for (const server of stored.servers) server.version = migrateMinecraftVersion(server.version) as string;
      this.value = mergeConfig(stored);
      this.validate(this.value);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await this.save(this.value);
    }
    return this.get();
  }

  get(): AppConfig {
    return structuredClone(this.value);
  }

  publicValue(): AppConfig {
    const value = this.get();
    value.webhook.url = value.webhook.url ? "configured" : "";
    value.proxies = value.proxies.map((proxy) => ({ ...proxy, password: proxy.password ? "configured" : "" }));
    return value;
  }

  async update(patch: Partial<AppConfig>): Promise<AppConfig> {
    const current = this.value;
    const webhookPatch: Partial<AppConfig["webhook"]> = patch.webhook ?? {};
    const submittedUrl = webhookPatch.url;
    const next = mergeConfig({
      ...current,
      ...patch,
      servers: patch.servers ?? current.servers,
      accounts: patch.accounts ?? current.accounts,
      proxies: (patch.proxies ?? current.proxies).map((proxy) => {
        const previous = current.proxies.find((item) => item.id === proxy.id);
        return { ...proxy, password: proxy.password === "configured" ? previous?.password ?? "" : proxy.password };
      }),
      connection: { ...current.connection, ...patch.connection },
      sell: { ...current.sell, ...patch.sell },
      spawner: { ...current.spawner, ...patch.spawner },
      webhook: {
        ...current.webhook,
        ...webhookPatch,
        url: submittedUrl === undefined || submittedUrl === "configured" ? current.webhook.url : submittedUrl
      }
    });
    this.validate(next);
    await this.save(next);
    this.value = next;
    return this.publicValue();
  }

  private validate(value: AppConfig): void {
    if (!value.connection.profileName.trim()) throw new Error("Profilname fehlt");
    if (!value.servers.length || !value.accounts.length) throw new Error("Mindestens ein Server und Account sind erforderlich");
    for (const id of [...value.servers.map((item) => item.id), ...value.accounts.map((item) => item.id), ...value.proxies.map((item) => item.id)]) if (typeof id !== "string" || !/^[a-z0-9_-]+$/i.test(id)) throw new Error("Profil-ID enthält ungültige Zeichen");
    if (new Set(value.servers.map((item) => item.id)).size !== value.servers.length || new Set(value.accounts.map((item) => item.id)).size !== value.accounts.length || new Set(value.proxies.map((item) => item.id)).size !== value.proxies.length) throw new Error("Doppelte Profil-ID");
    for (const server of value.servers) if (typeof server.name !== "string" || !server.name.trim()) throw new Error("Servername fehlt");
    for (const account of value.accounts) if (typeof account.name !== "string" || !account.name.trim()) throw new Error("Accountname fehlt");
    for (const account of value.accounts) if (!value.servers.some((server) => server.id === account.serverId)) throw new Error(`Serverprofil für ${account.name} fehlt`);
    for (const account of value.accounts) if (account.proxyId && !value.proxies.some((proxy) => proxy.id === account.proxyId)) throw new Error(`Proxyprofil für ${account.name} fehlt`);
    for (const account of value.accounts) if (account.username && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(account.username)) throw new Error(`Ungültige Microsoft-E-Mail für ${account.name}`);
    for (const account of value.accounts) if (!account.reconnectDelaysSeconds.length || account.reconnectDelaysSeconds.some((delay) => !Number.isInteger(delay) || delay < 1 || delay > 3600)) throw new Error(`Ungültige Reconnect-Regeln für ${account.name}`);
    for (const proxy of value.proxies) if (typeof proxy.name !== "string" || !proxy.name.trim() || typeof proxy.host !== "string" || !proxy.host.trim() || !Number.isInteger(proxy.port) || proxy.port < 1 || proxy.port > 65535) throw new Error(`Ungültiger Proxy ${proxy.name ?? ""}`);
    for (const server of value.servers) {
      if (!/^[a-z0-9.-]+$/i.test(server.host)) throw new Error(`Ungültige Serveradresse für ${server.name}`);
      if (!Number.isInteger(server.port) || server.port < 1 || server.port > 65535) throw new Error(`Ungültiger Serverport für ${server.name}`);
      if (!SUPPORTED_MINECRAFT_VERSIONS.includes(server.version as SupportedMinecraftVersion)) throw new Error(`Nicht unterstützte Minecraft-Version für ${server.name}`);
      if (server.autoGuiJoinEnabled && !server.autoGuiJoinTitleIncludes.trim()) throw new Error(`Auto-GUI-Titel fehlt für ${server.name}`);
      if (!Number.isInteger(server.autoGuiJoinSlot) || server.autoGuiJoinSlot < 0 || server.autoGuiJoinSlot > 89) throw new Error(`Ungültiger Auto-GUI-Slot für ${server.name}`);
      if (!Number.isInteger(server.autoGuiJoinDelayMs) || server.autoGuiJoinDelayMs < 100 || server.autoGuiJoinDelayMs > 10_000) throw new Error(`Ungültige Auto-GUI-Verzögerung für ${server.name}`);
      if (server.antiAfkMinSeconds < 10 || server.antiAfkMaxSeconds < server.antiAfkMinSeconds || server.antiAfkMaxSeconds > 3600) throw new Error(`Ungültiges Anti-AFK-Intervall für ${server.name}`);
      if (server.spamIntervalSeconds < 10 || server.spamIntervalSeconds > 86_400) throw new Error(`Ungültiges Chat-Timer-Intervall für ${server.name}`);
      for (const command of [server.joinCommand, server.worldChangeCommand, server.spamMessage]) if (command.length > 256) throw new Error(`Automationsnachricht für ${server.name} ist zu lang`);
    }
    if (!/^[a-z0-9.-]+$/i.test(value.connection.host)) throw new Error("Ungültige Serveradresse");
    if (!Number.isInteger(value.connection.port) || value.connection.port < 1 || value.connection.port > 65535) throw new Error("Ungültiger Serverport");
    if (!SUPPORTED_MINECRAFT_VERSIONS.includes(value.connection.version as SupportedMinecraftVersion)) throw new Error("Nicht unterstützte Minecraft-Version");
    if (!value.connection.reconnectDelaysSeconds.length || value.connection.reconnectDelaysSeconds.some((delay) => !Number.isInteger(delay) || delay < 1 || delay > 3600)) throw new Error("Ungültige Reconnect-Regeln");
    if (value.connection.autoGuiJoinEnabled && !value.connection.autoGuiJoinTitleIncludes.trim()) throw new Error("Auto-GUI-Titel fehlt");
    if (!Number.isInteger(value.connection.autoGuiJoinSlot) || value.connection.autoGuiJoinSlot < 0 || value.connection.autoGuiJoinSlot > 89) throw new Error("Ungültiger Auto-GUI-Slot");
    if (!Number.isInteger(value.connection.autoGuiJoinDelayMs) || value.connection.autoGuiJoinDelayMs < 100 || value.connection.autoGuiJoinDelayMs > 10_000) throw new Error("Ungültige Auto-GUI-Verzögerung");
    const macroConfigs = [
      { label: "global", sell: value.sell, spawner: value.spawner },
      ...value.accounts.map((account) => ({ label: account.name, sell: account.sell ?? value.sell, spawner: account.spawner ?? value.spawner }))
    ];
    for (const { label, sell, spawner } of macroConfigs) {
      if (spawner.minIntervalMinutes < 1 || spawner.maxIntervalMinutes < spawner.minIntervalMinutes) throw new Error(`Ungültiges Spawner-Intervall (${label})`);
      if (spawner.dropAllSlot < 0 || spawner.contentLastSlot < 0) throw new Error(`Ungültige Slot-Konfiguration (${label})`);
      if ([spawner.orderHighestSlot, spawner.orderDeliverAllSlot, spawner.orderContentLastSlot, spawner.orderPageLeftSlot, spawner.orderPageRightSlot].some((slot) => slot < 0 || slot > 89)) throw new Error(`Ungültige Order-Slots (${label})`);
      if (spawner.orderMaxPages < 1 || spawner.orderMaxPages > 100) throw new Error(`Ungültige Order-Seitenzahl (${label})`);
      if (spawner.orderMinDelayMs < 100 || spawner.orderMaxDelayMs < spawner.orderMinDelayMs || spawner.orderMaxDelayMs > 10_000) throw new Error(`Ungültige Order-Pausen (${label})`);
      if (sell.minPauseMs < 0 || sell.maxPauseMs < sell.minPauseMs) throw new Error(`Ungültige Sell-Pausen (${label})`);
      if (sell.contentLastSlot < 0 || sell.contentLastSlot > 89 || sell.confirmSlot !== sell.contentLastSlot + 1) throw new Error(`Ungültige Sell-Slots (${label})`);
      if (!sell.guiTitleIncludes.trim()) throw new Error(`Sell-GUI-Titel fehlt (${label})`);
      for (const time of [sell.scheduleStart, sell.scheduleEnd, spawner.scheduleStart, spawner.scheduleEnd]) {
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error(`Ungültiges Makro-Zeitfenster (${label})`);
      }
    }
    if (value.webhook.url && !/^https:\/\/(discord(?:app)?\.com|discord\.com)\/api\/webhooks\//i.test(value.webhook.url)) {
      throw new Error("Nur Discord-Webhook-URLs werden unterstützt");
    }
  }

  private async save(value: AppConfig): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    const temp = `${this.file}.tmp`;
    const stored = structuredClone(value);
    if (stored.webhook.url) stored.webhook.url = this.encrypt(stored.webhook.url);
    stored.proxies = stored.proxies.map((proxy) => ({ ...proxy, password: proxy.password ? this.encrypt(proxy.password) : "" }));
    await writeFile(temp, JSON.stringify(stored, null, 2), { encoding: "utf8", mode: 0o600 });
    await rename(temp, this.file);
  }

  private encrypt(value: string): string {
    if (!this.encryptionKey) throw new Error("CONFIG_ENCRYPTION_KEY oder SESSION_SECRET wird zum Speichern des Webhooks benötigt");
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.encryptionKey, iv);
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return `enc:v1:${iv.toString("base64url")}:${cipher.getAuthTag().toString("base64url")}:${encrypted.toString("base64url")}`;
  }

  private decrypt(value: string): string {
    if (!this.encryptionKey) throw new Error("Webhook ist verschlüsselt, aber der Verschlüsselungsschlüssel fehlt");
    const [, version, iv, tag, encrypted] = value.split(":");
    if (version !== "v1" || !iv || !tag || !encrypted) throw new Error("Ungültiges Webhook-Verschlüsselungsformat");
    const decipher = createDecipheriv("aes-256-gcm", this.encryptionKey, Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
  }
}
