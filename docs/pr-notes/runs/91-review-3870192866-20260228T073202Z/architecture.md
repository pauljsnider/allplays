# Architecture Role Summary

## Decision
Do not add `initialSnapshotLoaded` to `shouldUpdateChatLastRead`.

## Rationale
- The implementation contract is intentionally minimal: update iff `hasCurrentUser && hasTeamId`.
- Introducing snapshot phase state into this utility would increase coupling to listener lifecycle state that is already represented by call timing.

## Blast Radius
- Limited to `team-chat-last-read` helper tests and inline documentation.
- No runtime behavioral change in chat listener execution path.

## Conflict Resolution
- Reviewer suggested two options; selected option is removing `initialSnapshotLoaded` from tests because it preserves current behavior and avoids unnecessary API surface growth.
