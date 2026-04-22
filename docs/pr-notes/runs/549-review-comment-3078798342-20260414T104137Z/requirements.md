## Objective
Allow team admins to reset the team stats setup when a config is only referenced by past, finalized games, while still blocking reset when any config is attached to an upcoming, live, or otherwise active scheduled/shared game.

## Acceptance Criteria
1. Reset is blocked if any team stat config is assigned to a game that is still active, such as scheduled, live, in progress, or otherwise not finalized.
2. Reset is allowed when the only remaining references are finalized games, such as completed or cancelled games.
3. Shared games continue to block reset while they are active or upcoming for the affected teams.
4. Reset remains schema-only. It deletes `statTrackerConfigs` only and does not delete or mutate games, events, aggregated stats, live events, chat, or replay data.
5. Historical completed game views continue to render after reset, even if the original config document no longer exists.
6. When reset is blocked, the user sees a clear message telling them to remove active game assignments first.

## User/Coach/Parent Impact
- **Coach/Admin:** Can reset stats setup after a season without being blocked by historical completed games, while still being protected from breaking future or live workflows.
- **Parent:** No direct workflow change, but completed game reports and replays must remain readable after reset.
- **Overall UX:** Reset behavior now matches the existing user-facing message more closely and removes false blocks from historical data.

## Risks
- Historical screens that still look up config metadata by `statTrackerConfigId` could lose labels or layout hints if fallback behavior is incomplete.
- The phrase `scheduled or shared games` is slightly ambiguous if product intent were to treat all shared games as blocking regardless of status.
- Narrowing reset without touching `deleteConfig` leaves different guard behavior between reset and single-config deletion.

## Recommendation
Apply the smallest safe change in `resetTeamStatConfigs`: ignore finalized local game references and continue blocking on active/upcoming local assignments plus shared-game assignments. Validate that completed-game history still renders after reset and keep the scope limited to the reset workflow for this PR.
