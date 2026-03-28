## Code role

- Patch `tests/unit/edit-schedule-csv-import-wiring.test.js` to expect `./js/schedule-csv-import.js?v=2`.
- Leave runtime files unchanged because the functional review feedback is already present on the branch.
- Validate with targeted source inspection:
  - `rg` for `schedule-csv-import.js?v=2`
  - `git diff --stat`
  - `git status --short --branch`
