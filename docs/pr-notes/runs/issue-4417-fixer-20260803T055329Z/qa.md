# QA Plan

## Matrix

| Case | Seed | Auth and payload | Friendship assertion |
|---|---|---|---|
| Identity mismatch | Active invite for stored target | Verified different email; payload supplies target metadata | Auth-derived and payload-derived refs remain absent |
| Self-redemption | `generatedBy === auth.uid` | Verified matching email | Self-pair and payload-derived refs remain absent |
| Expiration | Expired invite | Verified matching email | Canonical ref remains absent |
| Prior use | Used invite plus accepted friendship | Verified matching email | Existing friendship remains identical |
| Blocked friendship | Active invite plus blocked friendship | Verified matching email | Blocked friendship remains identical |

## Snapshot contract

Read the invite and every relevant friendship ref with `getAll`. Represent each as `{ path, exists, data, updateTime }`. Deep equality after rejection proves no create, update, or delete. Existing friendship fixtures include stable timestamps and sentinel fields so accidental rewrites cannot pass.

## Error assertions

For every row assert exact code/message, undefined details, and absence of invite code, stored target, inviter metadata, Auth metadata, payload metadata, and internal rejection names in serialized public errors.

## Isolation

- Generate a UUID per case for code, users, app name, and friendship IDs.
- Use timestamps with a stable margin from the current clock.
- Register cleanup before mutation and delete only exact fixture refs.
- Do not clear the emulator database or depend on collection-global state.

## Focused validation

```bash
node --test functions/test/friend-invite-redemption.test.cjs
npx firebase emulators:exec --only firestore --project demo-allplays "node --test functions/test/friend-invite-redemption.test.cjs"
```

The emulator command is the completion gate because plain Node execution skips emulator tests.
