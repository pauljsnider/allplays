# QA notes

Thread: PRRT_kwDOQe-T585-rW3q

Validation plan:
- Check rules syntax if Firebase tooling is available.
- Validate public reads conceptually for three shapes: `{status: "published"}`, `{published: true}`, `{isPublished: true}`.
- Validate negative public reads for `{status: "draft"}` and docs with no publish fields.
- Confirm owner/admin/parent read condition remains unchanged.

Manual test recommendation:
- Seed legacy sponsor docs and load team page signed out. Confirm no `permission-denied` from sponsor queries and only published sponsors render.
