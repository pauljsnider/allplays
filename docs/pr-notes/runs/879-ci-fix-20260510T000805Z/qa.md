# QA Notes

Root Cause
- The unit test `parent-dashboard-rsvp-controls.test.js` expected a literal HTML snippet using `(ev.childIds || [])`, but the current production function uses the local name `event` for the same calendar event object.
- This is assertion drift, not a user-facing RSVP regression.

QA Plan
- Run the focused test: `npx vitest run tests/unit/parent-dashboard-rsvp-controls.test.js`.
- Run the full unit suite: `npm test`.

Edge Risks
- Ensure grouped RSVP behavior remains covered by checking for `data-child-ids` and the `.join(',')` serialization.
- Ensure per-child RSVP behavior remains covered by the existing `data-child-id` assertion.
