Scope: regression guardrails for live tracker finish reconciliation.

Checks:
- Unit coverage confirms reconciliation adds a durable event write with current period/clock context.
- Unit coverage confirms recap-email generation receives the augmented log when reconciliation occurs.
- Existing live-tracker email and integrity suites still pass.

Executed validation:
- `pnpm install`
- `pnpm exec vitest run tests/unit/live-tracker-finish.test.js`
- `pnpm exec vitest run tests/unit/live-tracker-email.test.js tests/unit/live-tracker-integrity.test.js`

Residual risk:
- No browser-level manual run was executed in this environment.
- Timestamp assertions remain intentionally loose because the helper stamps the inserted reconciliation entry at runtime.
