# QA Role Notes

## Regression Focus
- Parent-invite signup error path should include cleanup before throw.
- Non-parent signup and successful parent-invite paths unaffected.

## Checks
- Structural unit assertion for cleanup statements in parent-invite catch block.
- Existing parent-invite fail-closed assertion retained.

## Residual Risk
- Runtime delete failure handling is best-effort and depends on Firebase client state; sign-out fallback mitigates lingering session risk.
