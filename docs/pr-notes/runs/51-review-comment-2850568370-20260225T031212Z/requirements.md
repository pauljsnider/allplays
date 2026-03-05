# Requirements Role Notes

## Objective
Ensure recovered local game-day chat state is persisted to Firestore when no remote chat state exists, preserving continuity across devices.

## Current State
`hydrateChatState` can load local history and schedule a persist, but also marks that signature as already persisted immediately.

## Proposed State
Only treat Firestore-origin chat state as persisted at hydrate time. Local-only recovery remains pending until `updateGame` succeeds.

## Risk Surface / Blast Radius
- Surface: game-day chat persistence flow only.
- Blast radius: limited to `game-day.html` state tracking (`lastPersistedChatSignature`).

## Assumptions
- `updateGame` success is authoritative for persistence confirmation.
- Existing debounce and in-flight guards are correct.

## Success Criteria
- Local history recovered with no Firestore chat fields triggers one Firestore write.
- After successful write, no duplicate writes for unchanged signature.
