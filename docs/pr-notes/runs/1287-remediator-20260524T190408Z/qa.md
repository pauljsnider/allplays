# QA

Regression tests:
- Verify the template disables buttons using the global pending predicate while preserving scoped loading label checks.
- Verify overlapping `handlePayFee` calls result in a single Stripe checkout invocation and keep the first fee pending until the first promise resolves.
- Verify error path still clears pending state and surfaces the existing error message.

Validation command: `npx vitest run src/app/team-fees/team-fees.component.spec.ts --reporter=verbose`.
