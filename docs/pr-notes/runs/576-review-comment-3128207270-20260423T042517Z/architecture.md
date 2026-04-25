# Architecture

## Current State
- Branch head `1e2ef17` already changes create-team navigation to `edit-team.html?teamId=...` so the browser performs a real page load.
- Follow-up commit `f427be6` updates the edit-team unit harness to include the Team ID panel DOM contract introduced by the feature.

## Decision
- Keep the production redirect fix as implemented on branch.
- Add only the minimal regression harness update required for CI stability.

## Blast Radius
- Production behavior change is already isolated to post-create navigation in `edit-team.html`.
- New commit is test-only.

## Rollback
- Revert `f427be6` if the harness update causes unexpected coupling.

## Role Note
- Architecture role spawn timed out at the local gateway before results could be collected.
