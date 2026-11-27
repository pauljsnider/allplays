# Requirements analysis

## User need

Coaches must not be told that a new invitation email was sent when the active invite was merely reused and the deterministic mail job was deduplicated. A repeated invite action should either create a fresh delivery or clearly say that only the existing code remains active.

## Recommended behavior

- Keep the existing active invite code; do not create parallel access codes for the same parent and player.
- When the invite is reused and the deterministic queue call is deduplicated, request a fresh delivery through the existing cooldown-aware resend path.
- Say “resent” for reused invites and “sent” for newly created invites.
- If the resend is blocked or fails, retain the existing manual-code fallback instead of claiming success.

## Edge cases

- A first-time invite can race the Firestore create trigger. Do not force a second delivery merely because the deterministic call was deduplicated unless the invite itself was reused.
- Existing-account and bulk-import variants have separate confirmation/reporting behavior and should not be broadened in this targeted fix.

## Orchestration note

The requested `allplays-requirements-expert` skill was unavailable, and the configured subagent runtime rejected the role launch before execution. This artifact records the main-run requirements synthesis.
