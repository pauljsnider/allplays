# Track.html Refactoring Recommendation

## Current Architecture Issues

### Problem 1: Real-time Firebase Writes
Currently, `track.html` writes to Firebase in real-time for every stat change:
- Every stat increment triggers a `logStatEvent()` call (creates an event document)
- Every stat increment triggers an `updatePlayerStats()` call (updates aggregated stats)
- This happens for BOTH team players AND opponent players
- Results in hundreds of Firebase writes per game

### Problem 2: Undo Button Inconsistency
The undo button has different behavior for team vs opponent stats:
- **Team players**: Undo writes a negative event to Firebase (lines 949-964)
- **Opponent players**: Undo only updates local state, NOT Firebase (lines 937-942)
- This creates data inconsistency and confusing behavior

### Problem 3: Opponent Stats Not Persisted Until End
Opponent stats are only saved when the game finishes (line 1212):
```javascript
await updateGame(currentTeamId, currentGameId, {
    opponentStats: gameState.opponentStats
});
```

This means if the user refreshes mid-game, all opponent stats are lost.

## Recommended Solution: In-Memory Tracking with Single DB Write

### Benefits
1. **Simplicity**: All game data stays in memory until completion
2. **Performance**: Drastically reduces Firebase writes (hundreds → ~10)
3. **Cost**: Lower Firebase usage = lower costs
4. **Consistency**: Undo works the same for all players
5. **Reliability**: Single transaction at end = all-or-nothing save

### Proposed Architecture

```javascript
// Game state stays entirely in memory
gameState = {
    startTime: null,
    elapsed: 0,
    isRunning: false,
    currentPeriod: 'Q1',

    // Player stats (in-memory only)
    playerStats: {
        'playerId1': { pts: 5, reb: 3, ast: 2 },
        'playerId2': { pts: 8, reb: 1, ast: 5 }
    },

    // Opponent stats (in-memory only)
    opponentStats: {
        'opp1': { name: 'John Doe', number: '10', pts: 7, reb: 4 }
    },

    // Game log for AI summary
    gameLog: [],

    // Player notes
    playerNotes: {}
};

// On game completion, single write:
async function finishGame() {
    // 1. Write all events to events collection (batch write)
    // 2. Write aggregated player stats (batch write)
    // 3. Update game document with final data
    // All in a single transaction or series of batch writes
}
```

### Implementation Steps

1. **Remove real-time Firebase writes**
   - Remove `logStatEvent()` calls from stat increment functions
   - Remove `updatePlayerStats()` calls from stat increment functions
   - Keep all stats in `gameState` object only

2. **Simplify undo logic**
   - Undo just updates the in-memory `gameState`
   - No Firebase operations needed
   - Works identically for team and opponent players

3. **Add resume capability**
   - Load any existing aggregated stats on page load
   - Merge with current `gameState`
   - Allow continuing a game that was previously started

4. **Batch write on completion**
   ```javascript
   async function finishGame(finalHomeScore, finalAwayScore, summary) {
       const batch = writeBatch(db);

       // Write each event
       gameState.gameLog.forEach(event => {
           const eventRef = doc(collection(db, `teams/${teamId}/games/${gameId}/events`));
           batch.set(eventRef, event);
       });

       // Write aggregated stats for each player
       Object.entries(gameState.playerStats).forEach(([playerId, stats]) => {
           const statsRef = doc(db, `teams/${teamId}/games/${gameId}/aggregatedStats/${playerId}`);
           batch.set(statsRef, { stats });
       });

       // Update game document
       const gameRef = doc(db, `teams/${teamId}/games/${gameId}`);
       batch.update(gameRef, {
           homeScore: finalHomeScore,
           awayScore: finalAwayScore,
           summary,
           status: 'completed',
           opponentStats: gameState.opponentStats
       });

       await batch.commit();
   }
   ```

5. **Add auto-save/draft capability (optional)**
   - Periodically save `gameState` to localStorage
   - On page load, check for draft and offer to resume
   - Provides safety net without Firebase writes

### Migration Path

1. **Phase 1**: Implement new code alongside old (feature flag)
2. **Phase 2**: Test thoroughly with test games
3. **Phase 3**: Switch to new implementation
4. **Phase 4**: Remove old code after validation

### Estimated Effort

- **Time**: 4-6 hours of development + testing
- **Risk**: Low (can keep old code as fallback)
- **Impact**: High (major UX and cost improvement)

## Current Workarounds Applied

Until the refactoring is complete, the following fixes have been applied:

1. ✅ **Opponent stats now load on page reload** (track.html:356-368)
   - Checks `game.opponentStats` and loads if exists

2. ✅ **AI summary includes existing notes** (track.html:1128-1132)
   - Reads gameSummary textarea and includes in AI prompt

3. ⚠️ **Undo for opponent stats still only updates local state**
   - Not persisted to DB until game finishes
   - This is acceptable if we move to the recommended architecture

---

## UX Enhancement Recommendations

Based on coaching workflow feedback, the following improvements would significantly enhance the game tracking experience:

### Important: Sport-Specific Implementation 🏀⚽🏒

These UX recommendations are **basketball-specific** and assume:
- 5 players on court at a time
- Substitution workflow with playing time tracking
- Basketball-specific stat types (PTS, REB, AST, STL, BLK)

**Proposed Architecture: Sport-Specific Tracker Files**

Create dedicated tracking interfaces per sport:
```
track.html              → Generic/fallback tracker (current implementation)
track-basketball.html   → Basketball-optimized tracker (NEW)
track-soccer.html       → Soccer-optimized tracker (future)
track-hockey.html       → Hockey-optimized tracker (future)
```

**Routing Logic in edit-schedule.html:**
```javascript
// When "Track Game" button is clicked
function getTrackerUrl(game, team) {
    // Check if game has a statTrackerConfigId
    if (game.statTrackerConfigId) {
        const config = await getConfig(team.id, game.statTrackerConfigId);

        // Route based on config.baseType
        switch(config.baseType) {
            case 'Basketball':
                return `track-basketball.html#teamId=${team.id}&gameId=${game.id}`;
            case 'Soccer':
                return `track-soccer.html#teamId=${team.id}&gameId=${game.id}`;
            case 'Hockey':
                return `track-hockey.html#teamId=${team.id}&gameId=${game.id}`;
            default:
                return `track.html#teamId=${team.id}&gameId=${game.id}`;
        }
    }

    // Fallback: No config set, use generic tracker
    return `track.html#teamId=${team.id}&gameId=${game.id}`;
}
```

**Current Implementation Note (Dec 2025):**
- Basketball games now show a small chooser modal on Track:
  - Standard → `track.html`
  - Beta → `track-basketball.html`
- This keeps `track.html` passive while allowing opt-in testing of the basketball UX.

**Benefits of Sport-Specific Files:**
- ✅ Sport-specific UX optimizations (e.g., 5 players for basketball, 11 for soccer)
- ✅ Cleaner code - no complex conditional logic for different sports
- ✅ Easier to maintain and test independently
- ✅ Can ship basketball features without affecting other sports
- ✅ Future-proof for adding new sports
- ✅ Smaller file sizes (only load relevant code)

**Alternative Considered: Single File with Conditional Rendering**
- ❌ Single track.html with sport detection
- ❌ Complex if/else branching throughout code
- ❌ Harder to maintain as features diverge
- ❌ Performance impact (loading unused code)
- ❌ Harder to test sport-specific features

**Recommendation: Use Sport-Specific Files (track-basketball.html)**

---

### 1. Core Flow Redesign ⭐ HIGH PRIORITY
*Applies to: track-basketball.html*

**Current State:**
- Game tracking starts immediately with all players visible
- No pre-game lineup selection
- No way to mark players as absent

**Proposed Flow:**
1. **Make Lineup** (Pre-game screen)
   - Select starting 5 players (basketball-specific number)
   - Mark absent players (grayed out, not clickable)
   - Set initial bench players

2. **Start Game** (Begins timer)

3. **Record Stats** (Current tracking interface)

**Benefits:**
- Clearer game start ritual
- Reduces clutter (only show active players initially)
- Prevents accidental stat recording for absent players
- Aligns with real coaching workflow

**Implementation:**
```javascript
gameState = {
    // ... existing fields
    lineup: {
        starters: ['playerId1', 'playerId2', 'playerId3', 'playerId4', 'playerId5'],
        bench: ['playerId6', 'playerId7', 'playerId8'],
        absent: ['playerId9'],
        onCourt: ['playerId1', 'playerId2', 'playerId3', 'playerId4', 'playerId5']
    },
    substitutions: [] // Track sub history for playing time
};
```

### 2. Substitution Workflow ⭐ HIGH PRIORITY
*Applies to: track-basketball.html (5 active players)*

**Current State:**
- No substitution tracking
- All players always visible
- No playing time tracking

**Option A: Per-Player Sub Button**
- Each active player row has a "Sub" button
- Clicking opens modal to select bench player
- Swaps player and logs the substitution

**Option B: Global Sub Button** (Recommended)
- Single "Substitution" button at top of interface
- Opens two-step flow:
  1. Tap player coming OUT
  2. Tap player coming IN
- Only shows 5 active players in main view
- Bench players accessible via sub button

**Benefits:**
- Tracks playing time automatically
- Cleaner UI (only 5 players visible)
- Coaches can ensure fair playing time distribution
- Historical sub data for analysis

**Implementation:**
```javascript
function recordSubstitution(playerOut, playerIn) {
    const currentTime = getGameTime();

    gameState.substitutions.push({
        timestamp: Date.now(),
        gameTime: currentTime,
        period: gameState.currentPeriod,
        out: playerOut,
        in: playerIn
    });

    // Update active lineup
    const index = gameState.lineup.onCourt.indexOf(playerOut);
    gameState.lineup.onCourt[index] = playerIn;

    // Calculate playing time
    updatePlayingTime();

    addLogEntry(`Sub: ${playerOut} → ${playerIn}`);
    renderStatsTable(); // Re-render to show only active players
}

function calculatePlayingTime() {
    // Calculate minutes played for each player based on substitutions
    const playingTime = {};
    // ... algorithm to calculate from gameState.substitutions
    return playingTime;
}
```


### 4. Notes Redesign 💡 MEDIUM PRIORITY

**Current State:**
- Notes field on every player row
- Takes up significant screen space
- Disruptive to stat tracking flow
- Rarely used during live games

**Proposed Changes:**

**A. Remove in-game notes UI**
- Remove notes column from main tracking table
- More screen space for stats
- Less cognitive load during game

**B. Move notes to player detail screen**
- Tap player name → opens detail modal
- Shows cumulative stats for this game
- Notes field available if needed
- Not required/prompted

**C. Post-game AI-assisted notes**
- After finishing game, AI identifies players with zero stats
- Prompts: "Any notes about [Player Name]? (Optional)"
  - Example responses: "Strong defense", "Hustled on every play"
- These get included in AI summary generation
- Provides narrative without in-game disruption

**Implementation:**
```javascript
async function finishGame() {
    // ... existing finish logic

    // After stats saved, prompt for notes on low-stat players
    const playersWithoutStats = players.filter(p => {
        const stats = gameState.playerStats[p.id] || {};
        const totalStats = Object.values(stats).reduce((sum, val) => sum + val, 0);
        return totalStats === 0;
    });

    if (playersWithoutStats.length > 0) {
        await promptForPlayerNotes(playersWithoutStats);
    }
}

async function promptForPlayerNotes(players) {
    // Show modal with list of players
    // Simple textarea for each
    // "Skip" button to bypass
    // Notes get added to game summary context for AI
}
```

### 5. Playing Time Tracking ⏱️ HIGH PRIORITY
*Applies to: track-basketball.html (calculated from substitutions)*

**Current State:**
- No playing time tracking
- Coaches manually track with paper or memory
- No visibility into fair distribution

**Proposed:**
- Automatic calculation based on substitutions
- Display during game (small indicator)
- Full report after game completion
- Include in email summary

**UI During Game:**
```
┌──────────────────────┐
│ #10 Charlotte        │
│ PTS: 8  REB: 3       │
│ 🕐 12:34 playing time│
└──────────────────────┘
```

**Post-Game Report:**
```
PLAYING TIME REPORT
═══════════════════════════════════════
#10 Charlotte C      16:45 (83%)
#21 Vale            14:22 (72%)
#2  Charlotte       12:10 (61%)
#31 Tanvi           10:05 (50%)
#23 Emmie            8:38 (43%)

Fair Play Alert: All players got 40%+ playing time ✓
```



**Implementation:**
- Track when each player enters/exits court via substitutions
- Calculate cumulative time per player
- Show warnings if distribution is uneven (optional)
- Include in post-game summary

### Priority Matrix

| Feature | Priority | Effort | Impact | Dependencies |
|---------|----------|--------|--------|--------------|
| In-memory architecture | HIGH | Medium | Very High | None |
| Lineup selection | HIGH | Low | High | None |
| Substitution tracking | HIGH | Medium | Very High | Lineup selection |
| Playing time display | HIGH | Low | High | Substitution tracking |
| Enhanced undo UI | MEDIUM | Low | Medium | None |
| Remove in-game notes | MEDIUM | Low | Medium | None |
| Post-game AI notes prompt | MEDIUM | Medium | Medium | AI summary feature |

### Recommended Implementation Order

**Phase 1: Foundation** (Addresses technical debt)
1. In-memory architecture refactor
2. Enhanced undo UI

**Phase 2: Lineup & Subs** (Core workflow improvement)
3. Pre-game lineup selection
4. Substitution workflow
5. Playing time tracking

**Phase 3: Notes Refinement** (Polish)
6. Remove in-game notes column
7. Add player detail screen
8. Post-game AI-assisted notes

Phase 4: must include new tracked data to team.html and player.html

### Estimated Total Effort
- **Phase 1**: 6-8 hours
- **Phase 2**: 8-12 hours
- **Phase 3**: 4-6 hours
- **Phase 4**: 3-4 hours (display new data)
- **Total**: 21-30 hours (2-3 sprint weeks)

---

## Implementation Guide: Sport-Specific Routing

### Step 1: Update edit-schedule.html to Route to Correct Tracker

**Current Code** (edit-schedule.html):
```javascript
// Track Game button likely does something like:
window.location.href = `track.html#teamId=${teamId}&gameId=${gameId}`;
```

**Updated Code:**
```javascript
async function handleTrackGame(teamId, gameId) {
    try {
        const game = await getGame(teamId, gameId);

        // Determine which tracker to use based on config
        let trackerUrl = 'track.html'; // Default fallback

        if (game.statTrackerConfigId) {
            const configs = await getConfigs(teamId);
            const config = configs.find(c => c.id === game.statTrackerConfigId);

            if (config) {
                // Route based on sport type
                const trackerMap = {
                    'Basketball': 'track-basketball.html',
                    'Soccer': 'track-soccer.html',
                    'Hockey': 'track-hockey.html'
                };

                trackerUrl = trackerMap[config.baseType] || 'track.html';
            }
        }

        // Navigate to appropriate tracker
        window.location.href = `${trackerUrl}#teamId=${teamId}&gameId=${gameId}`;

    } catch (error) {
        console.error('Error launching tracker:', error);
        // Fallback to generic tracker
        window.location.href = `track.html#teamId=${teamId}&gameId=${gameId}`;
    }
}
```

### Step 2: Create track-basketball.html

**Option A: Copy and Customize** (Faster initial implementation)
1. Copy track.html → track-basketball.html
2. Remove generic features
3. Add basketball-specific features incrementally
4. Keep both files in sync for shared components

**Option B: Shared Component Architecture** (Better long-term)
1. Extract shared logic to `js/tracker-core.js`:
   - Timer functionality
   - Score display
   - Game log
   - Firebase save/load
   - AI summary generation

2. Create sport-specific modules:
   - `js/tracker-basketball.js` (lineup, subs, 5 players)
   - `js/tracker-soccer.js` (11 players, halves, future)
   - `js/tracker-hockey.js` (6 players, periods, future)

3. Each track-*.html imports:
   ```javascript
   import { TrackerCore } from './js/tracker-core.js';
   import { BasketballFeatures } from './js/tracker-basketball.js';

   const tracker = new TrackerCore();
   const basketball = new BasketballFeatures(tracker);
   ```

**Recommendation: Start with Option A, refactor to Option B later**
- Ship basketball features faster
- Learn what's truly sport-specific vs generic
- Refactor once patterns are clear

### Step 3: Ensure Backwards Compatibility

**Games without statTrackerConfigId:**
- Should still route to track.html (generic tracker)
- No breaking changes for existing users

**Games with config but non-basketball:**
- Route to track.html until sport-specific tracker exists
- Graceful degradation

**Update game creation flow:**
- When creating game in edit-schedule.html
- Prompt user to select stat tracker config
- Store `game.statTrackerConfigId` at creation time
- This enables routing to correct tracker

### Step 4: Testing Strategy

**Test Cases:**
1. ✅ Basketball game with config → routes to track-basketball.html
2. ✅ Soccer game with config → routes to track.html (fallback, until track-soccer.html exists)
3. ✅ Game without config → routes to track.html
4. ✅ Invalid config ID → routes to track.html
5. ✅ Config load error → routes to track.html

**Backwards Compatibility:**
1. ✅ Existing games still work with track.html
2. ✅ New basketball games use track-basketball.html
3. ✅ Can switch between trackers if needed (URL change)

### Example: Find Track Game Button in edit-schedule.html

Look for code similar to:
```javascript
// Likely in edit-schedule.html
<button onclick="trackGame('${teamId}', '${gameId}')">Track Game</button>

// Function to update:
function trackGame(teamId, gameId) {
    window.location.href = `track.html#teamId=${teamId}&gameId=${gameId}`;
}
```

Change to:
```javascript
async function trackGame(teamId, gameId) {
    await handleTrackGame(teamId, gameId); // Uses logic from Step 1
}
```

### Phase 4 Requirements: Display New Tracking Data

When substitutions and playing time are implemented, update these pages:

**team.html Enhancements:**
- Average playing time per player across all games
- Playing time distribution chart
- Substitution patterns analytics
- Fair play metrics (% of players getting >40% playing time)

**player.html Enhancements:**
- Playing time per game (timeline chart)
- Substitution history for this player
- In/out patterns (which players subbed with them)
- Playing time trends over season
