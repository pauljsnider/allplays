Objective: add a coach-facing lineup publish workflow in `game-day.html` with team notifications for game day.

Current state:
- Coaches can save draft lineups only.
- No persisted publish state, version, timestamp, or recipient metadata.
- No notification fanout when lineup changes are finalized.

Proposed state:
- `game.gamePlan` stores draft lineup plus publish metadata.
- Coaches can save a draft, publish the lineup, and return to draft mode for edits.
- Publishing creates a team notification artifact using existing team chat writes.

Risk surface and blast radius:
- Firestore writes on `teams/{teamId}/games/{gameId}` and `teams/{teamId}/chatMessages`.
- UI-only change in `game-day.html`; no server-side deployment dependency.
- Parent/player notification targeting is metadata-only in this patch; delivery channel is team chat.

Assumptions:
- Team chat is the existing in-app notification mechanism available to all relevant recipients.
- Persisting recipient metadata now is acceptable even if richer push/email delivery follows later.
- Draft edits after publish may require republishing before the latest lineup is considered final.

Recommendation:
- Use the smallest change that preserves controls: add publish metadata and emit a team chat notification on publish.
- Do not introduce Cloud Functions in this fix because the repo has no notification backend today.

Success measure:
- Coaches see explicit draft/publish controls.
- Publishing increments a version, records who/when, and writes a notification.
- Unit tests cover payload generation and page wiring.
