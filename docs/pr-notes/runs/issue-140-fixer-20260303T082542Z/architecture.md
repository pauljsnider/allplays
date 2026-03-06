# Architecture role synthesis (fallback)

## Current state
`parent-dashboard.html` module has an accidental early `window.submitGameRsvp = async function(...) {` opening brace, causing rideshare helper declarations to be nested in that function scope. Global wiring for rideshare handlers executes before valid top-level declarations.

## Proposed state
Remove the accidental early function opener so rideshare helpers remain top-level declarations, and keep a single canonical `window.submitGameRsvp` implementation later in the script.

## Blast radius
Single file, single script block, no API contract changes, no schema/rules changes.

## Control equivalence
- Keeps existing public `window.*` handler surface.
- Eliminates malformed scope that prevents initialization.
