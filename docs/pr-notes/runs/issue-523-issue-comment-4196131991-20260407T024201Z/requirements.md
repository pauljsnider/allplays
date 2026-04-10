## Objective
Define deterministic, branch-safe schedule-card coverage in `team.html` for the agreed db-backed states: cancelled, upcoming, live, completed-report, and completed-replay. The immediate fix must make future cancelled games fail closed so they never surface as actionable upcoming games.

## Acceptance Criteria
1. Cancelled future db games render cancelled treatment and do not render `Upcoming`, `Live Now`, `View Live`, or live-share CTAs.
2. Cancelled future db games are excluded from next-game selection and upcoming surfaces.
3. Upcoming scheduled db games render `Upcoming` and retain the live-view/share CTA path.
4. Live db games render the live badge, score block, and live URL.
5. Completed db games render report access, with replay shown only when the replay-ready signal is present.
6. Deterministic unit coverage exists for the five-state matrix in `renderDbGame()` plus the normalized event shape that drives selection.
7. Completed tie behavior remains valid as a completed-state variant.

## Non-Goals
- Building crawler-driven state discovery in this change.
- Redesigning schedule-card layout or copy beyond the state fix.
- Reworking unrelated calendar or practice flows.

## Open Questions
- Whether tied completed games should become an explicit sixth matrix state.
- Whether replay readiness should stay tied to `liveStatus === 'completed'` or move to a dedicated replay flag.
- Whether cancelled games should remain visible in future views as non-actionable items long term.
