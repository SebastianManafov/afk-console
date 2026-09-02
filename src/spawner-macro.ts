import type { Bot } from "mineflayer";
import { findAbortArrow } from "./arrow-policy.js";
import type { ConfigReader } from "./config.js";
import type { AppEvents } from "./events.js";
import { MacroBase, type BotWindow } from "./macro-base.js";
import { readableMinecraftReason } from "./minecraft-text.js";
import type { WebhookNotifier } from "./webhook.js";
import type { AppConfig } from "./types.js";

export class SpawnerMacro extends MacroBase {
  private busy = false;
  private waitingForGui = false;
  private timer: NodeJS.Timeout | null = null;
  private detectedSlots: { sellAllSlot: number; pageLeftSlot: number; pageRightSlot: number; dropAllSlot: number } | null = null;
  private readonly windowOpenListener = (window: BotWindow) => { void this.onWindow(window); };

  constructor(events: AppEvents, private readonly config: ConfigReader, private readonly webhook: WebhookNotifier) {
    super("spawner", events);
  }

  override attach(bot: Bot): void {
    if (this.bot === bot) return;
    this.bot?.removeListener("windowOpen", this.windowOpenListener);
    super.attach(bot);
    bot.on("windowOpen", this.windowOpenListener);
    if (this.config.get().spawner.enabled) this.setEnabled(true);
    this.scheduleNext();
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
    if (enabled) this.scheduleNext();
    else if (this.timer) clearTimeout(this.timer);
  }

  override cancel(): boolean {
    const cancelled = super.cancel();
    if (!cancelled) return false;
    this.waitingForGui = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    for (const control of ["forward", "back", "left", "right", "jump", "sneak"] as const) this.bot?.setControlState(control, false);
    if (this.bot?.currentWindow) this.bot.closeWindow(this.bot.currentWindow);
    return true;
  }

  async runNow(): Promise<void> {
    if (!this.bot || !this.runtime.enabled || this.busy || this.waitingForGui) return;
    try {
      const schedule = this.config.get().spawner;
      if (!this.inSchedule(schedule.scheduleStart, schedule.scheduleEnd)) {
        this.setState("waiting", "OUTSIDE_SCHEDULE");
        this.scheduleNext();
        return;
      }
      this.begin("TELEPORT_HOME_TOP");
      const cfg = this.config.get().spawner;
      await this.teleport(cfg.homeTopCommand, "HOME_TOP");
      await this.teleport(cfg.homeBottomCommand, "HOME_BOTTOM");
      await this.movementSequence(cfg.movementStepMs);
      this.setState("running", "FIND_SPAWNER");
      await this.bot.waitForChunksToLoad();
      const block = this.bot.findBlock({ matching: (candidate) => candidate.name.includes("spawner"), maxDistance: 8 });
      if (!block) throw new Error("No spawner block found within 8 blocks");
      this.setState("running", "OPEN_SPAWNER");
      this.waitingForGui = true;
      await this.bot.activateBlock(block);
      this.timer = setTimeout(() => { if (this.waitingForGui) void this.handleFailure(new Error("Spawner GUI did not open")); }, 6000);
    } catch (error) { await this.handleFailure(error); }
  }

  private async onWindow(window: BotWindow): Promise<void> {
    if (!this.runtime.enabled || this.busy || !this.waitingForGui) return;
    const cfg = this.config.get().spawner;
    const readableTitle = readableMinecraftReason(window.title);
    const title = readableTitle.toLowerCase();
    const layoutMatches = window.inventoryStart === 54 && [cfg.sellAllSlot, cfg.pageLeftSlot, cfg.pageRightSlot, cfg.dropAllSlot].every((slot) => Boolean(window.slots[slot]));
    if (!title.includes(cfg.guiTitleIncludes.toLowerCase()) && !layoutMatches) {
      this.events.log("warn", "spawner", `Unexpected GUI ignored: ${readableTitle} / ${window.inventoryStart} slots`);
      return;
    }
    if (!title.includes(cfg.guiTitleIncludes.toLowerCase())) this.events.log("info", "spawner", `Spawner GUI detected by layout: slots 0–44 contain items, controls ${cfg.sellAllSlot}/${cfg.pageLeftSlot}/${cfg.pageRightSlot}/${cfg.dropAllSlot}`);
    if (this.timer) clearTimeout(this.timer);
    this.waitingForGui = false;
    this.busy = true;
    let spawnerWindowClosed = false;
    let takenOver = false;
    try {
      this.detectedSlots = cfg.autoDetectSlots ? this.detectControls(window, cfg) : null;
      this.logWindow(window);
      const arrow = cfg.arrowAbort ? await this.preflightPages(window) : null;
      if (arrow) {
        const message = `Arrow filter: ${arrow.count}× ${arrow.name} in slot ${arrow.slot} detected. Run ended without Drop All.`;
        this.setState("blocked", "ARROW_FILTER_ABORT", message);
        this.events.log("warn", "spawner", message);
        await this.webhook.send("arrowAbort", "Spawner run stopped", message);
        return;
      }
      if (cfg.mode === "PAGE_FULL" && !this.isPageFull(window)) {
        this.setState("waiting", "WAIT_FOR_FULL_PAGE");
      this.events.log("info", "spawner", "Spawner page is not full yet");
        return;
      }
      if (cfg.skeletonFilter) await this.processFilteredPages(window);
      else await this.clickDropAll(window);
      if (cfg.orderEnabled) {
        this.bot?.closeWindow(window);
        spawnerWindowClosed = true;
        await this.deliverBonesToHighestOrder(cfg);
      }
      this.succeed(cfg.orderEnabled ? "Spawner processed and bones delivered to the highest order" : "Spawner Drop All executed");
      await this.webhook.send("macroSuccess", "Spawner successful", cfg.orderEnabled ? "Spawner was processed and all available bones were delivered to the highest order." : "Drop All was executed without detected arrows.");
    } catch (error) {
      if (this.isCancelled(error)) { takenOver = true; return; }
      await this.handleFailure(error);
    } finally {
      this.busy = false;
      if (!spawnerWindowClosed) this.bot?.closeWindow(window);
      else if (this.bot?.currentWindow) this.bot.closeWindow(this.bot.currentWindow);
      if (!takenOver && this.bot && cfg.afkHomeCommand.trim()) { this.setState("running", "RETURN_HOME_AFK"); this.bot.chat(cfg.afkHomeCommand); }
      this.detectedSlots = null;
      this.scheduleNext();
    }
  }

  private async preflightPages(window: BotWindow): Promise<{ name: string; count: number; slot: number } | null> {
    const cfg = this.config.get().spawner;
    this.setState("running", "ARROW_PREFLIGHT_PAGE_1");
    let navigated = 0;
    let previous = this.contentSignature(window);
    for (let page = 1; page <= cfg.maxPages; page += 1) {
      const arrow = findAbortArrow(window.slots, cfg.contentLastSlot, cfg.arrowItemNames);
      if (arrow) return arrow;
      const nextButton = window.slots[this.controlSlot("pageRightSlot", cfg)];
      if (!nextButton || this.contentCount(window) <= cfg.contentLastSlot) break;
      await this.click(this.controlSlot("pageRightSlot", cfg));
      await this.wait(cfg.clickDelayMs);
      const current = this.contentSignature(window);
      if (current === previous) break;
      previous = current;
      navigated += 1;
      this.setState("running", `ARROW_PREFLIGHT_PAGE_${page + 1}`);
    }
    this.setState("running", "RETURN_TO_FIRST_PAGE");
    while (navigated > 0) {
      await this.click(this.controlSlot("pageLeftSlot", cfg));
      await this.wait(cfg.clickDelayMs);
      navigated -= 1;
    }
    return null;
  }

  private async processFilteredPages(window: BotWindow): Promise<void> {
    const cfg = this.config.get().spawner;
    let pagesNavigated = 0;
    let sawAnyItems = false;
    let operations = 0;
    this.setState("running", "FILTER_DROP_ITEMS");
    while (operations < 512) {
      operations += 1;
      const items = window.slots.slice(0, cfg.contentLastSlot + 1).filter((item) => Boolean(item));
      if (items.length) sawAnyItems = true;
      const dropItems = items.filter((item) => item && this.isDropItem(item.name));
      if (dropItems.length) {
        if (dropItems.length === items.length) await this.clickDropAll(window);
        else {
          await this.click(dropItems[0]!.slot);
          await this.wait(cfg.clickDelayMs);
        }
        continue;
      }
      if (items.length <= cfg.contentLastSlot || pagesNavigated >= cfg.maxPages) break;
      const previous = this.contentSignature(window);
      await this.click(this.controlSlot("pageRightSlot", cfg));
      await this.wait(cfg.clickDelayMs);
      if (this.contentSignature(window) === previous) break;
      pagesNavigated += 1;
    }
    if (operations >= 512) throw new Error("Spawner filter reached the safety limit");
    if (sawAnyItems) {
      this.setState("running", "SELL_REMAINING_SLOT_45");
      await this.click(this.controlSlot("sellAllSlot", cfg));
      await this.wait(cfg.clickDelayMs);
    }
    this.setState("running", "RETURN_PAGES");
    while (pagesNavigated > 0) {
      await this.click(this.controlSlot("pageLeftSlot", cfg));
      await this.wait(cfg.clickDelayMs);
      pagesNavigated -= 1;
    }
  }

  private async clickDropAll(window: BotWindow): Promise<void> {
    const cfg = this.config.get().spawner;
    const slot = this.controlSlot("dropAllSlot", cfg);
    this.setState("running", `CLICK_DROP_ALL_SLOT_${slot}`);
    const button = window.slots[slot];
    if (!button) throw new Error(`Drop-All slot ${slot} is empty`);
    this.events.log("info", "spawner", `Drop All: Slot ${slot}, Item ${button.name}`);
    await this.click(slot);
    await this.wait(cfg.clickDelayMs);
  }

  private isPageFull(window: BotWindow): boolean {
    return this.contentCount(window) === this.config.get().spawner.contentLastSlot + 1;
  }

  private isDropItem(name: string): boolean {
    const normalized = name.toLowerCase().replace(/^minecraft:/, "");
    return this.config.get().spawner.dropItemNames.some((item) => item.toLowerCase().replace(/^minecraft:/, "") === normalized);
  }

  private contentCount(window: BotWindow): number {
    return window.slots.slice(0, this.config.get().spawner.contentLastSlot + 1).filter(Boolean).length;
  }

  private contentSignature(window: BotWindow): string {
    return window.slots.slice(0, this.config.get().spawner.contentLastSlot + 1)
      .map((item) => item ? `${item.name}:${item.count}` : "-")
      .join("|");
  }

  private logWindow(window: BotWindow): void {
    const cfg = this.config.get().spawner;
    const controls = [this.controlSlot("sellAllSlot", cfg), this.controlSlot("pageLeftSlot", cfg), this.controlSlot("pageRightSlot", cfg), this.controlSlot("dropAllSlot", cfg)]
      .map((slot) => `${slot}=${window.slots[slot]?.name ?? "empty"}`)
      .join(", ");
    this.events.log("info", "spawner", `GUI detected: ${readableMinecraftReason(window.title)}; ${controls}`);
  }

  private async waitForTeleport(x: number, y: number, z: number): Promise<void> {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await this.wait(250);
      if (!this.bot) throw new Error("Connection lost during teleport");
      const p = this.bot.entity.position;
      if (Math.hypot(p.x - x, p.y - y, p.z - z) > 3) return;
    }
    throw new Error("Teleport to /home spawner was not detected");
  }

  private async teleport(command: string, phase: string): Promise<void> {
    if (!this.bot || !command.trim()) return;
    this.setState("running", `TELEPORT_${phase}`); const start = this.bot.entity.position.clone(); this.bot.chat(command);
    try { await this.waitForTeleport(start.x, start.y, start.z); } catch { this.events.log("warn", "spawner", `${command}: no position change detected; continuing`); }
  }

  private async movementSequence(ms: number): Promise<void> {
    if (!this.bot) return; this.setState("running", "MOVE_W_S_D");
    for (const control of ["forward", "back", "right"] as const) { this.bot.setControlState(control, true); await this.wait(Math.max(50, ms)); this.bot.setControlState(control, false); await this.wait(100); }
  }

  private async deliverBonesToHighestOrder(cfg: AppConfig["spawner"]): Promise<void> {
    if (!this.bot) throw new Error("Connection lost before bone order");
    const bones = this.bot.inventory.items().filter((item) => /^(minecraft:)?bone$/i.test(item.name)).reduce((sum, item) => sum + item.count, 0);
    if (!bones) { this.events.log("info", "spawner", "Bone order skipped: no bones in inventory"); return; }
    await this.teleport(cfg.homeTopCommand, "ORDER_HOME_TOP");
    await this.waitHuman(cfg);
    this.setState("running", "OPEN_BONE_ORDER");
    const orderWindowPromise = this.waitForNextWindow(7_500);
    this.bot.chat(cfg.orderCommand);
    const orderWindow = await orderWindowPromise;
    const orderTitle = readableMinecraftReason(orderWindow.title);
    const orderLayoutMatches = orderWindow.inventoryStart === 54 && Boolean(orderWindow.slots[cfg.orderPageLeftSlot]) && Boolean(orderWindow.slots[cfg.orderPageRightSlot]);
    if (cfg.orderGuiTitleIncludes && !orderTitle.toLowerCase().includes(cfg.orderGuiTitleIncludes.toLowerCase()) && !orderLayoutMatches) throw new Error(`Unexpected order GUI: ${orderTitle}`);
    const highestSlot = cfg.orderAutoDetect ? await this.findHighestOrderSlot(orderWindow, cfg) : cfg.orderHighestSlot;
    this.setState("running", `SELECT_HIGHEST_BONE_ORDER_SLOT_${highestSlot}`);
    this.events.log("info", "spawner", `Bone order: ${bones} bones, highest order in slot ${highestSlot}`);
    await this.waitHuman(cfg);
    const deliveryWindowPromise = this.waitForNextWindow(7_500);
    try { await this.click(highestSlot); } catch (error) { void deliveryWindowPromise.catch(() => {}); throw error; }
    const activeWindow = await deliveryWindowPromise;
    const deliveryTitle = readableMinecraftReason(activeWindow.title);
    const deliveryLayoutMatches = activeWindow.inventoryStart === 9 && Boolean(activeWindow.slots[cfg.orderDeliverAllSlot]);
    if (cfg.orderDeliverGuiTitleIncludes && !deliveryTitle.toLowerCase().includes(cfg.orderDeliverGuiTitleIncludes.toLowerCase()) && !deliveryLayoutMatches) throw new Error(`Unexpected delivery GUI: ${deliveryTitle}`);
    await this.waitHuman(cfg);
    const deliverSlot = cfg.orderAutoDetect ? this.findDeliverAllSlot(activeWindow, cfg.orderDeliverAllSlot) : cfg.orderDeliverAllSlot;
    if (!activeWindow.slots[deliverSlot]) throw new Error(`Deliver-All slot ${deliverSlot} is empty`);
    this.setState("running", `DELIVER_ALL_BONES_SLOT_${deliverSlot}`);
    await this.waitHuman(cfg);
    await this.click(deliverSlot);
    await this.waitHuman(cfg);
    this.events.log("info", "spawner", `All available bones delivered to the order (slot ${deliverSlot})`);
  }

  private waitForNextWindow(timeoutMs: number): Promise<BotWindow> {
    const bot = this.bot;
    if (!bot) return Promise.reject(new Error("Bot is not connected"));
    return new Promise((resolve, reject) => {
      const onOpen = (window: BotWindow) => { clearTimeout(timer); resolve(window); };
      const timer = setTimeout(() => { bot.removeListener("windowOpen", onOpen); reject(new Error("Bone order GUI did not open")); }, timeoutMs);
      bot.once("windowOpen", onOpen);
    });
  }

  private async findHighestOrderSlot(window: BotWindow, cfg: AppConfig["spawner"]): Promise<number> {
    let best: { page: number; slot: number; value: number; priced: boolean } | null = null;
    let navigated = 0;
    let previous = this.orderSignature(window, cfg);
    for (let page = 0; page < cfg.orderMaxPages; page += 1) {
      for (const item of window.slots.slice(0, cfg.orderContentLastSlot + 1).filter(Boolean)) {
        if (!/^(minecraft:)?bone$/i.test(item!.name)) continue;
        let metadata = `${item!.displayName ?? ""}`;
        try { metadata += ` ${JSON.stringify(item!.nbt ?? {})}`; } catch { /* Unlesbare Metadaten lassen den ersten Bone-Slot als Fallback bestehen. */ }
        const priced = /preis|price|coin|geld|\$|€|order|auftrag/i.test(metadata);
        const numbers = priced ? [...metadata.matchAll(/\d[\d.,]*/g)].map((match) => Number(match[0].replace(/\.(?=\d{3}(?:\D|$))/g, "").replace(",", "."))).filter(Number.isFinite) : [];
        const value = numbers.length ? Math.max(...numbers) : Number.NEGATIVE_INFINITY;
        if (!best || (numbers.length > 0 && (!best.priced || value > best.value))) best = { page, slot: item!.slot, value, priced: numbers.length > 0 };
      }
      if (!window.slots[cfg.orderPageRightSlot] || page + 1 >= cfg.orderMaxPages) break;
      await this.click(cfg.orderPageRightSlot); await this.waitHuman(cfg);
      const current = this.orderSignature(window, cfg);
      if (current === previous) break;
      previous = current; navigated += 1;
    }
    while (navigated > 0) { await this.click(cfg.orderPageLeftSlot); await this.waitHuman(cfg); navigated -= 1; }
    if (!best) throw new Error("No active bone order found in slots 0–35");
    for (let page = 0; page < best.page; page += 1) { await this.click(cfg.orderPageRightSlot); await this.waitHuman(cfg); }
    if (!best.priced) this.events.log("warn", "spawner", `No price lore detected; using first bone slot ${best.slot} on page ${best.page + 1}`);
    else this.events.log("info", "spawner", `Highest bone order on page ${best.page + 1}, slot ${best.slot}, price value ${best.value}`);
    return best.slot;
  }

  private orderSignature(window: BotWindow, cfg: AppConfig["spawner"]): string {
    return window.slots.slice(0, cfg.orderContentLastSlot + 1).map((item) => item ? `${item.name}:${item.displayName}:${item.count}` : "-").join("|");
  }

  private findDeliverAllSlot(window: BotWindow, fallback: number): number {
    const found = window.slots.slice(0, window.inventoryStart).map((item, slot) => ({ slot, label: `${item?.displayName ?? ""} ${item?.name ?? ""}`.toLowerCase() }))
      .find((item) => /deliver.*all|all.*deliver|alles.*liefer|alle.*knochen|ganzes.*inventar|whole.*inventory|submit.*all/.test(item.label));
    if (!found) this.events.log("warn", "spawner", `Full inventory action not recognized by text; using orange fallback button in slot ${fallback}`);
    return found?.slot ?? fallback;
  }

  private waitHuman(cfg: AppConfig["spawner"]): Promise<void> {
    const delay = Math.round(cfg.orderMinDelayMs + Math.random() * (cfg.orderMaxDelayMs - cfg.orderMinDelayMs));
    return this.wait(delay);
  }

  private detectControls(window: BotWindow, cfg: AppConfig["spawner"]): typeof this.detectedSlots {
    const labels = window.slots.map((item, slot) => ({ slot, label: `${item?.displayName ?? ""} ${item?.name ?? ""}`.toLowerCase() }));
    const find = (patterns: RegExp[], fallback: number) => labels.find((item) => item.slot > cfg.contentLastSlot && patterns.some((pattern) => pattern.test(item.label)))?.slot ?? fallback;
    const arrowSlots = labels.filter((item) => item.slot > cfg.contentLastSlot && /arrow|pfeil/.test(item.label)).map((item) => item.slot).sort((a, b) => a - b);
    const detected = {
      sellAllSlot: find([/sell.*all/, /alles.*verkauf/], cfg.sellAllSlot),
      pageLeftSlot: arrowSlots[0] ?? cfg.pageLeftSlot,
      pageRightSlot: arrowSlots.at(-1) ?? cfg.pageRightSlot,
      dropAllSlot: find([/drop.*all/, /alles.*drop/, /alles.*fallen/], cfg.dropAllSlot)
    };
    this.events.log("info", "spawner", `GUI auto-detection: Sell ${detected.sellAllSlot}, left ${detected.pageLeftSlot}, right ${detected.pageRightSlot}, Drop ${detected.dropAllSlot}`);
    return detected;
  }

  private controlSlot(name: keyof NonNullable<typeof this.detectedSlots>, cfg: AppConfig["spawner"]): number { return this.detectedSlots?.[name] ?? cfg[name]; }

  private async handleFailure(error: unknown): Promise<void> {
    if (this.isCancelled(error)) return;
    this.waitingForGui = false;
    this.fail(error);
    await this.webhook.send("macroError", "Spawner error", error instanceof Error ? error.message : String(error));
    this.scheduleNext();
  }

  private scheduleNext(): void {
    if (this.timer) clearTimeout(this.timer);
    if (!this.runtime.enabled) return;
    const cfg = this.config.get().spawner;
    const minutes = cfg.minIntervalMinutes + Math.random() * (cfg.maxIntervalMinutes - cfg.minIntervalMinutes);
    const delay = Math.round(minutes * 60_000);
    this.runtime.nextRun = new Date(Date.now() + delay).toISOString();
    if (!["error", "blocked", "success"].includes(this.runtime.status)) this.setState("waiting", "WAITING_RANDOM_INTERVAL");
    this.timer = setTimeout(() => void this.runNow(), delay);
    this.timer.unref();
  }
}
