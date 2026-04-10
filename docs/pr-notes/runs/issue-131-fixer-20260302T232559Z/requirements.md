# Requirements Role - Issue #131

## Objective
Allow platform admins (`user.isAdmin === true`) to access `edit-config.html` for any team, matching team management banner behavior.

## Current vs Proposed
- Current: `edit-config.html` applies a page-local `hasAccess` check (owner/adminEmails only) and denies platform admins.
- Proposed: `edit-config.html` uses shared full-access policy (`hasFullTeamAccess`) already used by other team management pages.

## User Impact
- Blocker today: platform admins see Stats action but hit deny+redirect dead-end.
- Success: platform admin can open team stats config page when navigating from Team Admin banner.

## Constraints
- Keep patch minimal and targeted.
- Preserve deny behavior for unrelated users.
- Avoid changing broader routing or permissions model.

## Acceptance Criteria
1. `edit-config.html` access logic includes platform admin path.
2. Regression test fails before fix and passes after.
3. Existing team-management access wiring tests continue passing.
