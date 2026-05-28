# QA Plan

## Primary Risks
- Deploy-preview remains blocked by GitHub JSON parsing.
- Open or current PR preview channels are accidentally deleted.
- A CI-only change is mistaken for app behavior coverage.

## Validation
- Verify the workflow uses guarded `gh pr list` discovery.
- Verify the workflow shell block parses with `bash -n` after replacing GitHub expression placeholders locally.
- Verify `gh pr list --repo pauljsnider/allplays --state open --limit 200 --json number --jq '.[].number' | sed 's/^/pr-/'` returns channels without JSON parse errors.
- Run `npm run test:unit:ci` for baseline app regression coverage.
- Run `npm run app:build` because the deploy job builds the React app before preview deployment.

## Release Gate
A new GitHub Actions deploy-preview run for PR #1518 should show the deploy job passing and no `unexpected end of JSON input` in `Prune stale Firebase preview channels`.
