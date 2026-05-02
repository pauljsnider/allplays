# Requirements

- Firestore rules must not allow any authenticated user to modify game officiating fields across teams.
- Officiating field updates by non-admins must be limited to users authorized for that specific game as an assigned official by UID or normalized email.
- Schedule editing must persist authorization indexes derived from officiating slots so rules can authorize assigned officials without client-side trust.
- Newly added officiating slot rows must receive unique, stable IDs rather than index-derived IDs that can collide after deletion or reordering.

## Acceptance Criteria
- Team owner/admin retains full game update permission.
- Non-admin officiating updates require `officiatingAuthorizedUserIds` or `officiatingAuthorizedEmails` on the existing game document to contain the current user.
- Saving a schedule writes normalized officiating authorization arrays from the configured slots.
- New slot rows generate non-duplicating IDs in the form `slot-...`.
