# Live Game Tracker - Implementation Tasks

This document breaks down the Live Game Tracker feature into incremental, testable coding tasks. Each task references specific requirements and produces working, testable code.

---

## Phase 1: Database & Infrastructure

### Task 1.1: Add Firestore Security Rules ✅
**Ref:** Req 8.1-8.5, Design Section 10

- [x] Add security rules for `liveEvents` subcollection (public read, authenticated write)
- [x] Add security rules for `liveChat` subcollection (public read/write)
- [x] Add security rules for `liveReactions` subcollection (public read/write)
- [ ] Deploy and test rules with Firebase emulator

**Test:** Verify unauthenticated users can read but not write to liveEvents

---

### Task 1.2: Add db.js Live Event Functions ✅
**Ref:** Design Section 5 (db.js Additions)

- [x] Add `broadcastLiveEvent(teamId, gameId, eventData)` - fire-and-forget write
- [x] Add `subscribeLiveEvents(teamId, gameId, callback)` - real-time subscription
- [x] Add `getLiveEvents(teamId, gameId)` - fetch all events for replay
- [x] Add `setGameLiveStatus(teamId, gameId, status)` - update game liveStatus field
- [x] Add `subscribeGame(teamId, gameId, callback)` - real-time game status subscription

**Test:** Write a test event and verify it appears in subscription callback

---

### Task 1.3: Add db.js Live Chat Functions ✅
**Ref:** Req 3.4, Design Section 5

- [x] Add `subscribeLiveChat(teamId, gameId, options, callback)` - real-time subscription
- [x] Add `postLiveChatMessage(teamId, gameId, messageData)` - send message
- [x] Add `getLiveChatHistory(teamId, gameId)` - fetch all chat for replay

**Test:** Post a message and verify it appears in subscription

---

### Task 1.4: Add db.js Reaction Functions ✅
**Ref:** Req 4.3, Design Section 5

- [x] Add `sendReaction(teamId, gameId, reactionData)` - send ephemeral reaction
- [x] Add `subscribeReactions(teamId, gameId, callback)` - subscribe to new reactions
- [x] Add `getLiveReactions(teamId, gameId)` - fetch all reactions for replay

**Test:** Send reaction and verify callback receives it

---

### Task 1.5: Add db.js Viewer Presence Functions ✅
**Ref:** Req 2.6, Design Section 5

- [x] Add `trackViewerPresence(teamId, gameId, onCountChange)` - increment/decrement viewer count
- [x] Handle page unload to decrement count
- [x] Return cleanup function for component unmount

**Test:** Open page, verify count increments; close page, verify count decrements

---

### Task 1.6: Add db.js Game Discovery Functions ✅
**Ref:** Req 6.3-6.4, Design Section 5

- [x] Add `getUpcomingLiveGames(limit)` - upcoming games with live tracking
- [x] Add `getLiveGamesNow()` - currently live games
- [x] Add `getRecentLiveTrackedGames(limit)` - completed games for replay
- [x] Include team info (name, photo) with each game
- [x] Add Firestore composite indexes for live/upcoming/replay queries

**Test:** Create test games with various liveStatus values and verify queries return correct results

---

## Phase 2: Live Tracker (Stat Keeper Experience)

### Task 2.1: Create live-tracker.html Base Structure ✅
**Ref:** Req 1.1-1.2, Design Section 1

- [x] Copy `track-basketball.html` to `live-tracker.html`
- [x] Update script import to `js/live-tracker.js`
- [x] Add "LIVE" indicator badge in header
- [x] Add viewer count display in header

**Test:** Page loads without errors, displays same UI as track-basketball

---

### Task 2.2: Add Chat Panel to live-tracker.html ✅
**Ref:** Req 1.5, Design Section 1

- [x] Add collapsible chat panel at bottom of page
- [x] Add chat toggle button with unread badge
- [x] Add chat messages container (scrollable)
- [x] Add chat input form with send button
- [x] Style to match tracker dark theme (ink/slate/teal colors)

**Test:** Chat panel toggles open/closed, form submits

---

### Task 2.3: Create live-tracker.js Base Structure ✅
**Ref:** Req 1.2, Design Section 2

- [x] Copy `track-basketball.js` to `live-tracker.js`
- [x] Add `liveState` object for live-specific state
- [x] Add `startLiveBroadcast()` function to set game status to 'live'
- [x] Add `endLiveBroadcast()` function to set game status to 'completed'
- [x] Call `startLiveBroadcast()` when game starts
- [x] Call `endLiveBroadcast()` in `saveAndComplete()`

**Test:** Opening tracker sets game.liveStatus to 'live', completing sets to 'completed'

---

### Task 2.4: Add Event Broadcasting to live-tracker.js ✅
**Ref:** Req 1.2.2-1.2.5, Design Section 2

- [x] Create `broadcastEvent(eventData)` function with fire-and-forget pattern
- [x] Add retry queue for failed broadcasts with exponential backoff
- [x] Modify `addStat()` to call `broadcastEvent()` after local state update
- [x] Ensure network failures don't block UI

**Test:** Add stat, verify event appears in Firestore; simulate offline, verify UI doesn't freeze

---

### Task 2.5: Broadcast All Event Types ✅
**Ref:** Req 1.3, Design Section 2

- [x] Broadcast stat events (pts, reb, ast, stl, to, fouls)
- [x] Broadcast substitution events from `makeSwap()`
- [x] Broadcast period change events from `setPeriod()`
- [x] Include all required fields: period, gameClockMs, homeScore, awayScore, description
- [x] Broadcast clock start/pause events into liveEvents
- [x] Broadcast compensating events when removing a log entry

**Test:** Perform various actions, verify all event types appear in Firestore with correct data

---

### Task 2.6: Add Chat Functionality to Tracker ✅
**Ref:** Req 1.5.2-1.5.9, Design Section 2

- [x] Subscribe to liveChat on page load
- [x] Render chat messages in chat panel
- [x] Implement send message functionality
- [x] Update unread badge when new messages arrive (while collapsed)
- [x] Clear unread count when chat panel opens

**Test:** Send message from tracker, verify it appears; receive message, verify badge shows

---

### Task 2.7: Add Viewer Count to Tracker ✅
**Ref:** Req 1.5.8, Design Section 2

- [x] Subscribe to viewer count on page load
- [x] Display viewer count in header or chat toggle area
- [x] Update display when count changes

**Test:** Open viewer page, verify tracker shows updated count

---

## Phase 3: Live Viewer (Spectator Experience)

### Task 3.1: Create live-game.html Structure ✅
**Ref:** Req 2.1-2.2, Design Section 3

- [x] Create `live-game.html` with dark theme (ink/slate/teal/coral/gold colors)
- [x] Add scoreboard header (home/away scores, period, clock)
- [x] Add "LIVE" badge with pulsing indicator
- [x] Add viewer count display
- [x] Parse teamId and gameId from URL params
- [x] Keep scoreboard non-sticky on scroll

**Test:** Page loads, displays placeholder scoreboard

---

### Task 3.2: Add Mobile Tabs Navigation ✅
**Ref:** Req 7.2, Design Section 3

- [x] Add tab navigation: Plays, Stats, Chat
- [x] Implement tab switching logic
- [x] Show/hide panels based on active tab
- [x] Add unread badge on Chat tab

**Test:** Tap tabs, verify correct panel shows

---

### Task 3.3: Create Play-by-Play Panel ✅
**Ref:** Req 2.3, Design Section 3

- [x] Create plays feed container
- [x] Style event cards with period, time, description
- [x] Highlight scoring events with point value display
- [x] Color-code events by type (score=teal, 3pt=gold, sub=gray, period=coral)
- [x] Match event styling to team color (home vs opponent) and add side tags

**Test:** Render static test events, verify styling

---

### Task 3.4: Create Stats Panel ✅
**Ref:** Req 2.4, Design Section 3

- [x] Create stats list container
- [x] Display player cards with stats (pts, reb, ast, etc.)
- [x] Sort by points (default)
- [x] Add opponent stats section
- [x] Keep opponent stats expanded and show opponent numbers when available
- [x] Show on-court vs bench lineup in live viewer
- [x] Sync lineup updates to viewer even if tracker opens after live started
- [x] Render all configured stat columns inside lineup cards
- [x] Ensure fouls are always shown in live viewer stats
- [x] Match opponent card layout to player cards

**Test:** Render static test stats, verify display

---

### Task 3.5: Create Chat Panel ✅
**Ref:** Req 3.1-3.2, Design Section 3

- [x] Create chat messages container
- [x] Create chat input form
- [x] Style messages with sender name, text, timestamp
- [x] Differentiate AI messages visually
- [x] Add inline anonymous name edit UI
- [x] Add note for tagging @ALL PLAYS
- [x] Disable chat unless game is live on game day

**Test:** Render static test messages, verify styling

---

### Task 3.6: Create Reactions Bar ✅
**Ref:** Req 4.1-4.2, Design Section 3

- [x] Create reactions bar at bottom with emoji buttons
- [x] Add reactions overlay container for floating animations
- [x] Style buttons for easy mobile tapping (44x44 min)

**Test:** Tap reaction, verify button responds

---

### Task 3.7: Create Overlay States ✅
**Ref:** Req 2.1.4-2.1.5, Design Section 3

- [x] Create "Game Not Live Yet" overlay
- [x] Create "Game Ended" overlay with final score and "Watch Replay" button
- [x] Show appropriate overlay based on game.liveStatus
- [x] Use non-blocking banners so chat stays available before/after games

**Test:** Set various liveStatus values, verify correct overlay shows

---

### Task 3.8: Create live-game.js Initialization ✅
**Ref:** Design Section 4

- [x] Parse URL params (teamId, gameId, replay flag)
- [x] Load game, team, and players data
- [x] Check auth state and generate anon name if needed
- [x] Determine mode (live vs replay vs not-started)
- [x] Initialize appropriate subscriptions or show overlay

**Test:** Load page with valid game, verify data loads correctly

---

### Task 3.9: Implement Live Event Subscription ✅
**Ref:** Req 2.2.4, 2.3, Design Section 4

- [x] Subscribe to liveEvents on page load (live mode)
- [x] Process new events: update scores, period, clock, stats
- [x] Render new events in play-by-play feed
- [x] Auto-scroll feed unless user scrolled up
- [x] Auto-update viewer when game status changes without refresh

**Test:** Broadcast event from tracker, verify it appears in viewer within 3 seconds

---

### Task 3.10: Implement Scoreboard Updates ✅
**Ref:** Req 2.2.5, Design Section 4

- [x] Update score display when score events arrive
- [x] Add pulse animation on score change
- [x] Update period and clock display

**Test:** Score event arrives, verify scoreboard updates with animation

---

### Task 3.11: Implement Stats Updates ✅
**Ref:** Req 2.4.3-2.4.4, Design Section 4

- [x] Accumulate stats from events
- [x] Re-render stats panel on new events
- [x] Keep latest stat highlight until next stat arrives

**Test:** Stat event arrives, verify stats panel updates

---

### Task 3.12: Implement Score Celebrations ✅
**Ref:** Req 2.5.1-2.5.3, Design Section 4

- [x] Show screen flash on score events
- [x] Show enhanced effect for 3-pointers (floating "+3!")
- [x] Track scoring runs and show momentum indicator ("5-0 Run!")
- [x] Add celebratory visuals for non-scoring events (subs, steals, fouls)

**Test:** Score events trigger appropriate celebrations

---

### Task 3.13: Implement Chat Functionality ✅
**Ref:** Req 3.1-3.2, Design Section 4

- [x] Subscribe to liveChat
- [x] Render messages with sender info
- [x] Implement send message (authenticated or anonymous)
- [x] Generate "Fan1234" name for anonymous users
- [x] Allow anonymous users to change their display name
- [x] Post reactions into chat feed
- [x] Auto-scroll on new messages

**Test:** Send message, verify it appears for all viewers

---

### Task 3.14: Implement AI Chat Integration ✅
**Ref:** Req 3.3, Design Section 4

- [x] Detect @ALL PLAYS mention in messages
- [x] Provide @ALL PLAYS mention menu in live chat input
- [x] Show "thinking" indicator
- [x] Build context (current game stats, events, roster)
- [x] Call AI and post response as system message

**Test:** Ask @ALL PLAYS a question, verify AI responds with game context

---

### Task 3.15: Implement Reactions ✅
**Ref:** Req 4.1-4.2, Design Section 4

- [x] Subscribe to reactions stream
- [x] Send reaction on button tap with rate limiting (1/sec)
- [x] Show floating emoji animation for all incoming reactions
- [x] Position emojis randomly for visual variety

**Test:** Send reaction, verify all viewers see floating emoji

---

### Task 3.16: Implement Viewer Presence ✅
**Ref:** Req 2.6, Design Section 4

- [x] Track presence on page load
- [x] Subscribe to viewer count changes
- [x] Display count in header
- [x] Clean up on page unload

**Test:** Open/close viewer tabs, verify count updates

---

## Phase 4: Replay Mode

### Task 4.1: Create Replay Controls UI ✅
**Ref:** Req 5.2, Design Section 3

- [x] Add replay controls bar (play/pause, speed buttons, progress bar)
- [x] Hide reactions bar in replay mode
- [x] Show current time and total duration

**Test:** Controls render correctly in replay mode

---

### Task 4.2: Implement Replay Engine ✅
**Ref:** Req 5.3, Design Section 4

- [x] Load all liveEvents sorted by gameClockMs
- [x] Implement simulated clock with requestAnimationFrame
- [x] Process events when clock reaches their timestamp
- [x] Support play/pause functionality

**Test:** Start replay, verify events appear at correct times

---

### Task 4.3: Implement Replay Speed Controls ✅
**Ref:** Req 5.2.2, Design Section 4

- [x] Add speed buttons (1x, 2x, 3x, 4x)
- [x] Add speed buttons (10x, 20x, 50x)
- [x] Multiply clock advancement by speed factor
- [x] Update active button styling

**Test:** Change speed, verify playback accelerates/decelerates

---

### Task 4.4: Implement Replay Progress Bar ✅
**Ref:** Req 5.2.3-5.2.4, Design Section 4

- [x] Update progress bar as replay advances
- [x] Allow seeking by clicking/dragging progress bar
- [x] Jump to appropriate event index on seek

**Test:** Seek to middle of game, verify correct state

---

### Task 4.5: Implement Chat Replay ✅
**Ref:** Req 5.3.5, Design Section 4

- [x] Load all liveChat messages with timestamps
- [x] Show messages when replay clock reaches their time
- [x] Disable chat input in replay mode

**Test:** Replay shows chat messages at original times

---

### Task 4.6: Implement Reaction Replay ✅
**Ref:** Req 5.3.6, Design Section 4

- [x] Load all liveReactions with timestamps
- [x] Animate reactions when replay clock reaches their time

**Test:** Replay shows floating reactions at original times

---

## Phase 5: Game Discovery & Entry Points

### Task 5.1: Update edit-schedule.html Tracker Modal ✅
**Ref:** Req 1.1, Design Section 6

- [x] Add "Live Broadcast Tracker" option to tracker selection modal
- [x] Style with "LIVE" badge and description
- [x] Navigate to `live-tracker.html` when selected
- [x] Keep "Copy Live Link" available alongside view/live/replay options

**Test:** Click Track, select Live option, verify navigation

---

### Task 5.2: Add Copy Live Link to edit-schedule.html ✅
**Ref:** Req 6.1.1-6.1.2, Design Section 6

- [x] Add "Copy Live Link" button for basketball games
- [x] Copy shareable URL to clipboard
- [x] Show toast confirmation

**Test:** Click button, verify URL copied to clipboard

---

### Task 5.3: Add Watch Replay to edit-schedule.html ✅
**Ref:** Req 6.1.3-6.1.4, Design Section 6

- [x] Show "Watch Replay" button for games with liveStatus='completed'
- [x] Navigate to live-game.html with replay=true param

**Test:** Completed live-tracked game shows replay button

---

### Task 5.4: Update team.html with Live Indicator ✅
**Ref:** Req 6.2.1-6.2.3, Design Section 7

- [x] Add "LIVE NOW" badge for games with liveStatus='live'
- [x] Add "Watch Live" button linking to live-game.html
- [x] Style with pulsing red indicator
- [x] Always show Live View link and surface live score when active
- [x] Show View Live for upcoming games, Live Now when live, Replay when completed

**Test:** Live game shows indicator and button

---

### Task 5.5: Update team.html with Replay Link ✅
**Ref:** Req 6.2.4-6.2.5, Design Section 7

- [x] Add "Watch Replay" link for games with liveStatus='completed'
- [x] Display alongside "View Report" link

**Test:** Completed live-tracked game shows both links

---

### Task 5.6: Add Watch Replay to game.html ✅
**Ref:** Req 6.5, Design Section 9

- [x] Check game.liveStatus on page load
- [x] Show "View Live" if not started, "Live Now" if live, "Watch Replay" if completed
- [x] Position button prominently near score area
- [x] Navigate to live-game.html with replay=true param

**Test:** Live-tracked game report shows replay button

---

### Task 5.7: Add Live Games Section to index.html ✅
**Ref:** Req 6.3, Design Section 8

- [x] Add "Live & Upcoming Games" section
- [x] Load and display live games (with "LIVE NOW" badge)
- [x] Load and display upcoming games
- [x] Link each game to live-game.html
- [x] Add Firestore composite indexes for live/upcoming queries
- [x] Deploy Firestore indexes for live/upcoming/replay queries

**Test:** Section displays with live and upcoming games

---

### Task 5.8: Add Past Games Section to index.html ✅
**Ref:** Req 6.4, Design Section 8

- [x] Add "Recent Replays" section
- [x] Load recently completed live-tracked games
- [x] Display with final scores and "Watch Replay" link
- [x] Link to live-game.html with replay=true param

**Test:** Section displays recent games with replay links

---

## Phase 6: Polish & Testing

### Task 6.1: Add CSS Animations ✅
**Ref:** Req 2.2.5, 2.3.3, 2.5, 7.4

- [x] Score pulse animation
- [x] Event slide-in animation
- [x] Reaction float-up animation
- [x] Stat highlight flash animation
- [x] Ensure 60fps on mobile

**Test:** Animations perform smoothly on mobile device

---

### Task 6.2: Mobile Layout Optimization ✅
**Ref:** Req 7.1-7.5

- [x] Test and fix layout on various screen sizes
- [x] Ensure touch targets are 44x44px minimum
- [x] Test portrait and landscape orientations
- [x] Optimize chat panel for mobile
- [x] Add bottom padding so the reactions bar does not cover chat input

**Test:** Manual testing on iOS and Android devices

---

### Task 6.3: Error Handling ✅
**Ref:** Design Error Handling section

- [x] Handle game not found gracefully
- [x] Handle subscription failures with retry
- [x] Handle chat send failures with error message
- [x] Handle tracker offline mode gracefully

**Test:** Simulate various error conditions

---

### Task 6.4: Rate Limiting ✅
**Ref:** Req 4.2.4, 8.4-8.5

- [x] Implement reaction rate limiting (1/sec per user)
- [x] Implement chat rate limiting (prevent spam)
- [x] Show feedback when rate limited

**Test:** Rapid-fire reactions/messages, verify rate limiting works

---

### Task 6.5: Integration Testing
**Ref:** All requirements

- [ ] End-to-end test: tracker to viewer event flow
- [ ] Test chat round-trip (tracker ↔ viewer)
- [ ] Test replay from start to finish
- [ ] Test multiple concurrent viewers
- [ ] Test anonymous vs authenticated chat
- [ ] Verify start/pause events appear in tracker log and live play-by-play
- [ ] Verify log removal sends compensating live events
- [ ] Verify chat gating (disabled before game day / not live, enabled when live on game day)
- [ ] Verify reactions appear both in live chat and as floating emoji
- [ ] Verify View Live / Live Now / Replay state across team, edit-schedule, and game pages

**Test:** Full user journey testing

---

## Task Summary

| Phase | Tasks | Description |
|-------|-------|-------------|
| 1 | 1.1 - 1.6 | Database & Infrastructure |
| 2 | 2.1 - 2.7 | Live Tracker (Stat Keeper) |
| 3 | 3.1 - 3.16 | Live Viewer (Spectator) |
| 4 | 4.1 - 4.6 | Replay Mode |
| 5 | 5.1 - 5.8 | Game Discovery & Entry Points |
| 6 | 6.1 - 6.5 | Polish & Testing |

**Total Tasks:** 42

**Recommended Execution Order:**
1. Phase 1 (infrastructure) - enables all other work
2. Phase 2 (tracker) - can test broadcasting
3. Phase 3 (viewer) - can test full live flow
4. Phase 4 (replay) - builds on viewer
5. Phase 5 (discovery) - adds entry points
6. Phase 6 (polish) - final refinements
