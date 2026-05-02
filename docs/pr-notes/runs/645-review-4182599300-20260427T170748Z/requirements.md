# Requirements Role

## Problem Statement
Existing-user admin invites from `edit-team.html` must visibly complete the fallback path. The CI smoke failure showed `#admin-invite-status` remained hidden/empty after clicking **Send Invite**, so the team owner had no confirmation or copyable code.

## Acceptance Criteria
1. Existing-user admin invite shows a visible status containing “already has an account”.
2. The fallback invite code panel is visible and displays the generated code exactly.
3. The normalized email is added to the admin list and persisted.
4. Blank, invalid, and duplicate emails remain blocked with visible errors.
5. Admin invite redemption continues to validate/redeem and redirect to dashboard.
6. Parent invite and roster rollover behavior remain unchanged.
