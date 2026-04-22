# Architecture

## Current State
- Stats config management is thin. Teams can only create configs manually or seed two hardcoded quick templates.
- Firestore config persistence only supports create/list/delete. There is no first-class update, import, or reset workflow.
- New-team bootstrap duplicates template logic in `edit-team.html`, which increases drift risk.

## Proposed State
- Add a shared stat schema preset catalog in one module so edit-team bootstrap and edit-config reuse the same source of truth.
- Extend config persistence with update and guarded reset helpers while keeping the existing `statTrackerConfigs` collection unchanged.
- Add edit-config flows for preset apply, import-from-owned-team, load-into-form editing, and guarded reset.

## Data/API Changes
- Keep existing config document shape, still normalized through `normalizeStatTrackerConfig`.
- Add `updateConfig(teamId, configId, configData)`.
- Add `resetTeamStatConfigs(teamId)` with the same assignment guard used for delete, expanded across all configs.
- Add client-side preset helpers for reusable schema definitions and textarea serialization.

## Risks And Rollback
- Main risk is deleting configs that are still referenced by scheduled or shared games. Guard reset with assignment checks before deleting anything.
- Main UX risk is accidental destructive reset. Use explicit confirmation and clear copy.
- Rollback is simple because this is additive UI/API work on top of the current data model.

## Recommended Minimal Implementation Plan
1. Create a shared `js/stat-config-presets.js` module.
2. Reuse it in `edit-team.html` for new-team default config seeding.
3. Extend `js/db.js` with update and reset helpers.
4. Expand `edit-config.html` with preset/import/edit/reset controls wired to the new helpers.
5. Cover new behavior with focused unit tests and targeted smoke/manual validation.
