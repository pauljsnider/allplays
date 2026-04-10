# Architecture Role Notes

## Current State
- Modal rideshare rendering in `parent-dashboard.html` computes selected child, request lookup, button visibility, and status copy inline inside the offer map.
- Submission handling already lives in `js/parent-dashboard-rideshare-controls.js`.

## Proposed State
- Keep the HTML page as the integration layer.
- Move the per-offer action-state computation into `js/parent-dashboard-rideshare-controls.js` so rendering and tests share the same decision logic.

## Why This Path
- It is the smallest change that makes the modal workflow testable without introducing a framework or rewriting the page.
- It reduces drift between inline rendering logic and request submission logic by centralizing the selected-child state derivation in one module.

## Blast Radius
- `parent-dashboard.html`
- `js/parent-dashboard-rideshare-controls.js`
- rideshare unit tests only

## Controls
- Preserve existing helper APIs and Firestore request/cancel calls.
- Do not change selection persistence or rideshare data-loading behavior.
