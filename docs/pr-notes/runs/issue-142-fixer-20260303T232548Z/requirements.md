# Requirements Role Synthesis (Fallback)

## Note on orchestration tooling
Requested skills (`allplays-orchestrator-playbook`, `allplays-requirements-expert`) and `sessions_spawn` are not available in this environment. This artifact captures equivalent requirements analysis.

## Objective
Ensure replay speed changes during active playback preserve current replay timestamp and only affect future time progression.

## Current vs proposed behavior
- Current risk pattern: speed changes can retroactively rescale elapsed time base and jump the clock.
- Proposed behavior: at speed change instant, replay clock remains continuous; only slope changes after that instant.

## User-facing acceptance criteria
1. While replay is playing, switching from 1x to 4x at ~10s keeps clock near ~10s immediately after click.
2. Events/chat/reactions between 10s and 40s are not skipped due solely to speed change.
3. Progress bar and displayed clock stay monotonic and continuous at speed switch boundary.

## Risk surface and blast radius
- Surface: replay timing math and speed control handler.
- Blast radius: completed-game replay only; no live-tracking write paths.

## Assumptions
- Replay event ordering is already sorted by `gameClockMs`.
- Replay speed changes occur on UI thread via speed buttons.
