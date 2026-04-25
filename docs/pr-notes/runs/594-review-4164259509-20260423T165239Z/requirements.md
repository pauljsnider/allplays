# Acceptance Criteria

1. Loading `workflow-live-watch-replay.html` with no hash does not throw any runtime error during TOC initialization.
2. Loading the page with a valid hash initializes the matching TOC item as active on first render.
3. Loading the page on mobile still sets the correct active TOC state before any user interaction.
4. Existing TOC navigation, hash-based deep linking, and replay content rendering continue to work unchanged.
5. The added `test-workflow-mobile-toc-active-state.html` demonstrates the regression is fixed and covers the mobile active-state initialization path.

# User Impact

- Coaches and parents can open the live watch replay workflow without a broken page or stalled script execution.
- Mobile users, who are most likely to use this flow on the go, get correct section highlighting immediately.
- Admins and support avoid a credibility-damaging first-load failure in a high-visibility workflow page.

# Assumptions

- The issue is limited to the incorrect `window.window.location.hash` reference and not broader TOC logic.
- Browsers in scope support standard `window.location.hash` behavior.
- The new test page is intended as the primary regression check since this repo uses HTML-based manual testing rather than an automated runner.

# Recommendation

Approve after verifying the fix replaces `window.window.location.hash` with `window.location.hash` and the new mobile TOC test page passes. This is a low-risk, high-value regression fix because it removes a first-load runtime error in a mobile-first flow without changing intended UX behavior.
