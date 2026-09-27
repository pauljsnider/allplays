# Problem Statement

Native Firestore REST fallback drops `nextPageToken`, so conversations stop at 50 messages even when the UI offers older history.

# User Segments Impacted

Coaches, parents, admins, scorekeepers, and fans need the same reliable pagination mechanics within conversations they are authorized to read. Browser users must retain current Firestore SDK behavior.

# Acceptance Criteria

1. A native first page with a token keeps older loading actionable.
2. Each older request reuses the same collection, `createdAt desc`, page size 50, and prior token.
3. Default and nested conversation paths remain distinct and correctly encoded.
4. Each page replaces the cursor; a missing token ends pagination even for exactly 50 records.
5. Pages merge chronologically and deduplicate by message ID.
6. Native failures remain retryable errors and preserve loaded history.
7. Browser `DocumentSnapshot` subscription and pagination behavior is unchanged.

# Non-Goals

No realtime transport, schema, retention, page-size, unread-count, or virtualization changes.

# Edge Cases

Exact-50 terminal pages, short pages with a token, overlapping IDs, descending REST payloads, encoded tokens, conversation changes, authorization changes, and repeated clicks during an in-flight request.

# Open Questions

None blocking. Non-string tokens should fail explicitly; absent or blank tokens should be terminal.
