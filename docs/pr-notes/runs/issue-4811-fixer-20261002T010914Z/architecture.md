# Architecture analysis — issue #4811

> The requested `allplays-architecture-expert` skill was unavailable in this runtime. OpenClaw role sessions could not start because the main agent lacks a published-reply runtime, so a native read-only architecture subagent performed this analysis.

## Root cause

`match /liveEvents/{eventId}` uses `allow read` with the existing game visibility and Diamond guards. In Firestore rules, `read` covers both `get` and `list`; because the rule never checks `request.query.limit`, authorized active-game collection reads are unbounded.

## Dependency evidence

The branch already contains the prerequisite client behavior: legacy subscriptions use `limit(20)`, React/native active loads pass a 20-event maximum, and completed replay follows a separate full-history path. Both clients classify a replay as completed when either `status` or `liveStatus` is `completed` or `final`.

## Minimal safe rule shape

Inside the existing `liveEvents` match, add one compact lifecycle/limit helper. Split the existing read rule into:

- `allow get` with exactly the existing authorization and Diamond exclusion;
- `allow list` with those same guards plus either completed/final replay eligibility or `request.query.limit` present, positive, and at most 20.

The helper must read the fixed parent game path rather than child result data. Do not reuse the stricter replay-archive validator because it rejects transitional records that current clients classify as completed.

## Budget and risk

The current compacted artifact is 133,524 bytes against the 135,168-byte budget, leaving 1,644 bytes. Keep the change match-local and concise. The focused emulator test must also confirm that existing parent lookups stay within rules evaluation limits.

Recurrence risk after coverage is low for the rule itself; the residual risk is lifecycle predicate drift between clients and rules.
