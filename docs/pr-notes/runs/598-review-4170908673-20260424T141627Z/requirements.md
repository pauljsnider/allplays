# Requirements

## Objective
Restore preview-smoke stability for PR #598 without changing the tournament advancement behavior.

## User / Business Need
Coaches and admins must be able to open schedule and tournament pages in preview builds. A hard module import failure blocks page boot and hides schedule content, which prevents validating the bracket advancement feature.

## Acceptance Criteria
1. `js/db.js` no longer imports a non-existent module.
2. Tournament advancement changes in `edit-schedule.html`, `js/tournament-brackets.js`, and `applyTournamentAdvancementPatches` remain intact.
3. The schedule page can load `js/db.js` without a missing-module failure.
4. Existing unit tests still pass.

## Non-goals
- Shipping the unfinished organization-shared-schedule feature.
- Refactoring schedule rendering behavior.
- Expanding tournament advancement scope.

## Assumptions
- The `organization-shared-schedule` helpers were accidentally included on this branch.
- No shipped page on this branch depends on `getOrganization`, `getOrganizationTeams`, or `createOrganizationSharedGame`.

## Requirement Risks
- If another hidden page already depends on the removed helpers, that work needs its own complete module and tests before merge.
