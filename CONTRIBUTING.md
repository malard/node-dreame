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
