# Architecture

- Keep roster field definition persistence in the existing `teams/{teamId}/rosterFields/{fieldId}` subcollection.
- Use Firestore batch `set(..., { merge: true })` for reorder writes so missing documents are upserted instead of causing the whole batch to fail.
- Include `key: fieldId` on reorder-created docs so legacy fields get a stable document identity when backfilled by reordering.
