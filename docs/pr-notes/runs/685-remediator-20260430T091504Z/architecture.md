# Architecture notes

Thread: PRRT_kwDOQe-T585-rW3q

Decision:
- Guard optional sponsor publish fields in Firestore rules before comparing values.
- Prefer `data.get('field', default)` for optional fields so missing legacy fields do not error-deny.
- Keep authorization structure unchanged: owner/admin, parent, or published sponsor.

Risk:
- Treating any legacy publish marker as public can expose stale legacy docs if boolean fields were not cleaned up. This preserves the PR's backward-compatible intent and does not add new publish semantics.

Rollback:
- Revert the Firestore rules helper/rule change if emulator or deployment validation fails.
