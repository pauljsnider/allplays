# Architecture Decisions
- Replace `new URL(...).pathname` with Node's file URL conversion so the unit test resolves repo-relative paths correctly on Windows and POSIX.
- In the smoke test, fetch `/index.html` once as the hosting rewrite baseline, then assert each requested help file response is both successful and not identical to that fallback document.

# Tradeoffs
- Using `fileURLToPath` adds one import but avoids ad hoc path normalization logic.
- Comparing against the index fallback is less page-specific than asserting bespoke headings, but it scales across every referenced help file with minimal patch surface.

# Rollback
- Revert the two test-file edits only. No runtime code or hosting config changes are involved.
