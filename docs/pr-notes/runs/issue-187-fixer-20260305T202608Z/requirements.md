# Requirements Role (allplays-requirements-expert equivalent fallback)

Requested skills (`allplays-orchestrator-playbook`, `allplays-requirements-expert`) and `sessions_spawn` are unavailable in this runtime. This file captures equivalent role analysis.

## Objective
Ship mobile push notifications with per-team category preferences for live chat, live score updates, and schedule changes.

## Users and Decisions
- Parent/guardian/member decides notification categories per team.
- User decides whether to enable browser push permission on this device.

## Must-have UX
- In-app settings page supports per-team toggles for:
  - Live chat
  - Live score
  - Schedule changes
- User can explicitly enable push on the current device and persist token registration.
- Notifications deep-link to relevant page:
  - Team chat -> `team-chat.html?teamId=...`
  - Live score -> `live-game.html?teamId=...&gameId=...`
  - Schedule -> `team.html?teamId=...`

## Safety/controls
- Per-user preference ownership only.
- Device tokens stored under authenticated user scope.
- Multi-tenant blast radius limited to team membership checks at dispatch.
- Trigger dedupe/basic filters to avoid noisy sends for self-authored chat.

## Success metrics
- Preference docs present per team for opted-in users.
- Push token saved for opted-in device.
- Trigger emits send attempts only to users with matching category enabled.
- Manual verification confirms deep links and category filtering behavior.
