# Player/Team Matching Feed

## Introduction

ALL PLAYS families and coaches currently have no in-app way to find each other: a parent whose child needs a team, or a coach with open roster spots, has to rely on word of mouth or outside platforms. This feature adds **matching posts** to the existing social feed in the React app (`apps/app`): parents can post "player looking for a team" and team admins can post "team looking for players." Posts are structured (sport, age group, location, positions) so they can be browsed and filtered community-wide, and each post carries a clear respond path that leads to a conversation or a team signup link.

The feature builds on the existing social infrastructure — `socialPosts`, reactions, comments, reports, and moderation ([socialService.ts](../../apps/app/src/lib/socialService.ts), rules in `firestore.rules`) — and on public team discovery (`publicTeamsService.ts`). The key new capability is a **community visibility level**: matching posts are discoverable by signed-in users beyond the author's teams and friends, which requires new query paths, new security rules, and explicit safety constraints because most players are minors.

## User Stories

1. **As a parent**, I want to post on behalf of my child that they are looking for a team (sport, age group, area, positions) — with the post attributed to me, not the child — so that nearby coaches can find and contact me.
2. **As a team admin/owner**, I want to post that my team has open roster spots, so that interested families can find the team and start the signup process.
3. **As a parent browsing**, I want to filter matching posts by sport, age group, and location, so I only see relevant opportunities.
4. **As a team admin**, I want responses to my recruiting post to reach me in the app, so I can follow up without publishing my personal contact info.
5. **As a parent**, I want control over what identifying information about my child appears in a community-visible post, so my family's privacy is protected.
6. **As a post author**, I want to mark my post as filled/closed or have it expire automatically, so stale listings don't accumulate.
7. **As any user**, I want to report inappropriate matching posts, so admins can moderate the community space.
8. **As a global admin**, I want to review and remove matching posts, so the marketplace stays safe and useful.

## Functional Requirements (EARS)

### 1. Post creation

1.1. WHEN a signed-in user opens the social post composer, THE SYSTEM SHALL offer two new post presets: "Player looking for team" and "Team looking for players", alongside the existing presets in `socialPostPresets`.

1.2. WHEN a user selects "Team looking for players", THE SYSTEM SHALL require the user to select a team on which they are the owner or a team admin, and SHALL reject the post otherwise (client validation and Firestore rules).

1.3. WHEN a user selects "Player looking for team", THE SYSTEM SHALL frame the post as a parent/guardian posting on behalf of their child:
   - 1.3.1. THE SYSTEM SHALL let the parent select one of the players linked to their account (household/parent-linked players) to prefill first name and age group, OR enter a first name and age group manually when the child has no player record in the app yet.
   - 1.3.2. THE SYSTEM SHALL attribute the post to the parent as author ("Posted by [parent name]"), and SHALL NOT require a team association.
   - 1.3.3. WHEN a linked player is selected, THE SYSTEM SHALL copy only the allowed presentation fields (first name, age group) into the post and SHALL NOT reference or link to the player's team roster record or `/private/profile` data.

1.4. WHEN composing either matching post type, THE SYSTEM SHALL collect structured fields:
   - 1.4.1. Required: sport, age group (e.g., birth-year range or "U10"-style bracket), and location (city + state, or ZIP).
   - 1.4.2. Optional: positions/roles sought, skill/competition level, season/timeframe, free-text description.
   - 1.4.3. For team posts: number of open spots (optional) and an optional link to the team's existing signup/registration link.

1.5. WHEN a "player looking for team" post is created, THE SYSTEM SHALL identify the player by first name (or a parent-chosen display label) only, and SHALL NOT include the player's last name, birth date, photo, school, or any `/private/profile` data in the community-visible document.

1.6. WHEN a matching post is created, THE SYSTEM SHALL store it in the existing `socialPosts` collection with new `type` values (`player_seeking_team`, `team_seeking_players`), a new `visibility` value (`community`), and the structured fields under a dedicated `matching` map, with `status: 'open'` and an `expiresAt` timestamp.

1.7. WHEN a user attempts to attach media to a "player looking for team" post, THE SYSTEM SHALL NOT offer media upload for that post type. Team posts MAY include the team photo already stored on the team document.

### 2. Discovery and browsing

2.1. WHEN a signed-in user opens the feed, THE SYSTEM SHALL surface open matching posts relevant to the user (matching sport and/or location of their teams/players) merged into the existing home social feed.

2.2. THE SYSTEM SHALL provide a dedicated "Opportunities" (working title) browse view listing all open, non-hidden, non-expired matching posts, with filters for post type (players seeking / teams seeking), sport, age group, and location (state, city, or ZIP prefix), following the interaction patterns of `PublicTeamsBrowse`.

2.3. WHEN a matching post's `status` is not `open`, or `expiresAt` is in the past, or `hidden` is true, THE SYSTEM SHALL exclude it from feed and browse results.

2.4. WHILE a user is signed out, THE SYSTEM SHALL NOT expose matching posts (community visibility requires authentication; no anonymous/public-web access in this phase).

2.5. WHEN listing matching posts, THE SYSTEM SHALL order them by most recently created and SHALL paginate or cap result sets consistent with existing feed limits.

### 3. Responding to a post

3.1. WHEN a user views a "team looking for players" post, THE SYSTEM SHALL present a primary action that opens the team's public/signup path: the team's signup or registration link when configured, otherwise an in-app "I'm interested" response.

3.2. WHEN a user views a "player looking for team" post as a team owner/admin, THE SYSTEM SHALL present an "I'm interested" action that records a response and notifies the post author, including which team the responder represents.

3.3. WHEN a response is submitted, THE SYSTEM SHALL store it in a subcollection of the post (`socialPosts/{postId}/responses`) readable only by the post author, the responder, and global admins.

3.4. WHEN a response is created, THE SYSTEM SHALL notify the post author through the existing notification inbox (`notificationInboxService`) and, where enabled, push notification.

3.5. THE SYSTEM SHALL NOT reveal either party's email address or phone number in the post or the response; contact escalation happens through the author's follow-up (e.g., sharing the team signup link with the responder, or existing friendship/chat mechanisms).

3.6. WHEN the same user attempts to respond to the same post more than once, THE SYSTEM SHALL keep a single response per user per post (idempotent upsert).

3.7. WHEN a post author views their own post, THE SYSTEM SHALL show the list of responses with responder name, team (if any), and message, and allow the author to dismiss individual responses.

### 4. Post lifecycle

4.1. WHEN a post author marks a post "Filled" or "Closed", THE SYSTEM SHALL set `status` accordingly, remove the post from discovery immediately, and retain it for the author's own view.

4.2. WHEN a matching post is created, THE SYSTEM SHALL set `expiresAt` to a default of 60 days from creation; the author MAY shorten or extend it up to a maximum of 90 days.

4.3. WHEN a post author edits an open post, THE SYSTEM SHALL allow updates to the structured fields and description, consistent with the existing author-content-update rules for `socialPosts`.

4.4. WHEN a post expires, THE SYSTEM SHALL exclude it from all discovery queries (client-side filter on `expiresAt`; no server-side job required in this phase).

4.5. WHEN a post author deletes a post, THE SYSTEM SHALL delete it and stop showing its responses, consistent with existing `socialPosts` delete rules.

### 5. Safety, privacy, and moderation

5.1. THE SYSTEM SHALL enforce, in Firestore security rules, that community-visible matching posts contain only the allowed field set (no email, phone, birth date, or free-form contact fields), and that `type`/`visibility` combinations are valid (community visibility allowed only for the two matching post types).

5.2. WHEN any signed-in user reports a matching post, THE SYSTEM SHALL create a `socialReports` entry using the existing reporting flow.

5.3. WHEN a post accumulates 3 or more open reports, THE SYSTEM SHALL hide it from discovery pending admin review.

5.4. THE SYSTEM SHALL allow global admins to hide, close, or delete any matching post and to view all responses, consistent with the existing moderator rules for `socialPosts`.

5.5. WHEN composing a "player looking for team" post, THE SYSTEM SHALL display a privacy notice stating the post is visible to all ALL PLAYS users and reminding the author not to include contact details or identifying information in the free-text description.

5.6. WHEN a user has blocked another user via the existing `friendships` block mechanism, THE SYSTEM SHALL NOT deliver responses between those users and SHALL hide each party's matching posts from the other where feasible client-side.

5.7. THE SYSTEM SHALL NOT support comments or reactions on matching posts in this phase (respond-flow only), to keep the community surface low-risk.

### 6. Platform parity and quality

6.1. THE SYSTEM SHALL implement all feature logic in shared `apps/app/src/lib` services/logic modules so behavior is identical on web, iOS, and Android (no platform forks), per repo conventions.

6.2. THE SYSTEM SHALL include unit tests (Vitest) for the new logic module (post building/validation, filtering, lifecycle rules) and service module, plus focused smoke coverage for the new browse route.

6.3. WHEN Firestore rules change, THE SYSTEM SHALL include rules covering create/read/update/delete for community matching posts and responses, and composite indexes needed by the discovery queries (`firestore.indexes.json`).

6.4. WHEN discovery queries fail or time out, THE SYSTEM SHALL degrade gracefully (empty state with retry), following the existing `withTimeout` + logged-warning pattern in `socialService.ts`.

## Out of Scope (this phase)

- Anonymous/public-web (signed-out) visibility of matching posts.
- Automated matching/recommendation engine or scoring.
- In-app cross-team direct messaging (responses use the notification inbox, not a new DM system).
- Payments, tryout scheduling, or contract/commitment workflows.
- Server-side scheduled cleanup of expired posts.

## Success Criteria

- A parent can create a "player looking for team" post in under a minute with no PII beyond a first name and general location.
- A coach can create a "team looking for players" post tied to a team they administer, with a working signup-link respond path.
- Users can filter the opportunities view by sport + location and see only open, unexpired posts.
- Responses reach post authors via the notification inbox; no emails/phones are exposed anywhere in the flow.
- All new rules paths are exercised by tests; `npm test` and `npm run test:smoke` stay green.
