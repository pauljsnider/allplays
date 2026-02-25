# Player Data Security (Public vs Private Fields)

Firestore security rules are document-level: if a client can read a document, it can read *all fields* in that document.
This means we cannot “hide” sensitive fields inside a publicly-readable `players/{playerId}` document.

This spec defines a structure that keeps roster basics searchable while keeping sensitive info restricted.

## Current Paths

- Player public doc (today):
  - `teams/{teamId}/players/{playerId}`
- Player stats (per-game):
  - `teams/{teamId}/games/{gameId}/aggregatedStats/{playerId}`
  - `teams/{teamId}/games/{gameId}/events/{eventId}`

## Proposed Player Data Structure

### Public Player Doc (Searchable)

Path:

- `teams/{teamId}/players/{playerId}`

Recommended fields:

- `name` (string)
- `number` (string or number)
- `photoUrl` (string | null)
- `position` (string | null) (optional; safe if you want it public)
- `createdAt`, `updatedAt` (timestamps)

This document may be readable broadly (even publicly) if the product requires it, but it must not contain sensitive data.

### Private Player Profile (Sensitive)

Path:

- `teams/{teamId}/players/{playerId}/private/profile`

Recommended fields:

- `emergencyContact: { name, phone }`
- `medicalInfo` (string)
- (future) `address`, `dob`, etc.
- `updatedAt` (timestamp)

## Access Model (Intended)

### Read Access

- Coaches/admins for the team: can read private profile.
- The linked parent for that player: can read private profile.
- Others (including other parents on the same team): cannot read private profile.

### Write Access

- Coaches/admins: can update both public and private fields.
- Linked parent: can update only the private profile (and only for their linked player).
- No one else can update.

## Firestore Rules Outline (Conceptual)

Public player doc (example options):

- If you want roster to be public: `allow read: if true;`
- If you want roster gated: `allow read: if isSignedIn() && (isTeamOwnerOrAdmin(teamId) || isParentForTeam(teamId));`

Private player profile doc:

- `allow read: if isTeamOwnerOrAdmin(teamId) || isParentForPlayer(teamId, playerId);`
- `allow update: if isTeamOwnerOrAdmin(teamId) || (isParentForPlayer(teamId, playerId) && onlyTouchesPrivateFields);`

Important: `isParentForPlayer(teamId, playerId)` must validate *both* team and player, ideally via a `users/{uid}.parentOf[]`
list that includes `{ teamId, playerId }`. Checking only `parentTeamIds` is too broad.

See also: `spec/parent-update-security-bug.md`.

## Global Search Implications

Global search should only query the **public** player docs.

Options:

1. Team-scoped search only (simplest privacy):
   - Search within a team page (query `teams/{teamId}/players`)
2. Cross-team search (requires deliberate privacy posture):
   - Either allow collection-group read of public player docs, or
   - Maintain a dedicated `playerSearchIndex` collection that contains only safe fields
     (`name`, `number`, `teamId`, `playerId`, `photoUrl`) and query that.

Do not put sensitive fields in any document that is readable for search.

## Migration Plan (No Duplication)

Goal: move sensitive fields out of the public player doc into the private subcollection.

1. Update UI code:
   - `player.html` reads/writes `teams/{teamId}/players/{playerId}/private/profile` for sensitive fields.
2. Backfill existing data:
   - One-time script (admin-only) reads each player doc and, if `emergencyContact` / `medicalInfo` exist,
     writes them to `private/profile` then deletes those fields from the public doc.
3. Tighten rules:
   - Ensure private profile is restricted.
   - Optionally reconsider whether public player docs should remain publicly readable.

## What Should Never Be Public

- `medicalInfo`
- `emergencyContact`
- Addresses, DOB, phone numbers, emails

