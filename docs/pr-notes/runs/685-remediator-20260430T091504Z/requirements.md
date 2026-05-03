# Requirements notes

Thread: PRRT_kwDOQe-T585-rW3q

Acceptance criteria:
- Public users can read sponsor docs when any supported publish marker is explicitly set: `status == "published"`, `published == true`, or `isPublished == true`.
- Public users are denied sponsor docs when all publish markers are absent, false, draft, archived, or otherwise not explicitly published.
- Legacy sponsor docs with no `status` field but `published == true` or `isPublished == true` must not fail due to missing optional fields.
- Team owner/admin and parent sponsor read behavior remains unchanged.
- Scope is Firestore rules only unless investigation proves client code is required.

Non-goals:
- No data migration.
- No sponsor admin workflow changes.
- No broadening beyond intended published sponsor reads and existing role reads.
