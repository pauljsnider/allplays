# Risk Matrix

- High: token loss still caps history. Cover initial propagation and multiple pages.
- High: cursor scope crosses conversations. Cover default/nested paths and mismatch rejection.
- High: overlap causes duplicate/missing records. Cover ID deduplication and chronological ordering.
- Medium: exact-50 terminal page remains actionable. Cover token-authoritative completion.
- Medium: native failure looks like empty history. Cover explicit rejection.
- Medium: browser pagination regresses. Cover unchanged snapshot arguments.

# Automated Tests To Add/Update

Extend `chatService.test.ts` for first-page cursors, query parameters, cursor replacement, terminal pages, both paths, invalid tokens, REST errors, and web behavior. Extend `useChatMessages.test.tsx` for a 50-message native page, two older loads, overlap deduplication, chronological merge, replacement cursor use, terminal state, and failures.

# Manual Test Plan

With at least 75 messages and forced native fallback, load older history in default and nested conversations, verify stable scroll anchoring, no duplicate IDs, correct request parameters, terminal control removal, and retryable offline failure.

# Negative Tests

Exact-50 no-token page, short token-bearing page, malformed token, mismatched cursor context, overlapping IDs, repeated clicks, conversation changes, and web snapshot input.

# Release Gates

Run the two focused app tests and app TypeScript typecheck. Existing virtualization coverage is sufficient because scroll-anchor code is unchanged. GitHub CI remains the full gate.

# Post-Deploy Checks

Validate one Capacitor conversation with at least 75 messages and confirm no increase in native chat REST authorization or rate-limit failures.
