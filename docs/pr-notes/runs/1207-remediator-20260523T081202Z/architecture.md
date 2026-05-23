# Architecture Notes

## Decision
Add an explicit transaction-local invariant check for duplicate parent `userId` values after building the merged player parent array and before committing the player update.

## Control And Blast Radius
- Scope is limited to account merge player document updates in `functions/index.js` plus the pure merge helper tests.
- Firestore transactions already retry on changed read documents. The added validation documents and enforces the final-state invariant on every retry.
- Failure mode is fail closed with `failed-precondition` rather than committing ambiguous parent data.

## Minimal Strategy
- Add a pure helper in `account-merge-core.cjs` that returns duplicate non-empty parent user IDs.
- Invoke it inside the existing transaction for each affected player after `buildMergedPlayerParents` computes the candidate final array.
- Add unit coverage for deduping stale duplicate destination entries and duplicate detection.
