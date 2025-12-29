# Parent Role Design

## Current Roles & Flows
- Public/unauthenticated: read-only public teams/games/players.
- Coach: team owner or listed in `teams.adminEmails`; can manage teams/roster/games.
- Global admin: `users.isAdmin == true`; full access via UI + Firestore rules.
- Signup gated by access codes; profiles live in `users/{uid}`; `isAdmin` checked in `js/auth.js`, `js/utils.js`, roster/config/schedule pages.

## New Parent Model
- `users/{uid}`: add `roles: ['parent'] | ['coach'] | ['admin']` (keep `isAdmin` for backward compatibility), `parentOf: [{ teamId, playerId, playerName, teamName }]`.
- `teams/{teamId}/players/{playerId}`: add `parents: [{ userId, email, relation, status: 'pending'|'active', addedBy }]`.
- `accessCodes/{id}`: add `role: 'coach'|'parent'`, `teamId`, `playerId`, `playerName`, `expiresAt`; parent signup must validate these.
- Optional: `teams/{teamId}/parentLinks/{uid} -> { playerId }` for fast lookup if needed; `parentOf` is usually enough.

## Firestore Rules
- Helpers: `isCoach(teamId)`, `isParent(teamId, playerId) = isSignedIn() && get(/teams/$(teamId)/players/$(playerId)).data.parents.where(p => p.userId == request.auth.uid && p.status == 'active').size() > 0`.
- Users: parent can read/write own profile; admin full.
- Teams: public read; write stays owner/admin/global admin.
- Players: `read` allow owner/admin/global admin/parent of that player; `write` remains owner/admin/global admin (parents read-only).
- Games/Events/AggregatedStats: `read` allow parents of any rostered player in team; `write` unchanged (coach/admin only).
- Access codes: when `role == 'parent'`, create allowed for coach/admin of team; validation ensures role/player/team match; mark used sets `usedBy`.

## Auth & Header
- `js/auth.js`: load profile `roles`; default `['coach']`; set `user.roles`; preserve `isAdmin` flag. After login/signup, if parent-only redirect to parent dashboard.
- `js/utils.js` header: when parent-only, CTA becomes "My Player" (parent dashboard) and hides "Create Team".

## DB API Additions (`js/db.js`)
- `addParentInvite(teamId, playerId, parentEmail, relation)`: create parent access code + pending parent entry on player.
- `acceptParentInvite(userId, code)`: on signup/login with parent code, set `parentOf` in user doc and flip player parent entry to `active`.
- `getParentPlayers(userId)`: return `parentOf` with hydrated team/player display data.
- `validateAccessCode` returns role/teamId/playerId/playerName; `markAccessCodeAsUsed` sets `usedBy`.

## UI/Flows
- Invite: `edit-roster.html` adds "Invite Parent" per player; coach enters email + relation; show code to share/copy; display parent connections with status badges.
- Add player: optional parent email field on the single-player form; store as pending parent entry (no invite required). If provided, coach can still send/trigger an invite later.
- Bulk AI/image upload: allow optional parent email in parsed rows (e.g. `#12 Sarah Jones G parent:sarah@example.com` or `Sarah Jones - 12 (parent sarah@example.com)`); if missing, leave blank.
- Signup/Login: `login.html` surfaces code role/team/player; parent signup requires code; on success go to parent dashboard.
- Parent dashboard (new `parent-dashboard.html` + `js/parent.js`): list linked players with photo/number/team; quick links to latest game recap, player stats, team schedule; all read-only.
- My Teams (`dashboard.html`): parent-linked teams show a single "View" action; all other actions hidden.
- Existing pages (`player.html`, `team.html`, `game.html`): hide edit controls for parent-only; ensure data fetch works with new read rules.
- Admin: `admin.html` users table shows `roles` and parent link counts; coach dashboard may flag players with active parent connections.

## Migration
- One-time backfill: set `roles:['coach']` for existing users; `roles:['coach','admin']` when `isAdmin == true`.
- Existing access codes default to `role:'coach'` if role missing.

## Testing Ideas
- Parent signup with valid/invalid code; cannot sign up without code.
- Parent login sees only linked player(s); no edit buttons; Firestore rejects writes.
- Parent My Teams view shows one action button per team card.
- Coach invites parent; status flips pending->active after signup.
- Admin can still access everything; public viewer still reads public data.
