import type { Bot } from "mineflayer";

const PLAYER_INPUT_INTERVAL_MS = 50;
const CONTINUOUS_CONTROLS = ["forward", "back", "left", "right", "jump", "sprint"] as const;

type MovementControl = "forward" | "back" | "left" | "right" | "jump" | "sneak" | "sprint";

/**
 * Mineflayer's physics plugin simulates on-foot movement locally, but its
 * modern player_input packet is otherwise only emitted for vehicles. HugoSMP
 * also uses that packet to validate the held on-foot input state.
 */
export function installMovementInputBridge(bot: Bot): () => void {
  const originalSetControlState = bot.setControlState;
  if (typeof originalSetControlState !== "function") return () => {};

  let timer: NodeJS.Timeout | null = null;
  let disposed = false;

  const supportsPlayerInput = (): boolean => {
    try { return bot.supportFeature("newPlayerInputPacket"); }
    catch { return false; }
  };

  const readInputs = () => ({
    forward: bot.getControlState("forward"),
    backward: bot.getControlState("back"),
    left: bot.getControlState("left"),
    right: bot.getControlState("right"),
    jump: bot.getControlState("jump"),
    shift: bot.getControlState("sneak"),
    sprint: bot.getControlState("sprint")
  });

  const hasContinuousInput = (): boolean => CONTINUOUS_CONTROLS.some((control) => bot.getControlState(control));

  const stopRepeating = (): void => {
    if (timer) clearInterval(timer);
    timer = null;
  };

  const writeInput = (): void => {
    if (disposed || !supportsPlayerInput() || String(bot._client.state).toLowerCase() !== "play") return;
    bot._client.write("player_input", { inputs: readInputs() });
  };

  const sync = (): void => {
    if (disposed) return;
    try { writeInput(); }
    catch { return; }

    if (hasContinuousInput()) {
      if (!timer) {
        timer = setInterval(() => {
          if (!hasContinuousInput()) {
            stopRepeating();
            return;
          }
          try { writeInput(); }
          catch { stopRepeating(); }
        }, PLAYER_INPUT_INTERVAL_MS);
        timer.unref();
      }
    } else stopRepeating();
  };

  const patchedSetControlState = (control: MovementControl, state: boolean): void => {
    originalSetControlState.call(bot, control, state);
    sync();
  };

  bot.setControlState = patchedSetControlState;
  const cleanup = (): void => {
    if (disposed) return;
    disposed = true;
    stopRepeating();
    bot.removeListener("end", cleanup);
    if (bot.setControlState === patchedSetControlState) bot.setControlState = originalSetControlState;
  };
  bot.once("end", cleanup);
  return cleanup;
}
