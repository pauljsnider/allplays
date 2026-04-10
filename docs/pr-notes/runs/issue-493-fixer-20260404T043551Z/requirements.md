# Requirements Role Notes

## Objective
Add regression coverage for the Parent Dashboard rideshare modal so multi-child picker state, rendered action state, and submitted child payload stay aligned.

## Current State
- `parent-dashboard.html` renders rideshare controls inline and decides `Request Spot` vs `Cancel` from the currently selected child.
- `js/parent-dashboard-rideshare-controls.js` already covers selection resolution and submit payload handling, but not the modal's rendered sibling-switching workflow.
- Existing tests stop at helper/payload checks and do not assert rendered modal output for multiple eligible children.

## Proposed State
- Extract the per-offer child-selection action-state calculation into a testable helper.
- Use that helper from the modal rendering path.
- Add tests that prove switching the picker from one sibling to another flips the action and status copy for the selected child, and that request submission still uses the selected child.

## Risk Surface
- Blast radius is limited to Parent Dashboard rideshare controls.
- No Firestore schema or API contract changes.
- Main regression risk is accidentally changing request/cancel visibility for edge cases such as driver-owned offers, closed offers, or invalid child ids.

## Assumptions
- The intended behavior is one active rideshare action per selected child: unrequested siblings show `Request Spot`; siblings with an existing pending/confirmed request show `Cancel` and status text.
- The extracted helper can be treated as the canonical source of truth for modal per-offer UI state.

## Success Criteria
- A unit test proves sibling switching changes the rendered action from `Request Spot` to `Cancel` and updates the selected-child status copy.
- A unit test proves the request handler submits the picker-selected `{ childId, childName }`.
- Relevant rideshare unit tests pass.
