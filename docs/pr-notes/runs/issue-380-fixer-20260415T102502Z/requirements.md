# Acceptance Criteria

- Parent can upload native athlete-profile media without leaving ALL PLAYS.
- Builder supports both uploaded media and legacy external links so existing profiles continue to work.
- Parent can curate clips by adding, removing, and reordering them before save.
- Parent can optionally upload a dedicated athlete headshot that overrides the linked season photo on the public profile.
- Public athlete profile renders uploaded image/video clips inline and keeps legacy links clickable.
- Edit flows preserve existing uploaded media unless the parent explicitly removes or replaces it.
- Save flow keeps blast radius low by remaining inside the existing `athleteProfiles` document and image-storage patterns.

# User Workflow

1. Parent opens Athlete Profile Builder.
2. Parent optionally uploads a profile headshot.
3. Parent adds uploaded clips and/or legacy external links.
4. Parent reorders or removes clips in the builder.
5. Parent saves and receives a shareable athlete profile page.
6. Public profile renders uploaded media inline in curated order.

# Out of Scope

- Clip trimming or transcoding.
- Selecting from an existing internal clip library.
- Background cleanup jobs for orphaned storage objects.
- Rich media moderation workflows.
- A new subcollection or backend ingestion pipeline.

# Edge Cases

- Legacy profiles with URL-only clips must still load and save.
- Mixed uploaded and external clips must preserve order.
- Unsupported or empty uploads must be rejected before save.
- Removing a custom headshot must fall back to the linked season photo.
- Save failures after upload should best-effort clean up newly uploaded objects.

# Risks

- Storage cleanup is best-effort from the client, so interrupted saves can leave orphans.
- Public media URLs are intentionally shareable when a profile is public.
- Backward compatibility can break if clip normalization drops legacy fields.