# QA Role Summary

Thinking level: medium (cross-flow regression checks across duplicated tracker logic).

## Regression guardrails
1. Start fresh from resume prompt no longer re-prompts solely due to stale `liveHasData`.
2. Cancel removes `liveEvents` in addition to `events` and `aggregatedStats`.
3. Reset sets `liveStatus` back to scheduled in both persisted and in-memory state.
4. Opponent identity link fields remain unchanged after reset/cancel.

## Validation focus
- Static verification of patched payloads in `track-live.html` and `js/live-tracker.js`.
- Existing unit tests for `track-live-state` helper still pass.
