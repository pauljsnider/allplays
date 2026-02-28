# Requirements Role Notes

Thinking level: medium (targeted correctness hardening around DST boundaries)

## Objective
Address PR #103 review comment `r2867873194` by ensuring ICS TZID parsing does not silently return incorrect timestamps near DST transitions.

## Constraints
- Preserve existing valid imports and browser compatibility fallback behavior.
- Reject invalid/non-existent local times with explicit warnings.
- Keep patch minimal and reviewable.

## Acceptance Criteria
1. Parsing logic uses a stronger convergence strategy than the prior fixed small loop limit.
2. Non-convergent offset iteration is explicitly surfaced with a warning signal.
3. Existing DST spring-forward invalid time regression remains covered.
4. Unit tests pass for ICS timezone parser scenarios.

## Fallback Note
Requested orchestration skill `allplays-requirements-expert` is unavailable in this environment; this file records the equivalent role output directly.
