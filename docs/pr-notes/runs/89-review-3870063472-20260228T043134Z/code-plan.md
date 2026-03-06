# Code Role Plan

## Minimal Patch
1. In `expandRecurrence`, replace daily `matches = true` with modulo-day interval check.
2. Add daily recurrence fixtures and assertions in `tests/unit/recurrence-expand.test.js`.
3. Run focused tests and ship.

## Why This Patch
- Solves reported bug directly.
- Keeps behavior backward compatible for default interval.
- Adds regression guardrails to prevent recurrence.
