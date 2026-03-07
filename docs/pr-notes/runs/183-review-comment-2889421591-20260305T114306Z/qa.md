# QA role summary

Thinking level: medium (regression guardrail)

## Test strategy
- Keep existing BYE creation test.
- Add sequential regression test that reproduces reported failure path: BYE auto-advance first, then upstream result reported.

## Pass criteria
- Downstream game remains mutable until both teams are known.
- No preselected winner persists in `R2G1` before both sides are resolved.

## Commands
- `npx vitest run tests/unit/bracket-management.test.js`
