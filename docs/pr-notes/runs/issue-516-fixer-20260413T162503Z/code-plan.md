# Issue #516 Implementation Plan

## Implementation Plan
- Add regression cases to `tests/unit/rsvp-summary.test.js` using realistic parent multi-player and coach override docs.
- Add a matching game-day breakdown regression in `tests/unit/game-day-rsvp-breakdown.test.js`.
- Refactor the duplicated latest-response selection logic into a shared helper in `js/rsvp-summary.js`.
- Reuse that helper from `js/game-day-rsvp-breakdown.js` so summary and breakdown cannot diverge on precedence.

## Files To Touch
- `js/rsvp-summary.js`
- `js/game-day-rsvp-breakdown.js`
- `tests/unit/rsvp-summary.test.js`
- `tests/unit/game-day-rsvp-breakdown.test.js`

## Validation Notes
- Run focused RSVP tests first.
- Run the full unit suite after the shared-helper change.
- Do not change Firestore write paths, schemas, or unrelated UI code.
