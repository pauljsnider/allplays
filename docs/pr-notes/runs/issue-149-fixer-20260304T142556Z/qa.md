# QA Role Synthesis (Fallback)

## Note on orchestration tooling
Requested skills (`allplays-orchestrator-playbook`, `allplays-qa-expert`) and `sessions_spawn` are not available in this runtime. This artifact captures equivalent QA analysis.

## Failure reproduction coverage
Add a unit test that freezes time in 2026 and uses a weekly series starting in 2024. Assert upcoming window occurrences are returned.

## Regression guardrails
1. Verify no change to near-term daily interval expectations.
2. Verify weekly interval cadence with multi-day `byDays` remains stable.
3. Verify old series no longer returns empty when no end date is set.

## Validation commands
- Run targeted recurrence tests first.
- Run full recurrence-related unit suite (`tests/unit/recurrence-*.test.js`) for confidence.
