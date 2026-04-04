# Requirements Role (fallback synthesis)

## Objective
Add regression coverage for the homepage `Recent Replays` section so a public visitor reliably sees replay cards when data exists and clear fallback text when it does not.

## Current vs Proposed
- Current: Homepage unit coverage proves the shell loads and that replay links exist, but it does not explicitly validate replay card content, exact replay URL parameters, or the empty-state copy.
- Proposed: Add targeted assertions for replay team/opponent/score/date/link rendering and for the two replay fallbacks: empty result and query failure.

## Acceptance Criteria
1. When a completed game is returned, `#past-games-list` replaces `Loading replays...` with a replay card showing team name, opponent, final score, date text, and a replay URL containing `live-game.html`, `teamId`, `gameId`, and `replay=true`.
2. When no replay games are returned, the homepage shows `No recent replays available`.
3. When the replay query throws, the homepage shows `Unable to load replays`.

## Risks
- Low blast radius. The change is limited to homepage replay rendering and its tests.
- Main regression risk is altering homepage placeholder or fallback copy unexpectedly.
