# Migration Scripts

One-off Node.js scripts for Firestore data fixes and migrations. They run with
the `firebase-admin` SDK against production using Application Default Credentials.

## Requirements

- Node.js 18+
- Application Default Credentials for `game-flow-c6311`, such as a
  `GOOGLE_APPLICATION_CREDENTIALS` path to a service account file outside the
  repository or credentials provided by the Google Cloud runtime.

## Conventions

- Dry run by default; pass `--apply --code CODE` to write one reviewed repair.
- Scripts log every doc they would change so the dry run output can be
  reviewed before applying.

## Scripts

### backfill-public-user-profiles.js

Rebuilds the `publicUserProfiles/{uid}` Friends-discovery projection for
verified accounts from private user membership, Firebase Auth identity, and
team owner/admin links. It also reconciles the server-owned normalized staff
membership index used by runtime synchronization. Every run requires an
explicit `--project` (or `FIREBASE_PROJECT_ID`). It is dry-run-only unless
`--apply` and an exact `--confirm-project` are both provided. Apply mode also
removes stale projections for unverified users, deleted Firebase Auth accounts,
and public profiles whose private user record no longer exists.

```bash
node _migration/backfill-public-user-profiles.js --email parent@example.com \
  --project game-flow-c6311
node _migration/backfill-public-user-profiles.js --apply --email parent@example.com \
  --project game-flow-c6311 --confirm-project game-flow-c6311
node _migration/backfill-public-user-profiles.js --all --project game-flow-c6311
```

### fix-orphaned-invite-redemptions.js

Repairs damage from failed signups that consumed an invite/access code before
the cleanup path deleted the auth user without rolling back the redemption
(issue #3845). Finds `accessCodes` whose `usedBy` uid has no Firebase Auth
record, and with a scoped `--apply --code CODE`:

- un-marks the code (`used:false, usedBy:null, usedAt:null`, removes a
  redemption-written `status:'accepted'`),
- deletes the orphaned `users/{uid}` doc and the
  `publicUserProfiles/{uid}` projection,
- removes the orphaned uid from the player's `private/profile` `parents[]`
  for parent/household/co-parent invites.

```bash
node _migration/fix-orphaned-invite-redemptions.js                  # dry run, all used codes
node _migration/fix-orphaned-invite-redemptions.js --code 7PPHXY3R  # dry run, one code
node _migration/fix-orphaned-invite-redemptions.js --apply --code 7PPHXY3R
```

The apply mode intentionally requires `--code`; bulk writes are not supported.

### Other scripts

See the header comment in each script for usage:
`backfill-admin-user-search-index.js`,
`backfill-legacy-team-chat-target-fields.js`,
`backfill-notification-recipients.js`,
`backfill-public-team-search-fields.js`,
`backfill-reciprocal-parent-links.js`,
`migrate-player-private-profile.js`,
`quarantine-legacy-targeted-team-chat.js`.

`backfill-admin-user-search-index.js` is also applied automatically by the
production deployment when its migration or index-building logic changes.
`backfill-team-fee-checkout-attempts.js` is applied automatically by the
production deployment when its migration logic changes. It atomically moves
legacy parent-readable Stripe checkout URLs, session IDs, payer/request state,
and attempt tokens into each recipient's server-private `checkoutAttempts/current`
document before scrubbing those fields from the recipient. Run it manually
without arguments for a read-only dry run; pass `--apply` only when executing
the migration against the intended Firebase project.
`backfill-registration-checkout-attempts.js` follows the same automatic,
dry-run-by-default contract for registration checkout URLs, capabilities,
provider IDs, exact requests, and nested payment-reminder retry URLs. It gives
an existing private checkout attempt precedence, moves any remaining legacy
state, and scrubs every readable bearer field transactionally.

`backfill-game-replay-archives.js` moves replay provider identities and URLs
from parent-readable `games` and `sharedGames` documents into each exact
document's server-private `privateReplay/archive` child. It is dry-run-only
without `--apply`. Apply mode first persists a durable protected-identity
inventory, then transactionally copies or quarantines complete legacy replay
state and scrubs every parent alias. It also scans the finite structured-media
surface: game/shared-game clip arrays and nested legacy highlights, generated
athlete-profile clips and seasons, team and historical game stream aliases,
broadcast providers, non-completed game `videoUrl`, typed team video links, and
drill video resources. Exact automated copies are removed; independently
published media is preserved and permanently reserved so a later replay cannot
claim the same YouTube identity. Canonical shared-event streams are independent,
while explicit shared/public projections and generated team-game provider
copies are automated. Verification unions frozen, durable, and fresh evidence
and must prove that no readable protected replay, unreserved independent source,
or automated copy remains. Existing valid private archives and removal
tombstones take precedence on retries.

A quarantine is server-private operator evidence only. Its parent game carries
no replay marker or revision, so bounded readers treat it as no playable replay
instead of failing an otherwise complete schedule. Apply mode deliberately
stops with the mutation gate still closed whenever any quarantine exists. An
operator must inspect each private child, replace it transactionally with one
valid `ready` or `removed` archive (or explicitly retire the quarantined
capability), and rerun the full migration; the gate cannot become `ready` while
raw quarantine evidence remains. Quarantine data is never returned to clients
and must be deleted as part of that resolution rather than retained as archive
history.

The confidentiality boundary prevents automatic or generated copies from
republishing a protected replay. Team stream settings, typed team-media video
links, drill resources, and athlete-profile clips cross server-authoritative
transactions that reject protected identities and permanently reserve accepted
standalone media so it cannot later be claimed as a replay. Existing structured
publications are preserved and reserved under the same rule. Generic manual
sharing outside those finite structured fields—such as social posts or free
text—remains outside this migration's enforceable identity boundary.

Production uses a broad `REPLAY_NATIVE_CALLABLE_READY` hold covering replay,
structured-media, and athlete-profile mutation callables plus the
`getReplayPrivacyMigrationStatus` cache protocol. Before Firestore starts, an
adoption build clears any retired browser/native IndexedDB, uses memory-only
Firestore while readiness is false or unreadable, and records the returned
cache epoch only after the server reports the completed migration. This makes
the post-migration restart clear again even if the same native build ran before
the gate. While readiness is false, only the compatibility callables and
cleanup triggers are staged; Hosting, Rules, the migration gate, and data
remain on the trusted deployed baseline. Once every supported installed native
build uses all callable boundaries and this cache protocol, the workflow
deploys the sanitized public readers, drains their prior 300-second shared-cache
TTL for 330 seconds, publishes updated Hosting callers, activates the exact
server-only Rules, closes the mutation gate, activates the profile boundary,
and runs migration/verification before the full application deploy. Retries
repeat the drain and never reopen an established final boundary. Do not run the
migration lazily from a viewer request. During the native-adoption hold,
replay management and playback can read validated legacy state without moving
it, but replay link and remove mutations fail closed until the migration is
ready.
