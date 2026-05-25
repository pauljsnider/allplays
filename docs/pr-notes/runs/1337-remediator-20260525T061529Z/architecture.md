# Architecture

Architecture Decisions
- Add `isTeamRsvpReminderManager` as a separate capability from `isTeamStaff` to preserve coach schedule visibility while matching the backend email authorization contract.
- Keep email-count fallback logic in a pure helper using nullish presence instead of truthiness.
- Route metadata writes through `getStaffRsvpReminderMetadataTarget()` so virtual recurring IDs update the real persisted game document.

Risks And Rollback
- Risk: changing staff gating could hide reminder controls for coaches who expected access. This is intentional until backend accepts coaches.
- Rollback: revert the dedicated manager flag and metadata target helper changes if backend authorization changes.
