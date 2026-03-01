# QA Role Notes

## Regression Focus
- Hydration path with/without Firestore chat state.
- Debounced persistence dedupe behavior.

## Test Matrix
1. Firestore has no chat state, local storage has chat history: expect write issued once after hydrate.
2. Firestore has chat state: expect no extra write at hydrate if unchanged.
3. Firestore and local both empty: expect no write until user interaction.

## Guardrails
- Confirm `state.lastPersistedChatSignature` changes only on successful `updateGame` (or remote snapshot apply).
- Confirm no infinite persist loop from subscription callback.
