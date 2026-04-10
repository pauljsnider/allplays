Implementation plan:
1. Add unit assertions for cancelled ICS parsing in `tests/unit/utils-ics-practice-classification.test.js`.
2. Add a targeted Playwright page test for cancelled imported calendar rows in Edit Schedule.
3. Apply the smallest code change needed if the new tests expose instability in parsing or rendering.
4. Run the relevant unit and browser tests.
5. Commit all changes with an issue-referencing message.

Minimal-change rule:
- No refactor of Edit Schedule renderer unless the new tests prove it is necessary.
- Keep any code fix inside existing import/parsing flow.
