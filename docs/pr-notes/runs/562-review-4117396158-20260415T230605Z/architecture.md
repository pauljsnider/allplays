# Current State
`athlete-profile-builder.html` creates blob preview URLs with `URL.createObjectURL(...)` for pending uploaded headshots and clips. Those previews live in in-memory builder state and DOM dataset attributes until the tab closes. Remove, replace, reset, and hydrate flows did not revoke prior blob URLs.

# Proposed Change
Add a tiny client-side cleanup layer in the builder:
- `revokeObjectUrl(url)` guards `URL.revokeObjectURL` to blob URLs only.
- `releaseProfilePhotoPreview()` revokes the current pending headshot preview before replace, reset, or hydrate.
- Clip removal revokes the row preview URL before DOM removal.
- `clearClipList()` revokes all clip preview URLs before state rehydration.

# Risks/Blast Radius
- Blast radius is isolated to athlete profile builder preview handling.
- Persisted hosted media and linked season photos are not affected because revocation is limited to `blob:` URLs.
- Main failure mode would be revoking too broadly and blanking a preview, mitigated by the blob-only guard and keeping persisted remote URLs untouched.

# Rollback
Revert the builder cleanup helpers and event-hook calls in `athlete-profile-builder.html`. No schema, Firebase, or data migration rollback is required.