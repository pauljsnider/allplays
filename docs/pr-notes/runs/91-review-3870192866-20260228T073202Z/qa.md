# QA Role Summary

## Regression Focus
- Unread badge update trigger on initial snapshot.
- Unread badge update trigger on subsequent realtime snapshots.
- Guardrails when required context is missing.

## Validation Plan
- Execute targeted unit test file for `team-chat-last-read`.
- Confirm all assertions pass with only supported parameters.

## Residual Risk
- No end-to-end UI run in this patch; policy correctness depends on listener wiring unchanged by this PR.
