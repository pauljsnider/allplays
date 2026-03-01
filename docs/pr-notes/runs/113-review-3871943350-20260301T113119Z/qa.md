# QA Role Summary

- Thinking level: medium.
- Regression target: parent-invite failure handling across both signup entry points.

## Test Strategy

1. Email/password flow test must assert:
- thrown parent-invite error is propagated,
- profile update + verification are skipped,
- auth user deletion is invoked,
- signOut is invoked.

2. Google flow test must assert:
- thrown parent-invite error is propagated,
- profile update and markAccessCodeAsUsed are skipped,
- auth user deletion is invoked,
- signOut is invoked.

## Residual Risk

- Existing tests do not exercise cleanup-call failure combinations (delete fails but signOut succeeds, etc.); behavior remains logged best-effort.
