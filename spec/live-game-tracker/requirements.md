# Live Game Tracker Feature Requirements

## Introduction

Add a live game broadcasting feature that allows fans and spectators to watch basketball games unfold in real-time from anywhere. The feature provides a sports broadcast-style experience with live score updates, play-by-play feed, player stats, interactive chat, and emoji reactions.

The feature consists of two main components:
1. **Live Tracker** - A new tracker option for stat keepers that passively broadcasts events to the database in real-time while maintaining the same local-first reliability as the current tracker.
2. **Live Viewer** - A public-facing spectator page with a slick, mobile-first UI that receives real-time updates and provides an engaging viewing experience.

Additionally, a replay mode allows users to re-watch completed games with a simulated clock at variable speeds (1-4x).

## User Stories

### US-1: Fan watches game live
As a fan, I want to watch a basketball game unfold in real-time so that I can follow my team's performance when I can't be at the game in person.

### US-2: Fan sees play-by-play updates
As a fan, I want to see each play as it happens (scores, rebounds, assists, etc.) so that I can understand the flow and momentum of the game.

### US-3: Fan views live stats
As a fan, I want to see player statistics update in real-time so that I can track individual performances throughout the game.

### US-4: Fan chats with other viewers
As a fan, I want to chat with other people watching the game so that I can share the excitement and discuss what's happening.

### US-5: Fan uses AI assistant in chat
As a fan, I want to ask @ALL PLAYS questions about the game so that I can get stats, player info, or play-by-play summaries.

### US-6: Fan reacts to plays
As a fan, I want to send emoji reactions when exciting plays happen so that I can express my emotions and see others' reactions.

### US-7: Fan discovers upcoming games
As a visitor to the site, I want to see upcoming live games so that I can find games to watch.

### US-8: Parent shares game link
As a parent, I want to share a link to the live game so that friends and family can watch remotely.

### US-9: Coach uses live tracker
As a coach/stat keeper, I want to use the live tracker so that fans can watch the game while I track stats with the same reliability as before.

### US-14: Stat keeper sees fan chat
As a stat keeper, I want to see the fan chat while tracking so that I can see what viewers are saying and feel connected to the audience.

### US-15: Stat keeper responds in chat
As a stat keeper, I want to respond to fan messages so that I can answer questions or share insights during the game.

### US-10: Fan replays completed game
As a fan, I want to replay a completed game with a simulated clock so that I can experience the game as if watching it live.

### US-11: Fan adjusts replay speed
As a fan, I want to adjust replay speed (1x, 2x, 3x, 4x) so that I can watch quickly or at normal pace.

### US-12: Fan sees chat history during replay
As a fan watching a replay, I want to see chat messages appear at the times they were originally sent so that I get the full experience of the live broadcast.

### US-13: Anonymous fan joins chat
As an anonymous visitor, I want to participate in chat without creating an account so that I can engage with minimal friction.

### US-16: Fan finds replay from game report
As a fan, I want to watch a replay from the game report page so that I can relive an exciting game I missed.

### US-17: Fan discovers past games on homepage
As a visitor, I want to see recent completed games on the homepage so that I can watch replays of games I missed.

### US-18: Coach finds replay from schedule
As a coach, I want to access game replays from the edit schedule page so that I can review games with my team.

## Requirements (EARS Format)

### 1. Live Tracker (Stat Keeper Experience)

#### 1.1 Tracker Selection
1.1.1 When a user clicks "Track" on a game, the system shall display the existing tracker options plus a new "Live Tracker" option.

1.1.2 The Live Tracker option shall be visually distinct and indicate that it broadcasts the game publicly.

1.1.3 The system shall only show the Live Tracker option for basketball games initially.

#### 1.2 Live Tracker Behavior
1.2.1 The Live Tracker shall be based on the existing basketball tracker (track-basketball.html/js) with identical stat tracking functionality.

1.2.2 When a stat event occurs (score, rebound, assist, etc.), the system shall write the event to Firestore in a fire-and-forget manner (non-blocking).

1.2.3 The Live Tracker shall continue to maintain all local state (stats, log, undo history) exactly as the current tracker does.

1.2.4 If a Firestore write fails, the system shall log the error locally but NOT interrupt the tracker UI or alert the user.

1.2.5 The system shall retry failed event writes in the background with exponential backoff.

1.2.6 The Live Tracker shall still perform a batch save on "Save & Complete" as the current tracker does.

1.2.7 The Live Tracker shall write events to a subcollection: `teams/{teamId}/games/{gameId}/liveEvents/{eventId}`.

#### 1.3 Live Event Data Model
1.3.1 Each live event document shall include:
- `type`: string (score, rebound, assist, steal, turnover, foul, substitution, period_start, period_end, timeout, etc.)
- `playerId`: string (player who performed the action, if applicable)
- `playerName`: string (cached for display)
- `playerNumber`: string (cached for display)
- `statKey`: string (pts, reb, ast, stl, to, fouls, etc.)
- `value`: number (the delta, e.g., +2 for a 2-pointer)
- `period`: string (Q1, Q2, Q3, Q4, OT)
- `gameClockMs`: number (milliseconds elapsed in game)
- `homeScore`: number (running home score after this event)
- `awayScore`: number (running away score after this event)
- `isOpponent`: boolean (true if opponent player)
- `opponentPlayerName`: string (if isOpponent)
- `description`: string (human-readable event text, e.g., "#23 John Smith 2pt shot")
- `createdAt`: Firestore timestamp
- `createdBy`: string (uid of stat keeper)

#### 1.4 Game Live Status
1.4.1 When the Live Tracker starts, the system shall update the game document with `liveStatus: 'live'`.

1.4.2 When the Live Tracker completes (Save & Complete), the system shall update the game document with `liveStatus: 'completed'`.

1.4.3 If the Live Tracker is closed without completing, the game document shall retain `liveStatus: 'live'` until manually changed or completed.

1.4.4 The game document shall include `liveStartedAt` timestamp when going live.

1.4.5 The game document shall include `liveViewerCount` field updated periodically (see Viewer section).

#### 1.5 Tracker Chat Panel
1.5.1 The Live Tracker shall display a collapsible chat panel at the bottom of the screen.

1.5.2 The chat panel shall show real-time messages from the game's live chat (same data as viewer chat).

1.5.3 The chat panel shall display a badge/indicator showing unread message count when collapsed.

1.5.4 The chat panel shall subscribe to the `liveChat` subcollection via Firestore onSnapshot.

1.5.5 The stat keeper shall be able to send messages as their authenticated user (display name and photo).

1.5.6 The chat panel shall be minimal/unobtrusive to avoid interfering with stat tracking.

1.5.7 The chat panel shall NOT include @ALL PLAYS AI functionality (keep it simple for the tracker).

1.5.8 The chat panel shall display the current viewer count.

1.5.9 New messages shall show a subtle notification (visual or sound toggle) to alert the stat keeper.

1.5.10 The stat keeper shall be able to fully collapse/hide the chat panel if desired.

### 2. Live Viewer (Spectator Experience)

#### 2.1 Access & Navigation
2.1.1 The Live Viewer page (live-game.html) shall be publicly accessible without authentication.

2.1.2 The system shall accept a game URL in the format: `/live-game.html?gameId={gameId}&teamId={teamId}`.

2.1.3 The system shall display the team name, team logo, opponent name, and game date in the header.

2.1.4 The system shall display a "Game Not Live" state if the game has not started broadcasting.

2.1.5 The system shall display a "Game Ended" state with option to replay if the game is completed.

#### 2.2 Scoreboard Display
2.2.1 The system shall display a prominent scoreboard showing home team score and away team score.

2.2.2 The scoreboard shall display the current period (Q1, Q2, Q3, Q4, OT).

2.2.3 The scoreboard shall display the game clock (time elapsed or remaining based on configuration).

2.2.4 The scoreboard shall update in real-time as score events arrive (via Firestore onSnapshot).

2.2.5 When a score changes, the system shall animate the score update (e.g., pulse, highlight, scale effect).

#### 2.3 Play-by-Play Feed
2.3.1 The system shall display a scrolling play-by-play feed showing events as they happen.

2.3.2 Each play-by-play entry shall display: timestamp, player info (name/number), and event description.

2.3.3 New events shall animate into the feed (e.g., slide in from top or bottom).

2.3.4 The system shall visually distinguish different event types (scores highlighted more prominently than other stats).

2.3.5 Scoring plays shall display the point value (+1, +2, +3) with visual emphasis.

2.3.6 The play-by-play feed shall auto-scroll to show new events unless the user has scrolled up to view history.

#### 2.4 Live Stats Display
2.4.1 The system shall display a stats panel showing player statistics for the home team.

2.4.2 Stats shall include all tracked categories (points, rebounds, assists, steals, turnovers, fouls, etc.).

2.4.3 Stats shall update in real-time as events arrive.

2.4.4 The system shall highlight stat changes briefly when they update (e.g., flash or pulse animation).

2.4.5 The system shall display opponent stats in a separate, collapsible section.

2.4.6 The system shall sort players by a primary stat (default: points) with option to change sort.

#### 2.5 Visual Effects & Engagement
2.5.1 When a scoring event arrives, the system shall display a brief celebration animation (e.g., points floating up, brief screen flash).

2.5.2 For 3-point shots, the system shall display an enhanced celebration effect.

2.5.3 The system shall display momentum indicators when a team goes on a scoring run (e.g., "5-0 Run!").

2.5.4 The system shall display the current viewer count.

2.5.5 The UI shall have a sports broadcast aesthetic (bold typography, team colors where available, clean layout).

#### 2.6 Viewer Presence
2.6.1 When a viewer opens the live game page, the system shall increment the viewer count.

2.6.2 When a viewer closes the page or navigates away, the system shall decrement the viewer count.

2.6.3 The system shall use Firestore presence or a lightweight polling mechanism to track viewers.

2.6.4 The viewer count shall be displayed to both viewers and the stat keeper.

### 3. Live Chat

#### 3.1 Chat Display
3.1.1 The Live Viewer page shall include a chat panel alongside the game view.

3.1.2 On mobile, the chat shall be accessible via a toggle/tab (e.g., swipe or button to switch between game view and chat).

3.1.3 The chat shall display message history from the current game session.

3.1.4 New chat messages shall appear in real-time via Firestore onSnapshot.

3.1.5 The chat shall auto-scroll to new messages unless the user has scrolled up.

#### 3.2 Chat Participation
3.2.1 Authenticated users shall be able to send messages with their display name shown.

3.2.2 Unauthenticated users shall be able to send messages as anonymous fans.

3.2.3 For anonymous users, the system shall generate a display name in the format "Fan" + random 4-digit number (e.g., "Fan1234").

3.2.4 The anonymous fan identifier shall persist for the session (same tab/browser session).

3.2.5 Anonymous users may optionally enter a custom display name via a prompt or settings.

#### 3.3 AI Assistant Integration
3.3.1 Users shall be able to mention @ALL PLAYS in chat to ask questions.

3.3.2 The AI assistant shall have access to:
- Current game stats (live aggregated data)
- Play-by-play events from the current game
- Team roster information
- Historical team stats (same as team chat)

3.3.3 The AI response shall appear as a chat message attributed to "ALL PLAYS".

3.3.4 The system shall display a "thinking" indicator while the AI generates a response.

#### 3.4 Chat Data Model
3.4.1 Chat messages shall be stored in: `teams/{teamId}/games/{gameId}/liveChat/{messageId}`.

3.4.2 Each chat message document shall include:
- `text`: string
- `senderId`: string (uid or null for anonymous)
- `senderName`: string (display name or "FanXXXX")
- `senderPhotoUrl`: string (if authenticated user has photo)
- `isAnonymous`: boolean
- `createdAt`: Firestore timestamp
- `ai`: boolean (true if AI response)
- `aiQuestion`: string (the question asked, if AI response)

### 4. Reactions

#### 4.1 Reaction Types
4.1.1 The system shall support the following reaction emojis: Fire, Clap, Wow/Shocked, Heart, 100/Perfect.

4.1.2 The reaction UI shall display reaction buttons prominently and easily tappable on mobile.

#### 4.2 Reaction Broadcasting
4.2.1 When a user sends a reaction, it shall appear on ALL viewers' screens (broadcast to everyone).

4.2.2 Reactions shall animate across the screen (e.g., float up from bottom, fade out).

4.2.3 Multiple simultaneous reactions shall display together without overlapping awkwardly.

4.2.4 The system shall rate-limit reactions per user to prevent spam (e.g., max 1 reaction per second per user).

#### 4.3 Reaction Data
4.3.1 Reactions shall be stored temporarily in Firestore or handled via a real-time mechanism.

4.3.2 Reactions do NOT need to persist permanently - they are ephemeral during live viewing.

4.3.3 For replay mode, reactions shall be stored with timestamps so they can be replayed.

### 5. Replay Mode

#### 5.1 Replay Access
5.1.1 For completed games with live event data (`liveStatus: 'completed'`), the system shall offer a "Watch Replay" option.

5.1.2 The replay shall use the same Live Viewer UI with additional replay controls.

5.1.3 Replay shall ONLY be available for games tracked with the Live Tracker (not standard trackers).

5.1.4 The "Watch Replay" option shall be available from the following locations:
- Game report page (`game.html`)
- Team schedule on `team.html`
- Edit schedule page (`edit-schedule.html`)
- Past games section on homepage (`index.html`)

#### 5.2 Replay Controls
5.2.1 The system shall provide a play/pause button for the replay.

5.2.2 The system shall provide speed controls: 1x, 2x, 3x, 4x.

5.2.3 The system shall display a progress bar showing current position in the game.

5.2.4 The user shall be able to seek to any point in the game via the progress bar.

#### 5.3 Replay Simulation
5.3.1 The replay shall simulate a game clock that advances according to the selected speed.

5.3.2 Events shall appear in the play-by-play feed at their original game clock times.

5.3.3 The scoreboard shall update as events are "replayed" showing the score progression.

5.3.4 Stats shall accumulate as the replay progresses.

5.3.5 Chat messages from the original broadcast shall appear at their original timestamps during replay.

5.3.6 Stored reactions shall animate at their original timestamps during replay.

### 6. Game Discovery & Replay Access

#### 6.1 Edit Schedule Page (Admin/Coach)
6.1.1 On the edit schedule page, for games that are live or upcoming, the system shall display a "Live Game Link" that can be copied/shared.

6.1.2 The link shall be in a shareable format (e.g., short URL or QR code option).

6.1.3 For completed live-tracked games (`liveStatus: 'completed'`), the system shall display a "Watch Replay" button.

6.1.4 The "Watch Replay" button shall navigate to the Live Viewer page in replay mode.

#### 6.2 Team Schedule (Team Members)
6.2.1 On the team schedule page, games that are currently live shall display a "Watch Live" indicator/button.

6.2.2 The indicator shall be visually prominent (e.g., pulsing red dot, "LIVE" badge).

6.2.3 Clicking the indicator shall navigate to the Live Viewer page.

6.2.4 For completed live-tracked games, the game card shall display a "Watch Replay" link.

6.2.5 The "Watch Replay" link shall be visually distinct from the "View Report" link.

#### 6.3 Upcoming & Live Games (Main Site)
6.3.1 The main site shall include an "Upcoming Live Games" section.

6.3.2 This section shall display all public games scheduled within the next 7 days that have live tracking enabled.

6.3.3 Each game listing shall show: team name, opponent, date/time, and a "Watch" link.

6.3.4 Games currently live shall appear at the top with a "LIVE NOW" indicator.

6.3.5 The system shall only show games from teams that have opted into public visibility.

#### 6.4 Past Games / Replays (Main Site)
6.4.1 The main site shall include a "Recent Replays" or "Past Games" section.

6.4.2 This section shall display recently completed live-tracked games (within the last 7 days).

6.4.3 Each past game listing shall show: team name, opponent, final score, date, and a "Watch Replay" link.

6.4.4 The section shall display up to 6 recent games, sorted by completion date (newest first).

6.4.5 The system shall only show games from teams that have opted into public visibility.

#### 6.5 Game Report Page
6.5.1 On the game report page (`game.html`), for games with `liveStatus: 'completed'`, the system shall display a "Watch Replay" button.

6.5.2 The "Watch Replay" button shall be prominently placed near the game header/score area.

6.5.3 The button shall navigate to the Live Viewer page in replay mode.

6.5.4 For games not tracked with the Live Tracker, no replay button shall be shown.

### 7. Mobile-First Design

7.1 The Live Viewer shall be designed mobile-first with a responsive layout.

7.2 On mobile, the primary view shall show scoreboard and play-by-play, with stats and chat accessible via tabs or swipe.

7.3 Touch targets (buttons, reactions) shall be minimum 44x44 pixels for easy tapping.

7.4 The UI shall perform smoothly on mobile devices with animations at 60fps.

7.5 The page shall be usable in both portrait and landscape orientations.

### 8. Security & Access Control

8.1 The Live Viewer page shall be publicly readable (no authentication required to view).

8.2 Only the stat keeper (authenticated user with track permission) shall be able to write live events.

8.3 Chat write access shall be open to anyone (authenticated or anonymous).

8.4 The system shall implement rate limiting on chat messages to prevent abuse.

8.5 The system shall implement rate limiting on reactions to prevent spam.

8.6 Team owners/admins shall be able to disable live broadcasting for their games.

## Out of Scope (Deferred)

- Shot location tracking on court visualization
- Live tracker crash recovery (resume from last state)
- Push notifications for game start
- Video/audio streaming integration
- Monetization (ads, premium features)
- Moderation tools for live chat
- Multiple camera angles or alternate commentary
- Multi-language support
- Offline replay caching
- Social media sharing integration (beyond link copying)
- Sports other than basketball
- Private/invite-only broadcasts
