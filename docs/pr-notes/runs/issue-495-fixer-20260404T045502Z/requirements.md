Objective: make Game Day Wrap-Up AI use the actual team sport so basketball teams get basketball-specific outputs.

Current state:
- Wrap-Up AI prompts in `game-day.html` are hardcoded to soccer.
- Basketball is a supported Game Day mode, so this produces user-visible wrong-sport summaries and practice guidance.

Proposed state:
- Prompt wording resolves sport from the current team/game tracker context.
- Basketball teams receive basketball wording; soccer teams keep soccer wording; unknown sports degrade gracefully to a generic label.

Risk surface and blast radius:
- Blast radius is limited to two wrap-up AI actions in `game-day.html`.
- No Firestore schema changes, auth changes, or routing changes.
- Main regression risk is prompt wording drift for existing soccer teams.

Assumptions:
- Team sport or tracker config base type is the source of truth for wrap-up sport context.
- A generic fallback is acceptable if sport data is missing.
- Existing manual and unit test conventions remain the preferred path.

Recommendation:
- Extract prompt builders into `js/game-day-wrapup.js` and cover sport resolution with unit tests.
- Keep page behavior and saved payload structure unchanged.

Success criteria:
- Basketball wrap-up prompts mention basketball, not soccer.
- Soccer behavior remains soccer-specific.
- Unit tests cover both prompt builders and page wiring still references the helper module.
