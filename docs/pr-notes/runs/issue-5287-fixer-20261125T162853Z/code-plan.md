# Code plan

## Root cause

The verifier has no dedicated Hosting contract, so its application envelope can validate precomputed identity without proving that the site release and final Firebase CLI deployment summary completed.

## Minimal changes

1. Export `FIREBASE_HOSTING_TARGET_TYPE = 'firebase-hosting'`.
2. Add exact Hosting expected/evidence field lists.
3. Implement an isolated Hosting validator requiring `status: released`, matching project/site identity, exact `✔  hosting[<siteId>]: release complete`, and exact `✔ Deploy complete!`.
4. Dispatch Hosting requests before the existing application/Function branches.
5. Add complete, missing-final, progress-only, non-authoritative, malformed, and identity-mismatch tests.

## Implementation safeguards

- Keep Hosting fields out of application and Function shapes.
- Use exact string equality constructed from a validated site ID; do not use `/complete/i` or arbitrary log parsing.
- Reject booleans, exit codes, generic success text, arbitrary log blobs, and extra fields.
- Leave ANSI/log normalization to a future producer; this validator consumes normalized structured evidence.
