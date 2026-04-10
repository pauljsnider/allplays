## Minimal Patch
- Normalize `status` and `liveStatus` case-insensitively in `renderDbGame()`.
- Treat `status === cancelled` as fail-closed so cancelled future games never render upcoming/live CTAs.
- Preserve CTA-driving DB fields in `getAllEvents()`: `id`, `gameId`, `liveStatus`, `isHome`, `kitColor`, `arrivalTime`, `notes`, `assignments`, `rsvpSummary`, and derived `isCancelled`.
- Exclude cancelled events from `getNextGame()`.

## Test Additions
- `tests/unit/team-schedule-card-render.test.js`
  - cancelled future
  - upcoming scheduled
  - live
  - completed report vs replay
  - completed tie
- `tests/unit/team-schedule-events.test.js`
  - DB event normalization preserves CTA-driving fields
  - cancelled future events are skipped for next-game selection

## Validation Commands
```bash
cd /home/paul-bot1/.openclaw/workspace/worktrees/issue-523-20260407T013700Z
pnpm dlx vitest@4.0.18 run tests/unit/team-schedule-card-render.test.js tests/unit/team-schedule-events.test.js
pnpm dlx vitest@4.0.18 run tests/unit
```

## Risks
- Replay gating still depends on the current replay-ready signal convention.
- Mixed-case values outside the normalized paths could still be inconsistent elsewhere.
- This patch adds regression coverage but not browser-level integration coverage.
