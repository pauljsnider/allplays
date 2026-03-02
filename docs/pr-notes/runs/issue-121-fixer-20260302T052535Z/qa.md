# QA Role Synthesis

## Regression Guardrails
- Unit test ambiguous multi-child fallback returns empty list.
- Unit test single-child fallback still returns that child ID.
- Re-run parent RSVP unit suite.

## Manual Verification Focus
- Parent with two children on same team:
  - Child-specific list card click sends only clicked child ID.
  - Any grouped/ambiguous context should not silently write both children.
