export type MacroStatus = "off" | "waiting" | "running" | "success" | "blocked" | "error";

export interface MacroRuntime {
  enabled: boolean;
  status: MacroStatus;
  phase: string;
  runs: number;
  successes: number;
  lastRun: string | null;
  nextRun: string | null;
  error: string | null;
  startedAt: string | null;
}

export interface AppConfig {
  servers: Array<{
    id: string; name: string; host: string; port: number; version: string;
    autoGuiJoinEnabled: boolean; autoGuiJoinTitleIncludes: string; autoGuiJoinSlot: number; autoGuiJoinDelayMs: number;
    joinCommand: string; worldChangeCommand: string; antiAfkEnabled: boolean; antiAfkMinSeconds: number; antiAfkMaxSeconds: number;
    spamEnabled: boolean; spamMessage: string; spamIntervalSeconds: number;
  }>;
  proxies: Array<{ id: string; name: string; host: string; port: number; username: string; password: string }>;
  accounts: Array<{
    id: string; name: string; username: string; serverId: string; proxyId: string | null; enabled: boolean; paused: boolean; autoConnect: boolean;
    reconnectEnabled: boolean; reconnectDelaysSeconds: number[];
    sell: AppConfig["sell"] | null; spawner: AppConfig["spawner"] | null;
  }>;
  connection: {
    profileName: string;
    host: string;
    port: number;
    version: string;
    username: string;
    autoConnect: boolean;
    reconnectEnabled: boolean;
    reconnectDelaysSeconds: number[];
    autoGuiJoinEnabled: boolean;
    autoGuiJoinTitleIncludes: string;
    autoGuiJoinSlot: number;
    autoGuiJoinDelayMs: number;
    joinCommand: string;
    worldChangeCommand: string;
    antiAfkEnabled: boolean;
    antiAfkMinSeconds: number;
    antiAfkMaxSeconds: number;
    spamEnabled: boolean;
    spamMessage: string;
    spamIntervalSeconds: number;
  };
  sell: {
    enabled: boolean;
    command: string;
    guiTitleIncludes: string;
    contentLastSlot: number;
    confirmSlot: number;
    fillDelayMs: number;
    confirmDelayMs: number;
    excludeHotbar: boolean;
    onlyFullStacks: boolean;
    confirmPartial: boolean;
    autoReopen: boolean;
    useShiftClick: boolean;
    minPauseMs: number;
    maxPauseMs: number;
    scheduleStart: string;
    scheduleEnd: string;
  };
  spawner: {
    enabled: boolean;
    homeCommand: string;
    homeTopCommand: string;
    homeBottomCommand: string;
    afkHomeCommand: string;
    movementStepMs: number;
    autoDetectSlots: boolean;
    orderEnabled: boolean;
    orderCommand: string;
    orderGuiTitleIncludes: string;
    orderDeliverGuiTitleIncludes: string;
    orderAutoDetect: boolean;
    orderHighestSlot: number;
    orderDeliverAllSlot: number;
    orderContentLastSlot: number;
    orderPageLeftSlot: number;
    orderPageRightSlot: number;
    orderMaxPages: number;
    orderMinDelayMs: number;
    orderMaxDelayMs: number;
    minIntervalMinutes: number;
    maxIntervalMinutes: number;
    clickDelayMs: number;
    maxPages: number;
    mode: "ALWAYS" | "PAGE_FULL" | "INTERVAL";
    skeletonFilter: boolean;
    dropItemNames: string[];
    arrowAbort: boolean;
    arrowItemNames: string[];
    guiTitleIncludes: string;
    contentLastSlot: number;
    sellAllSlot: number;
    pageLeftSlot: number;
    pageRightSlot: number;
    dropAllSlot: number;
    scheduleStart: string;
    scheduleEnd: string;
  };
  webhook: {
    enabled: boolean;
    url: string;
    username: string;
    notifyConnect: boolean;
    notifyDisconnect: boolean;
    notifyKick: boolean;
    notifyMacroSuccess: boolean;
    notifyMacroError: boolean;
    notifyArrowAbort: boolean;
  };
}

export interface BotSnapshot {
  connection: "offline" | "connecting" | "online" | "reconnecting";
  username: string | null;
  server: string;
  ping: number | null;
  joinedAt: string | null;
  sneak: boolean;
  reconnectAttempt: number;
  reconnectAt: string | null;
  authCode: { verificationUri: string; userCode: string; expiresAt: string | null } | null;
  serverNotice: { type: "maintenance" | "restart"; message: string; detectedAt: string } | null;
  worldTransition: { state: "stable" | "configuring" | "waiting_world"; startedAt: string | null; message: string };
  controlLock: { locked: boolean; reason: string | null };
  diagnostics: Array<{ at: string; stage: string; status: "info" | "ok" | "warn" | "error"; message: string }>;
  uptimeSeconds: number;
  memoryMb: number;
  deployment: { provider: "local"; environment: string; service: string };
  accountId?: string;
  authenticated?: boolean;
  authenticating?: boolean;
  authExpiresAt?: string | null;
  lastError?: string | null;
  paused?: boolean;
  bots?: BotSnapshot[];
  health: number | null;
  food: number | null;
  experienceLevel: number | null;
  position: { x: number; y: number; z: number } | null;
  inventory: Array<{ slot: number; name: string; displayName: string; count: number }>;
  window: { title: string; inventoryStart: number; slots: Array<{ slot: number; name: string; displayName: string; count: number }> } | null;
  sell: MacroRuntime;
  spawner: MacroRuntime;
}

export interface LogEntry {
  at: string;
  level: "info" | "warn" | "error";
  source: string;
  message: string;
}
