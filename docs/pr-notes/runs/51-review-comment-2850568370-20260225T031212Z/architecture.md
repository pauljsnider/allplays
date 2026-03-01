# Architecture Role Notes

## Decision
Adopt remote-only persisted signature initialization in `hydrateChatState`.

## Rationale
`lastPersistedChatSignature` acts as an idempotency gate. Setting it from local state before remote write completion creates a false positive and suppresses required sync.

## Control Equivalence
- Before: local recovery could silently fail cross-device sync.
- After: sync occurs once, and the gate is re-established only after remote acknowledgement.

## Rollback
Revert single-line change in `game-day.html` if unexpected write amplification appears.
