# Code Role Plan

## Patch Scope
- File: `js/auth.js`
  - Refactor parent-invite `signup` catch cleanup to:
    - isolate delete attempt and logging
    - isolate sign-out attempt and logging
    - rethrow original caught error
- File: `tests/unit/auth-signup-parent-invite.test.js`
  - Add assertions for independent sign-out catch and non-coupled cleanup shape.

## Out of Scope
- No functional changes to Google signup flow.
- No Firestore rules/data-model changes.
