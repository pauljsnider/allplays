# Issue #440 Code Plan

## Thinking Level
Medium. The behavior is localized, but correctness depends on preserving ordering and failure handling across multiple side effects.

## Plan
1. Add a focused workflow helper for the `saveAndComplete()` execution path.
2. Add fail-first tests that execute the helper with mocked Firestore/UI dependencies.
3. Update `js/live-tracker.js` to delegate to the helper without changing user-visible behavior.
4. Run targeted Vitest coverage for live tracker finish modules.
5. Commit with issue reference once tests pass.

## Constraints
- Keep the patch targeted.
- Avoid unrelated refactors in `js/live-tracker.js`.
- Preserve existing cache-busting import style.
