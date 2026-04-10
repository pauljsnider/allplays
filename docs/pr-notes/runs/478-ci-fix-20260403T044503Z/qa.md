Root cause:
- The cancelled import smoke test relies on fixed dates that have aged into the past.
- `edit-schedule.html` only shows upcoming events by default, so the cancelled rows are absent and the locator fails.

Validation plan:
- Run the single failing Playwright smoke spec locally with `playwright.smoke.config.js`.
- Confirm both cancelled rows render, still show `Cancelled`, still apply strike-through styling, and still hide `Track` / `Plan Practice`.

Regression considerations:
- Relative future dates remove date-window brittleness.
- Assertions remain unchanged, so coverage of the intended cancelled-event behavior is preserved.
