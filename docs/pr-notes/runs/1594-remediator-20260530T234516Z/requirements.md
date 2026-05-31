# Requirements notes

## Acceptance criteria
- `npm --prefix apps/app test` must discover a committed test file.
- Jest legacy `../../../../js/*` imports from app TypeScript must resolve to this repository root via `<rootDir>/../../js/$1`.
- No Jest mapper may reference a private `/home/paul-bot1/...` workspace path.

## Review thread classification
- `PRRT_kwDOQe-T586F5qPg`: actionable. Replace hardcoded absolute `moduleNameMapper` targets with portable `<rootDir>` paths.
- `PRRT_kwDOQe-T586F5qb0`: informational but valid. Treat as remediation input by committing the configured `chatService.test.ts` target so app tests do not fail with no tests found.
- `PRRT_kwDOQe-T586F5qb1`: actionable. Same root cause as first actionable thread: mapper targets must resolve relative to the repo checkout.
