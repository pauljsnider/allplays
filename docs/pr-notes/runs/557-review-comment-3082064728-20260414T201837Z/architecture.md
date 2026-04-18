## Current State

- `track.html` finish-game work now consists of three write groups:
  - event docs under `games/{gameId}/events`,
  - one `aggregatedStats/{playerId}` doc for every rostered player,
  - one final update to `games/{gameId}`.
- The branch already takes the right first step for the review comment: it removes roster-wide `aggregatedStats` from the primary batch and chunks them into secondary batches capped at 450 writes.
- Those secondary stats batches commit before the primary batch. That matters because `aggregatedStats/{playerId}` writes are deterministic upserts, while event docs still use auto-generated IDs and are not naturally idempotent across retries.
- One remaining gap is recovery behavior: `startTimer()` checks existing `events` before offering a clear-and-restart path, but it does not treat `aggregatedStats`-only residue as persisted activity.

## Proposed State

- Keep the current split-batch pattern. It is the safest minimal remediation for the 500-write limit.
- Keep `aggregatedStats` in separate chunked batches, with deterministic doc IDs by `playerId`.
- Keep the primary batch focused on the historical authoritative writes: `events + final game update`.
- Add two small guardrails in `track.html`:
  1. **Preflight batch-size guard**: if `gameState.gameLog.length + 1 > 500`, block finish and show an explicit error instead of attempting the commit.
  2. **Restart detection guard**: when starting fresh, check both `events` and `aggregatedStats`; if either exists, prompt and clear both.
- Do **not** add new Firestore schema, new game statuses, or backend finalize jobs for this fix.

## Architecture Decisions

- **Use derived-doc fanout as the separate step**: `aggregatedStats` is derived data and safe to overwrite by stable `playerId`; that makes it the right payload to chunk.
- **Avoid retrying non-idempotent event creation**: because event docs still use auto IDs, keeping them in one atomic primary batch minimizes duplicate-history risk.
- **Prefer contained client-side hardening over lifecycle redesign**: adding a `finishing` or `completed_pending_stats` state would force reader changes across `game.html`, team views, and reporting flows.
- **Blast radius stays small**: this should stay confined to `track.html` plus the batch-limit regression coverage.

## Risks

- Multi-batch writes are still not all-or-nothing. If stats batches succeed and the primary batch fails, Firestore can temporarily contain `aggregatedStats` without the final event/game commit.
- That partial state is acceptable for a minimal fix because the stats docs are overwrite-safe, but it can confuse resume/start behavior unless the restart detection also checks `aggregatedStats`.
- Chunking roster stats does **not** protect against a too-large primary batch if the event log alone exceeds 500 writes. The preflight guard is required.
- There is a small chance of stale derived stats being visible after a failed finish attempt, but that is a smaller blast radius than duplicated event history.

## Rollback

- Revert the finish-flow chunking and preflight/restart guards in `track.html`.
- Revert the matching batch-limit test coverage.
- No data migration or Firestore cleanup is required, because document paths, schemas, and permissions remain unchanged.
