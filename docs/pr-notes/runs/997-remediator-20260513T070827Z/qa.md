# QA notes

Manual validation plan:
1. Open a completed game as a user with summary edit access.
2. Click Save Summary, then Cancel before the async save resolves.
3. Reopen Edit Summary and verify Save Summary remains disabled until the first save resolves.
4. Verify Save Summary can be used again after the save finishes or after an error.

Repo note:
- No automated test runner is defined in AGENTS.md. Use static inspection/manual browser flow for this targeted UI fix.
