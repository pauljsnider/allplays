# Code Plan

## Root Cause
- The failing test uses a hard-coded event date that has aged into the past.
- In calendar mode, the parent dashboard filters to upcoming events by default, so the modal receives no events and renders the empty state.

## Files To Change
- `tests/unit/parent-dashboard-calendar-day-modal-rsvp.test.js`

## Minimal Patch Plan
- Replace the fixed event date with a runtime-relative future date.
- Leave RSVP control logic and schedule filtering unchanged.

## Validation Command
- `npx vitest run tests/unit/parent-dashboard-calendar-day-modal-rsvp.test.js`