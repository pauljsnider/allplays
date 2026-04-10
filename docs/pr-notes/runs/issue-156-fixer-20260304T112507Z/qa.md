# QA Role Synthesis (Fallback)

## Test Strategy
Add unit tests for pure summary helper with overlapping parent and coach docs for same player.

## Primary Regression Guardrails
- Latest response wins for same player across multiple docs.
- Multi-player parent RSVP with one player override does not double-count overridden player.
- Summary never exceeds roster size in overlap scenario.

## Manual Verification Focus
- Parent dashboard and calendar summary values after parent RSVP then coach override.
- Game Day changes reflected as replacement for targeted player.
