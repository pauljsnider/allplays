# QA Role Notes

## Focused Regression Risks
- Redirect-based new user signup with parent invite failure should clear stale code.
- Redirect-based successful signup should still work with activation code intact during processing.
- Existing-user Google redirect login should not retain stale pending code.

## Validation Matrix
1. Trigger popup-blocked fallback and complete redirect with valid invite code: signup succeeds.
2. Trigger popup-blocked fallback with parent invite redemption failure: error shown, `pendingActivationCode` removed.
3. Redirect login as existing user after prior failed signup attempt: `pendingActivationCode` not retained.

## Guardrail
No behavior changes to email/password auth or non-redirect Google popup success path.
