# QA Role Synthesis (fallback)

## Test strategy
1. Unit test pure help module:
   - Role normalization behavior.
   - Role-aware section filtering behavior.
   - Search matching behavior.
2. Wiring tests:
   - Footer now points to `help.html`.
   - Team banner includes Help navigation card and link target.

## Regression guardrails
- Limit changes to link wiring and additive modules.
- No existing test updates unless required by changed behavior.
