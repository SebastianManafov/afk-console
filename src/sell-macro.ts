import type { Bot } from "mineflayer";
import type { ConfigReader } from "./config.js";
import type { AppEvents } from "./events.js";
import { MacroBase, type BotWindow } from "./macro-base.js";
import { readableMinecraftReason } from "./minecraft-text.js";
import type { WebhookNotifier } from "./webhook.js";

export class SellMacro extends MacroBase {
  private busy = false;
  private waitingForGui = false;
  private timer: NodeJS.Timeout | null = null;
  private readonly rejected = new Set<string>();
  private readonly strikes = new Map<string, number>();
  private readonly windowOpenListener = (window: BotWindow) => { void this.onWindow(window); };

  constructor(events: AppEvents, private readonly config: ConfigReader, private readonly webhook: WebhookNotifier) {
    super("sell", events);
  }

  override attach(bot: Bot): void {
    if (this.bot === bot) return;
    this.bot?.removeListener("windowOpen", this.windowOpenListener);
    super.attach(bot);
    bot.on("windowOpen", this.windowOpenListener);
    if (this.config.get().sell.enabled) this.setEnabled(true);
    this.schedule(800);
  }

  override detach(): void {
    this.bot?.removeListener("windowOpen", this.windowOpenListener);
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.busy = false;
    this.waitingForGui = false;
    super.detach();
  }

  override setEnabled(enabled: boolean): void {
    super.setEnabled(enabled);
    if (enabled) this.schedule(100);
  }

  override cancel(): boolean {
    const cancelled = super.cancel();
    if (!cancelled) return false;
    this.waitingForGui = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    return true;
  }

  async runNow(): Promise<void> {
    if (!this.bot || this.busy || !this.runtime.enabled) return;
    try {
      const schedule = this.config.get().sell;
      if (!this.inSchedule(schedule.scheduleStart, schedule.scheduleEnd)) {
        this.setState("waiting", "OUTSIDE_SCHEDULE"); this.schedule(60_000); return;
      }
      if (!this.hasCandidateItems()) { this.setState("waiting", "NO_SELLABLE_ITEMS"); this.schedule(1000); return; }
      this.begin("SEND_SELL_COMMAND");
      this.waitingForGui = true;
      this.bot.chat(this.config.get().sell.command);
      this.events.log("info", "sell", `${this.config.get().sell.command} sent`);
      this.schedule(5500);
    } catch (error) {
      this.waitingForGui = false; this.fail(error);
      await this.webhook.send("macroError", "Sell error", error instanceof Error ? error.message : String(error));
      this.schedule(1500);
    }
  }

  private async onWindow(window: BotWindow): Promise<void> {
    if (!this.runtime.enabled || this.busy || !this.waitingForGui) return;
    const cfg = this.config.get().sell;
    const readableTitle = readableMinecraftReason(window.title);
    const title = readableTitle.toLowerCase();
    const layoutMatches = window.inventoryStart === cfg.confirmSlot + 1 && Boolean(window.slots[cfg.confirmSlot]);
    if (!title.includes(cfg.guiTitleIncludes.toLowerCase()) && !layoutMatches) {
      this.events.log("warn", "sell", `Unexpected GUI ignored: ${readableTitle}`);
      return;
    }
    if (!title.includes(cfg.guiTitleIncludes.toLowerCase())) this.events.log("info", "sell", `Sell GUI detected by layout: inventory start ${window.inventoryStart}, confirmation ${cfg.confirmSlot}`);
    this.waitingForGui = false;
    this.busy = true;
    try {
      const confirmed = await this.fillAndConfirm(window);
      if (confirmed) {
        this.succeed("Sell run using 'Sell items' completed");
        await this.webhook.send("macroSuccess", "Sell successful", "The sell run was completed.");
      }
    } catch (error) {
      if (this.isCancelled(error)) return;
      this.fail(error);
      await this.webhook.send("macroError", "Sell error", (error as Error).message);
    } finally {
      this.busy = false;
      this.bot?.closeWindow(window);
      if (cfg.autoReopen) this.schedule(1500);
      else this.setState("waiting", "WAIT_FOR_MANUAL_RUN");
    }
  }

  private async fillAndConfirm(window: BotWindow): Promise<boolean> {
    const cfg = this.config.get().sell;
    this.setState("running", "FILL_GUI");
    const lastPlayerSlot = cfg.excludeHotbar ? window.inventoryEnd - 10 : window.inventoryEnd - 1;
    for (let slot = window.inventoryStart; slot <= lastPlayerSlot; slot += 1) {
      const item = window.slots[slot];
      if (!item || !this.isSellable(item.name, item.count, item.stackSize)) continue;
      const beforePlayer = this.countItem(window, item.name, window.inventoryStart, window.inventoryEnd - 1);
      const beforeGui = this.countItem(window, item.name, 0, cfg.contentLastSlot);
      if (cfg.useShiftClick) {
        await this.click(slot, 1);
      } else {
        await this.click(slot);
        await this.wait(Math.max(50, Math.floor(cfg.fillDelayMs / 2)));
        const target = window.slots.slice(0, cfg.contentLastSlot + 1).findIndex((candidate) => !candidate);
        if (target >= 0) await this.click(target);
      }
      const pause = cfg.minPauseMs + Math.random() * (cfg.maxPauseMs - cfg.minPauseMs);
      await this.wait(cfg.fillDelayMs + Math.round(pause));
      const moved = this.countItem(window, item.name, window.inventoryStart, window.inventoryEnd - 1) < beforePlayer
        || this.countItem(window, item.name, 0, cfg.contentLastSlot) > beforeGui;
      if (!moved) {
        const strikes = (this.strikes.get(item.name) ?? 0) + 1;
        this.strikes.set(item.name, strikes);
        if (strikes >= 3) {
          this.rejected.add(item.name);
          this.events.log("warn", "sell", `${item.name} was skipped after three rejections`);
        }
      } else {
        this.strikes.delete(item.name);
      }
    }
    const content = window.slots.slice(0, cfg.contentLastSlot + 1);
    const hasGuiItems = content.some(Boolean);
    if (!hasGuiItems) {
      this.setState("waiting", "NO_ACCEPTED_ITEMS");
      return false;
    }
    if (!cfg.confirmPartial && content.some((item) => !item)) {
      this.setState("waiting", "WAIT_FOR_FULL_SELL_GUI");
      return false;
    }
    if (!window.slots[cfg.confirmSlot]) throw new Error(`Sell confirmation is missing in slot ${cfg.confirmSlot}`);
    this.setState("running", `CONFIRM_SLOT_${cfg.confirmSlot}`);
    await this.click(cfg.confirmSlot);
    await this.wait(cfg.confirmDelayMs);
    return true;
  }

  private hasCandidateItems(): boolean {
    if (!this.bot) return false;
    const cfg = this.config.get().sell;
    const items = this.bot.inventory.items().filter((item) => !cfg.excludeHotbar || item.slot < 36);
    return items.some((item) => this.isSellable(item.name, item.count, item.stackSize));
  }

  private isSellable(name: string, count: number, stackSize: number): boolean {
    return !this.rejected.has(name) && (!this.config.get().sell.onlyFullStacks || count >= stackSize);
  }

  private countItem(window: BotWindow, name: string, start: number, end: number): number {
    return window.slots.slice(start, end + 1).reduce((sum, item) => sum + (item?.name === name ? item.count : 0), 0);
  }

  private schedule(ms: number): void {
    if (this.timer) clearTimeout(this.timer);
    if (!this.runtime.enabled) return;
    this.timer = setTimeout(() => {
      if (this.waitingForGui) {
        this.waitingForGui = false;
        this.fail(new Error("Sell GUI did not open within 5 seconds"));
      }
      void this.runNow();
    }, ms);
    this.timer.unref();
  }
}
