# Requirements

## Acceptance Criteria
- Opening app search must not throw when `computeAppSearchResults` returns the legacy JS shim shape with `actions`, `teams`, `players`, and `flat` but no `help` array.
- Help results continue to render when the TypeScript search service returns `help`.
- Scope is limited to PR review feedback for thread `PRRT_kwDOQe-T586EiBCC`.

## Non-goals
- No changes to search ranking, routing, Firebase queries, or help knowledge content.
