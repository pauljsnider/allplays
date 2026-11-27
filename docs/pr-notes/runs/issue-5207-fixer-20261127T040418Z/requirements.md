# Requirements analysis

## Root cause

The legacy parent dashboard labels the input generically as an invite-code box, but its click handler bypasses type discovery and invokes the parent-only redemption callable. That mismatch makes valid household and co-parent codes fail despite those codes being created and shared from the same parent experience.

## Expected behavior

- Any non-empty code entered in the dashboard must enter the canonical accept-invite flow, where the server-backed validator determines its type.
- Parent, household, and co-parent codes must reach their corresponding redemption handlers without the dashboard guessing the type.
- Existing authentication, email matching, verification, and already-redeemed handling must remain centralized in the shared flow.
- Empty input must retain the immediate "Please enter a code" feedback.

## Acceptance criteria

1. The dashboard no longer calls the parent-only redeemer from its generic code box.
2. The entered code is safely URL-encoded and routed to `/app/#/accept-invite`.
3. The canonical flow remains responsible for success, failure, and role-specific follow-up navigation.

The requested requirements subagent could not start because the subagent runtime reported `published reply runtime missing for main`; this artifact records the main-run synthesis needed to continue.
