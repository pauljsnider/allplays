# Code Plan

## Root Cause
`js/db.js` imported `./organization-shared-schedule.js?v=1`, but that module does not exist on this branch. Browser module resolution fails before page initialization.

## Minimal Patch
1. Remove the missing `organization-shared-schedule` import from `js/db.js`.
2. Remove the unused helper exports that depended on that import:
   - `getOrganization`
   - `getOrganizationTeams`
   - `createOrganizationSharedGame`
3. Leave `applyTournamentAdvancementPatches` and the tournament UI changes untouched.

## Impacted Files
- `js/db.js`
- `docs/pr-notes/runs/598-review-4170908673-20260424T141627Z/*.md`

## Validation
- Confirm no remaining references to `organization-shared-schedule`.
- Run the unit test suite.
- Review the final diff to ensure only the stray helper block was removed from production code.

## Conflict Resolution
Requirements, architecture, QA, and code lenses aligned on the same recommendation: remove the incomplete unrelated code instead of expanding scope with a new module.
