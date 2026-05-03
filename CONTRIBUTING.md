# Contributing to node-dreame

Working notes for contributors and future-me. Focused on what's
non-obvious from reading the code itself.

## JSDoc verification tags

Every entry in `src/miot-spec.ts` and the per-service tables under
`src/spec/` carries a verification tag in its JSDoc. The tags are not
decorative — they govern whether downstream code can rely on the value.

- **`VERIFIED <model> <YYYY-MM-DD>`** — the value was directly observed
  on the named device on that date. Either by reading the property and
  seeing the documented value, by writing the property and observing
  the side-effect, or (for actions) by firing the action and checking
  the device's response. New entries default to this tag.
- **`ASSUMED <source>`** — the value was borrowed from another project
  (typically Tasshack/dreame-vacuum) but has NOT yet been confirmed on
  Dreame native cloud against an X50-generation device. Treat the
  numeric value as raw — do not rely on enum labels until promoted to
  VERIFIED.

When you change a verification tag, also update the date and the live
observation that justifies the change. Do not silently downgrade a tag
without context.

For state values (enum members), include observed transitions or value
ranges directly in the docstring — the catalogue is documentation
first, type system second.

## Naming conventions

These are the repo's existing patterns; new code should match them.

### Capability flags (`src/capabilities.ts`)

- **`canX`** — discrete capability ("the device can perform X").
  Examples: `canMop`, `canMopWash`, `canAutoEmpty`.
- **`hasX`** — physical hardware presence. Examples: `hasSideBrush`,
  `hasCamera`, `hasDetergentReservoir`.
- **`supportsX`** — feature category, often multi-step. Examples:
  `supportsVirtualWalls`, `supportsMultiFloor`.
- **`supportedXs`** — enum subset accepted as input. Examples:
  `supportedSuctionLevels`, `supportedMopWashTemps`. Always typed
  `readonly T[]`.

### Class fields and methods

- **`#privateField`** — class privates use the JS native `#` prefix, not
  TypeScript's `private` keyword. Used universally; new fields should
  follow.
- **camelCase** — methods, locals, properties.
- **PascalCase** — types, classes, enums.
- **UPPER_SNAKE_CASE** — module-level constants and spec catalogue
  entries (`VACUUM_PROP`, `BATTERY_PROP`, `OAUTH_BASIC_AUTH`, etc.).

### Spec catalogue

- Every property/action table uses **`as const`** at every level
  (`{ siid: 4, piid: 1 } as const` inside `{ ... } as const`) so the
  literal types survive into consumer code.
- Enums are **TS `enum`** (numeric) — both the named-member ergonomics
  and the reverse map are useful. `as const` object literals are used
  only for string-keyed catalogues like `FEATURE_CONFIG_KEYS`.

### State naming

Where a property has a verified enum mapping, expose both the typed
member and the raw int side by side:

- **`<name>`** — the typed enum value (or `null` if outside the known set).
- **`<name>Raw`** / **`raw<Name>`** — the raw integer, present even when
  outside the enum. Lets consumers handle unknown values without losing
  the data.

Example: `VacuumState` carries `suction` (`SuctionLevel | null`) and
`suctionRaw` (`number | null`).

## Errors at module boundaries

Anything thrown by a public API path should be a subclass of
`DreameError` (defined in `src/errors.ts`):

- **`DreameAuthError`** — login / refresh failures, missing
  `access_token`, malformed token responses.
- **`DreameApiError`** — non-2xx HTTP responses, non-zero `code` in a
  cloud response, malformed JSON body.
- **`DreameDeviceOfflineError`** — specifically `code: 80001` ("device
  may be offline, command sending timed out"). Subclass of
  `DreameApiError` so existing `instanceof DreameApiError` checks still
  match.
- **`DreameTransportError`** — network failures, MQTT connection
  failures, AbortSignal-driven timeouts.

`RangeError` / `TypeError` are acceptable for **input validation** at
public method boundaries (e.g. `cleanSegments([])`); never use a plain
`throw new Error(...)` — wrap into a `Dreame*Error` subclass with a
context tag in the message ("auth: …", "device list: …",
"sendCommand: …", etc.).

## Explicit return types on public async methods

Every exported async method must declare its return type explicitly
(`Promise<DreameDevice[]>`, `Promise<RefreshResult>`, etc.) rather than
relying on inference. Two reasons:

1. The compiler catches accidental shape drift before it hits a
   downstream consumer who's typed against the inferred type.
2. The `dist/index.d.ts` declarations stay readable — inferred return
   types tend to widen into long unions when the body ends up calling
   another function whose return type is itself widened.

Same convention for the synchronous setters that return arrays
(`setSettings`, etc.) — declare the return type even when it's
`Promise<unknown>`.

## `readonly` on public array-typed fields

Public types that contain arrays should mark them `readonly` so
consumers can't mutate them in place — both because shared references
(`MODEL_CAPABILITIES` table entries, decoded `MapData`) shouldn't be
mutable from outside, and because mutation through the public API
breaks downstream callers' assumptions.

Already-followed: `DeviceCapabilities` (every array field is
`readonly`), `MODEL_CAPABILITIES` (table entries deep-frozen at module
load — see `capabilities.ts`).

Extended at #25: `MapData`, `MapLayer`, `MapSegment`, `MapPath`,
`MapCleanedAreaOverlay` — the decoder output is now `readonly` for
arrays, so renderers can't mutate the buffer that `MapManager` keeps
as the running merged state.

## No backwards-compat scaffolding

Until a v1.0 cut, this repo deliberately does not carry version-sniffing
or fallback paths for older firmware. Specifically:

- **No firmware-version branches.** Assume the device is on the latest
  firmware available for its model. If a property meaning changes
  across firmware, update the entry to reflect current reality and
  drop the old reading rather than maintaining both.
- **Drop ASSUMED entries when contradicted.** If live observation shows
  a Tasshack-borrowed enum value is wrong on the X50 generation, change
  the entry to the verified value and remove the `ASSUMED` doc — don't
  add a parallel "old vs new" enum.
- **No internal API stability guarantees.** Rename, remove, or reshape
  internal helpers freely. Tests get updated as part of the change.
- **Public API breaks are fine** until a v1.0 — every behavioural
  change to a published method needs a CHANGELOG entry but does not
  need a deprecation cycle.

## Lazy-load test fixtures inside `it()` callbacks

Fixture files (`test/fixtures/...`) must be read inside the test body,
not at the top of the test module or inside `describe()`:

```ts
// ❌ wrong — runs at describe() collection time, hits ENOENT in CI
const fixture = readFileSync("test/fixtures/foo.bin");

describe("decoder", () => {
  it("decodes foo", () => {
    expect(decode(fixture)).toBeTruthy();
  });
});

// ✅ correct — runs inside the it() callback only when the test runs
describe("decoder", () => {
  it("decodes foo", () => {
    const fixture = readFileSync("test/fixtures/foo.bin");
    expect(decode(fixture)).toBeTruthy();
  });
});
```

Reason: `describe.skip(...)` doesn't prevent the describe-block body
from executing — only the inner `it()`s. Reading fixtures at describe
scope therefore runs even when the test is skipped, and CI environments
that don't ship the fixtures get an unrelated `ENOENT` failure.

This bit us once. The repo's vitest config already runs the project
test suite green; the rule is here to keep it that way.

## One concept per file

Each module should hold one cohesive concept. Soft size guideline: if a
file is over ~500 lines and contains two clearly separable concerns,
split it. The repo's existing splits (after #15 and #16):

- `src/vacuum.ts` (the class) is paired with `src/vacuum/state.ts`,
  `src/vacuum/task-complete.ts`, and `src/vacuum/saved-maps.ts`.
- `src/miot-spec.ts` (the spec catalogue) is paired with
  `src/spec/enums.ts` and `src/spec/feature-config.ts`.
- `src/headers.ts` is split out from `src/auth.ts` to break the
  `auth → http → auth` import cycle.

Re-exports from the original module are fine when they preserve the
existing public import surface. Don't move public symbols without a
re-export bridge unless you're explicitly making a breaking change.

## HTTP header keys are always lowercase

Every header key emitted from the library is lower-case
(`"dreame-auth"`, `"content-type"`, `"user-agent"`, etc.). This isn't
just style — Dreame's backend is case-sensitive in ways that surface as
opaque 4xx responses if you mix in a `Content-Type` capital. Match the
existing entries in `src/headers.ts` exactly, including the `dreame-*`
custom keys, and lowercase any header keys you read off the wire (the
`mockFetch` helper in tests does this for you when comparing).
