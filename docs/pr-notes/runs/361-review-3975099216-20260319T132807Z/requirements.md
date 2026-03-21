Objective: close the PR #361 review gap by making the footer smoke prove the Help Center destination actually loads, not just that the browser URL changes.

Current state:
- `tests/smoke/footer-support-links.spec.js` verifies the homepage footer link points to `help.html`.
- The homepage smoke clicks the link and confirms the URL path becomes `/help.html`.
- That still allows a false pass if hosting rewrites or a missing file returns an error page at the same path.

Proposed state:
- The smoke should fail when `help.html` no longer returns a successful document response.
- The smoke should also fail when the Help Center page content does not render after navigation.

Risk surface:
- Low blast radius. This is test-only and isolated to one Playwright spec.
- The main risk is over-constraining the page-content assertion. Using the existing Help Center heading keeps that risk low.

Assumptions:
- `help.html` remains the canonical footer Help Center destination.
- The visible heading `ALL PLAYS Help Center` is intentional product copy, not transient debug text.

Recommendation:
- Capture the navigation response from the Help Center click.
- Assert that the response is non-null and successful.
- Keep the pathname assertion and add a visible heading assertion so the smoke proves the page rendered.

Acceptance criteria:
- Smoke fails if `help.html` is removed, rewritten to an error page, or serves a non-OK response.
- Smoke still validates homepage footer navigation and shared footer link wiring on `login.html`.
