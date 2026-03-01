# Code Role Plan (manual fallback)

## Plan
1. Add failing regression test for `signup()` parent invite catch block in `js/auth.js`.
2. Patch `js/auth.js` parent invite catch to rethrow after logging.
3. Run targeted vitest for new test.
4. Stage docs + test + code, commit with `#90` reference.

## Conflict resolution
- Requirements and QA both require fail-closed behavior and visible error.
- Architecture recommends minimal scoped patch in `signup()` only.
- Final synthesis: implement only email/password parent invite fail-closed change plus regression test, no broader auth refactor.
