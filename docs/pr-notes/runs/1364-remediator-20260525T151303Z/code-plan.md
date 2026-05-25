# Code Plan

- Inspect `apps/app/src/lib/parentToolsService.ts` pay eligibility helpers.
- Ensure `isParentTeamFeePayActionAllowed` does not exclude `adjusted`; only paid and canceled/cancelled are terminal blockers, plus non-positive balance.
- Add or preserve regression assertions in `tests/unit/app-parent-tools-service.test.js` for adjusted payable and adjusted zero-balance behavior.
