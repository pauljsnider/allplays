# Architecture role notes

## Decision
Add a narrow supplemental Firestore team lookup in `loadAppSearchTeams` for signed-in users instead of broad `getTeams({ includePrivate: true })`.

## Rationale
- Keeps blast radius small: only targeted queries for the signed-in user's uid and email.
- Preserves existing public/owner/admin-email `getTeams()` behavior and parent-home merge.
- Avoids relying on broad private team reads, which may fail under Firestore rules and would expand data exposure.

## Risks and rollback
- Requires Firestore indexes/rules to support targeted array membership queries on teams. If unsupported locally, the search still falls back to existing sources unless all sources fail.
- Rollback is one commit revert, returning to existing behavior.
