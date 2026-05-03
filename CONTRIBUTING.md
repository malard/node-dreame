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
