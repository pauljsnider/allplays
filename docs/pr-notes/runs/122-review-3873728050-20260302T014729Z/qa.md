# QA Role (manual fallback)

- Thinking level: medium (regression guardrails for two P-level comments).

## Risks targeted
1. Silent corruption of channel-based embeds during save.
2. Empty desktop video column shown for teams without streams.

## Coverage plan
1. Add unit tests for URL normalization preserving required query params.
2. Add unit tests for panel visibility decisions when `hasVideoStream=false`.
3. Re-run adjacent live-game chat test file to ensure no module regression from new import path.

## Validation outcome
- Passed: `tests/unit/live-stream-utils.test.js`
- Passed: `tests/unit/live-game-chat.test.js`
