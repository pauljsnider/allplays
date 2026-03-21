Objective: add regression coverage for public footer support links so broken Help Center or Contact destinations fail CI instead of reaching production silently.

Current state:
- The homepage footer and shared `renderFooter(...)` helper already point to live support destinations.
- CI smoke only runs `tests/smoke/static-hosting-bootstrap.spec.js`, so there is no browser-level guard on footer support links.

Proposed state:
- Add Playwright smoke coverage for the homepage footer and one shared-footer public page.
- Ensure smoke workflows execute the smoke suite instead of a single file so the new coverage gates PRs and production smoke runs.

Risk surface and blast radius:
- Blast radius is limited to smoke coverage and smoke workflow commands.
- Main risk is brittle selectors on pages that load shared footer content asynchronously.

Assumptions:
- `help.html` is the intended destination for `Help Center`.
- `https://paulsnider.net` is the intended external destination for `Contact`.
- A public shared-footer page is sufficient to guard `renderFooter(...)`; `login.html` is acceptable if it loads reliably in smoke.

Recommendation:
- Add one focused Playwright spec that validates non-placeholder hrefs and successful Help Center navigation from the homepage plus shared-footer wiring on `login.html`.
- Update smoke workflows to run all smoke specs so the regression guard is enforceable.

Success criteria:
- Smoke fails if homepage or shared-footer support links regress to `#`, empty, or same-page hash destinations.
- Smoke fails if homepage Help Center no longer navigates to `help.html`.
- Preview and production smoke workflows run the new spec automatically.
