import type { EventEmitter } from "node:events";

type ProtocolClient = EventEmitter;

type ProtocolHooks = {
  onKnownPacks(phase: "initial" | "reconfiguration"): void;
  onReconfiguration(): void;
  onReconfigurationFinished(): void;
  onResourcePack(): void;
  onPing(): void;
};

/** Observe HugoSMP without replacing handlers owned by Mineflayer. */
export function installHugoSmpProtocolHandlers(client: ProtocolClient, hooks: ProtocolHooks): () => void {
  let phase: "initial" | "reconfiguration" = "initial";
  let pingReported = false;
  let reconfigurationActive = false;

  const onSuccess = () => { phase = "initial"; };
  const onFinishConfiguration = () => {
    if (!reconfigurationActive) return;
    reconfigurationActive = false;
    hooks.onReconfigurationFinished();
  };
  const onStartConfiguration = () => {
    if (reconfigurationActive) return;
    reconfigurationActive = true;
    phase = "reconfiguration";
    hooks.onReconfiguration();
    client.removeListener("finish_configuration", onFinishConfiguration);
    client.once("finish_configuration", onFinishConfiguration);
  };
  const onKnownPacks = () => hooks.onKnownPacks(phase);
  const onResourcePack = () => hooks.onResourcePack();
  const onPing = () => {
    if (pingReported) return;
    pingReported = true;
    hooks.onPing();
  };

  client.once("success", onSuccess);
  client.on("start_configuration", onStartConfiguration);
  client.on("select_known_packs", onKnownPacks);
  client.on("add_resource_pack", onResourcePack);
  client.on("ping", onPing);

  return () => {
    reconfigurationActive = false;
    client.removeListener("success", onSuccess);
    client.removeListener("start_configuration", onStartConfiguration);
    client.removeListener("finish_configuration", onFinishConfiguration);
    client.removeListener("select_known_packs", onKnownPacks);
    client.removeListener("add_resource_pack", onResourcePack);
    client.removeListener("ping", onPing);
  };
}
