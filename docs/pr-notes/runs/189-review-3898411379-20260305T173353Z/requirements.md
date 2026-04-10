# Requirements Role (Fallback Manual Synthesis)

- Objective: Ensure live chat unread badge increments correctly when multiple messages share the same millisecond `createdAt` value.
- Current state: Unread delta uses timestamp-only cursor (`ts > lastChatSnapshotAt`), which drops same-ms arrivals.
- Proposed state: Cursor tracks timestamp plus message IDs at that timestamp.
- Risk surface: Chat badge logic only in live tracker UI; no Firestore schema/rules changes.
- Blast radius: Limited to live tracker unread count rendering and chat toggle reset behavior.

## Acceptance Criteria
1. New message with `createdAt` newer than cursor increments unread.
2. New message with `createdAt` equal to cursor increments unread if message ID was not previously seen at cursor timestamp.
3. Existing messages replayed in subsequent snapshots do not re-increment unread.
4. Expanding chat resets unread and clears cursor tie-break metadata.
