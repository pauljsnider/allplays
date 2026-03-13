# QA role synthesis (local fallback)

## Test focus
1. seeded bracket generation creates deterministic first-round pairings and source rules
2. result reporting auto-advances winner to downstream slot
3. publish workflow marks bracket published and returns public projection
4. BYE path auto-advances without requiring a played game

## Regression guardrails
- No mutation of unrelated game/event helpers.
- bracket helper functions are pure and deterministic for unit test repeatability.

## Manual checks
- Firestore rules compile and include `teams/{teamId}/brackets/{bracketId}` access controls.
