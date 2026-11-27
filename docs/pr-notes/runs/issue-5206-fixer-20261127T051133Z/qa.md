# QA analysis

## Regression strategy

Add a focused root Vitest source-contract test beside the existing parent-invite legacy-page tests. Scope the inspected source to the new-user branch so unrelated bulk resend code cannot satisfy the assertions.

The regression must prove that the branch:

- captures the result of the first `queueInviteEmail` call;
- combines `result.reused` with `emailDelivery.deduplicated` before forcing a new delivery;
- invokes the existing `{ forceNewDelivery: true }` path;
- distinguishes “resent” from “sent” in the confirmation copy; and
- performs the resend decision before rendering success.

## Focused validation

Run only the changed Vitest file. No Functions test is required because the backend resend and cooldown paths are unchanged and already covered by their adjacent tests.

## Orchestration note

The requested `allplays-qa-expert` skill was unavailable, and the configured subagent runtime rejected the role launch before execution. This artifact records the main-run QA synthesis.
