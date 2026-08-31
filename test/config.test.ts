import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ConfigStore } from "../src/config.js";

test("Standardwerte entsprechen der analysierten Mod-Konfiguration", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hugo-afk-defaults-"));
  try {
    const config = await new ConfigStore(directory, "test-encryption-secret-with-32-characters").load();
    assert.equal(config.sell.fillDelayMs, 150);
    assert.equal(config.sell.confirmDelayMs, 400);
    assert.equal(config.sell.useShiftClick, true);
    assert.equal(config.sell.guiTitleIncludes, "items verkaufen");
    assert.equal(config.sell.contentLastSlot, 34);
    assert.equal(config.sell.confirmSlot, 35);
    assert.equal(config.spawner.clickDelayMs, 250);
    assert.equal(config.spawner.mode, "ALWAYS");
    assert.equal(config.spawner.dropAllSlot, 53);
    assert.equal(config.spawner.sellAllSlot, 45);
    assert.equal(config.spawner.pageLeftSlot, 48);
    assert.equal(config.spawner.pageRightSlot, 50);
    assert.deepEqual(config.spawner.dropItemNames, ["bone", "minecraft:bone"]);
    assert.equal(config.spawner.arrowAbort, true);
    assert.equal(config.spawner.orderEnabled, false);
    assert.equal(config.spawner.orderCommand, "/order bone");
    assert.equal(config.spawner.orderGuiTitleIncludes, "orders");
    assert.equal(config.spawner.orderDeliverGuiTitleIncludes, "beliefern");
    assert.equal(config.spawner.orderAutoDetect, true);
    assert.equal(config.spawner.orderHighestSlot, 2);
    assert.equal(config.spawner.orderDeliverAllSlot, 6);
    assert.equal(config.spawner.orderContentLastSlot, 35);
    assert.equal(config.spawner.orderPageLeftSlot, 48);
    assert.equal(config.spawner.orderPageRightSlot, 50);
    assert.equal(config.spawner.orderMinDelayMs, 450);
    assert.equal(config.spawner.orderMaxDelayMs, 1100);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Konfiguration bleibt persistent und maskiert die Webhook-URL in der API", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hugo-afk-test-"));
  try {
    const store = new ConfigStore(directory, "test-encryption-secret-with-32-characters");
    await store.load();
    const current = store.get();
    const url = "https://discord.com/api/webhooks/123/secret";
    const publicConfig = await store.update({ webhook: { ...current.webhook, enabled: true, url } });
    assert.equal(publicConfig.webhook.url, "configured");
    const persisted = JSON.parse(await readFile(join(directory, "config.json"), "utf8"));
    assert.match(persisted.webhook.url, /^enc:v1:/);
    assert.notEqual(persisted.webhook.url, url);
    const reloaded = new ConfigStore(directory, "test-encryption-secret-with-32-characters");
    assert.equal((await reloaded.load()).webhook.url, url);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Verbindungsprofil wird validiert und persistent gespeichert", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rcc-connection-"));
  try {
    const store = new ConfigStore(directory, "test-encryption-secret-with-32-characters");
    const initial = await store.load();
    await store.update({
      connection: {
        ...initial.connection,
        profileName: "RCC HugoSMP",
        host: "play.example.net",
        port: 25566,
        version: "1.21.11",
        username: "player@example.com",
        autoConnect: true
      }
    });
    const reloaded = await new ConfigStore(directory, "test-encryption-secret-with-32-characters").load();
    assert.equal(reloaded.connection.profileName, "RCC HugoSMP");
    assert.equal(reloaded.connection.host, "play.example.net");
    assert.equal(reloaded.connection.port, 25566);
    assert.equal(reloaded.connection.username, "player@example.com");
    assert.equal(reloaded.connection.autoConnect, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Multi-Account-Profile und Proxy-Passwort bleiben getrennt und verschlüsselt", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rcc-multi-"));
  try {
    const secret = "test-encryption-secret-with-32-characters";
    const store = new ConfigStore(directory, secret); const initial = await store.load();
    const server = { ...initial.servers[0]!, id: "second", name: "Second", host: "play.example.net", port: 25565, version: "1.21.11", autoGuiJoinEnabled: false, autoGuiJoinTitleIncludes: "", autoGuiJoinSlot: 0, autoGuiJoinDelayMs: 750 };
    const proxy = { id: "proxy-1", name: "Proxy", host: "127.0.0.1", port: 8080, username: "user", password: "top-secret" };
    const account = { id: "second-account", name: "Second Bot", username: "second@example.com", serverId: server.id, proxyId: proxy.id, enabled: true, paused: false, autoConnect: false, reconnectEnabled: true, reconnectDelaysSeconds: [5, 15, 30, 60], sell: { ...initial.sell, command: "/sell second" }, spawner: null };
    const publicValue = await store.update({ servers: [...initial.servers, server], proxies: [proxy], accounts: [...initial.accounts, account] });
    assert.equal(publicValue.proxies[0]!.password, "configured");
    const persisted = JSON.parse(await readFile(join(directory, "config.json"), "utf8"));
    assert.match(persisted.proxies[0].password, /^enc:v1:/);
    const reloaded = await new ConfigStore(directory, secret).load();
    assert.equal(reloaded.proxies[0]!.password, "top-secret");
    assert.equal(reloaded.accounts[1]!.sell?.command, "/sell second");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("Ungültige Account-, Server- und Reconnect-Einstellungen werden abgelehnt", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rcc-validation-"));
  try {
    const store = new ConfigStore(directory, "test-encryption-secret-with-32-characters"); const initial = await store.load();
    await assert.rejects(() => store.update({ accounts: initial.accounts.map((account) => ({ ...account, username: "keine-email" })) }), /Microsoft-E-Mail/);
    await assert.rejects(() => store.update({ servers: initial.servers.map((server) => ({ ...server, port: 70000 })) }), /Serverport/);
    await assert.rejects(() => store.update({ accounts: initial.accounts.map((account) => ({ ...account, reconnectDelaysSeconds: [] })) }), /Reconnect-Regeln/);
    await assert.rejects(() => store.update({ accounts: initial.accounts.map((account) => ({ ...account, sell: { ...initial.sell, confirmSlot: 36 } })) }), /Sell-Slots/);
    await assert.rejects(() => store.update({ servers: [] }), /Mindestens ein Server/);
    await assert.rejects(() => store.update({ accounts: [] }), /Mindestens ein Server und Account/);
    await assert.rejects(() => store.update({ accounts: initial.accounts.map((account) => ({ ...account, proxyId: "fehlt" })) }), /Proxyprofil/);
    const duplicateProxy = { id: "doppelt", name: "Proxy", host: "127.0.0.1", port: 8080, username: "", password: "" };
    await assert.rejects(() => store.update({ proxies: [duplicateProxy, { ...duplicateProxy, name: "Proxy 2" }] }), /Doppelte Profil-ID/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("Ältere Serverprofile erhalten sichere Auto-GUI- und Automations-Standardwerte", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rcc-server-migration-"));
  try {
    const store = new ConfigStore(directory, "test-encryption-secret-with-32-characters");
    const initial = await store.load();
    const legacyServer = { ...initial.servers[0] } as Record<string, unknown>;
    delete legacyServer.autoGuiJoinEnabled;
    delete legacyServer.autoGuiJoinTitleIncludes;
    delete legacyServer.autoGuiJoinSlot;
    delete legacyServer.autoGuiJoinDelayMs;
    for (const key of ["joinCommand", "worldChangeCommand", "antiAfkEnabled", "antiAfkMinSeconds", "antiAfkMaxSeconds", "spamEnabled", "spamMessage", "spamIntervalSeconds"]) delete legacyServer[key];
    await store.update({ servers: [legacyServer as unknown as typeof initial.servers[number]] });
    const migrated = store.get().servers[0]!;
    assert.equal(migrated.autoGuiJoinEnabled, false);
    assert.equal(migrated.autoGuiJoinTitleIncludes, "");
    assert.equal(migrated.autoGuiJoinSlot, 0);
    assert.equal(migrated.autoGuiJoinDelayMs, 750);
    assert.equal(migrated.antiAfkEnabled, false);
    assert.equal(migrated.antiAfkMinSeconds, 45);
    assert.equal(migrated.antiAfkMaxSeconds, 90);
    assert.equal(migrated.spamEnabled, false);
    assert.equal(migrated.spamIntervalSeconds, 60);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("Ältere Account-Makroeinstellungen erhalten neue sichere GUI-Standardwerte", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rcc-account-migration-"));
  try {
    const store = new ConfigStore(directory, "test-encryption-secret-with-32-characters");
    const initial = await store.load();
    const legacySell = { ...initial.sell } as Record<string, unknown>;
    delete legacySell.guiTitleIncludes; delete legacySell.contentLastSlot; delete legacySell.confirmSlot;
    await store.update({ accounts: initial.accounts.map((account) => ({ ...account, sell: legacySell as typeof initial.sell })) });
    const reloaded = await new ConfigStore(directory, "test-encryption-secret-with-32-characters").load();
    assert.equal(reloaded.accounts[0]!.sell?.guiTitleIncludes, "items verkaufen");
    assert.equal(reloaded.accounts[0]!.sell?.contentLastSlot, 34);
    assert.equal(reloaded.accounts[0]!.sell?.confirmSlot, 35);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
