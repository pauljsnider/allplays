# Architecture Decisions

- Use denormalized primitive arrays on game documents for officiating authorization because Firestore rules cannot safely inspect arbitrary arrays of slot maps for membership.
- Keep the official update rule scoped to existing document authorization indexes plus existing `isOfficialGameUpdate()` field-diff restrictions.
- Generate slot IDs at row creation time and preserve them in `data-slot-id`, so downstream response and claim flows operate on stable identifiers.

## Risks And Rollback
- Existing games without authorization indexes may require an admin schedule save before assigned officials can update statuses. This is safer than preserving the cross-team write path.
- Rollback is limited to reverting the Firestore rule helper, schedule authorization arrays, and slot ID helper changes.
