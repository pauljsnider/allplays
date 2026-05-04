# Requirements

## Acceptance criteria
- Recap highlight clips with no source timing preserve `startMs: null` and `endMs: null`.
- Untimed recap clips do not render as synthetic `0:00 - 1:00` clips.
- Timed recap clips with valid bounds keep their authored timing.
- Metadata, players, period, game time, ordering, and explicit/fallback video URLs remain intact.

## Edge cases
- A legitimate `startMs: 0` with valid `endMs` remains timed.
- Metadata-only clips with explicit `videoUrl` remain visible without timing.
- Metadata-only clips using replay fallback URL remain visible without timing.
- Invalid or absent source timing must not become `0/60000`.
