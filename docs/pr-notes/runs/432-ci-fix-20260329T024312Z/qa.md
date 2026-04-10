Root cause evidence:
- Unit failure shows `setCoachPlayerRsvp('p1', 'going')` leaves `#rsvp-panel` containing `No Response (1)`.
- In `js/game-day-rsvp-controls.js`, `await loadRsvps()` is treated as failed when it returns `undefined`, which is a valid outcome for mocks and some wrappers.
- Cache-bust guard reports `js/db.js changed without a matching db.js version bump in imports.`

Validation plan:
- Run `npx vitest run tests/unit/game-day-rsvp-controls.test.js`.
- Run `node scripts/check-critical-cache-bust.mjs`.
- Run `npm run test:unit:ci` to cover the reported unit check.
