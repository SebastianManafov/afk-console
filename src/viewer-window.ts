import type { Bot } from "mineflayer";
import { readableMinecraftReason } from "./minecraft-text.js";
import type { ViewerWindowItem, ViewerWindowState } from "./types.js";

type UnknownRecord = Record<string, unknown>;
type EventListener = (...args: any[]) => void;

interface EventSource {
  on(event: string, listener: EventListener): unknown;
  off(event: string, listener: EventListener): unknown;
}

interface ViewerSocket {
  emit(event: string, ...args: any[]): unknown;
}

type DiagnosticLogger = (message: string) => void;

export interface ViewerWindowSync {
  sendCurrentWindow(): void;
  cleanup(): void;
}

export function serializeViewerItem(value: unknown, slot: number): ViewerWindowItem | null {
  const record = asRecord(value);
  if (!record) return null;
  const id = finiteInteger(record.type ?? record.id);
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const displayName = typeof record.displayName === "string" ? record.displayName.trim() : name;
  const count = finiteInteger(record.count);
  if (id === null || id < 0 || !name || !displayName || count === null || count < 1) return null;
  const item: ViewerWindowItem = { slot, id, name, displayName, count };
  const metadata = finiteInteger(record.metadata);
  if (metadata !== null && metadata !== 0) item.metadata = metadata;
  return item;
}

export function serializeViewerWindow(value: unknown): ViewerWindowState | null {
  const record = asRecord(value);
  if (!record) return null;
  const id = finiteInteger(record.id);
  const type = windowType(record.type);
  const slots = record.slots;
  const inventoryStart = finiteInteger(record.inventoryStart);
  if (id === null || id < 0 || id > 255 || type === null || !Array.isArray(slots) || inventoryStart === null || inventoryStart < 0 || inventoryStart > slots.length) return null;

  const serializedSlots: Array<ViewerWindowItem | null> = [];
  for (let slot = 0; slot < slots.length; slot += 1) {
    const item = slots[slot];
    if (item === null || item === undefined) serializedSlots.push(null);
    else {
      const serialized = serializeViewerItem(item, slot);
      if (!serialized) return null;
      serializedSlots.push(serialized);
    }
  }

  return {
    id,
    type,
    title: readableMinecraftReason(record.title),
    inventoryStart,
    slots: serializedSlots
  };
}

export function registerViewerWindowSync(options: {
  target: Bot;
  socket: ViewerSocket;
  diagnostic?: DiagnosticLogger;
}): ViewerWindowSync {
  const targetEvents = options.target as unknown as EventSource;
  const inventoryEvents = eventSource(options.target.inventory);
  let activeWindow: unknown = null;
  let windowCleanup: (() => void) | null = null;
  let cleaned = false;

  const emitWindowState = (event: "windowOpen" | "windowUpdate", window: unknown, inventorySlot?: number): boolean => {
    const payload = payloadForWindow(window, inventorySlot);
    if (!payload) {
      options.diagnostic?.(`Window ${event === "windowOpen" ? "open" : "update"} ignored: invalid state`);
      return false;
    }
    options.socket.emit(event, payload);
    return true;
  };

  const attachWindow = (window: unknown): void => {
    activeWindow = window;
    const source = eventSource(window);
    const onUpdate: EventListener = () => {
      if (cleaned || activeWindow !== window || options.target.currentWindow !== window) return;
      emitWindowState("windowUpdate", window);
    };
    source?.on("updateSlot", onUpdate);

    const onInventoryUpdate: EventListener = (slot: unknown) => {
      if (cleaned || activeWindow !== window || options.target.currentWindow !== window) return;
      const inventorySlot = finiteInteger(slot);
      if (inventorySlot === null) return;
      emitWindowState("windowUpdate", window, inventorySlot);
    };
    inventoryEvents?.on("updateSlot", onInventoryUpdate);

    windowCleanup = () => {
      source?.off("updateSlot", onUpdate);
      inventoryEvents?.off("updateSlot", onInventoryUpdate);
      windowCleanup = null;
    };
  };

  const detachWindow = (): void => {
    windowCleanup?.();
    activeWindow = null;
  };

  const payloadForWindow = (window: unknown, inventorySlot?: number): ViewerWindowState | null => {
    const payload = serializeViewerWindow(window);
    if (!payload) return null;
    const inventory = asRecord(options.target.inventory);
    const inventorySlots = inventory?.slots;
    const inventoryStart = finiteInteger(inventory?.inventoryStart);
    if (inventorySlot === undefined || inventoryStart === null || !Array.isArray(inventorySlots)) return payload;
    const offset = inventorySlot - inventoryStart;
    const windowSlot = payload.inventoryStart + offset;
    if (offset < 0 || offset >= 36 || inventorySlot >= inventorySlots.length || windowSlot >= payload.slots.length) return payload;
    const item = inventorySlots[inventorySlot];
    if (item === null || item === undefined) payload.slots[windowSlot] = null;
    else {
      const serialized = serializeViewerItem(item, windowSlot);
      if (serialized) payload.slots[windowSlot] = serialized;
    }
    return payload;
  };

  const openWindow = (window: unknown): void => {
    detachWindow();
    if (!window) return;
    const payload = serializeViewerWindow(window);
    if (!payload) {
      options.diagnostic?.("Window open ignored: invalid state");
      return;
    }
    attachWindow(window);
    options.socket.emit("windowOpen", payload);
    options.diagnostic?.(`Window opened: type=${String(payload.type)} title=${JSON.stringify(payload.title)} id=${payload.id} inventoryStart=${payload.inventoryStart} slotCount=${payload.slots.length}`);
  };

  const closeWindow = (window: unknown): void => {
    const closingWindow = window ?? activeWindow;
    const closingId = windowId(closingWindow);
    if (activeWindow && closingWindow && closingWindow !== activeWindow) return;
    detachWindow();
    if (closingId === null) return;
    options.socket.emit("windowClose", { id: closingId });
    options.diagnostic?.(`Window closed: id=${closingId}`);
  };

  const onWindowOpen: EventListener = (window: unknown) => openWindow(window);
  const onWindowClose: EventListener = (window: unknown) => closeWindow(window);
  const onEnd: EventListener = () => closeWindow(activeWindow);
  const onWorldTransition: EventListener = () => closeWindow(activeWindow);
  targetEvents.on("windowOpen", onWindowOpen);
  targetEvents.on("windowClose", onWindowClose);
  targetEvents.on("end", onEnd);
  targetEvents.on("login", onWorldTransition);
  targetEvents.on("respawn", onWorldTransition);

  return {
    sendCurrentWindow: () => {
      if (cleaned) return;
      const currentWindow = options.target.currentWindow;
      if (currentWindow) openWindow(currentWindow);
      else if (activeWindow) closeWindow(activeWindow);
    },
    cleanup: () => {
      if (cleaned) return;
      cleaned = true;
      targetEvents.off("windowOpen", onWindowOpen);
      targetEvents.off("windowClose", onWindowClose);
      targetEvents.off("end", onEnd);
      targetEvents.off("login", onWorldTransition);
      targetEvents.off("respawn", onWorldTransition);
      detachWindow();
    }
  };
}

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" ? value as UnknownRecord : null;
}

function eventSource(value: unknown): EventSource | null {
  const record = asRecord(value);
  return record && typeof record.on === "function" && typeof record.off === "function" ? record as unknown as EventSource : null;
}

function finiteInteger(value: unknown): number | null {
  return Number.isInteger(value) ? value as number : null;
}

function windowType(value: unknown): string | number | null {
  if (typeof value === "string" && value.trim()) return value;
  const numeric = finiteInteger(value);
  return numeric !== null && numeric >= 0 ? numeric : null;
}

function windowId(value: unknown): number | null {
  const id = finiteInteger(asRecord(value)?.id);
  return id !== null && id >= 0 && id <= 255 ? id : null;
}
