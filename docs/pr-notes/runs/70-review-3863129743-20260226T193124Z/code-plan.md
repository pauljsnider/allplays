# Code Role (allplays-code-expert)

## Objective
Implement a minimal safe patch for PR #70 review blockers without broad refactors.

## Implementation Plan
1. Inject `updateTeam` dependency into invite processor wiring in `accept-invite.html`.
2. In `js/accept-invite-flow.js` admin invite branch:
   - persist missing admin email via `updateTeam`
   - merge `coachOf` values instead of overwrite
   - preserve existing roles and add `coach` if missing
3. Extend `tests/unit/accept-invite-flow.test.js` with regression assertions for both review findings.
4. Run targeted unit tests and ship commit.

## Tradeoffs
- Keeps writes non-transactional to avoid scope expansion; acceptable for current single-user invite acceptance path.
- Uses additive merges to preserve backward compatibility with mixed-role profiles.
