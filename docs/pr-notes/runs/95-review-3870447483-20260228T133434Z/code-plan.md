# Code Role Plan

## Minimal Patch
1. In `expandRecurrence`, compute series week-start day number and current week-start day number.
2. Use week-start delta to derive interval gate.
3. Add a regression test for a mid-week start plus multi-day `byDays`.

## Non-Goals
- No changes to recurrence UI or storage schema.
- No changes to daily recurrence logic.
