# QA strategy — Issue #5199

## Nearest harness

`functions/test/parent-invite-auto-link-callable.test.cjs` runs the real handler with an in-memory Firestore transaction double and currently locks in the defect. `functions/test/parent-invite-redemption-callable.test.cjs` is the parity reference. Existing rules tests remain the downstream read-boundary guard but cannot prevent an Admin-SDK producer from writing restricted data.

## Prevention-oriented regression

Update the successful auto-link test to assert transaction writes to the user, sanitized public profile, player private profile, and access code, with no write to the public player. Assert the public player has no `parents` field, the private record matches manual redemption, unrelated private fields survive merge, and the projection sees the updated parent relationship.

Extend the transaction double with merge-capable `set` operations against missing documents. Add a case where the private profile already contains the parent and verify no duplicate is introduced. Retain authorization, no-existing-user, invite-state, and repeated-completion coverage.

## Smallest validation

```bash
node --test functions/test/parent-invite-auto-link-callable.test.cjs
```

Run the focused redemption test as a parity confirmation if the shared contract is mirrored.

## Recurrence risk

**Medium.** A producer-level storage-boundary assertion plus the existing restricted-field rules test is required because either layer alone is insufficient.
