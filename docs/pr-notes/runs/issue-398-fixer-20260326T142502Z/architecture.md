Current state:
- `js/live-game.js` owns lineup rendering inline.
- `state.onCourt` and `state.bench` are updated from game doc and live events.
- `renderLineup()` ignores `state.bench` and infers bench from roster complement.

Proposed state:
- Add pure helper(s) in `js/live-game-state.js` to:
  - normalize viewer lineup against roster ids
  - render on-court and bench HTML with the configured stat columns
- Update `js/live-game.js` to delegate lineup rendering to those helpers.

Why this shape:
- Smallest safe change.
- Keeps DOM manipulation in page code and business rules in a unit-testable module.
- Avoids introducing jsdom or broad page bootstrapping in tests.

Controls:
- Unknown ids filtered out.
- Duplicate ids removed across both lists.
- Explicit bench respected when present, with fallback to inferred remainder only when bench is absent.
