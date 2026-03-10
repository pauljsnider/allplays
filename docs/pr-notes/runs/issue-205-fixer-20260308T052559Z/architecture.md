Decision: centralize sport-specific phase defaults behind a shared helper instead of duplicating `Q1` fallbacks across tracker and viewer modules.

Why this path:
- Lowest blast radius: touches only default-value resolution and leaves Firestore schema unchanged.
- Preserves backward compatibility for basketball.
- Creates a reusable adapter seam for later sport-specific tracker expansion.

Control points:
- Helper resolves sport from `game.sport`, `team.sport`, or `config.baseType`.
- Helper prefers explicit `config.periods[].label` values when available.
- Call sites use helper for reset event creation, reset payload creation, viewer reset state, replay bootstrap, and tracker initialization.

Conflict resolution:
- Requirements wanted sport-correct UX immediately.
- Code minimization favored a narrow patch.
- Chosen compromise: fix sport-specific phase defaults end-to-end now, defer deeper baseball situation state to a later change because it would require new UI, persistence, and event schemas.

Blast radius:
- Low. Changes are isolated to live-tracking helper flows and initialization logic.
- No auth, rules, or server-side surfaces changed.
