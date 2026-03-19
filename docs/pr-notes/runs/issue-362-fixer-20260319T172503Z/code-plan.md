# Issue 362 Code Plan

1. Add a shared admin email list normalizer and reuse it for full-team access checks.
2. Normalize `adminEmails` when Edit Team loads an existing team, when an invite is added locally, and immediately before save.
3. Add a behavioral Vitest spec that executes the Edit Team page module with a mocked DOM and verifies remove/save/reload plus add/save/reload flows.
4. Add a small unit test for whitespace-trimmed admin access.
5. Run focused tests, then commit the targeted patch.
