# Architecture role

The requested `allplays-architecture-expert` skill was unavailable, and the required read-only role session failed before execution because the runtime reported `published reply runtime missing for main`. This main-lane synthesis applies the requested senior static-web and Firebase architecture perspective.

## Root cause

`edit-roster.html` derives one permanent idempotency key from team, player, and normalized email. `createParentInvite` stores that key in `inviteIdempotency` and only considers its target replayable while the invite is active or completed. When the target is expired, revoked, missing, or otherwise non-replayable, the keyed record remains and the handler throws `failed-precondition`; no path replaces the stale coordinate with a fresh invite.

## Decision

Keep active and completed replay behavior unchanged, but allow a keyed coordinate whose target is a matching, unaccepted terminal invite to fall through to normal invite creation. The existing transaction then applies authorization and rate limits, creates a new access code, and atomically overwrites both the operation and active-recipient coordinates. Missing, malformed, or request-mismatched outcomes still fail closed. This is smaller and more robust than relying on every client to mint correctly scoped run identifiers.

## Risk controls

- Do not reactivate or mutate the terminal access-code document.
- Preserve completed outcome replay to prevent duplicate post-acceptance operations.
- Preserve active invite reuse and quota-free replay.
- Let renewal consume normal rate-limit capacity.
