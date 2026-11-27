# Architecture analysis

## Root cause

`inviteParent` correctly exposes `reused: true`, and `queueInviteEmail` correctly exposes `deduplicated: true`. The legacy new-user modal discards both values and unconditionally renders a successful-send message. Because the default mail document ID is `invite_{codeId}`, a reused active code resolves to the already-created mail document without causing another provider delivery.

## Minimal design

Keep the current producer and backend contracts unchanged. In the legacy modal:

1. Capture the deterministic queue response.
2. If the invite was reused and that response was deduplicated, call `queueInviteEmail` again with `{ forceNewDelivery: true }`.
3. Let the existing callable enforce its invite-scoped resend cooldown and let the current catch path handle failures.
4. Render “resent” for a reused invite and “sent” for a new invite.

This uses the existing unique delivery ID generation and server-side cooldown rather than creating a new resend mechanism.

## Recurrence risk

Medium before regression coverage because queue acceptance and actual fresh delivery are distinct states. Low after a source-contract regression verifies that the modal consumes both `reused` and `deduplicated` before its success message.

## Orchestration note

The requested `allplays-architecture-expert` skill was unavailable, and the configured subagent runtime rejected the role launch before execution. This artifact records the main-run architecture synthesis.
