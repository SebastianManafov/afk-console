import { mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { request as httpRequest } from "node:http";
import { join } from "node:path";
import mineflayer, { type Bot } from "mineflayer";
import prismarineAuth from "prismarine-auth";
import type { ConfigReader } from "./config.js";
import type { AppEvents } from "./events.js";
import { installHugoSmpProtocolHandlers } from "./hugosmp-protocol.js";
import { decideAutoGuiJoin, determineControlLock, isNewWorldStable, isStablePlayState, sameAutoGuiJoinConfig } from "./connection-safety.js";
import { readableMinecraftReason } from "./minecraft-text.js";
import { SellMacro } from "./sell-macro.js";
import { SpawnerMacro } from "./spawner-macro.js";
import type { BotSnapshot } from "./types.js";
import type { WebhookNotifier } from "./webhook.js";
import { TokenVault } from "./token-vault.js";

const { Authflow, Titles } = prismarineAuth;

export class BotService {
  private bot: Bot | null = null;
  private connection: BotSnapshot["connection"] = "offline";
  private joinedAt: string | null = null;
  private sneak = false;
  private reconnectAttempt = 0;
  private reconnectAt: string | null = null;
  private authCode: BotSnapshot["authCode"] = null;
  private authPending = false;
  private authPromise: Promise<void> | null = null;
  private lastError: string | null = null;
  private serverNotice: BotSnapshot["serverNotice"] = null;
  private worldTransition: BotSnapshot["worldTransition"] = { state: "stable", startedAt: null, message: "Bereit" };
  private readonly diagnostics: BotSnapshot["diagnostics"] = [];
  private readonly startedAt = Date.now();
  private readonly pulseTimer: NodeJS.Timeout;
  private readonly tokenVault: TokenVault;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private connectTimer: NodeJS.Timeout | null = null;
  private protocolCleanup: (() => void) | null = null;
  private autoGuiJoinTimer: NodeJS.Timeout | null = null;
  private autoGuiJoinCompleted = false;
  private autoGuiJoinInFlight = false;
  private worldReadyCleanup: (() => void) | null = null;
  private worldReadyTimer: NodeJS.Timeout | null = null;
  private antiAfkTimer: NodeJS.Timeout | null = null;
  private spamTimer: NodeJS.Timeout | null = null;
  private manualControlActive = false;
  private activeEndpoint: { host: string; port: number } | null = null;
  private readonly acceptedBots = new WeakSet<Bot>();
  private intentionalStop = false;
  private scheduledReconnectDelayMs: number | null = null;
  readonly sell: SellMacro;
  readonly spawner: SpawnerMacro;

  constructor(
    private readonly config: ConfigReader,
    private readonly events: AppEvents,
    private readonly webhook: WebhookNotifier,
    private readonly dataDir: string,
    private readonly accountId = "primary",
    private readonly proxy: { host: string; port: number; username: string; password: string } | null = null
  ) {
    this.tokenVault = new TokenVault(join(dataDir, "auth"));
    this.sell = new SellMacro(events, config, webhook);
    this.spawner = new SpawnerMacro(events, config, webhook);
    events.on("macroState", () => this.publish());
    this.pulseTimer = setInterval(() => this.publish(), 750);
    this.pulseTimer.unref();
  }

  connect(): void {
    if (this.bot || this.connection === "connecting") return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const connection = this.config.get().connection;
    const username = connection.username.trim();
    if (!username) throw new Error("Microsoft-Konto ist in Settings nicht konfiguriert");
    this.intentionalStop = false;
    this.autoGuiJoinCompleted = false;
    this.autoGuiJoinInFlight = false;
    this.connection = this.reconnectAttempt ? "reconnecting" : "connecting";
    this.diagnose("connect", "info", `Verbindungsaufbau zu ${connection.host}:${connection.port} gestartet`);
    this.publish();
    const profilesFolder = join(this.dataDir, "auth");
    this.tokenVault.restore();
    mkdirSync(profilesFolder, { recursive: true });
    const options: Parameters<typeof mineflayer.createBot>[0] = {
      host: connection.host,
      port: connection.port,
      // Keep the user-facing host in the Minecraft handshake even when
      // minecraft-protocol follows HugoSMP's SRV record to java.hugosmp.net.
      // Proxy networks route the login by this virtual host value.
      fakeHost: connection.host,
      username,
      auth: "microsoft",
      version: connection.version,
      profilesFolder,
      viewDistance: "tiny",
      checkTimeoutInterval: 60_000,
      closeTimeout: 60_000,
      hideErrors: true,
      logErrors: false,
      respawn: true,
      // Velocity/Paper servers can reject movement packets that Mineflayer
      // produces while the 1.21 configuration registries are still syncing.
      physicsEnabled: false,
      onMsaCode: (data) => {
        this.authPending = true;
        this.authCode = {
          verificationUri: data.verification_uri,
          userCode: data.user_code,
          expiresAt: new Date(Date.now() + data.expires_in * 1000).toISOString()
        };
        this.events.log("info", "auth", `Microsoft-Gerätecode bereit: ${data.user_code}`);
        this.publish();
      }
    };
    if (this.proxy) options.connect = (client) => {
      const headers: Record<string, string> = {};
      if (this.proxy?.username) headers["Proxy-Authorization"] = `Basic ${Buffer.from(`${this.proxy.username}:${this.proxy.password}`).toString("base64")}`;
      const request = httpRequest({ host: this.proxy!.host, port: this.proxy!.port, method: "CONNECT", path: `${connection.host}:${connection.port}`, headers });
      request.once("connect", (response, stream) => {
        if (response.statusCode !== 200) return client.emit("error", new Error(`Proxy CONNECT HTTP ${response.statusCode}`));
        client.setSocket(stream); client.emit("connect");
      });
      request.once("error", (error) => client.emit("error", error));
      request.end();
    };
    let bot: Bot;
    try { bot = mineflayer.createBot(options); }
    catch (error) {
      this.connection = "offline";
      this.reconnectAt = null;
      this.diagnose("connect", "error", error instanceof Error ? error.message : String(error));
      this.tokenVault.seal();
      this.publish();
      throw error;
    }
    this.bot = bot;
    this.activeEndpoint = { host: connection.host, port: connection.port };
    const receivedPacketCounts = new Map<string, number>();
    const sentPacketCounts = new Map<string, number>();
    const resourcePackOffers = new Map<string, { forced: boolean; hash: string }>();
    const protocolClient = bot._client as unknown as { write(name: string, params: unknown): void };
    const originalWrite = protocolClient.write.bind(protocolClient);
    protocolClient.write = (name, params) => {
      const count = (sentPacketCounts.get(name) ?? 0) + 1;
      sentPacketCounts.set(name, count);
      const periodicPacket = ["resource_pack_receive", "keep_alive", "pong"].includes(name);
      if (count === 1 || (periodicPacket && (count <= 3 || count % 50 === 0))) {
        this.events.log("info", "protocol", `Client → Server: ${name}${count > 1 ? ` (#${count})` : ""}`);
        this.diagnose("protocol-out", "info", `${name}${count > 1 ? ` #${count}` : ""}`);
      }
      originalWrite(name, params);
    };
    const sendClientBrand = () => {
      setImmediate(() => {
        if (this.bot !== bot) return;
        try {
          const channelClient = bot._client as unknown as { writeChannel(channel: string, value: string): void };
          channelClient.writeChannel("minecraft:brand", "vanilla");
          this.events.log("info", "protocol", "Vanilla-Clientkennung in der initialen Konfigurationsphase gesendet");
          this.diagnose("configuration", "info", "Clientkennung minecraft:brand gesendet");
          this.publish();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.events.log("warn", "protocol", `Clientkennung konnte nicht gesendet werden: ${message}`);
          this.diagnose("configuration", "warn", `Clientkennung fehlgeschlagen: ${message}`);
        }
      });
    };
    bot._client.once("success", sendClientBrand);
    bot._client.prependListener("add_resource_pack", (packet: { uuid: unknown; forced?: boolean; hash?: string }) => {
      const offer = { forced: packet.forced === true, hash: packet.hash ?? "" };
      resourcePackOffers.set(String(packet.uuid), offer);
      this.events.log("info", "protocol", `Resource-Pack-Details: ${offer.forced ? "erzwungen" : "optional"}, Hash ${offer.hash ? "vorhanden" : "fehlt"}`);
      this.diagnose("resource-pack", "info", `Server-Pack ist ${offer.forced ? "erzwungen" : "optional"}`);
    });
    bot._client.on("packet", (data, metadata) => {
      const phase = String(metadata.state ?? "");
      const name = String(metadata.name ?? "");
      const key = `${phase}:${name}`;
      if (!["login", "configuration", "play"].includes(phase)) return;
      if (phase === "configuration" && name === "select_known_packs") {
        const offered = (data as { packs?: Array<{ namespace: string; id: string; version: string }> }).packs;
        const serverKnownPacks = Array.isArray(offered) ? offered : [];
        const compatibleKnownPacks = serverKnownPacks.filter((pack) => pack.version === connection.version);
        const description = serverKnownPacks.map((pack) => `${pack.namespace}:${pack.id}@${pack.version}`).join(", ");
        this.events.log("info", "protocol", `Server bietet ${serverKnownPacks.length} bekannte Packs an${description ? `: ${description}` : ""}`);
        this.diagnose("registry", "info", `Server-Angebot: ${description || "keins"}; versionsgleich: ${compatibleKnownPacks.length}`);
      }
      const count = (receivedPacketCounts.get(key) ?? 0) + 1;
      receivedPacketCounts.set(key, count);
      if (count > 3 && !["finish_configuration", "login", "respawn", "start_configuration"].includes(name)) return;
      this.events.log("info", "protocol", `${phase}-Paket empfangen: ${name}`);
      if (phase === "login" && name === "success") this.acceptedBots.add(bot);
      if (phase === "configuration" && name === "finish_configuration") this.diagnose("configuration", "ok", "Server hat die Konfigurationsphase abgeschlossen");
      if (phase === "play") this.diagnose("play", "ok", `Erstes Play-Paket: ${name}`);
      this.publish();
    });
    bot._client.once("session", () => {
      this.diagnose("microsoft", "ok", "Microsoft- und Minecraft-Sitzung bestätigt");
      this.events.log("info", "auth", "Microsoft- und Minecraft-Sitzung bestätigt");
      this.publish();
    });
    bot._client.once("connect", () => {
      this.diagnose("tcp", "ok", `TCP-Verbindung zu ${connection.host}:${connection.port} hergestellt`);
      this.events.log("info", "bot", `TCP-Verbindung zu ${connection.host}:${connection.port} hergestellt`);
      this.publish();
    });
    this.protocolCleanup?.();
    let worldSwitchGeneration = 0;
    this.protocolCleanup = installHugoSmpProtocolHandlers(bot._client, {
      onKnownPacks: (phase) => { this.diagnose("registry", "info", phase === "initial" ? "Initiale Registry wird synchronisiert" : "Registry für Welt-/Serverwechsel wird synchronisiert"); this.events.log("info", "protocol", phase === "initial" ? "Vollständige HugoSMP-Registry angefordert" : "Vollständige Registry für Welt-/Serverwechsel angefordert"); this.publish(); },
      onReconfiguration: () => {
        worldSwitchGeneration += 1;
        this.clearWorldReadyWait();
        this.clearAutoGuiJoinTimer();
        this.clearAutomationTimers();
        this.worldTransition = { state: "configuring", startedAt: new Date().toISOString(), message: "Registry und Welt werden synchronisiert" };
        this.diagnose("world-change", "info", "Welt-/Serverwechsel erkannt; Steuerung und Makros pausiert");
        bot.physicsEnabled = false;
        bot.clearControlStates();
        this.sneak = false;
        this.sell.detach();
        this.spawner.detach();
        this.events.log("info", "protocol", "Welt-/Serverwechsel erkannt: Bewegung sicher angehalten");
        this.publish();
      },
      onReconfigurationFinished: () => {
        this.clearWorldReadyWait();
        this.worldTransition = { state: "waiting_world", startedAt: this.worldTransition.startedAt ?? new Date().toISOString(), message: "Warte auf die neue Welt" };
        this.diagnose("world-change", "info", "Konfiguration abgeschlossen; warte auf Spawn/Respawn");
        const generation = worldSwitchGeneration;
        let armed = true;
        const cleanupListeners = () => {
          bot.removeListener("login", worldReady);
          bot.removeListener("spawn", worldReady);
          bot.removeListener("respawn", worldReady);
          if (this.worldReadyCleanup === cleanupListeners) this.worldReadyCleanup = null;
        };
        const worldReady = () => {
          if (!armed) return;
          armed = false;
          cleanupListeners();
          this.waitForWorldStability(bot, () => generation === worldSwitchGeneration);
        };
        this.worldReadyCleanup = cleanupListeners;
        bot.once("login", worldReady);
        bot.once("spawn", worldReady);
        bot.once("respawn", worldReady);
      },
      onResourcePack: () => { this.diagnose("resource-pack", "info", "Server-Resource-Pack angeboten"); this.events.log("info", "protocol", "HugoSMP-Resource-Pack angeboten"); this.publish(); },
      onPing: () => { this.events.log("info", "protocol", "HugoSMP-Konfigurations-Ping erkannt"); this.publish(); }
    });
    this.connectTimer = setTimeout(() => {
      if (this.bot !== bot || this.connection === "online") return;
      this.lastError = "Verbindungsaufbau nach 90 Sekunden abgebrochen";
      this.diagnose("connect", "error", this.lastError);
      this.events.log("error", "bot", this.lastError);
      try { bot.end("Connection timeout"); }
      catch { this.handleEnd(bot, "Connection timeout"); }
      setTimeout(() => { if (this.bot === bot) this.handleEnd(bot, "Connection timeout"); }, 250).unref();
      this.publish();
    }, 300_000);
    this.connectTimer.unref();
    bot.on("resourcePack", async (url, packId) => {
      if (this.bot !== bot) return;
      const offer = resourcePackOffers.get(String(packId));
      if (!offer?.forced) {
        bot._client.write("resource_pack_receive", { uuid: String(packId), result: 1 });
        this.diagnose("resource-pack", "ok", "Optionales Resource-Pack korrekt abgelehnt; Welt-Handshake wird fortgesetzt");
        this.events.log("info", "protocol", "Optionales HugoSMP-Resource-Pack mit UUID korrekt abgelehnt");
        this.publish();
        return;
      }
      try {
        bot._client.write("resource_pack_receive", { uuid: String(packId), result: 3 });
        this.diagnose("resource-pack", "info", "Resource-Pack akzeptiert; Download gestartet");
        this.events.log("info", "protocol", "HugoSMP-Resource-Pack akzeptiert");
        const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
        if (!response.ok) throw new Error(`Download HTTP ${response.status}`);
        const length = Number(response.headers.get("content-length") ?? 0);
        if (length > 256 * 1024 * 1024) throw new Error("Resource-Pack ist größer als 256 MB");
        const bytes = await response.arrayBuffer();
        await new Promise((resolve) => setTimeout(resolve, 5_000));
        if (this.bot !== bot) return;
        const downloadedHash = createHash("sha1").update(Buffer.from(bytes)).digest("hex");
        if (offer.hash && downloadedHash.toLowerCase() !== offer.hash.toLowerCase()) {
          throw new Error("Resource-Pack-Hash stimmt nicht mit dem Server-Angebot überein");
        }
        bot._client.write("resource_pack_receive", { uuid: String(packId), result: 4 });
        this.diagnose("resource-pack", "info", `Resource-Pack heruntergeladen (${Math.round(bytes.byteLength / 1024)} KB); SHA-1 bestätigt`);
        this.events.log("info", "protocol", "HugoSMP-Resource-Pack als heruntergeladen gemeldet");
        if (this.bot !== bot) return;
        bot._client.write("resource_pack_receive", { uuid: String(packId), result: 0 });
        this.diagnose("resource-pack", "ok", "Resource-Pack erfolgreich geladen");
        this.events.log("info", "protocol", "HugoSMP-Resource-Pack als geladen bestätigt");
      } catch (error) {
        if (this.bot === bot) bot._client.write("resource_pack_receive", { uuid: String(packId), result: 2 });
        const message = error instanceof Error ? error.message : String(error);
        this.diagnose("resource-pack", "error", `Resource-Pack fehlgeschlagen: ${message}`);
        this.events.log("warn", "protocol", `Resource-Pack konnte nicht geladen werden: ${message}`);
      }
      this.publish();
    });

    bot.once("spawn", () => {
      this.clearConnectTimer();
      this.connection = "online";
      this.worldTransition = { state: "waiting_world", startedAt: new Date().toISOString(), message: "Welt wird stabilisiert" };
      this.joinedAt = new Date().toISOString();
      this.reconnectAttempt = 0;
      this.reconnectAt = null;
      this.authCode = null;
      this.authPending = false;
      this.lastError = null;
      this.serverNotice = null;
      this.diagnose("spawn", "info", `Spawn von ${connection.host} empfangen; Sicherheitsphase läuft`);
      this.publish();
      this.clearWorldReadyWait();
      this.worldReadyTimer = setTimeout(() => {
        this.worldReadyTimer = null;
        if (this.bot !== bot || this.connection !== "online" || this.worldTransition.state !== "waiting_world") return;
        if (!this.isPlayReady()) {
          this.lastError = "Minecraft-Play-State wurde nach dem Spawn nicht stabil";
          this.diagnose("spawn", "error", this.lastError);
          this.events.log("error", "bot", this.lastError);
          bot.end("World state timeout");
          return;
        }
        this.sell.attach(bot);
        this.spawner.attach(bot);
        bot.physicsEnabled = true;
        this.worldTransition = { state: "stable", startedAt: null, message: "Welt bereit" };
        this.setSneak(true);
        this.diagnose("spawn", "ok", `Mit ${connection.host} verbunden und Welt stabil`);
        this.events.log("info", "bot", `Mit ${connection.host} verbunden`);
        void this.webhook.send("connect", "Bot verbunden", `**${bot.username}** ist HugoSMP beigetreten.`);
        if (bot.currentWindow) this.handleAutoGuiJoin(bot, bot.currentWindow);
        this.activateAutomations("join");
        this.publish();
      }, 2_000);
      this.worldReadyTimer.unref();
    });
    bot.on("messagestr", (message) => {
      this.events.emit("chat", { at: new Date().toISOString(), message });
      if (/welt wird in\s+\d+\s+sekunden.*neugestartet/i.test(message)) {
        this.scheduledReconnectDelayMs = 180_000;
        this.worldTransition = { state: "configuring", startedAt: new Date().toISOString(), message: "Weltneustart erkannt; Reconnect in 3 Minuten" };
        this.clearAutomationTimers();
        bot.physicsEnabled = false;
        bot.clearControlStates();
        try { bot.end("Weltneustart erkannt"); } catch { this.handleEnd(bot, "Weltneustart erkannt"); }
      }
    });
    bot.on("windowOpen", (window) => {
      const controls = window.slots.slice(0, window.inventoryStart).flatMap((item, slot) => item ? [`${slot}=${item.name}`] : []).join(", ");
      this.events.log("info", "gui", `${readableMinecraftReason(window.title)} · Inventarstart ${window.inventoryStart}${controls ? ` · ${controls}` : ""}`);
      this.handleAutoGuiJoin(bot, window);
      this.publish();
    });
    bot.on("windowClose", () => this.publish());
    bot.on("respawn", () => {
      if (this.bot !== bot) return;
      // Some proxies and dimension changes only emit respawn, without a
      // configuration phase. Treat those as a full world transition too.
      if (this.worldTransition.state === "stable") {
        this.clearAutoGuiJoinTimer();
        this.clearAutomationTimers();
        this.worldTransition = { state: "waiting_world", startedAt: new Date().toISOString(), message: "Respawn wird stabilisiert" };
        bot.physicsEnabled = false;
        bot.clearControlStates();
        this.sneak = false;
        this.sell.detach();
        this.spawner.detach();
        this.diagnose("world-change", "info", "Respawn-/Dimensionswechsel erkannt; Steuerung und Makros pausiert");
        this.publish();
        this.waitForWorldStability(bot);
      }
    });
    bot.on("kicked", (reason) => {
      const message = this.readableReason(reason);
      this.lastError = message;
      this.diagnose("kick", "error", message);
      const normalized = message.toLowerCase();
      if (/wartung|maintenance/.test(normalized)) this.serverNotice = { type: "maintenance", message, detectedAt: new Date().toISOString() };
      else if (/restart|reboot|neustart|server.*start/.test(normalized)) this.serverNotice = { type: "restart", message, detectedAt: new Date().toISOString() };
      if (this.serverNotice) this.events.log("warn", "monitor", `${this.serverNotice.type === "restart" ? "Serverneustart" : "Wartung"} erkannt`);
      this.events.log("warn", "bot", `Gekickt: ${message}`);
      void this.webhook.send("kick", "Bot gekickt", message);
    });
    bot.on("error", (error) => { this.lastError = error.message; this.diagnose("connection", "error", error.message); this.events.log("error", "bot", error.message); this.publish(); });
    bot.once("end", (reason) => this.handleEnd(bot, reason));
  }

  authenticate(): void {
    if (this.connection === "online") throw new Error("Account ist bereits verbunden und angemeldet");
    if (this.authPromise || this.authPending) throw new Error("Microsoft-Anmeldung läuft bereits");
    const username = this.config.get().connection.username.trim();
    if (!username) throw new Error("Microsoft-Konto ist in Settings nicht konfiguriert");
    if (this.tokenVault.hasTokens()) {
      this.events.log("info", "auth", "Microsoft-Anmeldung ist bereits gespeichert");
      this.publish();
      return;
    }

    const profilesFolder = join(this.dataDir, "auth");
    this.tokenVault.restore();
    mkdirSync(profilesFolder, { recursive: true });
    this.authPending = true;
    this.authCode = null;
    this.lastError = null;
    this.events.log("info", "auth", `Microsoft-Anmeldung für ${username} gestartet`);
    this.publish();

    const flow = new Authflow(username, profilesFolder, {
      authTitle: Titles.MinecraftNintendoSwitch,
      deviceType: "Nintendo",
      flow: "live"
    }, (data) => {
      this.authCode = {
        verificationUri: data.verification_uri,
        userCode: data.user_code,
        expiresAt: new Date(Date.now() + data.expires_in * 1000).toISOString()
      };
      this.events.log("info", "auth", `Microsoft-Gerätecode bereit: ${data.user_code}`);
      this.publish();
    });

    this.authPromise = flow.getMinecraftJavaToken({ fetchProfile: true, fetchCertificates: true })
      .then(({ profile }) => {
        if (!profile?.name) throw new Error("Microsoft-Konto besitzt kein verfügbares Minecraft-Java-Profil");
        this.authPending = false;
        this.authCode = null;
        this.lastError = null;
        this.events.log("info", "auth", `Microsoft-Anmeldung erfolgreich: ${profile.name}`);
        this.tokenVault.seal();
        this.publish();
      })
      .catch((error: unknown) => {
        this.authPending = false;
        this.authCode = null;
        this.lastError = error instanceof Error ? error.message : String(error);
        this.events.log("error", "auth", `Microsoft-Anmeldung fehlgeschlagen: ${this.lastError}`);
        this.tokenVault.seal();
        this.publish();
      })
      .finally(() => { this.authPromise = null; });
  }

  stop(): void {
    this.intentionalStop = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.clearConnectTimer();
    this.clearProtocolHandlers();
    this.clearAutoGuiJoinTimer();
    this.clearWorldReadyWait();
    this.clearAutomationTimers();
    const bot = this.bot;
    this.bot = null;
    this.activeEndpoint = null;
    this.sell.detach();
    this.spawner.detach();
    if (bot) {
      try { bot.quit("Dashboard stop"); } catch { /* Socket ist bereits geschlossen. */ }
      this.events.log("info", "bot", "Verbindung über Dashboard beendet");
      void this.webhook.send("disconnect", "Bot getrennt", `**${bot.username || this.config.get().connection.username}** wurde über das Dashboard getrennt.`);
    }
    this.connection = "offline";
    this.reconnectAt = null;
    this.authCode = null;
    this.authPending = false;
    this.sneak = false;
    this.joinedAt = null;
    this.manualControlActive = false;
    this.autoGuiJoinInFlight = false;
    this.worldTransition = { state: "stable", startedAt: null, message: "Offline" };
    this.publish();
    setTimeout(() => this.tokenVault.seal(), 750).unref();
  }

  dispose(): void { this.stop(); clearInterval(this.pulseTimer); }

  reconnect(): void {
    this.stop();
    this.intentionalStop = false;
    this.reconnectAttempt = 1;
    this.connection = "reconnecting";
    this.reconnectAt = new Date(Date.now() + 1_200).toISOString();
    this.reconnectTimer = setTimeout(() => this.connectSafely("Manueller Reconnect"), 1_200);
    this.publish();
  }

  sendChat(message: string): void {
    if (!this.isPlayReady()) throw new Error(this.connection === "online" ? "Weltwechsel läuft – Chat ist kurz pausiert" : "Bot ist nicht online");
    const controlLock = this.currentControlLock();
    if (controlLock.locked) throw new Error(`Chat gesperrt: ${controlLock.reason}`);
    const bot = this.bot!;
    const trimmed = message.trim();
    if (!trimmed) throw new Error("Nachricht ist leer");
    if (trimmed.length > 256) throw new Error(`Nachricht ist zu lang (${trimmed.length}/256 Zeichen)`);
    bot.chat(trimmed);
  }

  async control(input: Record<string, unknown>): Promise<void> {
    if (!this.isPlayReady()) throw new Error(this.connection === "online" ? "Weltwechsel läuft – Steuerung ist kurz pausiert" : "Bot ist nicht online");
    const controlLock = this.currentControlLock();
    if (controlLock.locked) throw new Error(`Manuelle Steuerung gesperrt: ${controlLock.reason}`);
    const bot = this.bot!;
    const action = String(input.action ?? "");
    this.manualControlActive = true;
    this.publish();
    try {
      if (action === "move") {
        const direction = String(input.direction ?? "forward");
        if (!["forward", "back", "left", "right"].includes(direction)) throw new Error("Ungültige Bewegungsrichtung");
        const requestedBlocks = Number(input.blocks ?? 1);
        if (!Number.isFinite(requestedBlocks)) throw new Error("Ungültige Bewegungsdistanz");
        const blocks = Math.max(1, Math.min(20, requestedBlocks));
        bot.setControlState(direction as "forward" | "back" | "left" | "right", true);
        await new Promise((resolve) => setTimeout(resolve, blocks * 300));
        if (this.bot === bot) bot.setControlState(direction as "forward" | "back" | "left" | "right", false);
      } else if (action === "jump") {
        bot.setControlState("jump", this.readBoolean(input.enabled));
      } else if (action === "sneak") {
        this.setSneak(this.readBoolean(input.enabled));
      } else if (action === "look") {
        const yawDegrees = Number(input.yaw ?? 0);
        const pitchDegrees = Number(input.pitch ?? 0);
        if (!Number.isFinite(yawDegrees) || !Number.isFinite(pitchDegrees)) throw new Error("Ungültiger Blickwinkel");
        const yaw = Math.max(-180, Math.min(180, yawDegrees)) * Math.PI / 180;
        const pitch = Math.max(-90, Math.min(90, pitchDegrees)) * Math.PI / 180;
        await bot.look(yaw, pitch, true);
      } else if (action === "swing") {
        bot.swingArm("right");
      } else if (action === "use") {
        bot.activateItem();
        await new Promise((resolve) => setTimeout(resolve, 250));
        if (this.bot === bot && this.isPlayReady()) bot.deactivateItem();
        } else if (action === "hotbar") {
        const requestedSlot = Number(input.slot ?? 0);
        if (!Number.isInteger(requestedSlot)) throw new Error("Ungültiger Hotbar-Slot");
          bot.setQuickBarSlot(Math.max(0, Math.min(8, requestedSlot)));
        } else if (action === "inventoryClick") {
          const slot = Number(input.slot);
          if (!Number.isInteger(slot) || slot < 0 || slot > 89) throw new Error("Ungültiger Inventar-Slot");
          const button = String(input.mouseButton ?? "left") === "right" ? 1 : 0;
          await bot.clickWindow(slot, button, this.readBoolean(input.shift) ? 1 : 0);
        } else if (action === "dropSlot") {
          const slot = Number(input.slot);
          if (!Number.isInteger(slot) || slot < 0 || slot > 89) throw new Error("Ungültiger Inventar-Slot");
          const item = bot.currentWindow?.slots[slot] ?? bot.inventory.slots[slot];
          if (!item) throw new Error("Dieser Slot ist leer");
          if (this.readBoolean(input.stack)) await bot.tossStack(item);
          else await bot.toss(item.type, item.metadata ?? 0, 1);
        } else if (action === "offhand") {
          const slot = Number(input.slot);
          if (!Number.isInteger(slot) || slot < 0 || slot > 89) throw new Error("Ungültiger Inventar-Slot");
          const item = bot.currentWindow?.slots[slot] ?? bot.inventory.slots[slot];
          if (!item) throw new Error("Dieser Slot ist leer");
          await bot.equip(item, "off-hand");
        } else if (action === "closeWindow") {
        if (bot.currentWindow) bot.closeWindow(bot.currentWindow);
      } else {
        throw new Error("Unbekannte Bot-Aktion");
      }
    } finally {
      this.manualControlActive = false;
      this.publish();
    }
  }

  setSneak(enabled: boolean): void {
    if (!this.bot) return;
    this.bot.setControlState("sneak", enabled);
    this.sneak = enabled;
    this.publish();
  }

  applyConfig(): void {
    const config = this.config.get();
    this.sell.setEnabled(config.sell.enabled);
    this.spawner.setEnabled(config.spawner.enabled);
    this.clearAutomationTimers();
    if (this.isPlayReady()) { this.scheduleAntiAfk(); this.scheduleSpam(); }
    this.publish();
  }

  snapshot(): BotSnapshot {
    const configuredConnection = this.config.get().connection;
    const shownEndpoint = this.bot && this.activeEndpoint ? this.activeEndpoint : configuredConnection;
    const position = this.bot?.entity?.position;
    const currentWindow = this.bot?.currentWindow;
    return {
      connection: this.connection,
      username: this.bot?.username ?? null,
      server: `${shownEndpoint.host}:${shownEndpoint.port}`,
      ping: this.bot?.player?.ping ?? null,
      joinedAt: this.joinedAt,
      sneak: this.sneak,
      reconnectAttempt: this.reconnectAttempt,
      reconnectAt: this.reconnectAt,
      authCode: this.authCode && (!this.authCode.expiresAt || Date.parse(this.authCode.expiresAt) > Date.now()) ? { ...this.authCode } : null,
      serverNotice: this.serverNotice ? { ...this.serverNotice } : null,
      worldTransition: { ...this.worldTransition },
      controlLock: this.currentControlLock(),
      diagnostics: this.diagnostics.map((entry) => ({ ...entry })),
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      deployment: {
        provider: "local",
        environment: process.env.NODE_ENV || "development",
        service: "rcc"
      },
      accountId: this.accountId,
      authenticated: !this.authPending && this.tokenVault.hasTokens(),
      authenticating: this.authPending,
      authExpiresAt: this.tokenVault.expiresAt(),
      lastError: this.lastError,
      health: this.bot?.health ?? null,
      food: this.bot?.food ?? null,
      experienceLevel: this.bot?.experience?.level ?? null,
      position: position ? { x: Math.round(position.x * 10) / 10, y: Math.round(position.y * 10) / 10, z: Math.round(position.z * 10) / 10 } : null,
      pov: this.povSnapshot(),
      inventory: this.bot?.inventory?.items().map((item) => ({
        slot: item.slot,
        name: item.name,
        displayName: item.displayName,
        count: item.count
      })) ?? [],
      window: currentWindow ? {
        title: readableMinecraftReason(currentWindow.title),
        inventoryStart: currentWindow.inventoryStart,
        slots: currentWindow.slots.slice(0, currentWindow.inventoryStart).flatMap((item, slot) => item ? [{ slot, name: item.name, displayName: item.displayName, count: item.count }] : [])
      } : null,
      sell: this.sell.snapshot(),
      spawner: this.spawner.snapshot()
    };
  }

  private povSnapshot(): BotSnapshot["pov"] {
    const bot = this.bot;
    const origin = bot?.entity?.position;
    if (!bot || !origin || this.connection !== "online") return null;
    const blocks: NonNullable<BotSnapshot["pov"]>["blocks"] = [];
    const radius = 9;
    const baseX = Math.floor(origin.x);
    const baseY = Math.floor(origin.y);
    const baseZ = Math.floor(origin.z);
    for (let y = -4; y <= 6; y += 1) {
      for (let x = -radius; x <= radius; x += 1) {
        for (let z = -radius; z <= radius; z += 1) {
          const block = bot.blockAt(origin.offset(x, y, z), false);
          if (!block || block.boundingBox === "empty") continue;
          const exposed = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].some(([ox, oy, oz]) => {
            const neighbor = bot.blockAt(block.position.offset(ox!, oy!, oz!), false);
            return !neighbor || neighbor.boundingBox === "empty";
          });
          if (exposed) blocks.push({ x: block.position.x - baseX, y: block.position.y - baseY, z: block.position.z - baseZ, name: block.name });
        }
      }
    }
    blocks.sort((a, b) => (a.x * a.x + a.y * a.y + a.z * a.z) - (b.x * b.x + b.y * b.y + b.z * b.z));
    return {
      yaw: bot.entity.yaw,
      pitch: bot.entity.pitch,
      eye: { x: origin.x - baseX, y: origin.y - baseY + 1.62, z: origin.z - baseZ },
      blocks: blocks.slice(0, 1200)
    };
  }

  private handleEnd(endedBot: Bot, reason: string): void {
    if (this.bot !== endedBot) return;
    this.clearConnectTimer();
    this.clearProtocolHandlers();
    this.clearAutoGuiJoinTimer();
    this.clearWorldReadyWait();
    const reachedServerLogin = this.acceptedBots.has(endedBot);
    const username = endedBot.username || "Bot";
    this.bot = null;
    this.activeEndpoint = null;
    this.sell.detach();
    this.spawner.detach();
    this.sneak = false;
    this.joinedAt = null;
    this.manualControlActive = false;
    this.autoGuiJoinInFlight = false;
    this.connection = "offline";
    this.worldTransition = { state: "stable", startedAt: null, message: "Offline" };
    const authenticationIncomplete = this.authPending && !this.tokenVault.hasTokens();
    this.authCode = null;
    this.authPending = false;
    this.events.log("warn", "bot", `Verbindung beendet: ${reason}`);
    this.diagnose("disconnect", this.intentionalStop ? "info" : "warn", `Verbindung beendet: ${reason}`);
    this.tokenVault.seal();
    void this.webhook.send("disconnect", "Bot getrennt", `**${username}** wurde getrennt: ${reason}`);
    if (!this.intentionalStop && !authenticationIncomplete) {
      const lastError = this.lastError ?? "";
      const proxySessionBlocked = /bereits.*(?:server|hugosmp)|already.*(?:server|online)|server nicht wechseln|cannot.*switch.*server/i.test(lastError);
      const rateLimited = /warte etwas|too (?:quickly|fast)|rate.?limit|zu schnell/i.test(lastError);
      this.scheduleReconnect(this.scheduledReconnectDelayMs ?? (proxySessionBlocked ? 5_000 : rateLimited ? 60_000 : reachedServerLogin ? 60_000 : 0));
      this.scheduledReconnectDelayMs = null;
    }
    else if (authenticationIncomplete) this.events.log("warn", "auth", "Microsoft-Anmeldung wurde nicht abgeschlossen. Bitte einen neuen Code anfordern.");
    this.publish();
  }

  private scheduleReconnect(minimumDelayMs = 0): void {
    const connection = this.config.get().connection;
    if (!connection.reconnectEnabled) { this.connection = "offline"; return; }
    const backoff = connection.reconnectDelaysSeconds.map((seconds) => seconds * 1000);
    const delay = Math.max(minimumDelayMs, backoff[Math.min(this.reconnectAttempt, backoff.length - 1)]!);
    this.reconnectAttempt += 1;
    this.connection = "reconnecting";
    this.reconnectAt = new Date(Date.now() + delay).toISOString();
    this.events.log("info", "bot", `Reconnect ${this.reconnectAttempt} in ${delay / 1000}s`);
    this.diagnose("reconnect", "info", `Versuch ${this.reconnectAttempt} in ${delay / 1000}s geplant`);
    this.reconnectTimer = setTimeout(() => this.connectSafely("Automatischer Reconnect"), delay);
  }

  private connectSafely(source: string): void {
    this.reconnectTimer = null;
    try { this.connect(); }
    catch (error) {
      this.connection = "offline";
      this.reconnectAt = null;
      this.lastError = error instanceof Error ? error.message : String(error);
      this.events.log("error", "bot", `${source} fehlgeschlagen: ${this.lastError}`);
      this.publish();
    }
  }

  private readableReason(reason: unknown): string {
    return readableMinecraftReason(reason);
  }

  private isPlayReady(): boolean {
    return this.bot !== null && this.connection === "online" && String(this.bot._client.state).toLowerCase() === "play";
  }

  private isWorldReady(): boolean {
    return this.bot !== null && isStablePlayState(this.connection, this.bot._client.state, this.worldTransition.state);
  }

  private publish(): void {
    this.events.state(this.snapshot());
  }

  private clearConnectTimer(): void {
    if (this.connectTimer) clearTimeout(this.connectTimer);
    this.connectTimer = null;
  }

  private clearProtocolHandlers(): void {
    this.protocolCleanup?.();
    this.protocolCleanup = null;
  }

  private diagnose(stage: string, status: BotSnapshot["diagnostics"][number]["status"], message: string): void {
    this.diagnostics.push({ at: new Date().toISOString(), stage, status, message });
    if (this.diagnostics.length > 100) this.diagnostics.splice(0, this.diagnostics.length - 100);
  }

  private handleAutoGuiJoin(bot: Bot, window: NonNullable<Bot["currentWindow"]>): void {
    if (this.autoGuiJoinCompleted || this.autoGuiJoinInFlight || this.autoGuiJoinTimer || this.bot !== bot) return;
    const connection = this.config.get().connection;
    const title = readableMinecraftReason(window.title);
    const availableSlots = window.slots.slice(0, window.inventoryStart).flatMap((item, slot) => item ? [slot] : []);
    const decision = decideAutoGuiJoin(title, availableSlots, connection);
    if (!decision.allowed) {
      if (connection.autoGuiJoinEnabled && title.toLocaleLowerCase("de-DE").includes(connection.autoGuiJoinTitleIncludes.trim().toLocaleLowerCase("de-DE"))) {
        this.diagnose("auto-gui-join", "warn", `${decision.reason}; kein Klick ausgeführt`);
      }
      return;
    }
    const controlLock = this.currentControlLock();
    if (controlLock.locked) {
      this.diagnose("auto-gui-join", "warn", `Kein Klick: ${controlLock.reason}`);
      return;
    }
    const scheduledConfig = { ...connection };
    const delay = connection.autoGuiJoinDelayMs;
    this.diagnose("auto-gui-join", "info", `Passendes Fenster „${title}“ erkannt; Slot ${connection.autoGuiJoinSlot} in ${delay} ms`);
    this.autoGuiJoinTimer = setTimeout(() => {
      this.autoGuiJoinTimer = null;
      if (this.bot !== bot || bot.currentWindow !== window || !this.isPlayReady()) {
        this.diagnose("auto-gui-join", "info", "Fenster vor dem Klick geschlossen oder Verbindung nicht mehr bereit");
        this.publish();
        return;
      }
      const currentConnection = this.config.get().connection;
      const currentSlots = window.slots.slice(0, window.inventoryStart).flatMap((item, slot) => item ? [slot] : []);
      const currentDecision = decideAutoGuiJoin(readableMinecraftReason(window.title), currentSlots, currentConnection);
      const currentLock = this.currentControlLock();
      if (!sameAutoGuiJoinConfig(currentConnection, scheduledConfig) || !currentDecision.allowed || currentLock.locked) {
        const reason = !sameAutoGuiJoinConfig(currentConnection, scheduledConfig) ? "Konfiguration wurde geändert" : currentLock.locked ? currentLock.reason : currentDecision.reason;
        this.diagnose("auto-gui-join", "warn", `${reason}; geplanter Klick verworfen`);
        this.publish();
        return;
      }
      this.autoGuiJoinInFlight = true;
      void bot.clickWindow(currentConnection.autoGuiJoinSlot, 0, 0).then(() => {
        if (this.bot !== bot) return;
        this.autoGuiJoinCompleted = true;
        this.diagnose("auto-gui-join", "ok", `Slot ${currentConnection.autoGuiJoinSlot} geklickt`);
        this.events.log("info", "gui", `Auto-GUI-Join: Slot ${currentConnection.autoGuiJoinSlot} geklickt`);
      }).catch((error: unknown) => {
        if (this.bot !== bot) return;
        this.diagnose("auto-gui-join", "error", error instanceof Error ? error.message : String(error));
      }).finally(() => {
        this.autoGuiJoinInFlight = false;
        this.publish();
      });
    }, delay);
    this.autoGuiJoinTimer.unref();
  }

  private clearAutoGuiJoinTimer(): void {
    if (this.autoGuiJoinTimer) clearTimeout(this.autoGuiJoinTimer);
    this.autoGuiJoinTimer = null;
  }

  private clearWorldReadyWait(): void {
    this.worldReadyCleanup?.();
    this.worldReadyCleanup = null;
    if (this.worldReadyTimer) clearTimeout(this.worldReadyTimer);
    this.worldReadyTimer = null;
  }

  private waitForWorldStability(bot: Bot, generationIsCurrent: () => boolean = () => true): void {
    if (this.worldReadyTimer) clearTimeout(this.worldReadyTimer);
    const startedAt = Date.now();
    let delayedWarningReported = false;
    const check = () => {
      this.worldReadyTimer = null;
      if (this.bot !== bot || this.connection !== "online" || !generationIsCurrent()) return;
      if (isNewWorldStable(bot._client.state, Boolean(bot.entity), Date.now() - startedAt)) {
        this.sell.attach(bot);
        this.spawner.attach(bot);
        bot.physicsEnabled = true;
        this.worldTransition = { state: "stable", startedAt: null, message: "Welt bereit" };
        this.setSneak(true);
        this.diagnose("world-change", "ok", "Neue Welt ist stabil; Steuerung und Makros freigegeben");
        this.events.log("info", "protocol", "Welt-/Serverwechsel abgeschlossen: Bewegung wieder aktiviert");
        if (bot.currentWindow) this.handleAutoGuiJoin(bot, bot.currentWindow);
        this.activateAutomations("worldChange");
        this.publish();
        return;
      }
      if (!delayedWarningReported && Date.now() - startedAt >= 20_000) {
        delayedWarningReported = true;
        this.diagnose("world-change", "warn", "Neue Welt benötigt länger als 20 Sekunden; Verbindung bleibt bestehen und Automationen bleiben pausiert");
        this.events.log("warn", "protocol", "Weltwechsel dauert länger; Client wartet weiter, ohne sich auszuloggen");
        this.publish();
      }
      this.worldReadyTimer = setTimeout(check, 500);
      this.worldReadyTimer.unref();
    };
    this.worldReadyTimer = setTimeout(check, 500);
    this.worldReadyTimer.unref();
  }

  private currentControlLock(): BotSnapshot["controlLock"] {
    return determineControlLock(this.worldTransition.state, this.sell.snapshot(), this.spawner.snapshot(), this.manualControlActive);
  }

  private activateAutomations(event: "join" | "worldChange"): void {
    if (!this.bot || !this.isPlayReady()) return;
    const cfg = this.config.get().connection;
    const command = event === "join" ? cfg.joinCommand : cfg.worldChangeCommand;
    if (command.trim()) {
      this.bot.chat(command.trim());
      this.events.log("info", "automation", `${event === "join" ? "Join" : "World-Change"}-Befehl gesendet`);
    }
    this.clearAutomationTimers();
    this.scheduleAntiAfk();
    this.scheduleSpam();
  }

  private scheduleAntiAfk(): void {
    const cfg = this.config.get().connection;
    if (!cfg.antiAfkEnabled || !this.bot) return;
    const seconds = cfg.antiAfkMinSeconds + Math.random() * (cfg.antiAfkMaxSeconds - cfg.antiAfkMinSeconds);
    this.antiAfkTimer = setTimeout(() => {
      this.antiAfkTimer = null;
      if (this.bot && this.isPlayReady() && !this.currentControlLock().locked) {
        this.bot.swingArm("right");
        this.events.log("info", "anti-afk", "Zufällige Aktivität ausgeführt");
      }
      this.scheduleAntiAfk();
    }, Math.round(seconds * 1000));
    this.antiAfkTimer.unref();
  }

  private scheduleSpam(): void {
    const cfg = this.config.get().connection;
    if (!cfg.spamEnabled || !cfg.spamMessage.trim() || !this.bot) return;
    this.spamTimer = setTimeout(() => {
      this.spamTimer = null;
      if (this.bot && this.isPlayReady() && !this.currentControlLock().locked) {
        this.bot.chat(cfg.spamMessage.trim());
        this.events.log("info", "chat-timer", "Geplante Nachricht gesendet");
      }
      this.scheduleSpam();
    }, cfg.spamIntervalSeconds * 1000);
    this.spamTimer.unref();
  }

  private clearAutomationTimers(): void {
    if (this.antiAfkTimer) clearTimeout(this.antiAfkTimer);
    if (this.spamTimer) clearTimeout(this.spamTimer);
    this.antiAfkTimer = null;
    this.spamTimer = null;
  }

  private readBoolean(value: unknown): boolean {
    if (typeof value !== "boolean") throw new Error("Ungültiger Schalterwert");
    return value;
  }

}
