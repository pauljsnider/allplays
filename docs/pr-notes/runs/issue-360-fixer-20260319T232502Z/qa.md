# QA Role (allplays-qa-expert equivalent fallback)

Requested orchestration skill `allplays-orchestrator-playbook`, role skill `allplays-qa-expert`, and `sessions_spawn` are unavailable in this runtime. This artifact captures equivalent QA analysis.

## Risk Focus

- Wrong child ID/name submitted on request.
- Modal rerender hiding the parent's existing request by snapping back to child A.
- Cancel action firing backend writes but leaving stale UI state assumptions.

## Test Plan

- Add a unit test for child-selection resolution when the parent already has a request for child B.
- Add a unit test for request handler behavior with a selector value for child B and verify backend + rerender side effects.
- Add a unit test for cancel handler behavior and verify backend + rerender side effects.

## Regression Guardrails

- Keep existing rideshare helper and wiring tests green.
- Run the focused new test file plus the existing rideshare-related suite.
