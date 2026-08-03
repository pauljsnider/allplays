# Architecture Analysis

## Baseline

- Branch: `paulbot/fix/issue-4417-20260803055328`
- Base and starting HEAD: `4941b01c546e2125f96561b26faed69b8498d565`
- Worktree was clean and dependencies #4415 and #4416 were present.
- No production defect is evident. The missing behavior is emulator evidence for rejection paths.

## Boundaries

1. The callable derives identities only from `context.auth.uid` and verified token claims. Payload identity fields are ignored.
2. The transaction validates code and canonical recipient before Firestore work.
3. Invite type, code, prior use, status, expiry, inviter, self-redemption, and target identity are checked before friendship reads.
4. Existing friendship blocking and participant integrity are checked before mutation.
5. Friendship and invite writes are staged together only after all rejection gates pass.
6. Both layers expose the same metadata-free public error.

## Minimal design

Update only `functions/test/friend-invite-redemption.test.cjs` unless emulator evidence exposes a defect.

- Make emulator snapshots safe for absent documents.
- Snapshot existence, normalized data, and update time. Exclude read time because it changes naturally.
- Add unique callable-level emulator cases for identity mismatch, self-redemption, expiration, prior use, and blocked friendship.
- Supply invite-matching identity metadata through plausible payload fields while verified Auth claims mismatch.
- Deep-compare pre-request and post-rejection state.

## Safety and blast radius

This is test-only. No schema, Rules, client, callable contract, or production write path changes. Unique fixture IDs and exact-reference cleanup constrain emulator blast radius. Admin SDK emulator coverage is appropriate because the trusted callable transaction, not client Rules, is under test.

### Production-safety review

- Authorization and privacy: applicable. Tests exercise verified Auth identity, payload substitution, and metadata-free errors.
- Atomicity and partial failure: applicable. Before/after data and document versions prove rejected transactions commit no writes.
- Stale-state revalidation: applicable for prior-use, expiry, and blocked-friendship fixtures.
- Confirmation, retention/deletion behavior, reload durability, size/rate limits, and interrupted-browser recovery: not applicable because this slice changes no production workflow or client behavior.

## Root cause and prevention

Root cause: fake transaction tests asserted zero committed batches, but the real Firestore emulator lacked rejection-path state and document-version assertions.

Prevention: every server transaction rejection branch should pair generic-error checks with authoritative before/after emulator snapshots for both absent and existing mutation targets.
