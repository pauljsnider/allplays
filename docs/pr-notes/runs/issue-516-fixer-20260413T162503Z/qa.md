# Issue #516 QA Plan

## QA Plan
- Cover the precedence case in unit tests with production-like parent and coach RSVP document shapes.
- Verify both summary recomputation and game-day breakdown behavior so denormalized counts cannot drift from per-player resolution.
- Keep validation focused on the RSVP regression area plus a full unit smoke run after the shared-helper change.

## Test Cases
1. Parent multi-player RSVP `going` for `p1` and `p2`, then newer coach override `not_going` for `p1` produces summary `{ going: 1, notGoing: 1, maybe: 0, notResponded: 0, total: 2 }`.
2. Older coach override for `p1`, then newer parent multi-player RSVP `maybe` for `p1` and `p2` makes both players resolve to `maybe`.
3. Game-day breakdown preserves sibling isolation while using the same precedence rule and counts.

## Validation Commands
- `./node_modules/.bin/vitest run tests/unit/rsvp-summary.test.js tests/unit/game-day-rsvp-breakdown.test.js tests/unit/rsvp-doc-ids.test.js`
- `npm test`
