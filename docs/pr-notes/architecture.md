# Architecture Role Notes (Issue #28)

## Objective
Implement issue #28 with minimal schema churn and rule-safe read patterns.

## Current Architecture
- Drill library data in top-level `drillLibrary` collection.
- Community listing: `getDrills()` constrained to `source == 'community'`.
- Team custom listing: `getTeamDrills(teamId)`.
- Practice timeline blocks: primarily `drill` and `structure`.

## Proposed Architecture
1. Query composition:
- Keep existing `getDrills()` for seeded community documents.
- Add `getPublishedDrills()` to fetch `publishedToCommunity == true` custom drills.
- Merge and de-duplicate both sets in the UI Community tab.

2. Cross-team My Drills:
- Resolve accessible teams via `getUserTeamsWithAccess(userId, email)`.
- Fetch `getTeamDrills(team.id)` for each team and merge/dedupe by drill ID.

3. Upload resilience:
- In `uploadDrillDiagram`, use `ensureImageAuth()` (non-hard-fail) and fallback to main storage on auth/authorization errors.

4. Timeline block model extension:
- Add `blockType: 'note'` as a first-class free-text timeline block.
- Render/edit/save similarly to drill blocks, but with no linked `drillId`.
- Prevent note blocks from being nested into structure children.

5. Practice mode drill access:
- Add an explicit `openCurrentPracticeDrill()` action that opens detail when current playback block has `drillId`.

## Controls / Tradeoffs
- Tradeoff: Community pagination currently still uses `getDrills` cursor; published custom drills are merged in initial load without dedicated cursor paging.
- Benefit: avoids introducing complex multi-cursor state and preserves existing behavior for seeded community drills.
- Control: query paths remain rule-safe and limited to signed-in allowed documents.
