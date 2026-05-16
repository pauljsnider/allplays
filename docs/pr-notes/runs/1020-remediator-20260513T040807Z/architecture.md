# Architecture notes

## Current design
Payment settings are represented as bounded booleans: `offlinePaymentEnabled` and `onlineCheckoutEnabled`.

## Data flow
Admin configuration is saved on registration forms, normalized for legacy/malformed values, and snapshotted into public registration records with fee/program context.

## Control posture
No payment transaction, provider token, PHI, or financial instrument data is introduced. Firestore rules constrain public writes to the expected payment settings shape using allowlists and boolean checks.

## Risk and rollback
Blast radius is limited to copy/configuration and registration snapshots. If needed, rollback is a branch revert with no data migration because missing settings normalize to disabled.
