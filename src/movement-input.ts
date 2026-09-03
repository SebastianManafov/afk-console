import type { Bot } from "mineflayer";

const MOVEMENT_PACKET_NAMES = new Set(["position", "position_look", "look", "flying"]);

type MovementControl = "forward" | "back" | "left" | "right" | "jump" | "sneak" | "sprint";
type PacketRecord = Record<string, unknown>;
type SupportedFeature = "newPlayerInputPacket" | "sendsClientTickEndPacket";

const isRecord = (value: unknown): value is PacketRecord => (
  typeof value === "object" && value !== null && !Array.isArray(value)
);

const notchianYaw = (yaw: number): number => Math.fround((Math.PI - yaw) * 180 / Math.PI);
const notchianPitch = (pitch: number): number => Math.fround(-pitch * 180 / Math.PI);

const isPlayState = (state: unknown): boolean => String(state).toLowerCase() === "play";

/**
 * Modern prediction servers validate the input and movement packets as one
 * tick. Mineflayer 4.38 does not yet keep those packets fully synchronized,
 * so this bridge adapts its outgoing packets at the protocol boundary.
 */
export function installMovementInputBridge(bot: Bot): () => void {
  const originalSetControlState = bot.setControlState;
  const client = bot._client as unknown as {
    state: unknown;
    write(name: string, params: unknown): void;
  };
  const originalClientWrite = typeof client.write === "function" ? client.write.bind(client) : null;
  if (typeof originalSetControlState !== "function" || !originalClientWrite) return () => {};

  let disposed = false;
  let lastInputKey: string | null = null;
  let tickEndImmediate: NodeJS.Immediate | null = null;

  const supportsFeature = (feature: SupportedFeature): boolean => {
    try { return bot.supportFeature(feature) === true; }
    catch { return false; }
  };

  const supportsModernMovement = (): boolean => supportsFeature("newPlayerInputPacket");
  const supportsClientTickEnd = (): boolean => supportsFeature("sendsClientTickEndPacket");

  const readInputs = () => ({
    forward: bot.getControlState("forward"),
    backward: bot.getControlState("back"),
    left: bot.getControlState("left"),
    right: bot.getControlState("right"),
    jump: bot.getControlState("jump"),
    shift: bot.getControlState("sneak"),
    sprint: bot.getControlState("sprint")
  });

  const writeInput = (): void => {
    if (disposed || !supportsModernMovement() || !isPlayState(client.state)) return;
    const inputs = readInputs();
    const inputKey = JSON.stringify(inputs);
    if (inputKey === lastInputKey) return;
    originalClientWrite("player_input", { inputs });
    lastInputKey = inputKey;
  };

  const normalizeMovementPacket = (name: string, params: unknown): unknown => {
    if (!isRecord(params) || !supportsModernMovement()) return params;

    const entity = bot.entity as unknown as {
      yaw?: unknown;
      pitch?: unknown;
      isCollidedHorizontally?: unknown;
      onGround?: unknown;
    } | undefined;
    const normalized: PacketRecord = { ...params };

    // The physics plugin can advance entity rotation separately from the
    // private last-sent rotation it keeps in its closure. The server must see
    // the same yaw/pitch that the local physics state used for this movement.
    if ((name === "look" || name === "position_look") && entity &&
        typeof entity.yaw === "number" && Number.isFinite(entity.yaw) &&
        typeof entity.pitch === "number" && Number.isFinite(entity.pitch)) {
      normalized.yaw = notchianYaw(entity.yaw);
      normalized.pitch = notchianPitch(entity.pitch);
    }

    // 1.21.3+ encodes horizontal collision in the movement flags. Sending an
    // undefined value serializes as false and can make a valid local step look
    // like an invalid prediction to the server.
    if (isRecord(params.flags) && entity) {
      normalized.flags = {
        ...params.flags,
        onGround: typeof params.flags.onGround === "boolean"
          ? params.flags.onGround
          : entity.onGround === true,
        hasHorizontalCollision: entity.isCollidedHorizontally === true
      };
    }

    return normalized;
  };

  const sendClientTickEnd = (): void => {
    if (disposed || !supportsClientTickEnd() || !isPlayState(client.state)) return;
    originalClientWrite("tick_end", {});
  };

  // Mineflayer emits physicsTick before updatePosition(). setImmediate lets
  // the movement packet be written first, then closes that same server tick.
  const scheduleClientTickEnd = (): void => {
    if (disposed || !supportsClientTickEnd() || tickEndImmediate) return;
    tickEndImmediate = setImmediate(() => {
      tickEndImmediate = null;
      sendClientTickEnd();
    });
    tickEndImmediate.unref();
  };

  const patchedClientWrite = (name: string, params: unknown): void => {
    if (disposed) {
      originalClientWrite(name, params);
      return;
    }

    if (supportsModernMovement() && name === "player_input") {
      // Mineflayer currently emits a partial packet when sneak changes. The
      // modern server expects the complete held-control bitset.
      writeInput();
      return;
    }

    if (supportsModernMovement() && MOVEMENT_PACKET_NAMES.has(name)) {
      // This also catches a control change that happens between physics ticks.
      writeInput();
      originalClientWrite(name, normalizeMovementPacket(name, params));
      scheduleClientTickEnd();
      return;
    }

    originalClientWrite(name, params);
  };

  client.write = patchedClientWrite;

  const patchedSetControlState = (control: MovementControl, state: boolean): void => {
    originalSetControlState.call(bot, control, state);
    try { writeInput(); }
    catch { return; }
  };

  const onPhysicsTick = (): void => scheduleClientTickEnd();
  bot.on("physicsTick", onPhysicsTick);
  bot.setControlState = patchedSetControlState;

  const cleanup = (): void => {
    if (disposed) return;
    disposed = true;
    bot.removeListener("physicsTick", onPhysicsTick);
    bot.removeListener("end", cleanup);
    if (tickEndImmediate) clearImmediate(tickEndImmediate);
    tickEndImmediate = null;
    if (client.write === patchedClientWrite) client.write = originalClientWrite;
    if (bot.setControlState === patchedSetControlState) bot.setControlState = originalSetControlState;
  };
  bot.once("end", cleanup);
  return cleanup;
}
