# Requirements analysis — issue #5371

## Evidence and acceptance mapping

- `App.tsx` already protects `/ai/mcp/:requestId`, and `app-mcp-review-auth.spec.js` verifies that a signed-out deep link preserves the review destination without exposing mutation controls.
- `McpActionReview.tsx` keeps **Prepare for review** and **Confirm change** as separate actions.
- `mcpActionReviewService.ts` validates account, catalog, scope, expiry, pending-action identity, and the displayed fingerprint before the existing private-AI executor can run.
- Existing service tests cover cross-account denial, expiry, stale previews, partial retries, ambiguous persistence, and duplicate-execution prevention.

## Remaining requirement gap

The route and safe service lifecycle already exist, but terminal UI state is not reconciled after confirmation. A completed or failed result changes the message while the rendered `Status:` can remain `prepared`. A persisted `executing` state, which is also the fail-closed representation of an uncertain outcome, receives only generic copy.

Required behavior is to show completed, failed, partial, and executing/uncertain states distinctly without offering replay or claiming full completion for partial or ambiguous outcomes.

## Recommendation

Update local status only after a resolved terminal confirmation result, continue reloading authoritative remaining work for partial results, and add explicit non-actionable copy for failed and executing/uncertain states. Preserve all existing service boundaries and mutation guards.
