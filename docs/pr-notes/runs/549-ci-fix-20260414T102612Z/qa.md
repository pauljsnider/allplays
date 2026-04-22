# QA Plan
- Run `npx vitest run tests/unit/edit-team-admin-access-persistence.test.js` to confirm the extracted module now evaluates correctly.
- Run the full unit suite with `npx vitest run` to confirm no adjacent unit behavior regressed.
- Verify the formerly failing suite reports passing tests without changing test expectations.

# Risks And Rollback
- Main risk is masking another missing import if the page adds more dependencies later; current fix restores parity for the newly added stat config import.
- Rollback is a single-file revert if broader unit execution shows unrelated fallout.
