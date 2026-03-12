Current state:
- `team-chat.html` owns attachment validation and only tracks one pending image.
- `js/db.js` uploads one file and stores one image slot.

Proposed state:
- Add `js/team-chat-media.js` as the canonical pure helper for:
  - validating and normalizing image/video attachment metadata
  - shaping outbound attachment records
  - deriving gallery entries from message collections
- Update `js/db.js` to upload arbitrary chat media and persist normalized `attachments`.
- Update `team-chat.html` to render attachment grids and a thread-level media modal sourced from the helper output.

Blast radius controls:
- Preserve legacy `image*` fields from the first image attachment so old rendering and downstream consumers do not break.
- Keep edits/deletes text-only behavior unchanged.
- Use one per-file size policy to avoid backend/rule changes.

Tradeoffs:
- This patch does not generate video thumbnails server-side.
- The gallery is scoped to browsing and opening assets, not favoriting.

Rollback:
- Revert the helper, UI, and `attachments` writes together. Legacy `image*` fields remain available for older messages.
