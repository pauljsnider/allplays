# QA role synthesis (fallback)

## Regression guardrails
- Add unit test on `parent-dashboard.html` source to catch malformed nesting pattern.
- Assert exactly one `window.submitGameRsvp` assignment to prevent duplicate handler blocks.

## Validation plan
- Run targeted unit test for parent dashboard script wiring.
- Run related rideshare helper and RSVP tests for nearby behavior confidence.

## Manual sanity checklist
- Open `/parent-dashboard.html`.
- Verify no console init error.
- Verify Offer Ride, Request Spot, and Confirm/Decline actions call handlers.
