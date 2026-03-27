## Current State

- `game-day.html` defines `pickBestGameId()` and `normalizeGameDayUrl()` inline.
- `initPage()` resolves a game id, rewrites history, and then loads the selected game document.
- The exact requested id currently short-circuits selection without validating whether it is still a good Game Day target.

## Proposed State

- Move entry-routing helpers into `js/game-day-entry.js`.
- Import those helpers back into `game-day.html`.
- Preserve the existing `initPage()` flow: resolve id, normalize URL, load selected game doc.

## Controls Comparison

- Current blast radius: inline page logic with no automated guardrail.
- Proposed blast radius: same runtime path, but with deterministic unit coverage and one reusable helper module.
- No auth, Firestore rule, or data model changes.

## Tradeoffs

- Small new module adds one more import, but materially improves testability.
- Keeping the rest of `initPage()` intact avoids regression risk in the broader Game Day screen.
