export type ViewerMovementControl = "forward" | "back" | "left" | "right" | "jump" | "sneak" | "sprint";

export interface ViewerMovementInput {
  kind: "movement";
  control: ViewerMovementControl;
  enabled: boolean;
}

export interface ViewerLookInput {
  kind: "look";
  yaw: number;
  pitch: number;
}

export type ViewerActionName = "attack" | "use" | "hotbar";

export interface ViewerAttackInput {
  kind: "action";
  action: "attack";
}

export interface ViewerUseInput {
  kind: "action";
  action: "use";
  enabled?: boolean;
}

export interface ViewerHotbarInput {
  kind: "action";
  action: "hotbar";
  slot: number;
}

export type ViewerActionInput = ViewerAttackInput | ViewerUseInput | ViewerHotbarInput;
export type ViewerControlInput = ViewerMovementInput | ViewerLookInput | ViewerActionInput;

export interface ViewerWindowClickInput {
  windowId: number;
  slot: number;
  mouseButton: 0 | 1;
  mode: 0 | 1;
}

export interface ViewerWindowCloseInput {
  windowId: number;
}

export type ViewerControlDenialReason =
  | "invalid_controller"
  | "already_controlled"
  | "competing_session"
  | "not_owner"
  | "expired"
  | "not_ready"
  | "locked"
  | "role"
  | "invalid_input"
  | "stale_window";

export const VIEWER_CONTROL_HEARTBEAT_MS = 1_000;
export const VIEWER_CONTROL_LEASE_EXPIRY_MS = 5_000;

export class ViewerControlDeniedError extends Error {
  readonly reason: ViewerControlDenialReason;

  constructor(reason: ViewerControlDenialReason) {
    super("Viewer control is not available");
    this.name = "ViewerControlDeniedError";
    this.reason = reason;
  }
}

export function parseViewerWindowClick(value: unknown): ViewerWindowClickInput | null {
  if (!isRecord(value)) return null;
  const windowId = integerInRange(value.windowId, 0, 255);
  const slot = integerInRange(value.slot, 0, 255);
  const mouseButton = integerInRange(value.mouseButton, 0, 1);
  const mode = integerInRange(value.mode, 0, 1);
  if (windowId === null || slot === null || mouseButton === null || mode === null) return null;
  return { windowId, slot, mouseButton: mouseButton as 0 | 1, mode: mode as 0 | 1 };
}

export function parseViewerWindowClose(value: unknown): ViewerWindowCloseInput | null {
  if (!isRecord(value)) return null;
  const windowId = integerInRange(value.windowId, 0, 255);
  return windowId === null ? null : { windowId };
}

export function validateViewerWindowClick(value: unknown, currentWindow: unknown): ViewerWindowClickInput {
  const click = parseViewerWindowClick(value);
  if (!click) throw new ViewerControlDeniedError("invalid_input");
  const window = isRecord(currentWindow) ? currentWindow : null;
  const windowId = window ? integerInRange(window.id, 0, 255) : null;
  if (!window || windowId === null || windowId !== click.windowId) throw new ViewerControlDeniedError("stale_window");
  const slots = window.slots;
  if (!Array.isArray(slots) || click.slot >= slots.length) throw new ViewerControlDeniedError("invalid_input");
  return click;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function integerInRange(value: unknown, minimum: number, maximum: number): number | null {
  return Number.isInteger(value) && (value as number) >= minimum && (value as number) <= maximum ? value as number : null;
}

export interface ViewerControlLeaseOptions {
  now?: () => number;
  heartbeatMs?: number;
  expiryMs?: number;
}

/**
 * A single-controller dead-man lease. The controller ID is intentionally
 * never exposed by this class; callers only learn whether they own it.
 */
export class ViewerControlLease {
  private controller: string | null = null;
  private expiresAt = 0;
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly now: () => number;
  private readonly heartbeatMs: number;
  private readonly expiryMs: number;

  constructor(private readonly onRelease: (reason: string) => void = () => {}, options: ViewerControlLeaseOptions = {}) {
    this.now = options.now ?? Date.now;
    this.heartbeatMs = options.heartbeatMs ?? VIEWER_CONTROL_HEARTBEAT_MS;
    this.expiryMs = options.expiryMs ?? VIEWER_CONTROL_LEASE_EXPIRY_MS;
  }

  acquire(controllerId: string): void {
    const normalized = this.normalizeController(controllerId);
    this.expireIfNeeded();
    if (this.controller !== null) throw new ViewerControlDeniedError("already_controlled");
    this.controller = normalized;
    this.expiresAt = this.now() + this.expiryMs;
    this.armExpiryTimer();
  }

  heartbeat(controllerId: string): boolean {
    if (!this.owns(controllerId)) return false;
    this.expiresAt = this.now() + this.expiryMs;
    this.armExpiryTimer();
    return true;
  }

  release(controllerId: string, reason = "released"): boolean {
    if (!this.owns(controllerId)) return false;
    this.clear(reason);
    return true;
  }

  forceRelease(reason = "forced release"): boolean {
    if (!this.isActive) return false;
    this.clear(reason);
    return true;
  }

  owns(controllerId: string): boolean {
    this.expireIfNeeded();
    return typeof controllerId === "string" && controllerId.length > 0 && this.controller === controllerId;
  }

  get isActive(): boolean {
    this.expireIfNeeded();
    return this.controller !== null;
  }

  private normalizeController(controllerId: string): string {
    if (typeof controllerId !== "string" || controllerId.length < 1 || controllerId.length > 256) {
      throw new ViewerControlDeniedError("invalid_controller");
    }
    return controllerId;
  }

  private expireIfNeeded(): void {
    if (this.controller !== null && this.expiresAt <= this.now()) this.clear("heartbeat timeout");
  }

  private armExpiryTimer(): void {
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    const delay = Math.max(this.heartbeatMs, this.expiresAt - this.now());
    this.expiryTimer = setTimeout(() => {
      this.expiryTimer = null;
      this.expireIfNeeded();
      if (this.controller !== null) this.armExpiryTimer();
    }, delay);
    if (typeof this.expiryTimer === "object" && "unref" in this.expiryTimer) {
      (this.expiryTimer as NodeJS.Timeout).unref();
    }
  }

  private clear(reason: string): void {
    this.controller = null;
    this.expiresAt = 0;
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
    this.onRelease(reason);
  }
}
