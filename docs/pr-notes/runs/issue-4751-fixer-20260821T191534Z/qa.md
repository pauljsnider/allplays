# Risk Matrix

- High: duplicate checkout creation while one request is pending.
- High: retry bypasses canonical destination validation.
- Medium: rejection leaves the CTA disabled until reload.
- Medium: stale failure feedback remains visible during retry.
- Low: loading and error state are not announced clearly.

# Automated Tests To Add/Update

- Deferred promise test for synchronous disabled, loading label, and `aria-busy` state.
- Duplicate-click assertion while the deferred promise is pending.
- Rejection test for visible retryable feedback, restored label, and enabled CTA.
- Retry test for a second invocation with unchanged team/season context and cleared stale feedback.
- Invalid-destination retry test proving fail-closed recovery.
- Retain the canonical destination matrix for HTTP, lookalike, credentialed, port-bearing, and root-only URLs.

# Manual Test Plan

Throttle checkout creation, verify the CTA enters loading state and cannot duplicate requests, force a failure, retry without refreshing, and verify successful navigation only to canonical Stripe Checkout.

# Negative Tests

- Two pending clicks produce one invocation.
- Rejection never leaves the CTA disabled.
- Retry never retains stale error feedback.
- Invalid destination never navigates.
- Retry preserves team and season context.
- Missing error details use stable retryable fallback copy.

# Release Gates

- `npx vitest run tests/unit/team-pass.test.js --reporter=verbose`
- New regressions fail against the pre-fix lifecycle.
- Existing canonical URL tests remain green.
- No backend, eligibility, React mobile, or Playwright scope expansion.

# Post-Deploy Checks

Verify one pending request, failure recovery, successful retry, invalid-destination recovery, and absence of duplicate checkout calls in browser network logs.
