export interface SlotItem {
  name: string;
  count: number;
  slot: number;
}

export function findAbortArrow(
  slots: Array<SlotItem | null>,
  contentLastSlot: number,
  configuredNames: string[]
): SlotItem | null {
  const names = new Set(configuredNames.map((name) => name.toLowerCase().replace(/^minecraft:/, "")));
  return slots.slice(0, contentLastSlot + 1).find((item) => {
    if (!item) return false;
    return names.has(item.name.toLowerCase().replace(/^minecraft:/, ""));
  }) ?? null;
}
