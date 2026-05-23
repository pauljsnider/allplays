# QA notes

## Affected checks
- preview-smoke / edit roster Bulk AI reset smoke
- regression-guards / team fallback edit roster smoke
- roster-chat-media-replay-smoke / regression guard shard including edit roster fallback

## Validation
Run the affected smoke files against a fresh static server from the current worktree:

```bash
python3 -m http.server 4180
SMOKE_BASE_URL=http://127.0.0.1:4180 npx playwright test tests/smoke/edit-roster-bulk-ai-reset.spec.js tests/smoke/team-fallback-regressions.spec.js --config=playwright.smoke.config.js --reporter=line
SMOKE_BASE_URL=http://127.0.0.1:4180 npx playwright test tests/smoke/app-auth-profile.spec.js tests/smoke/app-schedule.spec.js --config=playwright.smoke.config.js --reporter=line
```

Expected: affected edit-roster/team fallback tests pass; app auth/profile and schedule shard remains unchanged or skipped under existing smoke gating.
