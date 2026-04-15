# Objective
Prevent athlete profile builder preview uploads from retaining blob-backed headshot and clip URLs after the user replaces media, removes media, resets to the linked season photo, or reloads saved profile state.

# Acceptance Criteria
- Replacing a pending uploaded headshot revokes the prior blob preview URL before creating the next one.
- Resetting the headshot to the linked season photo revokes any pending blob preview URL.
- Removing a pending uploaded clip revokes that clip's blob preview URL.
- Rehydrating builder state from saved profile data clears any prior blob preview URLs before rendering persisted remote URLs.
- Remote hosted URLs and linked season photos continue rendering normally and are never revoked.

# User/Coach/Parent Impact
- Parents can edit athlete profiles for long sessions without browser memory growth from abandoned 100 MB media previews.
- Saved profile behavior stays unchanged, including linked season photos, uploaded media, clip ordering, and sharing controls.
- Failure risk is low because the change is limited to client-side preview lifecycle cleanup.

# Open Questions
- None for this patch. The review feedback is specific and the fix scope is isolated to browser preview cleanup in the builder.