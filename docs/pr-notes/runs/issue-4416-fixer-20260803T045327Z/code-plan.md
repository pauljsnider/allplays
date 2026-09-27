# Code Plan

Evidence baseline: `5a5e93495c208fcd5d8a234f824cb6b0e8bb14ad`.

## Minimal patch

1. Extend `functions/test/friend-invite-redemption.test.cjs` with emulator-gated Admin SDK helpers.
2. Add verified-email and verified-phone callable cases that assert accepted friendship state, consumed invite state, shared timestamps, generic replay rejection, and unchanged complete records plus update times.
3. Append the focused Node test to the existing `test:storage-rules:ci` command while the Firestore emulator is active.
4. Keep all production code unchanged unless validation exposes an incompatibility.

## Implementation controls

- Use real Admin `Timestamp` values and a uniquely named app per fixture.
- Keep access codes exactly eight uppercase alphanumeric characters.
- Normalize Firestore timestamps before data comparison.
- Clean only the exact fixture documents; never clear a shared emulator database.
- Resolve identity only from `context.auth.token`.

## Validation

- Safe skip: `node --test functions/test/friend-invite-redemption.test.cjs`
- Emulator: `npx firebase emulators:exec --only firestore --project demo-allplays "node --test functions/test/friend-invite-redemption.test.cjs"`

Production code is not expected to change. The defect mechanism is missing real Firestore integration coverage rather than a known callable defect.
