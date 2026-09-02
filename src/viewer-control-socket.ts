import type { Socket } from "socket.io";
import type { DashboardRole } from "./auth.js";
import type { MultiBotManager } from "./multi-bot-manager.js";
import { ViewerControlDeniedError, type ViewerMovementControl } from "./viewer-control.js";

const movementControls = new Set<ViewerMovementControl>(["forward", "back", "left", "right", "jump", "sneak", "sprint"]);

export interface ViewerControlCapabilities {
  canControl: boolean;
  accountId: string;
}

export function registerViewerControlHandlers(socket: Socket, manager: MultiBotManager, accountId: string, role: DashboardRole): () => void {
  const controllerId = socket.id;
  const emitDenied = (reason: string): void => { socket.emit("viewerControlDenied", { reason: genericDenialReason(reason) }); };
  const run = (operation: () => void | Promise<void>): void => {
    try {
      const result = operation();
      if (result && typeof (result as Promise<void>).catch === "function") void (result as Promise<void>).catch((error: unknown) => emitDenied(errorReason(error)));
    } catch (error) {
      emitDenied(errorReason(error));
    }
  };
  const requireAdmin = (): boolean => {
    if (role === "admin") return true;
    emitDenied("role");
    return false;
  };
  const acquire = (): void => {
    if (!requireAdmin()) return;
    run(() => {
      manager.acquireViewerControl(accountId, controllerId);
      socket.emit("viewerControlGranted", { accountId });
    });
  };
  const heartbeat = (): void => {
    if (!requireAdmin()) return;
    try {
      if (!manager.heartbeatViewerControl(accountId, controllerId)) emitDenied("not_owner");
    } catch (error) {
      emitDenied(errorReason(error));
    }
  };
  const release = (): void => {
    if (role !== "admin") return;
    try { manager.releaseViewerControl(accountId, controllerId, "client release"); }
    catch { /* The account may have been removed while the iframe was closing. */ }
  };
  const control = (payload: unknown): void => {
    if (!requireAdmin()) return;
    if (!isRecord(payload) || typeof payload.control !== "string" || !movementControls.has(payload.control as ViewerMovementControl) || typeof payload.enabled !== "boolean") {
      emitDenied("invalid_input");
      return;
    }
    run(() => manager.viewerControl(accountId, controllerId, { kind: "movement", control: payload.control as ViewerMovementControl, enabled: payload.enabled as boolean }));
  };
  const look = (payload: unknown): void => {
    if (!requireAdmin()) return;
    if (!isRecord(payload) || !isFiniteNumber(payload.yaw) || !isFiniteNumber(payload.pitch)) {
      emitDenied("invalid_input");
      return;
    }
    run(() => manager.viewerControl(accountId, controllerId, { kind: "look", yaw: payload.yaw as number, pitch: payload.pitch as number }));
  };
  const action = (payload: unknown): void => {
    if (!requireAdmin()) return;
    if (!isRecord(payload) || (payload.action !== "attack" && payload.action !== "use" && payload.action !== "hotbar")) {
      emitDenied("invalid_input");
      return;
    }
    if (payload.action === "hotbar") {
      if (!Number.isInteger(payload.slot) || (payload.slot as number) < 0 || (payload.slot as number) > 8) {
        emitDenied("invalid_input");
        return;
      }
      run(() => manager.viewerControl(accountId, controllerId, { kind: "action", action: "hotbar", slot: payload.slot as number }));
      return;
    }
    if (payload.action === "use" && payload.enabled !== undefined && typeof payload.enabled !== "boolean") {
      emitDenied("invalid_input");
      return;
    }
    if (payload.action === "attack" && payload.enabled !== undefined) {
      emitDenied("invalid_input");
      return;
    }
    run(() => payload.action === "use"
      ? manager.viewerControl(accountId, controllerId, { kind: "action", action: "use", enabled: payload.enabled !== false })
      : manager.viewerControl(accountId, controllerId, { kind: "action", action: "attack" }));
  };
  const compatibilityRelease = (): void => release();
  const disconnect = (): void => {
    release();
    cleanup();
  };
  const revoke = (payload: { accountId: string; reason: string }): void => {
    if (payload.accountId === accountId && payload.reason !== "client release") socket.emit("viewerControlRevoked", { reason: payload.reason });
  };
  const removeRevocationListener = manager.onViewerControlRevoked(revoke);
  socket.emit("viewerControlCapabilities", { canControl: role === "admin", accountId } satisfies ViewerControlCapabilities);
  socket.on("viewerControlAcquire", acquire);
  socket.on("viewerControlHeartbeat", heartbeat);
  socket.on("viewerControlRelease", release);
  socket.on("botControl", control);
  socket.on("botLook", look);
  socket.on("botAction", action);
  socket.on("releaseControls", compatibilityRelease);
  socket.on("disconnect", disconnect);

  let cleaned = false;
  function cleanup(): void {
    if (cleaned) return;
    cleaned = true;
    removeRevocationListener();
    socket.off("viewerControlAcquire", acquire);
    socket.off("viewerControlHeartbeat", heartbeat);
    socket.off("viewerControlRelease", release);
    socket.off("botControl", control);
    socket.off("botLook", look);
    socket.off("botAction", action);
    socket.off("releaseControls", compatibilityRelease);
    socket.off("disconnect", disconnect);
  }
  return cleanup;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function errorReason(error: unknown): string {
  if (error instanceof ViewerControlDeniedError) return error.reason;
  const message = error instanceof Error ? error.message : String(error);
  if (/locked|macro|manual|busy/i.test(message)) return "locked";
  if (/not online|world|play|ready|account not found/i.test(message)) return "not_ready";
  return "not_ready";
}

function genericDenialReason(reason: string): string {
  if (reason === "already_controlled") return "competing_session";
  if (["role", "competing_session", "not_owner", "expired", "not_ready", "locked", "invalid_input"].includes(reason)) return reason;
  return "not_ready";
}
