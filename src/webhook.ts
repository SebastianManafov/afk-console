import type { ConfigReader } from "./config.js";
import type { AppEvents } from "./events.js";

export type WebhookEvent = "connect" | "disconnect" | "kick" | "macroSuccess" | "macroError" | "arrowAbort" | "test";

const colors: Record<WebhookEvent, number> = {
  connect: 0x35d07f,
  disconnect: 0xf0a33a,
  kick: 0xef5350,
  macroSuccess: 0x35d07f,
  macroError: 0xef5350,
  arrowAbort: 0xffb020,
  test: 0x7c6cff
};

export class WebhookNotifier {
  constructor(private readonly config: ConfigReader, private readonly events: AppEvents) {}

  async send(event: WebhookEvent, title: string, description: string): Promise<boolean> {
    const { webhook } = this.config.get();
    if (!webhook.url || (!webhook.enabled && event !== "test")) return false;
    const allowed = event === "test"
      || (event === "connect" && webhook.notifyConnect)
      || (event === "disconnect" && webhook.notifyDisconnect)
      || (event === "kick" && webhook.notifyKick)
      || (event === "macroSuccess" && webhook.notifyMacroSuccess)
      || (event === "macroError" && webhook.notifyMacroError)
      || (event === "arrowAbort" && webhook.notifyArrowAbort);
    if (!allowed) return false;

    try {
      const response = await fetch(webhook.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: webhook.username,
          allowed_mentions: { parse: [] },
          embeds: [{ title, description, color: colors[event], timestamp: new Date().toISOString() }]
        }),
        signal: AbortSignal.timeout(8000)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return true;
    } catch (error) {
      this.events.log("error", "webhook", `Webhook fehlgeschlagen: ${(error as Error).message}`);
      return false;
    }
  }
}
