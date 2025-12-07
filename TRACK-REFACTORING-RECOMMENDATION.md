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
