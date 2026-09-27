# Code Plan: Issue #4367

**Baseline:** `paulbot/fix/issue-4367-20260802014758` at `19c998a35fad8037f7bbbf2d6fe55e98a090ea8d`.

## Implementation

1. Add focused service tests that demonstrate trusted reuse, invalid/missing regeneration, and failed regeneration.
2. Add a private canonical Stripe Checkout destination helper.
3. Scrub invalid stored destinations while preserving the raw record for online-mode classification.
4. Require canonical validation in reusable-link detection.
5. Validate callable output before returning it and use a retry-oriented error for invalid results.
6. Run the focused app test and app build, inspect the diff, and commit the test and fix together.

## Risk controls

Scrubbing closes FeesTool compatibility fallbacks that inspect `fee.checkoutUrl`. The same helper protects both persisted and newly generated destinations. No unrelated payment, rendering, authorization, or persistence behavior changes.
