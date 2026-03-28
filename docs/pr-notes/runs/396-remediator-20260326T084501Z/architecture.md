Current state vs proposed state:
- Current: smoke URL generation resolves `/foo` from the site root.
- Proposed: smoke URL generation resolves `/foo` relative to the deployed app base path when one exists.

Risk surface and blast radius:
- Blast radius is limited to Playwright smoke helpers and one smoke spec.
- Main risk is over-constraining the mocked Firebase route and breaking the test if the page performs a different reset-password request on load.

Recommendation:
- Keep the helper change minimal and deterministic.
- In the spec, continue non-reset-password Firebase traffic, fulfill the known invalid-code request, and abort any unexpected `accounts:resetPassword` request to avoid live calls.
