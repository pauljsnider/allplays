# QA Notes

## Validation commands
- `GITHUB_EVENT_NAME=pull_request GITHUB_BASE_REF=master node scripts/check-critical-cache-bust.mjs`
- `npm run app:build`
- `npm run test:unit:ci`
- Preview smoke if time allows with configured root and app preview servers.

## Regression expectations
Large dependency or lockfile diffs must not crash cache-bust guard. If critical files such as `js/firebase.js`, `js/auth.js`, or `js/db.js` change, the guard must still require a matching import cache-bust bump.

## Risks
Preview smoke failures may be separate app route regressions. The cache-bust failure itself is code-fixable in the guard script.

## Final validation evidence
- Cache-bust guard passed locally with pull request env.
- React app build passed.
- Full preview smoke passed locally: 92 passed, 1 skipped.
