# Architecture analysis — Issue #5199

## Root cause

The Admin-SDK auto-link handler writes restricted parent data to the public player document. Firestore Rules cannot block that privileged write; `hasRestrictedRosterFieldValues` only makes the polluted document unreadable to public viewers. The focused test encoded the incorrect public write as expected behavior.

## Persistence contract

Within the existing transaction:

1. Build the updated user relationship data once and update `users/{parentId}`.
2. Merge the established sanitized projection into `publicUserProfiles/{parentId}`.
3. Read and merge `teams/{teamId}/players/{playerId}/private/profile.parents`, using the manual-redemption record shape and de-duplicating by `userId`.
4. Mark the access code accepted.
5. Do not write `parents` to the public player document.

Reading the private profile and writing the merged array inside the transaction avoids new production dependency wiring and remains concurrency-safe under Firestore transaction retries. The public player remains a read dependency because its safe display fields populate the user's `parentOf` link.

The projection should use the existing public-profile projection helper with the normalized, revalidated invite email and the same transaction timestamp for `updatedAt`.

## Historical data

Do not opportunistically scrub legacy records during future invite acceptance. A complete backfill must copy qualifying links before scrubbing and belongs in separately authorized operational work; `_migration/` is outside this controller-approved patch.

## Recurrence risk

**Medium.** The focused producer is guarded after this fix, but independent invite implementations and existing historical records remain risks until a separately authorized inventory/backfill is completed.
