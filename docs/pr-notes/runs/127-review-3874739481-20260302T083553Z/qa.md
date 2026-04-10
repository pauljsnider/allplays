# QA Role (manual fallback)

## Risk focus
- Regression: admin invite users missing profile metadata consumed by admin lookups/reporting.
- Regression: auth account orphaned on admin redemption error.

## Coverage strategy
- Extend `tests/unit/signup-flow.test.js` to assert baseline profile write in admin invite success path.
- Add explicit admin invite failure rollback test to assert auth user deletion, sign-out, and original error propagation.

## Validation run
- `node /home/paul-bot1/.openclaw/workspace/allplays/node_modules/vitest/vitest.mjs run --root /home/paul-bot1/.openclaw/workspace/worktrees/allplays-pr127-review tests/unit/signup-flow.test.js`
