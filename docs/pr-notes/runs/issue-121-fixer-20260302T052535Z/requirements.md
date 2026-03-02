# Requirements Role Synthesis

## Objective
Ensure parent RSVP actions from child-specific context do not implicitly apply to siblings on the same team event.

## Current Behavior
Parent RSVP resolution can fallback to a broad player scope for an event, allowing one action to include multiple linked children when explicit child context is absent.

## Expected Behavior
A single child-card RSVP should affect only that child. Multi-child updates must be explicit.

## Acceptance Criteria
- Multi-child team/event context without explicit child selection does not default to all child IDs.
- Single-child team/event context still submits that child without extra prompts.
- Existing explicit `childId`, `selectedChildId`, and `childIds` behavior remains scoped to allowed players.
- Regression test covers ambiguous multi-child fallback.
