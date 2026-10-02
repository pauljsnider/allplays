# Requirements analysis — issue #4811

> The requested `allplays-requirements-expert` skill was unavailable in this runtime. OpenClaw `sessions_spawn` was attempted twice but failed before execution because the main agent has no published-reply runtime; a native read-only requirements subagent performed this analysis instead.

## Missing behavior

`firestore.rules` currently grants one `allow read` on `liveEvents`, so authorized document gets and collection lists share the same rule and collection queries never inspect `request.query.limit`. Client-side limits cannot enforce the Firestore resource boundary against stale, alternate, or malicious clients.

## Observable contract

- Authorized active-game list with no limit: denied.
- Authorized active-game list with a limit from 1 through 20: allowed.
- Authorized active-game list above 20: denied.
- Authorized single-document get: unchanged and allowed without a query limit.
- Authorized completed/final replay list: allowed without the active-game cap.
- Existing private-game authorization and Diamond isolation: unchanged.

The limit changes query shape, not visibility. Existing owners, admins, parents, officials, assigned helpers, and public/shareable viewers retain their current authorization paths. Completed replay means either `status` or `liveStatus` is `completed` or `final`, matching current consumers. Cancelled, deleted, scheduled, and malformed lifecycle values do not receive the replay exemption.

## Product boundaries

Active feeds must stay bounded during play, while postgame replay must retain the complete play-by-play used for review and derived totals. This slice must not change client query construction, ordering, loaders, retention, chat/reaction reads, or data schemas.

## Regression expectations

Add source-contract assertions for separate `get`/`list` rules, positive limits, the 20-event maximum, and the completed/final exception. Add emulator coverage for unbounded and excessive active queries, accepted bounded queries across public and parent-authorized personas, unchanged point reads, completed replay, unauthorized access, and Diamond isolation.
