# QA Analysis

> Fallback artifact: the requested QA subagent was dispatched, but the runtime rejected the role before execution. This analysis was completed in the main lane from repository and issue evidence.

## Regression strategy

Add a jsdom unit regression to `tests/unit/help-team-context-links.test.js` that loads the reported source article with `context=team&teamId=TEAM123&role=coach`, invokes the shared helper, and asserts that the Team Communication related-workflow URL contains all three values. This fails before the fix because the helper only rewrites the Back link.

The existing Back-link unit test covers the second half of the journey on the destination article. The existing inventory test verifies that every workflow page loads the shared helper.

## Focused validation

```bash
npx vitest run tests/unit/help-team-context-links.test.js --reporter=verbose
```

No browser smoke is necessary for this DOM-only URL rewrite because jsdom executes the same shared helper against real page markup.

## Edge checks

- Preserve no context when `context=team` or `teamId` is absent.
- Do not rewrite cross-origin links.
- Preserve an optional role only when present.
