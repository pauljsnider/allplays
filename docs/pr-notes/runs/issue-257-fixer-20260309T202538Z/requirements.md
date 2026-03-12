Objective: add team chat photo/video albums with multi-media attachments for issue #257.

Current state:
- Team chat only accepts one image file.
- Messages persist one legacy media slot (`imageUrl` and related fields).
- There is no thread-level media browser.

Proposed state:
- Team chat accepts multiple image/video attachments per message.
- Messages persist a normalized `attachments` array while keeping the legacy image fields populated from the first image for backward compatibility.
- Team chat exposes a "Photos & Videos" browser that aggregates media across the thread without requiring users to scroll old messages.

Risk surface and blast radius:
- `team-chat.html` composer, rendering, and new gallery modal.
- `js/db.js` upload and message persistence schema.
- Help/workflow copy describing attachment capability.
- Existing single-image messages must continue rendering unchanged.

Assumptions:
- Short videos can use the same 5 MB per-file limit as images for this first increment.
- Firebase Storage paths used for chat images can also hold video assets.
- A modal gallery on `team-chat.html` is sufficient for the issue; no separate standalone page is required.

Recommendation:
- Ship one backward-compatible attachment model now.
- Defer thumbnails, favorites, and external share tracking until there is evidence they are needed.

Success criteria:
- Users can attach multiple images/videos in one send.
- Existing and new media render correctly in chat.
- Team members can open a thread-level media browser and view prior shared media.
