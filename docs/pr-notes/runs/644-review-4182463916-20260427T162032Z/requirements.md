# Requirements Review

## Acceptance Criteria
- Rollover source selection shows eligible staff/admins with the carry-over toggle enabled by default.
- Manual deselection of one or more staff/admin checkboxes persists after adding or removing a manual admin.
- Disabling `Carry over staff/admin access` persists after adding or removing a manual admin.
- Manual admins are not duplicated through rollover.
- Save grants access only to manual admins plus rollover staff still checked at save time.
- Source team changes reset the preview to that source team defaults.
- Empty eligible rollover state remains disabled and clearly communicates that existing admins are skipped.

## Non-Goals
- No Firestore rules or schema changes.
- No parent/member rollover.
- No invite delivery redesign.
