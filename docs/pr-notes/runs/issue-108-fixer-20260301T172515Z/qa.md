# QA role synthesis

## Bug reproduction assertion
When both emails are present and different, send flow should choose team `notificationEmail`.

## Test strategy
- Add focused unit tests for recipient resolver:
  - prefers team notification email
  - falls back to current user email when team email missing/blank
  - trims whitespace and handles null/undefined safely

## Regression guardrails
- Keep existing `mailto` composition unchanged except recipient source.
- Run targeted unit test file and full unit suite (if feasible) to avoid collateral regressions.

## Manual spot-check
- In UI, set team Notification Email distinct from login email, complete game with send-on-save checked, verify mailto recipient.
