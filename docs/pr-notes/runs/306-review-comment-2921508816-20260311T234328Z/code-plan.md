# Code Role

- Thinking level: low
- Smallest change:
  - keep the existing `afterPersist` partial-failure hook
  - replace the raw error alert with a stable, coach-facing remediation message
  - update the focused test to pin the exact alert text
- Files touched:
  - `game-day.html`
  - `tests/unit/game-day-lineup-publish.test.js`
  - run notes under `docs/pr-notes/runs/306-review-comment-2921508816-20260311T234328Z/`
- Why this is safe:
  - no behavioral change to successful publish or notification flows
  - no backend changes
  - test remains focused on the exact regression requested in review
