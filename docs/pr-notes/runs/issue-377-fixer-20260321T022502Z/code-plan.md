# Issue 377 Code Plan

## Thinking Level
Medium. The logic is localized, but the save flow has multiple side effects and the tests need to prove the right behavior without adding a new harness.

## Plan
1. Add a failing unit test for a new finish orchestration helper covering persistence payloads and redirect branching.
2. Implement the helper module and wire `live-tracker.js` through it.
3. Keep the patch targeted to finish/save flow logic and existing email wiring.
4. Run targeted `vitest` coverage for the changed area.

## What Would Change My Mind
- If the repo already had a stable live-tracker Playwright harness hidden elsewhere, use that instead of helper extraction.
- If wiring the helper requires broad cross-file changes, stop and reassess scope.
