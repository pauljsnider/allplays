# Code Plan

## Files To Touch
- `parent-dashboard.html`

## Implementation Plan
1. In `openScheduleDayModal`, keep the existing filtered event lookup.
2. If the selected day resolves to zero events, fall back to day-matching entries from `allScheduleEvents` while preserving player scoping.
3. Re-run the parent dashboard RSVP modal tests, then the local unit suite command used by CI.

## Validation
- Confirm the modal HTML contains `data-child-ids="child-a,child-b"` before submission.
- Confirm grouped RSVP submission still sends both player ids and the modal refresh reflects the updated summary.
