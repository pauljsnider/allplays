# QA Plan

- Verify the production file no longer references `window.window.location.hash`.
- Verify the dedicated regression page initializes the first TOC item active on load and exercises click and scroll active-state behavior for both mobile and desktop flows.
- Verify the impacted workflow remains limited to `workflow-live-watch-replay.html` mobile and hash-based TOC initialization.

# Regression Risks

- Low: the production patch changes a single global property reference.
- Medium if the test page drifts from production logic in future edits, because this repo relies heavily on page-level regression pages.

# Manual Checks

1. Load `test-workflow-mobile-toc-active-state.html` directly or via a local static server.
2. Confirm the summary reports 5 passed and 0 failed checks.
3. Confirm mobile click and scroll checks move the active state as expected.
4. Confirm desktop rerun checks initialize section 1 when no hash is present and move to section 2 on scroll.

# Recommendation

Accept the fix after confirming the typo is removed and the TOC initialization path remains covered by the now-deterministic regression page.
