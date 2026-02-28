# Requirements role synthesis

## Objective
Make delegated coaches (`user.coachOf`) experience consistent full team-management access across team navigation and linked edit pages.

## Current vs proposed
- Current: `team.html` + banner treat `coachOf` as full-access, but `edit-team.html` and `edit-roster.html` deny and redirect.
- Proposed: same authorization source for all team management entry points so coach-assigned users can view/edit team and roster.

## User impact
- Primary user: delegated coaches managing roster and team settings.
- Failure mode today: broken workflow after clicking visible CTA.

## Acceptance criteria
- Delegated coach with matching team id in `coachOf` can access `edit-team.html` and `edit-roster.html`.
- Existing allowed actors remain allowed: owner, team admin email, platform admin.
- Unauthorized users remain blocked.
- Regression tests cover coach access on both pages.

## Risks
- Over-broad access if check is implemented inconsistently across pages.
- URL param/hash parsing mismatch already exists but out of scope for this fix.
