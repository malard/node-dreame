/**
 * Cleaning-path string parser. Wire format: a flat sequence of
 * `<op-letter><x>,<y>` ops in the JSON tail's `tr` field. Op letters
 * are M (mop), W (sweep+mop), S (sweep), L (line moveTo); lowercase
 * `l` is a P-frame line continuation, treated as L after the merge
 * layer concatenates prev+P trs.
 */

import type { MapPath, MapPathType } from "./types.js";

const PATH_TYPE_FROM_OP: Record<string, MapPathType> = {
  M: "mop",
  W: "sweep-and-mop",
  S: "sweep",
  L: "line",
};

const PATH_OP_REGEX = /([MWSLl])(-?\d+),(-?\d+)/g;

/**
 * Parse Dreame's compact path string into typed segments.
 *
 * Each op letter starts a new segment:
 *   M = mop,   W = sweep+mop,   S = sweep,   L = line moveTo,
 *   l = P-frame line continuation (treated as L per Tasshack map.py:3987).
 *
 * Coordinates are millimetres world-frame for `mop` / `sweep` /
 * `sweep-and-mop` waypoints. **Line ops are RELATIVE deltas** to the
 * preceding absolute waypoint (or the previous point within the same
 * line). The accumulator unwinds them so every surfaced point is
 * absolute world-frame mm — verified live 2026-05-07 against r2532a
 * (without unwinding, 1000s of `line` deltas all cluster around the
 * world origin and render as a tight artifact).
 *
 * When a `line` op appears with no preceding absolute waypoint
 * (e.g. when `tr` starts with `L`/`l` and there's no anchor to
 * accumulate against — rare but possible at the very start of a
 * fresh subscription), the points are emitted literally. Callers
 * downstream of the merge layer don't see this path because P-frame
 * `tr` concatenation always prepends the prior absolute waypoint.
 */
export function parsePathTr(tr: string): MapPath[] {
  if (!tr) {
    return [];
  }
  // Locally mutable so we can push as we walk the regex matches; widened
  // to the public `readonly`-decorated MapPath shape on return.
  type MutablePath = { type: MapPathType; points: { x: number; y: number }[] };
  const out: MutablePath[] = [];
  let current: MutablePath | null = null;
  let anchor: { x: number; y: number } | null = null;
  for (const m of tr.matchAll(PATH_OP_REGEX)) {
    const opRaw = m[1]!;
    const xRaw = Number(m[2]);
    const yRaw = Number(m[3]);
    const op = opRaw === "l" ? "L" : opRaw;
    const type = PATH_TYPE_FROM_OP[op];
    if (!type) {
      continue;
    }
    if (type === "line" && anchor !== null) {
      // Accumulate the relative delta against the running anchor.
      const abs: { x: number; y: number } = {
        x: anchor.x + xRaw,
        y: anchor.y + yRaw,
      };
      if (!current || current.type !== type) {
        // New line segment: seed with the anchor itself so the line
        // draws a continuous trace from the preceding waypoint.
        current = { type, points: [{ x: anchor.x, y: anchor.y }, abs] };
        out.push(current);
      } else {
        current.points.push(abs);
      }
      anchor = abs;
    } else {
      // Either an absolute waypoint (S / W / M) or a `line` with no
      // anchor yet — emit literally.
      const pt = { x: xRaw, y: yRaw };
      if (!current || current.type !== type) {
        current = { type, points: [pt] };
        out.push(current);
      } else {
        current.points.push(pt);
      }
      if (type !== "line") {
        // Absolute waypoint — update the anchor for any following
        // `line` op to accumulate against.
        anchor = pt;
      }
    }
  }
  return out;
}
