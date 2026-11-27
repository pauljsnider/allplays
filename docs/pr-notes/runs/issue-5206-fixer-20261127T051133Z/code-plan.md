# Code plan

1. Add a source-contract regression to `tests/unit/parent-invite-auto-link.test.js` for the legacy new-user branch.
2. Run that focused test and confirm the new assertion fails against the unconditional queue call.
3. Update only `edit-roster.html`: retain the deterministic queue attempt, force a fresh delivery only for a reused-and-deduplicated result, and use truthful sent/resent wording.
4. Re-run the focused test.
5. Review the diff, stage the fix, test, and required run artifacts, then commit with an issue-referencing message.

## Orchestration note

The requested `allplays-code-expert` skill was unavailable, and the configured subagent runtime rejected the role launch before execution. This artifact records the main-run implementation plan.
