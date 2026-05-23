# QA Notes

## Validation
- `git diff --check`
- Verified PR merge ref exists with `git ls-remote origin refs/pull/1239/merge`
- Ran `SMOKE_BASE_URL=http://127.0.0.1:4173 npm run test:smoke:team-fallback`

## Expected CI result
The regression-guards workflow should now pass checkout with explicit repository read permission, then execute the roster/chat/media/replay smoke suite.
