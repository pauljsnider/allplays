# Code Role Output

## Patch Plan
1. Add a helper to clean up newly created users by deleting account and signing out.
2. Call helper in email/password parent-invite catch path, then rethrow.
3. Call helper in Google parent-invite catch path, then rethrow.
4. Extend unit tests to validate no profile write and cleanup side effects.

## Code Changes Applied
- Added `cleanupFailedNewUser(user, context)` helper in `js/auth.js` to centralize delete + signOut cleanup for failed new-user flows.
- Updated email/password parent invite catch path to invoke cleanup helper and rethrow.
- Updated Google new-user parent invite catch path to invoke cleanup helper and rethrow (fail closed).
- Expanded `tests/unit/auth-signup-parent-invite.test.js` with assertions that parent-link failure skips `updateUserProfile`, attempts `user.delete()`, and signs out.
- Added Google parent-invite regression test covering fail-closed cleanup behavior.

## Validation Run
- `node /home/paul-bot1/.openclaw/workspace/allplays/node_modules/vitest/vitest.mjs run tests/unit/auth-signup-parent-invite.test.js`
- Result: pass (`3 passed`, `0 failed`).

## Residual Risks
- UI may still show generic error copy if higher layers do not map backend errors.

## Commit Message Draft
Fix parent invite cleanup and fail-closed behavior for Google auth

---

# Orchestrator Synthesis

## Acceptance Criteria
1. Parent invite failures fail closed in both signup channels.
2. Newly created auth users are cleaned up on parent invite failure.
3. No profile writes occur when parent invite redemption fails.
4. Non-parent signup path remains unchanged.

## Architecture Decisions
- Minimal surgical edits in `js/auth.js` only around parent-invite failure catches.
- Shared cleanup helper to avoid divergent behavior between channels.

## QA Plan
- Update existing auth parent-invite unit tests with assertions for cleanup + no profile write.
- Add Google-path regression coverage in same test file.

## Implementation Plan
- Implement helper and catch-block changes.
- Expand tests and run targeted Vitest execution.
- Commit and push with evidence.

## Risks And Rollback
- Risk: cleanup helper affects sign-out semantics in unexpected paths.
- Mitigation: invoke only in parent-invite failure catches.
- Rollback: revert commit to restore prior behavior if regressions appear.
