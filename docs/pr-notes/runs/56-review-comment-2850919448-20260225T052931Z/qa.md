# QA Role

## Objective
Validate that closed/cancelled offers reject new request creation.

## Coverage
- Rule parsing sanity via Firebase deploy dry-run command.
- Targeted rule inspection for create path.

## Regression Guardrails
- Confirm request create still requires:
  - signed-in parent
  - parent-child link
  - pending request status
  - open offer state

## Acceptance Criteria
1. Request create denied when offer status is `closed`.
2. Request create denied when offer status is `cancelled`.
3. Request create allowed when offer status is `open` and other constraints pass.

## Residual Gaps
- No emulator-backed automated rule tests currently in repo; manual/CI rule tests should be added in a follow-up.
