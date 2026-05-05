# PR 724 Remediator Code Plan

Subagent orchestration note: role-specific sessions_spawn was unavailable in this runtime (`agentId is not allowed`), so this note records the inline code analysis.

## Implementation Plan
1. In `registration.html`, replace label `innerHTML` interpolation with a created `span`, `textContent` for `field.label`, and a separately appended required marker node.
2. In `firestore.rules`, add `hasOnlyFlatStringValues(data)` helper that checks map type, bounds key count, and verifies each possible value up to the bound is a string.
3. Use the helper in `isPendingRegistrationPayloadValid` for `participant` and `guardian`.
4. Add focused unit assertions in `tests/unit/registration-flow.test.js` for the XSS-safe render path and rule helper wiring.
5. Run `npm test -- --run tests/unit/registration-flow.test.js` or the repo unit suite.
