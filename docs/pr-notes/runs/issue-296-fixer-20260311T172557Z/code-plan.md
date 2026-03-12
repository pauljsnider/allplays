Thinking level: medium
Reason: targeted flow bug with existing test coverage and low architectural ambiguity.

Plan:
1. Add regression coverage around existing-team admin invite persistence.
2. Encapsulate existing-team invite persistence in a helper with injected dependencies.
3. Switch `edit-team.html` to use that helper.
4. Run focused invite-related Vitest coverage, then the full unit suite if time/cost is reasonable.
5. Commit the fix and test artifacts together with an issue-referencing message.
