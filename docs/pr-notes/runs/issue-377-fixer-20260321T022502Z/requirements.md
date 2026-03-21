# Issue 377 Requirements

## Objective
Add coverage for the live tracker finish flow so regressions in final save, score reconciliation, and recap redirect/email behavior are caught before release.

## Current State
- `live-tracker.html` finish behavior is only covered by helper-level unit tests and source-string wiring checks.
- No runnable automated test on this branch proves that finish/save persists reconciled scores, writes player/opponent stats, and follows the expected redirect path.

## Proposed State
- Extract the finish orchestration into a small helper module that can be tested with realistic inputs.
- Add focused unit coverage that validates:
  - final score reconciliation from the score log
  - persisted event, aggregated stat, and game update payloads
  - redirect behavior with and without the recap email toggle

## Risk Surface
- High-blast-radius game completion flow touching final score, game status, stats persistence, and user navigation.
- Low implementation blast radius if the change is limited to finish-flow orchestration and existing page wiring.

## Assumptions
- `vitest` unit coverage is the supported automated test surface on this branch.
- Introducing a new browser harness for a single issue is out of scope for a targeted fix.

## Recommendation
Use a testable orchestration helper and keep page behavior unchanged except where needed to align the UI with the reconciled saved score.
