# QA plan

> The requested `allplays-qa-expert` skill was unavailable, so the role applied the specified senior QA and regression-guardrail perspective directly.

## Regression coverage

1. Add a 51-recipient integration fixture for the configured page size of 50.
2. Assert the page-two recipient is delivered exactly once.
3. Instrument the fee-recipient query fake and assert both upcoming reads request 50 documents, return at most 50, order by `dueDate`, and advance the second read from the first page's final snapshot.
4. Assert the structured summary reports two pages, `drained`, 51 examined, 51 sent, and zero failed.
5. Add source wiring assertions for the bounded drain, explicit query limit/cursor, worker helper, fixed concurrency constant, and summary fields.
6. Retain direct worker-helper tests that prove the concurrency ceiling, complete examination, and deterministic sent/failed counts.

## Preservation guardrails

Run the existing fee reminder notification tests unchanged. They cover eligibility, preferences, payment-state rechecks, Auth and team access, active player linkage, claims, expired leases, ambiguous commits, retries, and one-send-per-threshold behavior.

## Focused validation

```bash
npx vitest run tests/unit/fee-due-reminders-source.test.js functions/test/notification-triggers.test.js --reporter=verbose
```

Recurrence risk is low after these regressions because both the production wiring and a real multi-page delivery path enforce the bounds.
