Current state:
- `game-day.html` owns status-transition prompting, wrap-up field hydration, completion payload construction, and redirect URL assembly inline.

Proposed state:
- Move the wrap-up-specific decision and payload construction into `js/game-day-wrapup.js`.
- Keep DOM reads/writes in `game-day.html`; only extract deterministic behavior.

Control and blast-radius comparison:
- Current state has no CI-visible contract for this path, so regressions land silently.
- New state adds an explicit contract around transition gating, field hydration, completion payload, and redirect while keeping page behavior unchanged.

Tradeoffs:
- Small extra module/import to maintain.
- In return, the highest-risk wrap-up path becomes testable without introducing a browser runner migration.

Rollback:
- Revert the helper import and inline the three small behaviors back into `game-day.html`.
