# Architecture Role (fallback local synthesis)

## Current state
`track.html` always renders and wires `#generateAISummary`, then always attempts `getAI(...GoogleAIBackend...)` and model generation.

## Proposed state
Introduce a small helper module that determines AI summary capability via explicit runtime flag and applies UI gating before event listener wiring.

## Design decision
Use explicit opt-in flag (`globalThis.ALLPLAYS_ENABLE_AI_SUMMARY === true`) for `track.html` AI summary capability.

## Rationale
- Static-hosted app has no reliable server-side capability negotiation.
- Explicit opt-in prevents deterministic failures in non-billing environments.
- Minimal blast radius: only `track.html` AI button behavior changes.
