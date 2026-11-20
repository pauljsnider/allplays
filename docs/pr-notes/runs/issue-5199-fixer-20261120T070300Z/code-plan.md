# Code plan — Issue #5199

## Minimal patch

Limit production changes to `functions/parent-invite-auto-link-callable.cjs` and focused coverage to its adjacent test.

1. Import the established pure public-user-profile projection builder.
2. Add references for `publicUserProfiles/{userId}` and the player's `private/profile`.
3. Read the private profile with the existing transaction reads.
4. Build `nextUserData` once, update the user, and merge its sanitized public projection.
5. Append the manual-redemption parent record only when the private array does not already contain the same `userId`; merge it into the private profile.
6. Remove the public-player `parents` update while preserving invite acceptance in the transaction.

## Test plan

Extend the in-memory Firestore double with `transaction.set` and merge semantics. Inject or assert deterministic projection output, change the successful write-path expectations, prove the public player is untouched, verify the private record and projection, and add pre-existing-link de-duplication coverage.

## Hazards

- Use the established projection helper rather than assembling a new public schema.
- Use the normalized and transaction-revalidated invite email.
- Match manual redemption's private record shape; do not retain auto-link-only `status` or `source` fields.
- Preserve unrelated private-profile data with merge semantics.
- Do not touch rejected entrypoint, workflow, ignore, or migration paths.

## Recurrence risk

**Medium.** The immediate patch is narrow, but shared storage-boundary tests are the durable guard against future path drift.
