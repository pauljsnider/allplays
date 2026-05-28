# Requirements

## Problem
PR #1518 has app validation passing, but the deploy-preview workflow is blocked by the Firebase preview-channel pruning step. The failing command uses raw paginated GitHub API JSON parsing and emitted `unexpected end of JSON input` before deploy could complete.

## Acceptance Criteria
1. Deploy-preview completes when app tests and smoke checks pass.
2. Stale Firebase preview pruning does not fail because open-PR discovery returns malformed, partial, or empty data.
3. Open PR channels are still represented as `pr-<number>` when discovery succeeds.
4. The active PR channel is never deleted.
5. If open-PR discovery fails, pruning skips safely with clear log output rather than treating the open-channel set as empty.
6. No app UI, Firebase rules, data model, or runtime behavior changes are introduced.

## Non-Goals
- Redesign the deploy pipeline.
- Change app code or smoke test behavior.
- Change production hosting, Firestore, Auth, or Storage behavior.
