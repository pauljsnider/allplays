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
