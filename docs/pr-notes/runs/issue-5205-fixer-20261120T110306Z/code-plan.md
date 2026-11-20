# Code role

The requested `allplays-orchestrator-playbook` and `allplays-code-expert` skills were unavailable. The required read-only role session also failed before execution because the runtime reported `published reply runtime missing for main`. The required RCA playbook path `/home/paul-bot1/automation/docs/bug-rca-playbook.md` does not exist. This main-lane synthesis follows the repository bug-fix contract and keeps all edits, validation, and commit ownership in the main run.

1. Add a regression against the real creation handler for expired and revoked outcomes using the same legacy operation key.
2. Verify the test fails on the current `failed-precondition` branch.
3. Remove only the stale-key rejection so non-replayable terminal outcomes proceed through existing rate limiting and transactional creation.
4. Run `node --test functions/test/parent-invite-creation.test.cjs`.
5. Review the focused diff, stage the test, fix, and role artifacts, then commit with issue #5205 in the message.

Recurrence risk is low after the regression because active, completed, expired, and revoked idempotency states are all covered at the real handler boundary.
