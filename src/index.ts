import { resolve } from "node:path";
import { MultiBotManager } from "./multi-bot-manager.js";
import { ConfigStore } from "./config.js";
import { AppEvents } from "./events.js";
import { startServer } from "./server.js";
import { WebhookNotifier } from "./webhook.js";

const dataDir = resolve(process.env.DATA_DIR || "./data");
const events = new AppEvents();
const config = new ConfigStore(dataDir);
await config.load();
const webhook = new WebhookNotifier(config, events);
const bot = new MultiBotManager(config, events, webhook, dataDir);
startServer(config, events, bot, webhook);

const autoConnectAllowed = process.env.AUTO_CONNECT !== "false";
if (autoConnectAllowed && config.get().accounts.some((account) => account.enabled && !account.paused && account.autoConnect)) {
  try { bot.connect(); } catch (error) { events.log("error", "bot", (error as Error).message); }
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    events.log("info", "server", `${signal} empfangen, Bot wird sauber getrennt`);
    bot.stop();
    setTimeout(() => process.exit(0), 1_250);
  });
}
