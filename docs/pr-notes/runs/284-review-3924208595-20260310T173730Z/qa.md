# QA role

- Reviewed evidence:
  - PR review comment `2913371652` flags stale-profile precedence risk.
  - Branch head `cd765dd` changes dashboard lookup to `user.email || profile?.email`.
- Validation target: dashboard access wiring plus shared team access tests.
- Findings:
  - Product code already matches the requested behavior.
  - `tests/unit/team-management-access-wiring.test.js` still expected the old string and failed.
- Regression guardrail: assert auth-first precedence explicitly so future edits cannot silently reintroduce stale-profile priority.
- Acceptance criteria:
  - Focused tests pass.
  - No new product-code diff is required beyond the already-landed fix.
