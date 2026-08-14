# Current-State Read

The native adapter narrows Firestore REST list responses to document arrays and discards page-level continuation metadata. The shared cursor contract assumes web document snapshots, so native polling emits no usable cursor and older loading retries the web SDK before silently returning an empty page.

# Proposed Design

Add a discriminated native cursor containing collection path, fixed order, page size, and nullable `nextPageToken`. Parse chat REST pages separately from general list reads. Validate cursor scope before using its token. Return `{ messages, cursor }` from older loads and track the active pagination cursor independently in the hook. Keep web snapshots opaque and on the existing SDK path.

# Files And Modules Touched

- `apps/app/src/lib/firestore/types.ts`
- `apps/app/src/lib/chatService.ts`
- `apps/app/src/pages/messages/hooks/useChatMessages.ts`
- Adjacent service and hook tests

# Data/State Impacts

Cursor state remains in memory and conversation-scoped. No stored schema, index, retention, or unread-count changes.

# Security/Permissions Impacts

Existing Auth, App Check, and Firestore rules remain authoritative. Cursor collection/order/page-size context is validated against the active team and conversation before requesting a page.

# Failure Modes And Mitigations

Absent tokens terminate; malformed token types reject; REST errors propagate; stale or cross-conversation cursors fail before network use; overlapping records deduplicate by ID; browser cursors remain unchanged.
