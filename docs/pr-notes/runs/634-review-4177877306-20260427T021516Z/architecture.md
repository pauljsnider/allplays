# Architecture Role Summary

## Decisions
- Treat this as repository hygiene, not an application behavior change.
- Remove the generated `test-results/.last-run.json` artifact from tracking.
- Add `test-results/` to `.gitignore` under testing artifacts.
- Keep `tests/smoke/edit-schedule-calendar-import.spec.js` intact.

## Risk And Blast Radius
- No Firestore schema, rules, auth, Storage, or production runtime impact.
- Ignoring generated test output reduces repository noise and accidental leakage of local test metadata.
- Rollback is limited to reverting the ignore-rule/artifact-removal commit.
