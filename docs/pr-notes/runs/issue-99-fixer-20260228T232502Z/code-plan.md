# Code Role (allplays-code-expert)

## Plan
1. Create `tests/unit/recurrence-until-inclusive.test.js` with a failing case for end-date inclusivity.
2. Update `expandRecurrence` end-condition logic in `js/utils.js` to compare against end-of-day inclusive `until` boundary.
3. Run focused test file and confirm pass.
4. Stage and commit with issue reference.

## Non-Goals
- No refactor of recurrence interval behavior.
- No UI or Firestore schema changes.
