# Migration Scripts

One-off Node.js scripts for Firestore data fixes and migrations. They run with
the `firebase-admin` SDK against production using Application Default
Credentials or an explicitly supplied service account key.

## Requirements

- Node.js 18+
- `./serviceAccountKey.json` in this directory (service account for
  `game-flow-c6311`). Never commit this file.

## Conventions

- Dry run by default; pass `--apply --code CODE` to write one reviewed repair.
- Scripts log every doc they would change so the dry run output can be
  reviewed before applying.

## Scripts

### backfill-public-team-profiles.js

Creates or refreshes the strict `publicTeamProfiles/{teamId}` projection for
active public teams and removes stale projections for private/inactive teams.
It does not modify source team documents, so it is safe to deploy while legacy
clients continue reading public `teams` documents. Dry run is the default:

```bash
node _migration/backfill-public-team-profiles.js
node _migration/backfill-public-team-profiles.js --team TEAM_ID
node _migration/backfill-public-team-profiles.js --apply
```

Safe rollout order:

1. Deploy the projection rules, Functions sync trigger/callable fallbacks, and
   projection-first frontend readers while retaining legacy source reads.
2. Run and review this backfill's dry run, then apply it.
3. A full apply first sets `systemMigrations/publicTeamProfilesBackfill.completed`
   to `false`, keeping browse on the compatibility source query. After the
   initial pass it repeatedly reconciles current source teams and orphaned
   projections until two source snapshots match. Only that fixed point records
   `completed: true`; sustained concurrent changes abort without enabling the
   projection-only path.
4. Verify old source-team readers and new projection readers in production.

Public browse and detail reads retain allow-listed callable fallbacks during
the backfill window, including when there are zero projection documents.

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
`backfill-legacy-team-chat-target-fields.js`,
`backfill-notification-recipients.js`,
`backfill-public-team-search-fields.js`,
`backfill-reciprocal-parent-links.js`,
`migrate-player-private-profile.js`,
`quarantine-legacy-targeted-team-chat.js`.
