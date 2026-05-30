# Requirements

Acceptance Criteria
- Lineup publish panel is visible only to team staff/admin for database-backed games.
- Non-staff scorekeepers with `canUpdateScore` keep live score controls but do not see staff-only lineup publish controls.
- Staff with a lineup draft can publish as before; staff without a draft sees the disabled publish action and draft guidance.

Edge Cases
- Read-only viewers see neither score controls nor lineup publish controls.
- Cancelled game publish remains disabled inside the staff-only panel if rendered for staff.
