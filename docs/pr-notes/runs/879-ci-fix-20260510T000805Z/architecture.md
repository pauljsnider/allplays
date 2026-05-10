# Architecture Notes

Acceptance Criteria
- CI unit tests pass for PR #879.
- Parent dashboard RSVP wiring still preserves grouped `data-child-ids` and per-child `data-child-id` datasets.
- Fix remains scoped to test drift or the smallest source correction needed.

Architecture Decisions
- The production path renders grouped RSVP buttons through `renderCalendarAvailabilityControls(event)` and passes `data-child-ids="${escapeAttr((event.childIds || []).join(','))}"` into `renderCalendarRsvpButtonSet`.
- The failing assertion is tied to an implementation-local variable name (`ev`) rather than the behavior being verified.
- Do not rename production locals solely to satisfy a brittle test. Update the assertion to match current source while preserving the same behavioral guard.

Risks And Rollback
- Risk is low: the change is test-only and maintains coverage for the required grouped dataset attribute.
- Rollback is reverting the assertion if production code changes back to the old local variable name.
