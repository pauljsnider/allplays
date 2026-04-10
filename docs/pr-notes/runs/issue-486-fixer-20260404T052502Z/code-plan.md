Thinking level: low
Reason: Single-helper regression with an existing targeted test page and clear expected behavior.

Plan:
1. Update the test-page replica of `isBasketballConfig` so it matches the shipped bug and fails on the missing-`baseType` case.
2. Run the page logic under a lightweight harness to prove the regression before the fix.
3. Patch `edit-schedule.html` so missing `baseType` falls back to team sport.
4. Update the test-page helper to match the fixed logic.
5. Re-run the targeted validation and commit the change set.
