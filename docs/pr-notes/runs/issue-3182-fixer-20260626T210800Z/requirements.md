# Requirements

## Acceptance Criteria
- Staff can launch tournament block creation from Schedule staff tools.
- Cancel or dismiss returns to Schedule without creating data.
- Reopen starts with a clean draft.
- Non-staff users do not see the entry point.

## User Flow Expectations
- Open Manage schedule.
- Select New tournament block.
- See a distinct tournament creation shell for the selected team.
- Cancel or dismiss returns to the prior Schedule state.

## Edge Cases
- Entered draft values are discarded on cancel.
- Close control and cancel behave the same.
- Team context stays aligned to the currently selected manageable team.

## Recommendation
Keep this slice UI-only. Use local state only, preserve existing staff gating, and avoid any write path until submit.
