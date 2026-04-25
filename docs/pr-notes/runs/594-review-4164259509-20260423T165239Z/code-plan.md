# Implementation Plan

- Change the initial TOC active-state call in `workflow-live-watch-replay.html` to use `window.location.hash`.
- Keep the production TOC setup otherwise unchanged.
- Tighten `test-workflow-mobile-toc-active-state.html` so its mocked layout and hash reset behavior produce deterministic mobile and desktop regression results.

# Minimal Patch

- `workflow-live-watch-replay.html`: replace `window.window.location.hash.slice(1)` with `window.location.hash.slice(1)`.
- `test-workflow-mobile-toc-active-state.html`: make the hidden fixture render off-screen instead of `display:none`, use deterministic heading-position mocks, reset the desktop rerun state, and detect active links by active class.

# Validation Hooks

- `grep -n "window\.location\.hash\|window\.window\.location\.hash" workflow-live-watch-replay.html`
- `grep -n "window\.location\.hash\|window\.window\.location\.hash" test-workflow-mobile-toc-active-state.html`
- `google-chrome --headless=new --disable-gpu --no-sandbox --allow-file-access-from-files --dump-dom file:///tmp/allplays-pr594-review-4164259509/test-workflow-mobile-toc-active-state.html`

# Recommendation

Ship the one-line production fix with the stabilized regression page so the active-state path is both corrected and verifiable.
