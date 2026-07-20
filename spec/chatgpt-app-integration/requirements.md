# ChatGPT App Integration

## Introduction

Extend AllPlays into ChatGPT as a conversational command interface for parents and coaches. AllPlays remains the system of record for teams, schedules, players, permissions, and actions; ChatGPT provides natural-language reasoning and synthesis. The integration is a remote Model Context Protocol (MCP) service exposing a narrow, permission-aware tool set — not a reproduction of the full AllPlays app.

Source: `AllPlays_ChatGPT_App_Integration_Plan.docx` (Draft 1.0, July 19, 2026).

## User Stories

1. As a **parent**, I want to ask "What does my family have this weekend?" and receive a correct, permission-filtered schedule for my linked players, with deep links into AllPlays.
2. As a **parent**, I want to see which upcoming events still need my RSVP.
3. As a **coach**, I want a summary of a completed game (score, summary, player statistics) for teams I own or administer.
4. As a **user**, I want the assistant to know which teams I belong to and in what role, without ever seeing another team's data.
5. (Later phase) As a **parent**, I want to update a linked player's RSVP conversationally after confirmation.
6. (Later phase) As a **coach**, I want to generate, revise, and save a practice plan.

## Requirements (EARS)

### 1. MCP service foundation
1.1. The system SHALL expose a remote MCP service over Streamable HTTP suitable for ChatGPT Developer Mode connection.
1.2. The MVP SHALL expose read-only tools: `list_my_teams`, `get_family_schedule`, `get_game_summary`.
1.3. WHEN a tool is invoked without valid authentication, the service SHALL reject the request with an authorization error.
1.4. Tools SHALL return structured domain data, not prewritten prose; ChatGPT performs synthesis.

### 2. Identity and authorization
2.1. The service SHALL derive user identity exclusively from the verified bearer token, never from tool arguments.
2.2. A Firebase UID, team ID, player ID, or role supplied by ChatGPT SHALL never be trusted by itself; the service SHALL independently enforce current Firestore membership (owner via `teams/{id}.ownerId`, admin via `teams/{id}.adminEmails[]`, parent via `users/{uid}.parentOf[]`).
2.3. WHEN a user requests data for a team they are not a member of, the service SHALL return a permission-denied error and no data.
2.4. Production authentication SHALL use OAuth (authorization code + PKCE) mapped to a Firebase UID; the development spike MAY use the user's Firebase refresh token (exchanged server-side for an ID token) or a raw ID token as the bearer. All data access SHALL be performed with the user's own credential so Firestore security rules enforce authorization identically to the AllPlays clients.

### 3. Family schedule
3.1. `get_family_schedule` SHALL return games and practices in a requested date range (default: next 7 days) for every team the user is authorized on.
3.2. For parent-linked teams, each event SHALL include the user's own RSVP state for linked players.
3.3. Events SHALL include only whitelisted fields (type, date, opponent, location, notes, RSVP summary) plus a validated deep link.

### 4. Game summary
4.1. `get_game_summary` SHALL verify team membership before returning any data.
4.2. The response SHALL include only whitelisted game fields (score, status, summary, opponent, date, location) and aggregated player statistics; private player data SHALL never be returned.

### 5. Privacy and youth data
5.1. The service SHALL return the minimum data needed for the workflow; birth dates, contact details, medical notes, and private RSVP notes SHALL never be returned.
5.2. Private rosters, notes, schedules, or locations SHALL never cross team boundaries.
5.3. Retrieved user content (messages, notes, drill descriptions) SHALL be treated as untrusted data, never as instructions.

### 6. Write actions (later phase, out of MVP scope)
6.1. Initial writes SHALL be limited to `set_player_rsvp` and `save_practice_plan`, each requiring user confirmation, idempotency, and an audit event.

## Success Criteria

- End-to-end connection works in ChatGPT Developer Mode against a dev deployment.
- Authorization-denial correctness: cross-team and cross-role requests are refused in automated tests.
- First milestone: a connected account asks "What does my family have this weekend?" and receives a correct, permission-filtered schedule with deep links.
