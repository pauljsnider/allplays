Objective: cover the `track-statsheet.html` apply/save workflow end to end enough to catch silent save regressions before coaches see them.

Current state:
- Automated coverage reaches routing into the statsheet page, not the guarded save path.
- The user-visible failure mode is silent persistence drift: success UI can appear while saved stats or report output are wrong.

Proposed state:
- Add automated browser coverage for the real statsheet page flow with mocked Firebase modules.
- Prove three outcomes: unmatched included home rows block save, overwrite cancel preserves prior data, overwrite confirm rewrites data that the game report renders.

Risk surface and blast radius:
- `games/{gameId}/aggregatedStats/*`
- `games/{gameId}/events/*` deletes on overwrite
- `games/{gameId}` fields `homeScore`, `awayScore`, `opponentStats`, `status`, `statSheetPhotoUrl`
- Post-game report rendering for coaches and parents

Assumptions:
- Mocked browser-module coverage is acceptable Playwright coverage for this repo’s static-page architecture.
- Minimal production changes that improve testability are in scope for a coverage-gap issue.
- We do not need live Firebase or AI calls to validate this workflow.

Recommendation:
- Extract the apply/save logic behind a small helper seam and keep page behavior unchanged.
- Drive assertions from browser interactions plus mocked persistence state so failures stay user-meaningful and reviewable.

Success measures:
- New automated spec fails without the new seam/coverage work and passes after the patch.
- Spec covers guard, cancel, confirm, persisted score/opponent/home stat data, and game report rendering.
