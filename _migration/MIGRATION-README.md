# Migration Scripts

One-off Node.js scripts for Firestore data fixes and migrations. They run with
the `firebase-admin` SDK against production using a service account key.

## Requirements

- Node.js 18+
- `./serviceAccountKey.json` in this directory (service account for
  `game-flow-c6311`). Never commit this file.

## Conventions

- Dry run by default; pass `--apply --code CODE` to write one reviewed repair.
- Scripts log every doc they would change so the dry run output can be
  reviewed before applying.

## Scripts

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
