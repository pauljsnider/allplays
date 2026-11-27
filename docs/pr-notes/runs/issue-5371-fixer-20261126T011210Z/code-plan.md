# Code plan — issue #5371

## Tests first

Extend `McpActionReview.test.tsx` with completed-status reconciliation, failed-status guidance, partial remaining-preview refresh, and executing/uncertain non-actionable presentation.

## Minimal implementation

- After `confirmMcpActionReview` resolves with `completed` or `failed`, update the local review status and clear the consumed pending proposal. The service resolves only after its status write succeeds, so ambiguous results continue through the existing catch path.
- Continue reloading for `partial`, because the existing executor can replace the pending arguments with only the remaining work.
- Add status-specific non-actionable copy for completed, failed, and executing. Preserve conservative generic handling for unknown states.
- Do not modify the MCP service, OAuth scopes, Firebase rules, private-AI execution state machine, or browser route wiring.

## Validation

Run the focused page/service Vitest files and `npm run app:build`. Keep the existing signed-out Playwright smoke unchanged because route/auth behavior is already covered and this patch does not change routing.
