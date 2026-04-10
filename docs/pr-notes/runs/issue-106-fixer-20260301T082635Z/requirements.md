# Requirements Role Output (manual fallback)

## Context
- Requested skill `allplays-orchestrator-playbook` and role skills were not available in-session.
- Produced equivalent role analysis manually before implementation.

## User-visible problem
- While replay is actively playing, changing speed (1x -> 10x/20x) jumps timeline forward and skips events.

## Functional requirement
- Speed changes during active replay must only affect future progression rate from the current replay position.
- No immediate jump in replay clock/progress/feed when speed is changed mid-play.

## Acceptance criteria
- Replay clock remains continuous across speed change (no discontinuous jump at click time).
- Event consumption remains ordered and no immediate bulk skip caused by speed toggle alone.
- Existing pause/resume and scrub behavior remains unchanged.

## Constraints
- Minimal targeted patch in `live-game` replay flow only.
- Add regression tests covering speed-change continuity.
