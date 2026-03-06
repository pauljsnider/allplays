# Architecture role (inline fallback)

Subagent orchestration tools/skills are unavailable in this execution context, so this is an inline architecture pass.

## Current state
`render()` builds HTML strings with template literals and injects with `innerHTML`; section fields are inserted raw.

## Proposed state
Add local helper functions in the page script:
- `escapeHtml(value)` for text/HTML context.
- `toSafeFragmentId(value, index)` to produce deterministic, encoded fragment IDs for `id` and `href`.

Render uses precomputed escaped/safe values before interpolation.

## Risk / blast radius
Low: only `help.html` rendering logic changes; no shared modules or backend behavior impacted.
