import type { Bot } from "mineflayer";
import type { AppEvents } from "./events.js";
import type { MacroRuntime, MacroStatus } from "./types.js";

export type BotWindow = NonNullable<Bot["currentWindow"]>;

export class MacroCancelledError extends Error {
  constructor() { super("Macro ended for manual takeover"); this.name = "MacroCancelledError"; }
}

export abstract class MacroBase {
  protected bot: Bot | null = null;
  protected runtime: MacroRuntime;
  private cancellation = 0;

  constructor(protected readonly name: string, protected readonly events: AppEvents) {
    this.runtime = {
      enabled: false,
      status: "off",
      phase: "OFF",
      runs: 0,
      successes: 0,
      lastRun: null,
      nextRun: null,
      error: null
      ,startedAt: null
    };
  }

  attach(bot: Bot): void {
    this.bot = bot;
  }

  detach(): void {
    this.bot = null;
    if (this.runtime.enabled) this.setState("waiting", "WAIT_FOR_CONNECTION");
  }

  setEnabled(enabled: boolean): void {
    this.runtime.enabled = enabled;
    this.setState(enabled ? "waiting" : "off", enabled ? "WAITING" : "OFF");
  }

  cancel(): boolean {
    if (this.runtime.status !== "running") return false;
    this.cancellation += 1;
    this.runtime.startedAt = null;
    this.setState(this.runtime.enabled ? "waiting" : "off", this.runtime.enabled ? "TAKEN_OVER" : "OFF");
    this.events.log("warn", this.name, "Run ended for manual takeover");
    return true;
  }

  snapshot(): MacroRuntime {
    return structuredClone(this.runtime);
  }

  protected setState(status: MacroStatus, phase: string, error: string | null = null): void {
    this.runtime.status = status;
    this.runtime.phase = phase;
    this.runtime.error = error;
    this.events.emit("macroState");
  }

  protected begin(phase: string): void {
    this.cancellation += 1;
    this.runtime.runs += 1;
    this.runtime.lastRun = new Date().toISOString();
    this.runtime.startedAt = this.runtime.lastRun;
    this.setState("running", phase);
  }

  protected succeed(message: string): void {
    this.runtime.successes += 1;
    this.setState("success", "SUCCESS");
    this.runtime.startedAt = null;
    this.events.log("info", this.name, message);
  }

  protected fail(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.setState("error", "ERROR", message);
    this.runtime.startedAt = null;
    this.events.log("error", this.name, message);
  }

  protected async click(slot: number, mode: 0 | 1 = 0): Promise<void> {
    if (!this.bot) throw new Error("Bot is not connected");
    const generation = this.cancellation;
    await this.bot.clickWindow(slot, 0, mode);
    if (generation !== this.cancellation) throw new MacroCancelledError();
  }

  protected wait(ms: number): Promise<void> {
    const generation = this.cancellation;
    return new Promise((resolve, reject) => setTimeout(() => generation === this.cancellation ? resolve() : reject(new MacroCancelledError()), ms));
  }

  protected isCancelled(error: unknown): boolean { return error instanceof MacroCancelledError; }

  protected inSchedule(start: string, end: string, now = new Date()): boolean {
    const current = now.getHours() * 60 + now.getMinutes();
    const parse = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
    const from = parse(start); const to = parse(end);
    return from <= to ? current >= from && current <= to : current >= from || current <= to;
  }
}
