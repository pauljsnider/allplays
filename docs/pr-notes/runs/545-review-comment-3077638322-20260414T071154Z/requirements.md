## Acceptance Criteria
1. Every `.html` file linked from `help.html` and listed in `help-page-reference.html` must load its own page shell in production, not a Firebase rewrite fallback to `index.html`.
2. Production smoke must fail when a referenced file is missing, stale, or rewritten to the home page even if the HTTP status is `200`.
3. Each checked page must expose at least one stable, page-specific identity signal available without user interaction, such as its own `<title>` or primary heading.
4. A coach selecting a workflow from Help Center must land on that exact workflow page.
5. A parent or member opening a shared help/reference page must see the intended guidance page immediately.
6. An admin/program operator must be able to rely on post-deploy smoke to catch stale Help Center references before users do.

## User Risks
- Coaches lose time if a Help Center link silently drops them on the homepage.
- Parents can conclude the guide is gone or the app is broken when a link returns the wrong page shell.
- Admins get false confidence from green smoke tests while broken references remain live.

## Scope Boundaries
- In scope: link integrity for Help Center workflow entries and file-reference entries under Firebase rewrite behavior.
- In scope: confirming the served page is the intended destination page.
- Out of scope: validating full functional behavior of every destination page after load.
- Out of scope: changing Firebase rewrites, auth rules, or broader site-wide routing strategy.

## Recommended Test Expectations
- Keep `response.ok()` but treat it as necessary, not sufficient.
- Verify a stable identity marker from the served HTML matches that file’s expected page.
- Prefer production-safe checks such as comparing the requested page’s `<title>` to the repo source title.
- Explicitly fail when the served page identity matches `index.html` or otherwise does not match the requested file.
