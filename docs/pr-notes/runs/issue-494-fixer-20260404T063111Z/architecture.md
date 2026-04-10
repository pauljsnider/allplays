# Architecture Role (fallback synthesis)

## Root Cause
The product behavior already exists in `js/homepage.js`, but the regression net is incomplete. Replay rendering is data-driven and therefore vulnerable to silent breakage if query return shapes or fallback handling drift.

## Minimal Safe Fix
- Extend `tests/unit/homepage-index.test.js` with explicit replay-card and replay-fallback assertions.
- Harden `loadPastGames` to treat unexpected non-array query results as empty state rather than leaving the section vulnerable to runtime shape errors.
- Bump the homepage module cache version in `index.html` so the deployed page pulls the updated script.

## Blast Radius
- `js/homepage.js`
- `index.html`
- `tests/unit/homepage-index.test.js`

## Controls
- Keep changes local to `loadPastGames`.
- Preserve existing user-facing copy.
- Validate with focused Vitest coverage for homepage behavior.
