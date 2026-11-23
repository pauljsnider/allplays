# Code plan

The required `allplays-code-expert` role session was attempted twice but the OpenClaw subagent runtime failed with `published reply runtime missing for main`. This artifact records the main-run synthesis.

1. Add failing regressions for unverified mismatched recipient emails in the real parent handler and all three callable paths.
2. Add identity-core tests for structured authoritative email and verification state.
3. Implement the structured resolver while retaining the email-only wrapper.
4. Update redemption guards to compare mismatch before enforcing verification.
5. Run focused tests, inspect the diff, and commit fix plus tests and artifacts.
