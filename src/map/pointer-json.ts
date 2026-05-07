/**
 * `siid 6 piid 8` (`POINTER_JSON` / `MAP_LIST`) value parser.
 *
 * The device publishes a JSON-encoded string here pointing at the
 * saved-map list's OSS object plus an md5 of the body. Three lib
 * call sites consume this exact wire format — `MapManager`'s
 * pointer-push handler, `Vacuum.fetchSavedMapList()`, and
 * `Vacuum.rememberOssPointer()` — so the parse lives here in one
 * place to keep the alias-tolerance and shape contract uniform.
 *
 * Both `obj_name` and `object_name` are accepted: Tasshack's docs
 * use `obj_name` and Dreame's native cloud (Dreamehome app) emits
 * `object_name`. We've seen both in the wild.
 *
 * Returns `null` when the input isn't a non-empty string, isn't
 * valid JSON, or doesn't carry a usable `obj_name` / `object_name`.
 * Caller decides whether `null` is an error or a "no pointer yet"
 * outcome.
 */
export interface ParsedPointerJson {
  filename: string;
  md5?: string;
}

export function parsePointerJson(value: unknown): ParsedPointerJson | null {
  let parsed: { obj_name?: unknown; object_name?: unknown; md5?: unknown };
  if (typeof value === "string") {
    if (value.length === 0) {
      return null;
    }
    try {
      parsed = JSON.parse(value) as typeof parsed;
    } catch {
      return null;
    }
  } else if (value !== null && typeof value === "object") {
    // Some pushes (notably MapManager's POINTER_JSON push handler) get
    // the value pre-parsed by the upstream MQTT layer.
    parsed = value as typeof parsed;
  } else {
    return null;
  }
  const filename = parsed.object_name ?? parsed.obj_name;
  if (typeof filename !== "string" || filename.length === 0) {
    return null;
  }
  const result: ParsedPointerJson = { filename };
  if (typeof parsed.md5 === "string") {
    result.md5 = parsed.md5;
  }
  return result;
}
