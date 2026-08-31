export function readableMinecraftReason(reason: unknown): string {
  if (typeof reason === "string") {
    try { return readableMinecraftReason(JSON.parse(reason)); }
    catch { return reason; }
  }

  const text = collectText(reason, new Set()).join("").trim();
  if (text) return text;
  try { return JSON.stringify(reason); }
  catch { return String(reason); }
}

function collectText(value: unknown, seen: Set<object>): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap((item) => collectText(item, seen));
  if (!value || typeof value !== "object" || seen.has(value)) return [];
  seen.add(value);

  const record = value as Record<string, unknown>;
  if (record.type === "string" && typeof record.value === "string") return [record.value];

  const messageKeys = ["text", "translate", "with", "extra", "message"];
  const direct = messageKeys.flatMap((key) => key in record ? collectText(record[key], seen) : []);
  if (direct.length) return direct;

  if ("value" in record) {
    const nested = record.value;
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      const nestedRecord = nested as Record<string, unknown>;
      const selected = messageKeys.flatMap((key) => key in nestedRecord ? collectText(nestedRecord[key], seen) : []);
      if (selected.length) return selected;
      if ("value" in nestedRecord) return collectText(nestedRecord.value, seen);
    }
    return collectText(nested, seen);
  }
  return [];
}
