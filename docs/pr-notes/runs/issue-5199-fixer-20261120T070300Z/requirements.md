# Requirements analysis — Issue #5199

## Root cause and acceptance criteria

The automatic and manual parent-invite paths independently implemented the same domain transition. The automatic path writes `parents` to the public player document even though Firestore Rules classify that field as restricted; manual redemption writes the relationship to `private/profile` and maintains the sanitized public user projection.

The fix must ensure that automatic linking:

- never writes parent identity or contact data to `teams/{teamId}/players/{playerId}`;
- writes the canonical `{ userId, email, relation, addedAt }` record to `players/{playerId}/private/profile.parents`;
- refreshes `publicUserProfiles/{userId}` through the established sanitized projection;
- keeps user linkage, invite acceptance, and private linkage atomic;
- preserves unrelated public-player and private-profile fields;
- remains retry-safe and does not duplicate a parent already present in the private profile.

Manual redemption behavior and the rules classification of `parents` must remain unchanged. Auto-link and manual redemption should be behaviorally indistinguishable to parents, coaches, and managers after completion.

## Historical data and scope

Existing public `parents` entries with `source: 'parent_invite'` require a privileged, idempotent backfill. The controller explicitly rejected `_migration/` and other operational paths for this run, so this patch must prevent new leakage and leave historical cleanup as a separately authorized follow-up rather than hiding a partial migration in the callable.

## Regression requirement

The real auto-link handler must be exercised with in-memory Firestore to prove the public player stays clean, the private link and sanitized projection are written, existing private data is preserved, and repeated or pre-existing links do not duplicate.

## Recurrence risk

**Medium.** Multiple invite acceptance paths can drift unless handler-level tests assert their shared public/private storage boundary and projection contract.
