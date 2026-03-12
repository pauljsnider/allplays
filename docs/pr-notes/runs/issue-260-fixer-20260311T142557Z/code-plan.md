Chosen thinking level: medium.
Reason: the bug is narrow, but it spans two tracker implementations and needs regression protection without overbuilding test harnesses.

Implementation plan:
1. Add a focused unit test covering legacy tracker email helper usage.
2. Run the focused test to confirm it fails on current source.
3. Import `resolveSummaryRecipient()` into `track.html` and `js/track-basketball.js`.
4. Replace direct `currentUser.email` mailto recipients with helper-based selection.
5. Run focused tests, then the relevant broader unit suite.

Fallback path:
- If importing the helper into `track.html` causes module issues, inline a tiny wrapper that delegates to the existing helper module loaded from a separate script. Prefer direct import first.
