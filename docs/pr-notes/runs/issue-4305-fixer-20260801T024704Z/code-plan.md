# Code plan

## Minimal patch

1. In `legacyPlayerDb.ts`, stop importing `inviteCoParentToAthlete` from `js/db.js`; import `functions` and `httpsCallable` from the legacy Firebase module, define the callable result type, normalize email, and return `response.data`.
2. In `playerService.ts`, call the adapter using only `teamId`, `playerId`, and email after retaining the local linked-parent UX assertion.
3. In `PlayerDetail.tsx`, map `created`, `reused`, and normalized `resource-exhausted` errors to accurate result-card state and copy.
4. Add focused adapter and component tests before implementation validation.

## Root cause and prevention

The Player app reused a legacy helper that directly minted authorization-bearing access-code documents and predated the protected callable. Future client workflows that create access or trigger email must call the protected server boundary, and UI copy must derive from authoritative outcome flags rather than promise resolution alone.

## Conflict resolution

One role proposed changing `js/db.js`; architecture review identified that doing so would also alter the legacy parent-dashboard workflow. The adapter-only route satisfies issue #4305 with a smaller blast radius and no legacy cache-bust chain.
