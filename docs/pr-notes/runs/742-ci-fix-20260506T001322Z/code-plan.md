# Code Plan

Subagents unavailable in this runtime, so analysis was performed inline.

## Implementation Plan
- Locate the brittle assertion in `tests/unit/registration-flow.test.js`.
- Replace the exact `allow create` substring expectation with assertions that tolerate formatting while still requiring `allow create: if (` and `isPublishedRegistrationForm` in the registration rules.
- Run focused tests, then commit with the required CI-fix message.
