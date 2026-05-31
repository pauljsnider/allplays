# QA notes

Validation targets:
- `npm --prefix apps/app test`
- `npm run app:build` from repo root, if feasible after the focused app test passes
- Root `npm test` is the existing Vitest unit suite and can be skipped only if unrelated/time-constrained, with local app test evidence retained.

Regression checks:
- Test file exists for every Jest `testMatch` entry.
- `moduleNameMapper` has no `/home/` absolute workspace target.
- Mapper targets are `<rootDir>` relative and resolve to committed files in repo root `js/`.
