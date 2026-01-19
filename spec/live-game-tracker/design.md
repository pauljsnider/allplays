# Live Game Tracker Design Document

## Overview

This document describes the technical design for the Live Game Tracker feature, which enables real-time game broadcasting for basketball games. The feature consists of two main experiences:

1. **Live Tracker** - A modified basketball tracker that passively broadcasts events to Firestore
2. **Live Viewer** - A spectator page that receives real-time updates with chat and reactions

The design prioritizes:
- **Tracker reliability** - Network issues never interrupt stat tracking
- **Real-time updates** - Viewers see events within 1-3 seconds
- **Mobile-first UI** - Optimized for phones at the game
- **Broadcast aesthetic** - Sports TV-style presentation

---

## Architecture

### High-Level Data Flow

```
┌─────────────────────────┐
│     Live Tracker        │
│   (Stat Keeper Phone)   │
└───────────┬─────────────┘
            │ Fire-and-forget writes
            │ (non-blocking)
            ▼
┌─────────────────────────┐
│       Firestore         │
│  ┌───────────────────┐  │
│  │ liveEvents        │  │◄──────────────┐
│  │ liveChat          │  │               │
│  │ liveReactions     │  │               │
│  │ game.liveStatus   │  │               │
│  └───────────────────┘  │               │
└───────────┬─────────────┘               │
            │ onSnapshot                   │
            │ (real-time)                  │
            ▼                              │
┌─────────────────────────┐               │
│     Live Viewer(s)      │───────────────┘
│   (Spectator Phones)    │  Chat/Reactions
└─────────────────────────┘
```

### Component Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         TRACKER SIDE                            │
├─────────────────────────────────────────────────────────────────┤
│  live-tracker.html                                              │
│  ├── Stat tracking UI (copied from track-basketball.html)       │
│  ├── Collapsible chat panel (bottom)                            │
│  └── Viewer count badge                                         │
│                                                                 │
│  js/live-tracker.js                                             │
│  ├── All track-basketball.js logic                              │
│  ├── broadcastEvent() - fire-and-forget Firestore writes        │
│  ├── Chat subscription (read-only + send)                       │
│  └── Viewer count subscription                                  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                         VIEWER SIDE                             │
├─────────────────────────────────────────────────────────────────┤
│  live-game.html                                                 │
│  ├── Scoreboard header                                          │
│  ├── Play-by-play feed                                          │
│  ├── Stats panel (collapsible)                                  │
│  ├── Chat panel (tab on mobile)                                 │
│  ├── Reactions overlay                                          │
│  └── Replay controls (when applicable)                          │
│                                                                 │
│  js/live-game.js                                                │
│  ├── subscribeToLiveEvents() - real-time event stream           │
│  ├── subscribeToLiveChat() - real-time chat                     │
│  ├── subscribeToReactions() - ephemeral reactions               │
│  ├── Presence tracking (viewer count)                           │
│  ├── Replay engine (simulated clock)                            │
│  └── AI chat integration (@ALL PLAYS)                           │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                       SHARED / MODIFIED                         │
├─────────────────────────────────────────────────────────────────┤
│  js/db.js                                                       │
│  ├── broadcastLiveEvent()                                       │
│  ├── subscribeLiveEvents()                                      │
│  ├── subscribeLiveChat() / postLiveChatMessage()                │
│  ├── sendReaction() / subscribeReactions()                      │
│  ├── updateViewerPresence() / subscribeViewerCount()            │
│  ├── setGameLiveStatus()                                        │
│  └── getUpcomingLiveGames()                                     │
│                                                                 │
│  edit-schedule.html - Add "Live Tracker" option + "Watch Replay"│
│  team.html - Add "Watch Live" badge + "Watch Replay" link       │
│  game.html - Add "Watch Replay" button for live-tracked games   │
│  index.html - Add "Live Games" + "Past Games/Replays" sections  │
│  firestore.rules - Security rules for new collections           │
└─────────────────────────────────────────────────────────────────┘
```

---

## Components

### New Files

| File | Purpose | Lines (Est.) |
|------|---------|--------------|
| `live-tracker.html` | Live tracker page with chat panel | ~350 |
| `js/live-tracker.js` | Live tracker logic, event broadcasting | ~1600 |
| `live-game.html` | Spectator viewer page | ~400 |
| `js/live-game.js` | Viewer logic, subscriptions, replay | ~1200 |

### Modified Files

| File | Changes | Lines Changed (Est.) |
|------|---------|---------------------|
| `js/db.js` | Add live event, chat, reaction, presence, replay functions | +250 |
| `edit-schedule.html` | Add "Live Tracker" option + "Watch Replay" button | +50 |
| `team.html` | Add "Watch Live" indicator + "Watch Replay" link | +60 |
| `game.html` | Add "Watch Replay" button for live-tracked games | +30 |
| `index.html` | Add "Live Games" + "Past Games/Replays" sections | +120 |
| `firestore.rules` | Rules for liveEvents, liveChat, liveReactions | +50 |

---

## Detailed Component Design

### 1. live-tracker.html

**Based on:** `track-basketball.html` (copy and extend)

**New Elements:**

```html
<!-- Chat Panel (bottom of page, collapsible) -->
<div id="chat-panel" class="fixed bottom-0 left-0 right-0 bg-slate border-t border-teal/30 transition-all duration-300">
  <!-- Collapsed State -->
  <button id="chat-toggle" class="w-full p-3 flex items-center justify-between">
    <span class="flex items-center gap-2">
      <svg><!-- chat icon --></svg>
      <span>Live Chat</span>
      <span id="unread-badge" class="hidden bg-red-500 text-white text-xs rounded-full px-2">0</span>
    </span>
    <span id="viewer-count" class="text-teal text-sm">0 watching</span>
  </button>

  <!-- Expanded State -->
  <div id="chat-content" class="hidden h-64">
    <div id="chat-messages" class="h-48 overflow-y-auto p-3">
      <!-- Messages render here -->
    </div>
    <form id="chat-form" class="p-3 border-t border-teal/20 flex gap-2">
      <input type="text" id="chat-input" placeholder="Send a message..."
             class="flex-1 bg-ink border border-teal/30 rounded px-3 py-2 text-sand">
      <button type="submit" class="bg-teal text-ink px-4 py-2 rounded font-medium">Send</button>
    </form>
  </div>
</div>
```

**Key Differences from track-basketball.html:**
1. Chat panel at bottom (collapsible)
2. Viewer count display
3. Unread message badge
4. Imports `live-tracker.js` instead of `track-basketball.js`

---

### 2. js/live-tracker.js

**Based on:** `js/track-basketball.js` (copy and extend)

**New State:**
```javascript
let liveState = {
  isLive: false,
  viewerCount: 0,
  unreadChatCount: 0,
  chatExpanded: false,
  chatMessages: [],
  lastChatReadTime: null,
  eventQueue: [],        // Failed events to retry
  unsubscribeChat: null,
  unsubscribeViewers: null
};
```

**New Functions:**

```javascript
// ============ BROADCASTING ============

/**
 * Broadcast a stat event to Firestore (fire-and-forget)
 * Called whenever addStat() is invoked
 */
async function broadcastEvent(eventData) {
  const event = {
    type: eventData.type,           // 'stat', 'substitution', 'period_change'
    playerId: eventData.playerId,
    playerName: eventData.playerName,
    playerNumber: eventData.playerNumber,
    statKey: eventData.statKey,
    value: eventData.value,
    period: state.period,
    gameClockMs: state.clock,
    homeScore: state.home,
    awayScore: state.away,
    isOpponent: eventData.isOpponent || false,
    opponentPlayerName: eventData.opponentPlayerName || null,
    description: eventData.description,
    createdAt: serverTimestamp(),
    createdBy: currentUser.uid
  };

  try {
    await broadcastLiveEvent(currentTeamId, currentGameId, event);
  } catch (error) {
    console.error('Broadcast failed (will retry):', error);
    liveState.eventQueue.push(event);
    scheduleRetry();
  }
}

/**
 * Retry failed broadcasts with exponential backoff
 */
let retryTimeout = null;
let retryAttempt = 0;

function scheduleRetry() {
  if (retryTimeout) return; // Already scheduled

  const delay = Math.min(1000 * Math.pow(2, retryAttempt), 30000); // Max 30s
  retryTimeout = setTimeout(async () => {
    retryTimeout = null;

    const queue = [...liveState.eventQueue];
    liveState.eventQueue = [];

    for (const event of queue) {
      try {
        await broadcastLiveEvent(currentTeamId, currentGameId, event);
        retryAttempt = 0; // Reset on success
      } catch (error) {
        liveState.eventQueue.push(event);
      }
    }

    if (liveState.eventQueue.length > 0) {
      retryAttempt++;
      scheduleRetry();
    }
  }, delay);
}

// ============ CHAT ============

/**
 * Subscribe to live chat messages
 */
function initChat() {
  liveState.unsubscribeChat = subscribeLiveChat(
    currentTeamId,
    currentGameId,
    { limit: 50 },
    (messages) => {
      liveState.chatMessages = messages;
      renderChatMessages();
      updateUnreadBadge();
    }
  );
}

function renderChatMessages() {
  const container = q('#chat-messages');
  container.innerHTML = liveState.chatMessages
    .slice()
    .reverse() // Show oldest first
    .map(msg => `
      <div class="mb-2 ${msg.senderId === currentUser?.uid ? 'text-right' : ''}">
        <span class="text-teal text-xs">${msg.senderName || 'Fan'}</span>
        <p class="text-sand text-sm">${escapeHtml(msg.text)}</p>
      </div>
    `).join('');

  // Auto-scroll to bottom
  container.scrollTop = container.scrollHeight;
}

async function sendChatMessage(text) {
  if (!text.trim()) return;

  await postLiveChatMessage(currentTeamId, currentGameId, {
    text: text.trim(),
    senderId: currentUser.uid,
    senderName: currentUser.displayName || currentUser.email,
    senderPhotoUrl: currentUser.photoURL || null,
    isAnonymous: false
  });
}

function toggleChat() {
  liveState.chatExpanded = !liveState.chatExpanded;
  q('#chat-content').classList.toggle('hidden', !liveState.chatExpanded);

  if (liveState.chatExpanded) {
    liveState.lastChatReadTime = Date.now();
    liveState.unreadChatCount = 0;
    updateUnreadBadge();
  }
}

function updateUnreadBadge() {
  const badge = q('#unread-badge');
  if (liveState.unreadChatCount > 0 && !liveState.chatExpanded) {
    badge.textContent = liveState.unreadChatCount > 99 ? '99+' : liveState.unreadChatCount;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

// ============ VIEWER COUNT ============

function initViewerCount() {
  liveState.unsubscribeViewers = subscribeViewerCount(
    currentTeamId,
    currentGameId,
    (count) => {
      liveState.viewerCount = count;
      q('#viewer-count').textContent = `${count} watching`;
    }
  );
}

// ============ LIFECYCLE ============

async function startLiveBroadcast() {
  liveState.isLive = true;
  await setGameLiveStatus(currentTeamId, currentGameId, 'live');
  initChat();
  initViewerCount();
}

async function endLiveBroadcast() {
  liveState.isLive = false;
  await setGameLiveStatus(currentTeamId, currentGameId, 'completed');

  if (liveState.unsubscribeChat) liveState.unsubscribeChat();
  if (liveState.unsubscribeViewers) liveState.unsubscribeViewers();
}
```

**Modified Functions (from track-basketball.js):**

```javascript
// Modify addStat() to also broadcast
function addStat(playerId, statKey, delta) {
  // ... existing local state update logic ...

  // NEW: Broadcast to live viewers
  if (liveState.isLive) {
    const player = roster.find(p => p.id === playerId);
    broadcastEvent({
      type: 'stat',
      playerId,
      playerName: player?.name,
      playerNumber: player?.number,
      statKey,
      value: delta,
      description: formatEventDescription(player, statKey, delta)
    });
  }
}

// Modify makeSwap() to broadcast substitutions
function makeSwap(outId, inId) {
  // ... existing swap logic ...

  if (liveState.isLive) {
    broadcastEvent({
      type: 'substitution',
      description: `SUB: ${inPlayer.name} in for ${outPlayer.name}`
    });
  }
}

// Modify setPeriod() to broadcast period changes
function setPeriod(period) {
  // ... existing period logic ...

  if (liveState.isLive) {
    broadcastEvent({
      type: 'period_change',
      description: `${period} started`
    });
  }
}

// Modify saveAndComplete() to end broadcast
async function saveAndComplete() {
  // End live broadcast first
  if (liveState.isLive) {
    await endLiveBroadcast();
  }

  // ... existing save logic ...
}
```

---

### 3. live-game.html

**Structure:**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Live Game - ALL PLAYS</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            ink: '#0b132b',
            slate: '#1c2541',
            teal: '#5bc0be',
            coral: '#ff6b6b',
            gold: '#ffd93d',
            sand: '#f7f5ed'
          }
        }
      }
    }
  </script>
  <style>
    /* Reaction animations */
    @keyframes float-up {
      0% { transform: translateY(0) scale(1); opacity: 1; }
      100% { transform: translateY(-200px) scale(1.5); opacity: 0; }
    }
    .reaction-float {
      animation: float-up 2s ease-out forwards;
    }

    /* Score pulse */
    @keyframes score-pulse {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.15); }
    }
    .score-pulse {
      animation: score-pulse 0.4s ease-in-out;
    }

    /* Event slide-in */
    @keyframes slide-in {
      from { transform: translateX(-100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
    .event-slide {
      animation: slide-in 0.3s ease-out;
    }
  </style>
</head>

<body class="bg-ink text-sand min-h-screen">
  <!-- SCOREBOARD HEADER -->
  <header id="scoreboard" class="sticky top-0 z-40 bg-slate/95 backdrop-blur border-b border-teal/20">
    <div class="max-w-lg mx-auto px-4 py-3">
      <!-- Team Names -->
      <div class="flex justify-between items-center text-sm text-teal/70 mb-1">
        <span id="home-team-name">Home Team</span>
        <span id="away-team-name">Away Team</span>
      </div>

      <!-- Scores -->
      <div class="flex justify-between items-center">
        <span id="home-score" class="text-5xl font-bold text-sand">0</span>
        <div class="text-center">
          <div id="period" class="text-teal font-medium">Q1</div>
          <div id="clock" class="text-sand/70 text-sm">0:00</div>
          <div id="live-badge" class="inline-flex items-center gap-1 mt-1">
            <span class="w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>
            <span class="text-red-400 text-xs font-medium">LIVE</span>
          </div>
        </div>
        <span id="away-score" class="text-5xl font-bold text-sand">0</span>
      </div>

      <!-- Viewer Count -->
      <div class="text-center mt-2">
        <span id="viewer-count" class="text-teal/60 text-xs">0 watching</span>
      </div>
    </div>
  </header>

  <!-- MOBILE TABS -->
  <nav id="mobile-tabs" class="sticky top-[140px] z-30 bg-ink border-b border-teal/20 md:hidden">
    <div class="flex">
      <button data-tab="plays" class="flex-1 py-3 text-sm font-medium text-teal border-b-2 border-teal">
        Plays
      </button>
      <button data-tab="stats" class="flex-1 py-3 text-sm font-medium text-sand/50 border-b-2 border-transparent">
        Stats
      </button>
      <button data-tab="chat" class="flex-1 py-3 text-sm font-medium text-sand/50 border-b-2 border-transparent relative">
        Chat
        <span id="chat-badge" class="hidden absolute top-2 right-4 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">0</span>
      </button>
    </div>
  </nav>

  <!-- MAIN CONTENT -->
  <main class="max-w-6xl mx-auto px-4 py-4">
    <div class="md:grid md:grid-cols-3 md:gap-6">

      <!-- PLAY-BY-PLAY (Left on desktop, Tab 1 on mobile) -->
      <div id="plays-panel" class="md:col-span-2">
        <h2 class="text-teal font-medium mb-3 flex items-center gap-2">
          <svg class="w-5 h-5"><!-- play icon --></svg>
          Play-by-Play
        </h2>
        <div id="plays-feed" class="space-y-2 max-h-[60vh] overflow-y-auto">
          <!-- Events render here -->
          <div class="text-center text-sand/40 py-8">
            Waiting for game to start...
          </div>
        </div>
      </div>

      <!-- STATS PANEL (Right on desktop, Tab 2 on mobile) -->
      <div id="stats-panel" class="hidden md:block">
        <h2 class="text-teal font-medium mb-3 flex items-center gap-2">
          <svg class="w-5 h-5"><!-- stats icon --></svg>
          Player Stats
        </h2>
        <div id="stats-list" class="space-y-2">
          <!-- Player stats render here -->
        </div>

        <!-- Opponent Stats (Collapsible) -->
        <details class="mt-4">
          <summary class="text-teal/70 text-sm cursor-pointer">Opponent Stats</summary>
          <div id="opponent-stats" class="mt-2 space-y-2">
            <!-- Opponent stats render here -->
          </div>
        </details>
      </div>

      <!-- CHAT PANEL (Tab 3 on mobile, sidebar on desktop) -->
      <div id="chat-panel" class="hidden md:block md:col-span-3 lg:col-span-1">
        <h2 class="text-teal font-medium mb-3 flex items-center gap-2">
          <svg class="w-5 h-5"><!-- chat icon --></svg>
          Live Chat
        </h2>
        <div id="chat-container" class="bg-slate/50 rounded-lg border border-teal/20">
          <div id="chat-messages" class="h-64 overflow-y-auto p-3 space-y-2">
            <!-- Messages render here -->
          </div>
          <form id="chat-form" class="p-3 border-t border-teal/20">
            <div class="flex gap-2">
              <input type="text" id="chat-input" placeholder="Send a message..."
                     class="flex-1 bg-ink border border-teal/30 rounded-lg px-3 py-2 text-sand text-sm">
              <button type="submit" class="bg-teal text-ink px-4 py-2 rounded-lg font-medium text-sm">
                Send
              </button>
            </div>
            <p id="chat-anon-notice" class="hidden text-sand/40 text-xs mt-2">
              Chatting as <span id="anon-name">Fan1234</span>
            </p>
          </form>
        </div>
      </div>
    </div>
  </main>

  <!-- REACTIONS BAR -->
  <div id="reactions-bar" class="fixed bottom-0 left-0 right-0 bg-slate/95 backdrop-blur border-t border-teal/20 p-3">
    <div class="max-w-lg mx-auto flex justify-center gap-4">
      <button data-reaction="fire" class="reaction-btn text-2xl hover:scale-125 transition-transform">
        <span>&#128293;</span>
      </button>
      <button data-reaction="clap" class="reaction-btn text-2xl hover:scale-125 transition-transform">
        <span>&#128079;</span>
      </button>
      <button data-reaction="wow" class="reaction-btn text-2xl hover:scale-125 transition-transform">
        <span>&#128562;</span>
      </button>
      <button data-reaction="heart" class="reaction-btn text-2xl hover:scale-125 transition-transform">
        <span>&#10084;&#65039;</span>
      </button>
      <button data-reaction="hundred" class="reaction-btn text-2xl hover:scale-125 transition-transform">
        <span>&#128175;</span>
      </button>
    </div>
  </div>

  <!-- REACTIONS OVERLAY (floating emojis appear here) -->
  <div id="reactions-overlay" class="fixed inset-0 pointer-events-none z-50 overflow-hidden">
    <!-- Floating reactions animate here -->
  </div>

  <!-- REPLAY CONTROLS (shown when viewing replay) -->
  <div id="replay-controls" class="hidden fixed bottom-16 left-0 right-0 bg-ink/95 border-t border-teal/20 p-3">
    <div class="max-w-lg mx-auto">
      <!-- Progress Bar -->
      <div class="mb-3">
        <input type="range" id="replay-progress" min="0" max="100" value="0"
               class="w-full h-2 bg-slate rounded-lg appearance-none cursor-pointer">
        <div class="flex justify-between text-xs text-sand/50 mt-1">
          <span id="replay-current">0:00</span>
          <span id="replay-duration">0:00</span>
        </div>
      </div>

      <!-- Controls -->
      <div class="flex justify-center items-center gap-4">
        <button id="replay-play" class="bg-teal text-ink w-10 h-10 rounded-full flex items-center justify-center">
          <svg class="w-5 h-5"><!-- play/pause icon --></svg>
        </button>
        <div class="flex gap-2">
          <button data-speed="1" class="speed-btn px-3 py-1 rounded bg-teal text-ink text-sm font-medium">1x</button>
          <button data-speed="2" class="speed-btn px-3 py-1 rounded bg-slate text-sand text-sm">2x</button>
          <button data-speed="3" class="speed-btn px-3 py-1 rounded bg-slate text-sand text-sm">3x</button>
          <button data-speed="4" class="speed-btn px-3 py-1 rounded bg-slate text-sand text-sm">4x</button>
        </div>
      </div>
    </div>
  </div>

  <!-- GAME NOT LIVE STATE -->
  <div id="not-live-overlay" class="hidden fixed inset-0 bg-ink/95 z-50 flex items-center justify-center">
    <div class="text-center p-8">
      <div class="text-6xl mb-4">&#127936;</div>
      <h2 class="text-2xl font-bold text-sand mb-2">Game Not Live Yet</h2>
      <p class="text-sand/60 mb-4">Check back when the game starts!</p>
      <p id="game-start-time" class="text-teal">Scheduled: --</p>
    </div>
  </div>

  <!-- GAME ENDED STATE -->
  <div id="ended-overlay" class="hidden fixed inset-0 bg-ink/95 z-50 flex items-center justify-center">
    <div class="text-center p-8">
      <div class="text-6xl mb-4">&#127942;</div>
      <h2 class="text-2xl font-bold text-sand mb-2">Game Ended</h2>
      <p id="final-score" class="text-3xl text-teal font-bold mb-4">0 - 0</p>
      <button id="watch-replay-btn" class="bg-teal text-ink px-6 py-3 rounded-lg font-medium">
        Watch Replay
      </button>
    </div>
  </div>

  <script type="module" src="js/live-game.js"></script>
</body>
</html>
```

---

### 4. js/live-game.js

**State Management:**

```javascript
// ============ STATE ============

const state = {
  // Game info
  teamId: null,
  gameId: null,
  team: null,
  game: null,
  players: [],

  // Live state
  isLive: false,
  isReplay: false,
  events: [],
  stats: {},           // { playerId: { pts: 0, reb: 0, ... } }
  opponentStats: {},
  homeScore: 0,
  awayScore: 0,
  period: 'Q1',
  gameClockMs: 0,

  // Chat
  chatMessages: [],
  unreadChatCount: 0,
  anonName: null,      // "Fan1234" for anonymous users

  // Viewers
  viewerCount: 0,

  // Replay
  replayEvents: [],    // All events sorted by time
  replayChat: [],      // All chat sorted by time
  replayReactions: [], // All reactions sorted by time
  replayIndex: 0,
  replaySpeed: 1,
  replayPlaying: false,
  replayStartTime: null,

  // UI
  activeTab: 'plays',

  // Subscriptions
  unsubscribers: []
};
```

**Core Functions:**

```javascript
// ============ INITIALIZATION ============

async function init() {
  // Parse URL params
  const params = new URLSearchParams(window.location.search);
  state.teamId = params.get('teamId');
  state.gameId = params.get('gameId');

  if (!state.teamId || !state.gameId) {
    showError('Invalid game link');
    return;
  }

  // Load game data
  state.team = await getTeam(state.teamId);
  state.game = await getGame(state.teamId, state.gameId);
  state.players = await getPlayers(state.teamId);

  // Check auth for chat
  checkAuth((user) => {
    state.user = user;
    if (!user) {
      state.anonName = generateAnonName();
      showAnonNotice();
    }
  });

  // Render initial UI
  renderGameInfo();
  initTabs();
  initReactions();
  initChat();

  // Determine game state
  if (state.game.liveStatus === 'live') {
    startLiveMode();
  } else if (state.game.liveStatus === 'completed') {
    showEndedOverlay();
  } else {
    showNotLiveOverlay();
  }
}

// ============ LIVE MODE ============

function startLiveMode() {
  state.isLive = true;
  hideLiveBadge(false);

  // Subscribe to live events
  const unsubEvents = subscribeLiveEvents(
    state.teamId,
    state.gameId,
    (events) => {
      processNewEvents(events);
    }
  );
  state.unsubscribers.push(unsubEvents);

  // Subscribe to chat
  const unsubChat = subscribeLiveChat(
    state.teamId,
    state.gameId,
    { limit: 100 },
    (messages) => {
      state.chatMessages = messages;
      renderChat();
    }
  );
  state.unsubscribers.push(unsubChat);

  // Subscribe to reactions
  const unsubReactions = subscribeReactions(
    state.teamId,
    state.gameId,
    (reaction) => {
      showFloatingReaction(reaction);
    }
  );
  state.unsubscribers.push(unsubReactions);

  // Track presence
  const unsubPresence = trackViewerPresence(
    state.teamId,
    state.gameId,
    (count) => {
      state.viewerCount = count;
      renderViewerCount();
    }
  );
  state.unsubscribers.push(unsubPresence);
}

// ============ EVENT PROCESSING ============

let lastEventId = null;

function processNewEvents(events) {
  // Find new events since last update
  const newEvents = events.filter(e => !state.events.find(se => se.id === e.id));

  for (const event of newEvents) {
    // Update state
    state.events.push(event);

    // Update scores
    if (event.homeScore !== undefined) state.homeScore = event.homeScore;
    if (event.awayScore !== undefined) state.awayScore = event.awayScore;
    if (event.period) state.period = event.period;
    if (event.gameClockMs !== undefined) state.gameClockMs = event.gameClockMs;

    // Update player stats
    if (event.playerId && event.statKey && event.value) {
      if (event.isOpponent) {
        state.opponentStats[event.playerId] = state.opponentStats[event.playerId] || {};
        state.opponentStats[event.playerId][event.statKey] =
          (state.opponentStats[event.playerId][event.statKey] || 0) + event.value;
      } else {
        state.stats[event.playerId] = state.stats[event.playerId] || {};
        state.stats[event.playerId][event.statKey] =
          (state.stats[event.playerId][event.statKey] || 0) + event.value;
      }
    }

    // Render with animations
    renderScoreboard(event.type === 'stat' && event.statKey === 'pts');
    renderPlayByPlay(event, true);
    renderStats();

    // Show celebration for scores
    if (event.type === 'stat' && event.statKey === 'pts') {
      showScoreCelebration(event);
    }
  }
}

// ============ RENDERING ============

function renderScoreboard(animate = false) {
  const homeEl = q('#home-score');
  const awayEl = q('#away-score');

  homeEl.textContent = state.homeScore;
  awayEl.textContent = state.awayScore;

  q('#period').textContent = state.period;
  q('#clock').textContent = formatClock(state.gameClockMs);

  if (animate) {
    // Determine which score changed and animate it
    homeEl.classList.add('score-pulse');
    setTimeout(() => homeEl.classList.remove('score-pulse'), 400);
  }
}

function renderPlayByPlay(event, isNew = false) {
  const feed = q('#plays-feed');

  const eventEl = document.createElement('div');
  eventEl.className = `bg-slate/50 rounded-lg p-3 border-l-4 ${getEventBorderColor(event)} ${isNew ? 'event-slide' : ''}`;
  eventEl.innerHTML = `
    <div class="flex justify-between items-start">
      <div>
        <span class="text-teal text-xs">${event.period} · ${formatClock(event.gameClockMs)}</span>
        <p class="text-sand font-medium">${event.description}</p>
        ${event.playerName ? `<p class="text-sand/60 text-sm">#${event.playerNumber} ${event.playerName}</p>` : ''}
      </div>
      ${event.value && event.statKey === 'pts' ? `
        <span class="text-2xl font-bold ${event.value === 3 ? 'text-gold' : 'text-teal'}">
          +${event.value}
        </span>
      ` : ''}
    </div>
  `;

  // Insert at top (newest first)
  feed.insertBefore(eventEl, feed.firstChild);

  // Limit displayed events
  while (feed.children.length > 50) {
    feed.removeChild(feed.lastChild);
  }
}

function getEventBorderColor(event) {
  if (event.type === 'stat' && event.statKey === 'pts') {
    if (event.value === 3) return 'border-gold';
    return 'border-teal';
  }
  if (event.type === 'substitution') return 'border-sand/30';
  if (event.type === 'period_change') return 'border-coral';
  return 'border-slate';
}

function renderStats() {
  const container = q('#stats-list');

  // Sort players by points
  const sortedPlayers = state.players
    .map(p => ({ ...p, stats: state.stats[p.id] || {} }))
    .sort((a, b) => (b.stats.pts || 0) - (a.stats.pts || 0));

  container.innerHTML = sortedPlayers.map(player => `
    <div class="bg-slate/50 rounded-lg p-2 flex items-center justify-between">
      <div class="flex items-center gap-2">
        <span class="text-teal font-mono text-sm">#${player.number}</span>
        <span class="text-sand text-sm">${player.name}</span>
      </div>
      <div class="flex gap-3 text-xs">
        <span class="text-sand">${player.stats.pts || 0} PTS</span>
        <span class="text-sand/60">${player.stats.reb || 0} REB</span>
        <span class="text-sand/60">${player.stats.ast || 0} AST</span>
      </div>
    </div>
  `).join('');
}

// ============ CELEBRATIONS ============

function showScoreCelebration(event) {
  // Brief screen flash
  const flash = document.createElement('div');
  flash.className = 'fixed inset-0 bg-teal/10 pointer-events-none z-40';
  document.body.appendChild(flash);
  setTimeout(() => flash.remove(), 200);

  // For 3-pointers, show extra effect
  if (event.value === 3) {
    showFloatingText('+3!', 'text-gold text-4xl font-bold');
  }
}

function showFloatingText(text, classes) {
  const el = document.createElement('div');
  el.className = `fixed top-1/3 left-1/2 -translate-x-1/2 pointer-events-none z-50 ${classes}`;
  el.textContent = text;
  el.style.animation = 'float-up 1.5s ease-out forwards';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1500);
}

// ============ REACTIONS ============

function initReactions() {
  q('#reactions-bar').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-reaction]');
    if (!btn) return;

    // Rate limit
    if (btn.disabled) return;
    btn.disabled = true;
    setTimeout(() => btn.disabled = false, 1000);

    const type = btn.dataset.reaction;
    sendReaction(state.teamId, state.gameId, {
      type,
      senderId: state.user?.uid || state.anonName,
      createdAt: serverTimestamp()
    });
  });
}

function showFloatingReaction(reaction) {
  const overlay = q('#reactions-overlay');
  const emoji = getReactionEmoji(reaction.type);

  const el = document.createElement('div');
  el.className = 'absolute text-4xl reaction-float';
  el.style.left = `${Math.random() * 80 + 10}%`;
  el.style.bottom = '100px';
  el.textContent = emoji;

  overlay.appendChild(el);
  setTimeout(() => el.remove(), 2000);
}

function getReactionEmoji(type) {
  const map = {
    fire: '\u{1F525}',
    clap: '\u{1F44F}',
    wow: '\u{1F632}',
    heart: '\u2764\uFE0F',
    hundred: '\u{1F4AF}'
  };
  return map[type] || '\u{1F525}';
}

// ============ CHAT ============

function initChat() {
  q('#chat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = q('#chat-input');
    const text = input.value.trim();
    if (!text) return;

    input.value = '';

    // Check for AI mention
    const hasAiMention = /@all\s*plays/i.test(text);

    await postLiveChatMessage(state.teamId, state.gameId, {
      text,
      senderId: state.user?.uid || null,
      senderName: state.user?.displayName || state.anonName,
      senderPhotoUrl: state.user?.photoURL || null,
      isAnonymous: !state.user
    });

    // Trigger AI response if mentioned
    if (hasAiMention) {
      await generateAiResponse(text);
    }
  });
}

function renderChat() {
  const container = q('#chat-messages');

  container.innerHTML = state.chatMessages
    .slice()
    .reverse()
    .map(msg => `
      <div class="flex gap-2 ${msg.ai ? 'bg-teal/10 -mx-3 px-3 py-2 rounded' : ''}">
        ${msg.senderPhotoUrl ?
          `<img src="${msg.senderPhotoUrl}" class="w-6 h-6 rounded-full">` :
          `<div class="w-6 h-6 rounded-full bg-slate flex items-center justify-center text-xs text-teal">
            ${msg.ai ? '\u{1F916}' : (msg.senderName?.[0] || '?')}
          </div>`
        }
        <div class="flex-1 min-w-0">
          <span class="text-teal text-xs font-medium">${msg.ai ? 'ALL PLAYS' : msg.senderName}</span>
          <p class="text-sand text-sm break-words">${formatChatMessage(msg.text)}</p>
        </div>
      </div>
    `).join('');

  // Auto-scroll
  container.scrollTop = container.scrollHeight;
}

function generateAnonName() {
  const num = Math.floor(1000 + Math.random() * 9000);
  return `Fan${num}`;
}

// ============ REPLAY MODE ============

async function startReplay() {
  state.isReplay = true;
  state.isLive = false;

  // Load all historical data
  state.replayEvents = await getLiveEvents(state.teamId, state.gameId);
  state.replayChat = await getLiveChatHistory(state.teamId, state.gameId);
  state.replayReactions = await getLiveReactions(state.teamId, state.gameId);

  // Sort by timestamp
  state.replayEvents.sort((a, b) => a.gameClockMs - b.gameClockMs);
  state.replayChat.sort((a, b) => a.createdAt - b.createdAt);

  // Reset state
  state.events = [];
  state.stats = {};
  state.homeScore = 0;
  state.awayScore = 0;
  state.period = 'Q1';
  state.gameClockMs = 0;
  state.replayIndex = 0;

  // Show replay controls
  q('#replay-controls').classList.remove('hidden');
  q('#reactions-bar').classList.add('hidden');
  q('#ended-overlay').classList.add('hidden');

  // Update UI
  renderScoreboard();
  q('#plays-feed').innerHTML = '';

  // Start replay
  playReplay();
}

function playReplay() {
  state.replayPlaying = true;
  state.replayStartTime = Date.now();

  requestAnimationFrame(replayTick);
}

function replayTick() {
  if (!state.replayPlaying) return;

  const elapsed = (Date.now() - state.replayStartTime) * state.replaySpeed;

  // Process events up to current time
  while (
    state.replayIndex < state.replayEvents.length &&
    state.replayEvents[state.replayIndex].gameClockMs <= elapsed
  ) {
    const event = state.replayEvents[state.replayIndex];
    processNewEvents([event]);
    state.replayIndex++;
  }

  // Update clock display
  state.gameClockMs = elapsed;
  renderScoreboard();

  // Update progress bar
  const totalDuration = state.replayEvents[state.replayEvents.length - 1]?.gameClockMs || 0;
  q('#replay-progress').value = (elapsed / totalDuration) * 100;

  // Continue or end
  if (state.replayIndex < state.replayEvents.length) {
    requestAnimationFrame(replayTick);
  } else {
    state.replayPlaying = false;
  }
}

// ============ UTILITIES ============

function formatClock(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function q(selector) {
  return document.querySelector(selector);
}

// Initialize on load
init();
```

---

### 5. js/db.js Additions

**New Functions to Add:**

```javascript
// ============ LIVE EVENTS ============

/**
 * Broadcast a live event (fire-and-forget from tracker)
 */
export async function broadcastLiveEvent(teamId, gameId, eventData) {
  const eventsRef = collection(db, 'teams', teamId, 'games', gameId, 'liveEvents');
  return addDoc(eventsRef, {
    ...eventData,
    createdAt: serverTimestamp()
  });
}

/**
 * Subscribe to live events (for viewer)
 */
export function subscribeLiveEvents(teamId, gameId, callback) {
  const eventsRef = collection(db, 'teams', teamId, 'games', gameId, 'liveEvents');
  const q = query(eventsRef, orderBy('createdAt', 'asc'));

  return onSnapshot(q, (snapshot) => {
    const events = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    callback(events);
  });
}

/**
 * Get all live events (for replay)
 */
export async function getLiveEvents(teamId, gameId) {
  const eventsRef = collection(db, 'teams', teamId, 'games', gameId, 'liveEvents');
  const q = query(eventsRef, orderBy('createdAt', 'asc'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

// ============ LIVE CHAT ============

/**
 * Subscribe to live game chat
 */
export function subscribeLiveChat(teamId, gameId, options, callback) {
  const chatRef = collection(db, 'teams', teamId, 'games', gameId, 'liveChat');
  const q = query(chatRef, orderBy('createdAt', 'desc'), limit(options.limit || 100));

  return onSnapshot(q, (snapshot) => {
    const messages = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    callback(messages);
  });
}

/**
 * Post a message to live game chat
 */
export async function postLiveChatMessage(teamId, gameId, messageData) {
  const chatRef = collection(db, 'teams', teamId, 'games', gameId, 'liveChat');
  return addDoc(chatRef, {
    ...messageData,
    createdAt: serverTimestamp()
  });
}

/**
 * Get all chat messages (for replay)
 */
export async function getLiveChatHistory(teamId, gameId) {
  const chatRef = collection(db, 'teams', teamId, 'games', gameId, 'liveChat');
  const q = query(chatRef, orderBy('createdAt', 'asc'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

// ============ REACTIONS ============

/**
 * Send a reaction (ephemeral)
 */
export async function sendReaction(teamId, gameId, reactionData) {
  const reactionsRef = collection(db, 'teams', teamId, 'games', gameId, 'liveReactions');
  return addDoc(reactionsRef, {
    ...reactionData,
    createdAt: serverTimestamp()
  });
}

/**
 * Subscribe to reactions (real-time)
 */
export function subscribeReactions(teamId, gameId, callback) {
  const reactionsRef = collection(db, 'teams', teamId, 'games', gameId, 'liveReactions');
  // Only listen to recent reactions (last 10 seconds)
  const tenSecondsAgo = new Date(Date.now() - 10000);
  const q = query(reactionsRef, where('createdAt', '>', tenSecondsAgo));

  return onSnapshot(q, (snapshot) => {
    snapshot.docChanges().forEach(change => {
      if (change.type === 'added') {
        callback({ id: change.doc.id, ...change.doc.data() });
      }
    });
  });
}

/**
 * Get all reactions (for replay)
 */
export async function getLiveReactions(teamId, gameId) {
  const reactionsRef = collection(db, 'teams', teamId, 'games', gameId, 'liveReactions');
  const q = query(reactionsRef, orderBy('createdAt', 'asc'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

// ============ GAME LIVE STATUS ============

/**
 * Update game live status
 */
export async function setGameLiveStatus(teamId, gameId, status) {
  const gameRef = doc(db, 'teams', teamId, 'games', gameId);
  const updates = { liveStatus: status };

  if (status === 'live') {
    updates.liveStartedAt = serverTimestamp();
  }

  return updateDoc(gameRef, updates);
}

// ============ VIEWER PRESENCE ============

/**
 * Track viewer presence and get count updates
 */
export function trackViewerPresence(teamId, gameId, onCountChange) {
  const gameRef = doc(db, 'teams', teamId, 'games', gameId);
  const viewerId = `viewer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  // Increment on connect
  updateDoc(gameRef, {
    liveViewerCount: increment(1)
  });

  // Subscribe to count changes
  const unsubscribe = onSnapshot(gameRef, (snapshot) => {
    const data = snapshot.data();
    onCountChange(data?.liveViewerCount || 0);
  });

  // Decrement on disconnect
  const cleanup = () => {
    updateDoc(gameRef, {
      liveViewerCount: increment(-1)
    });
    unsubscribe();
  };

  // Handle page unload
  window.addEventListener('beforeunload', cleanup);

  return () => {
    window.removeEventListener('beforeunload', cleanup);
    cleanup();
  };
}

// ============ UPCOMING GAMES ============

/**
 * Get upcoming live games across all public teams
 */
export async function getUpcomingLiveGames(limitCount = 10) {
  const now = new Date();
  const oneWeekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  // This requires a collection group query on 'games'
  const gamesRef = collectionGroup(db, 'games');
  const q = query(
    gamesRef,
    where('type', '==', 'game'),
    where('date', '>=', Timestamp.fromDate(now)),
    where('date', '<=', Timestamp.fromDate(oneWeekFromNow)),
    orderBy('date', 'asc'),
    limit(limitCount)
  );

  const snapshot = await getDocs(q);
  const games = [];

  for (const doc of snapshot.docs) {
    const gameData = { id: doc.id, ...doc.data() };
    // Get team info (parent document)
    const teamRef = doc.ref.parent.parent;
    const teamSnap = await getDoc(teamRef);
    if (teamSnap.exists()) {
      gameData.team = { id: teamSnap.id, ...teamSnap.data() };
    }
    games.push(gameData);
  }

  return games;
}

/**
 * Get currently live games
 */
export async function getLiveGamesNow() {
  const gamesRef = collectionGroup(db, 'games');
  const q = query(
    gamesRef,
    where('liveStatus', '==', 'live')
  );

  const snapshot = await getDocs(q);
  const games = [];

  for (const doc of snapshot.docs) {
    const gameData = { id: doc.id, ...doc.data() };
    const teamRef = doc.ref.parent.parent;
    const teamSnap = await getDoc(teamRef);
    if (teamSnap.exists()) {
      gameData.team = { id: teamSnap.id, ...teamSnap.data() };
    }
    games.push(gameData);
  }

  return games;
}

/**
 * Get recently completed live-tracked games (for replay section)
 */
export async function getRecentLiveTrackedGames(limitCount = 6) {
  const now = new Date();
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const gamesRef = collectionGroup(db, 'games');
  const q = query(
    gamesRef,
    where('liveStatus', '==', 'completed'),
    where('date', '>=', Timestamp.fromDate(oneWeekAgo)),
    orderBy('date', 'desc'),
    limit(limitCount)
  );

  const snapshot = await getDocs(q);
  const games = [];

  for (const doc of snapshot.docs) {
    const gameData = { id: doc.id, ...doc.data() };
    const teamRef = doc.ref.parent.parent;
    const teamSnap = await getDoc(teamRef);
    if (teamSnap.exists()) {
      gameData.team = { id: teamSnap.id, ...teamSnap.data() };
    }
    games.push(gameData);
  }

  return games;
}
```

---

### 6. edit-schedule.html Changes

**Modify the tracker selection modal:**

```javascript
// In the existing trackGame() function, add Live Tracker option

function trackGame(gameId) {
  const game = games.find(g => g.id === gameId);
  const configId = game.statTrackerConfigId;

  if (!configId) {
    window.location.href = `track.html#teamId=${currentTeamId}&gameId=${gameId}`;
    return;
  }

  if (isBasketballConfig(configId)) {
    pendingTrackGameId = gameId;
    document.getElementById('basketball-tracker-modal')?.classList.remove('hidden');
  } else {
    window.location.href = `track.html#teamId=${currentTeamId}&gameId=${gameId}`;
  }
}

// Update the modal HTML to include Live Tracker option
// Add this option to the existing basketball-tracker-modal:

/*
<div id="basketball-tracker-modal" class="hidden fixed inset-0 ...">
  <div class="bg-white rounded-lg p-6 max-w-md w-full mx-4">
    <h3 class="text-xl font-bold mb-4">Choose Tracker</h3>

    <div class="space-y-3">
      <!-- Existing options -->
      <button onclick="selectTracker('standard')" class="w-full p-4 border rounded-lg text-left hover:bg-gray-50">
        <div class="font-medium">Standard Tracker</div>
        <div class="text-sm text-gray-500">Desktop-friendly stat tracking</div>
      </button>

      <button onclick="selectTracker('basketball')" class="w-full p-4 border rounded-lg text-left hover:bg-gray-50">
        <div class="font-medium">Mobile Basketball Tracker</div>
        <div class="text-sm text-gray-500">Optimized for phones</div>
      </button>

      <!-- NEW: Live Tracker option -->
      <button onclick="selectTracker('live')" class="w-full p-4 border-2 border-primary-500 rounded-lg text-left hover:bg-primary-50 relative">
        <div class="absolute -top-2 -right-2 bg-red-500 text-white text-xs px-2 py-0.5 rounded-full">
          LIVE
        </div>
        <div class="font-medium text-primary-700">Live Broadcast Tracker</div>
        <div class="text-sm text-gray-500">Broadcast to fans in real-time</div>
        <div class="text-xs text-primary-600 mt-1">Fans can watch, chat, and react!</div>
      </button>
    </div>

    <button onclick="closeTrackerModal()" class="mt-4 w-full py-2 text-gray-500">
      Cancel
    </button>
  </div>
</div>
*/

function selectTracker(type) {
  const gameId = pendingTrackGameId;
  closeTrackerModal();

  switch (type) {
    case 'standard':
      window.location.href = `track.html#teamId=${currentTeamId}&gameId=${gameId}`;
      break;
    case 'basketball':
      window.location.href = `track-basketball.html#teamId=${currentTeamId}&gameId=${gameId}`;
      break;
    case 'live':
      window.location.href = `live-tracker.html#teamId=${currentTeamId}&gameId=${gameId}`;
      break;
  }
}

// Also add "Copy Live Link" button next to games that support live tracking
// In the renderSchedule() function, add for each game:

/*
${isBasketballConfig(game.statTrackerConfigId) ? `
  <button onclick="copyLiveLink('${game.id}')" class="text-sm text-primary-600 hover:text-primary-800">
    <svg class="w-4 h-4 inline"><!-- link icon --></svg>
    Copy Live Link
  </button>
` : ''}

// Add "Watch Replay" button for completed live-tracked games
${game.liveStatus === 'completed' ? `
  <a href="live-game.html?teamId=${currentTeamId}&gameId=${game.id}&replay=true"
     class="text-sm text-primary-600 hover:text-primary-800 flex items-center gap-1">
    <svg class="w-4 h-4"><!-- play icon --></svg>
    Watch Replay
  </a>
` : ''}
*/

function copyLiveLink(gameId) {
  const url = `${window.location.origin}/live-game.html?teamId=${currentTeamId}&gameId=${gameId}`;
  navigator.clipboard.writeText(url);
  showToast('Live game link copied!');
}

function watchReplay(gameId) {
  window.location.href = `live-game.html?teamId=${currentTeamId}&gameId=${gameId}&replay=true`;
}
```

---

### 7. team.html Changes

**Add "Watch Live" indicator to game cards:**

```javascript
// In the renderSchedule() function, add live indicator:

function renderGameCard(game) {
  const isLive = game.liveStatus === 'live';

  return `
    <div class="bg-white rounded-lg shadow p-4 ${isLive ? 'ring-2 ring-red-500' : ''}">
      ${isLive ? `
        <div class="flex items-center gap-2 mb-2">
          <span class="w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>
          <span class="text-red-600 text-sm font-medium">LIVE NOW</span>
        </div>
      ` : ''}

      <div class="flex justify-between items-center">
        <div>
          <div class="font-medium">${game.opponent}</div>
          <div class="text-sm text-gray-500">${formatDate(game.date)}</div>
        </div>

        ${isLive ? `
          <a href="live-game.html?teamId=${teamId}&gameId=${game.id}"
             class="bg-red-500 text-white px-4 py-2 rounded-lg font-medium flex items-center gap-2">
            <span class="w-2 h-2 bg-white rounded-full animate-pulse"></span>
            Watch Live
          </a>
        ` : game.status === 'completed' ? `
          <div class="flex items-center gap-3">
            <a href="game.html?teamId=${teamId}&gameId=${game.id}"
               class="text-primary-600 hover:text-primary-800">
              View Report
            </a>
            ${game.liveStatus === 'completed' ? `
              <a href="live-game.html?teamId=${teamId}&gameId=${game.id}&replay=true"
                 class="text-teal-600 hover:text-teal-800 flex items-center gap-1">
                <svg class="w-4 h-4"><!-- play icon --></svg>
                Replay
              </a>
            ` : ''}
          </div>
        ` : ''}
      </div>
    </div>
  `;
}
```

---

### 8. index.html Changes

**Add "Live Games" section:**

```html
<!-- Add after the hero section or features section -->

<!-- LIVE GAMES SECTION -->
<section id="live-games-section" class="py-12 bg-gray-50">
  <div class="max-w-6xl mx-auto px-4">
    <div class="flex justify-between items-center mb-6">
      <h2 class="text-2xl font-bold text-gray-900">
        <span class="text-red-500">&#9679;</span> Live & Upcoming Games
      </h2>
      <a href="#" class="text-primary-600 hover:text-primary-800 text-sm">View All</a>
    </div>

    <div id="live-games-list" class="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
      <!-- Games render here -->
      <div class="text-center py-8 text-gray-500 col-span-full">
        Loading games...
      </div>
    </div>
  </div>
</section>
```

```javascript
// Add to the page's init script:

async function loadLiveGames() {
  const container = document.getElementById('live-games-list');

  try {
    // Get live games first
    const liveGames = await getLiveGamesNow();

    // Get upcoming games
    const upcomingGames = await getUpcomingLiveGames(6);

    // Combine, with live games first
    const allGames = [
      ...liveGames.map(g => ({ ...g, isLive: true })),
      ...upcomingGames.filter(g => !liveGames.find(lg => lg.id === g.id))
    ].slice(0, 6);

    if (allGames.length === 0) {
      container.innerHTML = `
        <div class="text-center py-8 text-gray-500 col-span-full">
          No upcoming live games scheduled
        </div>
      `;
      return;
    }

    container.innerHTML = allGames.map(game => `
      <a href="live-game.html?teamId=${game.team?.id}&gameId=${game.id}"
         class="block bg-white rounded-lg shadow hover:shadow-lg transition-shadow p-4 ${game.isLive ? 'ring-2 ring-red-500' : ''}">

        ${game.isLive ? `
          <div class="flex items-center gap-2 mb-2">
            <span class="w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>
            <span class="text-red-600 text-xs font-medium uppercase">Live Now</span>
            ${game.liveViewerCount ? `
              <span class="text-gray-400 text-xs">${game.liveViewerCount} watching</span>
            ` : ''}
          </div>
        ` : ''}

        <div class="flex items-center gap-3 mb-2">
          ${game.team?.photoUrl ?
            `<img src="${game.team.photoUrl}" class="w-10 h-10 rounded-full object-cover">` :
            `<div class="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center text-primary-600 font-bold">
              ${game.team?.name?.[0] || '?'}
            </div>`
          }
          <div>
            <div class="font-medium text-gray-900">${game.team?.name || 'Team'}</div>
            <div class="text-sm text-gray-500">vs ${game.opponent}</div>
          </div>
        </div>

        ${game.isLive ? `
          <div class="text-2xl font-bold text-center py-2">
            ${game.homeScore || 0} - ${game.awayScore || 0}
          </div>
        ` : `
          <div class="text-sm text-gray-500">
            ${formatDateTime(game.date)}
          </div>
        `}

        <div class="mt-2 text-center">
          <span class="text-primary-600 text-sm font-medium">
            ${game.isLive ? 'Watch Now &#8594;' : 'Set Reminder'}
          </span>
        </div>
      </a>
    `).join('');

  } catch (error) {
    console.error('Failed to load live games:', error);
    container.innerHTML = `
      <div class="text-center py-8 text-gray-500 col-span-full">
        Unable to load games
      </div>
    `;
  }
}

// Call on page load
loadLiveGames();
loadPastGames();
```

**Add "Past Games / Replays" section:**

```html
<!-- PAST GAMES / REPLAYS SECTION -->
<section id="past-games-section" class="py-12 bg-white">
  <div class="max-w-6xl mx-auto px-4">
    <div class="flex justify-between items-center mb-6">
      <h2 class="text-2xl font-bold text-gray-900">
        Recent Replays
      </h2>
      <a href="#" class="text-primary-600 hover:text-primary-800 text-sm">View All</a>
    </div>

    <div id="past-games-list" class="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
      <!-- Games render here -->
      <div class="text-center py-8 text-gray-500 col-span-full">
        Loading replays...
      </div>
    </div>
  </div>
</section>
```

```javascript
async function loadPastGames() {
  const container = document.getElementById('past-games-list');

  try {
    // Get recently completed live-tracked games
    const pastGames = await getRecentLiveTrackedGames(6);

    if (pastGames.length === 0) {
      container.innerHTML = `
        <div class="text-center py-8 text-gray-500 col-span-full">
          No recent replays available
        </div>
      `;
      return;
    }

    container.innerHTML = pastGames.map(game => `
      <a href="live-game.html?teamId=${game.team?.id}&gameId=${game.id}&replay=true"
         class="block bg-white rounded-lg shadow hover:shadow-lg transition-shadow p-4 border border-gray-100">

        <div class="flex items-center gap-3 mb-3">
          ${game.team?.photoUrl ?
            `<img src="${game.team.photoUrl}" class="w-10 h-10 rounded-full object-cover">` :
            `<div class="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center text-primary-600 font-bold">
              ${game.team?.name?.[0] || '?'}
            </div>`
          }
          <div>
            <div class="font-medium text-gray-900">${game.team?.name || 'Team'}</div>
            <div class="text-sm text-gray-500">vs ${game.opponent}</div>
          </div>
        </div>

        <div class="text-2xl font-bold text-center py-2 text-gray-900">
          ${game.homeScore || 0} - ${game.awayScore || 0}
        </div>

        <div class="text-xs text-gray-400 text-center mb-2">
          ${formatDate(game.date)}
        </div>

        <div class="mt-2 text-center">
          <span class="text-teal-600 text-sm font-medium flex items-center justify-center gap-1">
            <svg class="w-4 h-4"><!-- play icon --></svg>
            Watch Replay
          </span>
        </div>
      </a>
    `).join('');

  } catch (error) {
    console.error('Failed to load past games:', error);
    container.innerHTML = `
      <div class="text-center py-8 text-gray-500 col-span-full">
        Unable to load replays
      </div>
    `;
  }
}
```

---

### 9. game.html Changes

**Add "Watch Replay" button for live-tracked games:**

```javascript
// In the game.html initialization, check if game was live-tracked

async function init() {
  // ... existing game loading code ...

  const game = await getGame(teamId, gameId);

  // Check if this game has replay available
  if (game.liveStatus === 'completed') {
    showReplayButton(teamId, gameId);
  }
}

function showReplayButton(teamId, gameId) {
  // Add replay button near the score/header area
  const headerArea = document.querySelector('#game-header') || document.querySelector('.game-score');

  const replayBtn = document.createElement('a');
  replayBtn.href = `live-game.html?teamId=${teamId}&gameId=${gameId}&replay=true`;
  replayBtn.className = 'inline-flex items-center gap-2 bg-teal-500 text-white px-4 py-2 rounded-lg font-medium hover:bg-teal-600 transition-colors mt-4';
  replayBtn.innerHTML = `
    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"></path>
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
    </svg>
    Watch Replay
  `;

  headerArea?.appendChild(replayBtn);
}
```

**HTML location for replay button:**

```html
<!-- In game.html, add a container for the replay button in the header area -->
<div id="game-header" class="text-center py-6">
  <div class="text-sm text-gray-500">${formatDate(game.date)}</div>
  <div class="text-3xl font-bold my-2">
    <span>${game.homeScore}</span>
    <span class="text-gray-400 mx-2">-</span>
    <span>${game.awayScore}</span>
  </div>
  <div class="text-lg text-gray-700">vs ${game.opponent}</div>

  <!-- Replay button will be injected here if game.liveStatus === 'completed' -->
  <div id="replay-button-container"></div>
</div>
```

---

### 10. firestore.rules Changes

**Add rules for new collections:**

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // ... existing rules ...

    match /teams/{teamId}/games/{gameId} {
      // ... existing game rules ...

      // Live Events - tracker can write, anyone can read
      match /liveEvents/{eventId} {
        allow read: if true;  // Public read for viewers
        allow create: if isTeamOwnerOrAdmin(teamId);  // Only tracker (authenticated)
        allow update, delete: if false;  // Events are immutable
      }

      // Live Chat - anyone can read and write (with rate limiting in app)
      match /liveChat/{messageId} {
        allow read: if true;  // Public read
        allow create: if true;  // Anyone can post (anonymous or authenticated)
        allow update: if false;  // Messages are immutable
        allow delete: if isTeamOwnerOrAdmin(teamId);  // Moderation
      }

      // Live Reactions - ephemeral, anyone can read/write
      match /liveReactions/{reactionId} {
        allow read: if true;
        allow create: if true;
        allow update, delete: if false;
      }
    }
  }
}
```

---

## Data Models

### Live Event Document
**Collection:** `teams/{teamId}/games/{gameId}/liveEvents/{eventId}`

```typescript
interface LiveEvent {
  id: string;                    // Auto-generated
  type: 'stat' | 'substitution' | 'period_change' | 'timeout';
  playerId?: string;             // Player who performed action
  playerName?: string;           // Cached for display
  playerNumber?: string;         // Cached for display
  statKey?: string;              // pts, reb, ast, stl, to, fouls
  value?: number;                // Delta (+1, +2, +3, -1)
  period: string;                // Q1, Q2, Q3, Q4, OT
  gameClockMs: number;           // Milliseconds elapsed
  homeScore: number;             // Running score after event
  awayScore: number;             // Running score after event
  isOpponent: boolean;           // True if opponent player
  opponentPlayerName?: string;   // If isOpponent
  description: string;           // Human-readable ("John Smith 2pt shot")
  createdAt: Timestamp;          // Server timestamp
  createdBy: string;             // UID of stat keeper
}
```

### Live Chat Message Document
**Collection:** `teams/{teamId}/games/{gameId}/liveChat/{messageId}`

```typescript
interface LiveChatMessage {
  id: string;                    // Auto-generated
  text: string;                  // Message content
  senderId: string | null;       // UID or null for anonymous
  senderName: string;            // Display name or "Fan1234"
  senderPhotoUrl?: string;       // Profile photo if authenticated
  isAnonymous: boolean;          // True if not logged in
  createdAt: Timestamp;          // Server timestamp

  // AI response fields (optional)
  ai?: boolean;                  // True if AI response
  aiQuestion?: string;           // Original question
  aiMeta?: {                     // AI context metadata
    statsRequested: boolean;
    eventsRequested: boolean;
  };
}
```

### Live Reaction Document
**Collection:** `teams/{teamId}/games/{gameId}/liveReactions/{reactionId}`

```typescript
interface LiveReaction {
  id: string;                    // Auto-generated
  type: 'fire' | 'clap' | 'wow' | 'heart' | 'hundred';
  senderId: string;              // UID or anon identifier
  createdAt: Timestamp;          // Server timestamp
}
```

### Game Document Updates
**Document:** `teams/{teamId}/games/{gameId}`

```typescript
// New fields added to existing game document
interface GameLiveFields {
  liveStatus?: 'scheduled' | 'live' | 'completed';
  liveStartedAt?: Timestamp;     // When broadcast started
  liveViewerCount?: number;      // Current viewer count
}
```

---

## Error Handling

### Tracker Error Handling

| Scenario | Handling |
|----------|----------|
| Firestore write fails | Log error, add to retry queue, continue tracking |
| Retry queue grows > 100 | Warn stat keeper (non-blocking toast) |
| Network disconnect | Continue tracking locally, retry queue on reconnect |
| Chat subscription fails | Show "Chat unavailable" message, tracking continues |
| Auth token expires | Attempt silent refresh, show login prompt if fails |

### Viewer Error Handling

| Scenario | Handling |
|----------|----------|
| Game not found | Show "Game not found" error page |
| Team not found | Show "Team not found" error page |
| Subscription fails | Show "Connection lost" banner, auto-retry |
| Chat post fails | Show error toast, keep message in input |
| Reaction send fails | Silent fail (reactions are ephemeral) |

---

## Testing Strategy

### Unit Tests

| Component | Tests |
|-----------|-------|
| `broadcastEvent()` | Event data formatting, retry logic |
| `processNewEvents()` | State updates, score calculation |
| `formatClock()` | Time formatting edge cases |
| `generateAnonName()` | Format validation |
| `replayTick()` | Timing accuracy, event sequencing |

### Integration Tests

| Flow | Test Cases |
|------|------------|
| Tracker → Viewer | Event appears within 3 seconds |
| Chat round-trip | Message appears for all viewers |
| Reaction broadcast | Reaction visible to all viewers |
| Viewer presence | Count increments/decrements correctly |
| Replay mode | Events replay in correct order and timing |

### Manual Testing Checklist

- [ ] Tracker works offline (events queue locally)
- [ ] Viewer shows correct state when joining mid-game
- [ ] Chat works for anonymous users
- [ ] Reactions rate-limit properly
- [ ] Replay speed controls work correctly
- [ ] Mobile layout is usable
- [ ] Animations perform at 60fps on mobile
- [ ] Browser back/forward navigation works
- [ ] Page refresh doesn't break viewer state

---

## Summary: Files to Create/Modify

### New Files (4)
| File | Description |
|------|-------------|
| `live-tracker.html` | Live tracker page with chat panel |
| `js/live-tracker.js` | Live tracker logic with broadcasting |
| `live-game.html` | Spectator viewer page |
| `js/live-game.js` | Viewer logic with subscriptions |

### Modified Files (6)
| File | Changes |
|------|---------|
| `js/db.js` | Add 13 new functions for live events, chat, reactions, presence, replays |
| `edit-schedule.html` | Add "Live Tracker" option to modal, "Copy Live Link", "Watch Replay" buttons |
| `team.html` | Add "Watch Live" indicator + "Watch Replay" link on game cards |
| `game.html` | Add "Watch Replay" button for live-tracked games |
| `index.html` | Add "Live & Upcoming Games" + "Recent Replays" sections |
| `firestore.rules` | Add rules for liveEvents, liveChat, liveReactions |
