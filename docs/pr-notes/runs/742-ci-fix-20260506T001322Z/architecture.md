# Architecture Notes

Subagents unavailable in this runtime, so analysis was performed inline.

## Acceptance Criteria
- Restore CI by aligning registration Firestore rule assertion with the actual intended rules structure.
- Do not broaden Firestore access or change runtime authorization behavior unless required.

## Architecture Decision
- The failure is test drift: `firestore.rules` now wraps registration create authorization in a multi-line expression instead of the previous literal `allow create: if isPublishedRegistrationForm` substring.
- Prefer updating the unit assertion to validate the current rule shape and required guard function usage rather than changing security rules just to satisfy a brittle substring.

## Risks And Rollback
- Risk: a too-loose test could miss accidental removal of published-form gating. Mitigation: keep assertions for the registration form match, published form function, pending status, and waiver acceptance.
- Rollback: revert the test-only commit if CI exposes a real rules regression.
