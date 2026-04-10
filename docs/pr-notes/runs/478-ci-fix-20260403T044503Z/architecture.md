Objective: restore `preview-smoke` for cancelled imported calendar events with the smallest possible change.

Thinking level: low. The failure is isolated to one smoke test and the rendered UI behavior remains coherent.

Current state:
- `edit-schedule.html` defaults to `upcoming-all`.
- The smoke fixture in `tests/smoke/edit-schedule-calendar-cancelled-import.spec.js` uses hardcoded March 2026 dates.
- On 2026-04-03 those events fall into the past and are filtered out before the locator runs.

Proposed state:
- Keep application behavior unchanged.
- Make the smoke fixture generate future-relative event dates so the test remains visible under the default upcoming filter.

Risk surface and blast radius:
- Limited to one Playwright smoke test fixture.
- No runtime code, data model, or user-visible behavior changes.

Why this path:
- It fixes the actual root cause, which is test brittleness caused by wall-clock drift.
- Changing product filtering logic to satisfy the test would expand blast radius and be the wrong control.
