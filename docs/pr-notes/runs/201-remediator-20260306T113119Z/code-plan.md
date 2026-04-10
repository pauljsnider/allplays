Thinking level: low
Reason: Single-thread review remediation with an existing unit test target.

Plan:
1. Guard `redeemResult` in `js/accept-invite-flow.js` before building the success response.
2. Add a unit test for an invalid atomic redemption payload.
3. Run the focused Vitest file and commit the scoped fix.
