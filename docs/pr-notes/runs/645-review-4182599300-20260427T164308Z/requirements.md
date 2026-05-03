# Requirements Role

## Problem Statement
PR #645 safely copies selected rollover players. The blocking signal is the `preview-smoke` failure in the existing-user admin invite fallback on `edit-team.html`, caused by the page's updated DB import contract not matching the smoke stub.

## Acceptance Criteria
1. Existing-team admin invite flow normalizes `Coach@Example.com` to `coach@example.com`.
2. Existing-user admin invite displays the fallback status, invite code, and visible copy container.
3. Admin list reflects the normalized email after persistence.
4. Admin invite redemption validates and redeems the admin code, then redirects to `dashboard.html`.
5. Parent invite redemption is not called for admin invite redemption.
6. Roster rollover behavior remains unchanged.
7. Unit tests and the targeted admin invite smoke test pass in CI.

## Non-Goals
- No production roster rollover rewrite.
- No Firestore rules changes.
- No invitation model redesign.
