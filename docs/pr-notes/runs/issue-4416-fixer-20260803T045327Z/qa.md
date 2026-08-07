# QA Analysis

Evidence baseline: `5a5e93495c208fcd5d8a234f824cb6b0e8bb14ad`.

## Focused matrix

| Scenario | Required evidence |
| --- | --- |
| Verified email | Callable success, accepted friendship, consumed invite, matching authenticated recipient |
| Verified phone | Same state using canonical Auth phone claim and formatted stored phone |
| Replay | Exact generic public error with no details |
| Replay immutability | Complete normalized data and update times unchanged for both documents |

## Fixture and assertion controls

- Use separate eight-character invite codes, UIDs, friendship IDs, and named Admin apps.
- Seed through Admin SDK and trust identity only from callable Auth context.
- Register cleanup for exact fixture documents and apps.
- Gate emulator cases on `FIRESTORE_EMULATOR_HOST` so ordinary Functions tests cannot contact a real project.
- Compare complete documents, not selected fields, because replay could otherwise refresh timestamps or overwrite stable participant data unnoticed.

## Validation

Focused command:

`npx firebase emulators:exec --only firestore --project demo-allplays "node --test functions/test/friend-invite-redemption.test.cjs"`

Also run the same Node test without an emulator to prove safe skipping.

## Recurrence risk

Medium until CI explicitly runs the emulator-gated cases. After CI wiring, low because the real Firestore transaction and replay state are checked deterministically.
