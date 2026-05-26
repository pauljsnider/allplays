# Requirements

Acceptance Criteria
- RSVP reminder UI and service authorize only backend-compatible managers: global admin, team owner, or team admin email.
- Coach-only staff can still see staff schedule context, but cannot trigger RSVP reminder preview/send.
- Explicit email sentCount: 0 remains zero in returned results and persisted metadata.
- Recurring virtual occurrence IDs write reminder metadata to the persisted master event doc and store occurrence-specific metadata.

Edge Cases
- Missing/blank user email must not match admin emails.
- Virtual IDs use the `masterId__occurrence` pattern; occurrence keys must be Firestore path-safe.
