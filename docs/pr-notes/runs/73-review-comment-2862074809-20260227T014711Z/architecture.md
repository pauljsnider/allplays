# Architecture Role Notes

## Decision
Add cleanup responsibility to `handleGoogleRedirectResult()` because that is the canonical control point for redirect return execution.

## Why This Layer
- Redirect errors never pass through `loginWithGoogle` popup catch cleanup.
- `handleGoogleRedirectResult` owns post-redirect control flow and can enforce invariant cleanup with `try/finally`.

## Control Equivalence
- Existing popup cleanup remains unchanged.
- Redirect cleanup becomes equivalent/stronger by guaranteeing state eviction even when parent-invite signup throws.

## Rollback
Revert the single `handleGoogleRedirectResult` block if regression appears.
