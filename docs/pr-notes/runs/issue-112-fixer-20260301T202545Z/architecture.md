# Architecture Role Notes (Fallback Synthesis)

Skill availability note: `allplays-orchestrator-playbook` and `allplays-architecture-expert` were requested but are not present in this session's available skill list. This document captures equivalent analysis.

## Root Cause
The calendar page expects `ev.isPractice` on ICS events. If that property is absent (undefined), ternary mapping defaults to game.

## Minimal Safe Fix
- Add shared helper `getCalendarEventType(event)` in `js/utils.js`.
- Helper derives `isPractice` as:
  - explicit boolean from `event.isPractice` if provided
  - otherwise `isPracticeEvent(event.summary || '')`
- Use helper in `calendar.html` ICS event mapping.

## Why This Path
- Reuses existing shared classifier behavior already used by `edit-schedule.html` and `parent-dashboard.html`.
- Limits change to one integration point and avoids broad parser refactors.
- Maintains backward compatibility with parser versions that already provide `isPractice`.

## Security/Controls
- No PHI or tenant boundary changes.
- No API surface or permission model impact.
