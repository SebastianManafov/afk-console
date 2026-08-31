import { EventEmitter } from "node:events";
import type { BotSnapshot, LogEntry } from "./types.js";

export class AppEvents extends EventEmitter {
  private logs: LogEntry[] = [];

  constructor(private readonly echoToConsole = true) { super(); }

  log(level: LogEntry["level"], source: string, message: string): void {
    const entry: LogEntry = { at: new Date().toISOString(), level, source, message };
    this.logs.push(entry);
    if (this.logs.length > 300) this.logs.shift();
    this.emit("log", entry);
    if (this.echoToConsole) console[level === "warn" ? "warn" : level === "error" ? "error" : "log"](`[${source}] ${message}`);
  }

  state(snapshot: BotSnapshot): void {
    this.emit("state", snapshot);
  }

  recentLogs(): LogEntry[] {
    return [...this.logs];
  }
}
