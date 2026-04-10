Objective: resolve PR thread `PRRT_kwDOQe-T5854VkrM` by preventing the parent dashboard from rejecting duplicate parent invite codes that remain redeemable.

Current state:
- `parent-dashboard.html` calls `validateAccessCode(code)` before `redeemParentInvite(user.uid, code)`.
- `validateAccessCode()` inspects a single matched access-code document and can fail if the first duplicate is stale, used, expired, or a different type.
- `redeemParentInvite()` already contains duplicate-aware selection logic and transaction-time expiry/use checks.

Proposed state:
- Parent dashboard manual redemption should rely on `redeemParentInvite()` as the authority for duplicate parent invite resolution.
- The dashboard should still show existing success and error alerts, but it should not pre-block on `validateAccessCode()`.

Risk surface and blast radius:
- Single page: `parent-dashboard.html`
- Single user flow: signed-in parent redeeming a manual code
- No schema, auth, or Firestore rule changes

Assumptions:
- `redeemParentInvite()` remains the authoritative fail-closed control for invalid, used, or expired parent invite codes.
- Matching the accept-invite page behavior is not required for this dashboard path when it conflicts with duplicate-aware redemption.

Recommendation:
- Remove the dashboard pre-validation call and cover the wiring with a focused unit test so future edits do not reintroduce the regression.
