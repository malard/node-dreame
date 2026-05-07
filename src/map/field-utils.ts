/**
 * Wire-value coercion helpers used by the map decoder modules.
 *
 * Dreame's tail JSON ships some numeric fields as strings (notably
 * `ai_obstacle` records' position fields and the rect/line corner
 * arrays) and some as numbers. Both forms decode to the same world-
 * frame mm value; these helpers normalise.
 *
 * Both return `null` on non-numeric / non-finite input — callers
 * decide whether to skip the entry or substitute a default.
 */

export function parseFloatField(v: unknown): number | null {
  if (typeof v === "number") {
    return Number.isFinite(v) ? v : null;
  }
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function parseIntField(v: unknown): number | null {
  const n = parseFloatField(v);
  return n === null ? null : Math.trunc(n);
}
