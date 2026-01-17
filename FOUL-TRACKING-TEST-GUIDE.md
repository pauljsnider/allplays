# Testing Guide: Foul Tracking & Score Undo Bug Fix

## Overview
This PR fixes critical bugs and adds foul tracking to the basketball tracker:
- **Bug Fix**: Score undo/remove now properly updates scores
- **New Feature**: Per-player foul tracking with visual warnings
- **New Feature**: Fouls displayed in all stats views (game, player, team)

**Branch:** `claude/fix-score-add-fouls-KY9Am`

---

## 🎯 Critical Test Areas

### 1. Score Undo/Remove Bug Fix

#### Test 1.1: Undo Score Updates Score Correctly
**Setup:**
- Open track-basketball.html with a basketball game
- Add 5 players to the court
- Start the game timer

**Steps:**
1. Add 2 points to player #24 (click "+2" button)
2. Observe home score increases by 2 (e.g., 0 → 2)
3. Click the "Undo" button (circular arrow)
4. **Expected:** Home score decreases by 2 (back to 0)
5. **Expected:** Player #24's PTS stat returns to previous value
6. **Expected:** Event is removed from game log

**Pass Criteria:** ✅ Score and stats correctly revert on undo

---

#### Test 1.2: Remove Event from Log Updates Score
**Setup:**
- Game in progress with some scoring events

**Steps:**
1. Add 3 points to player #10 (click "+3" button)
2. Observe: Home score increases by 3, log shows "#10 PTS +3"
3. Add 2 rebounds to player #10
4. Find the "+3 PTS" event in the game log
5. Click the "X" button on that specific event
6. **Expected:** Home score decreases by 3
7. **Expected:** Player #10's PTS decreases by 3
8. **Expected:** Rebounds stay the same (not affected)
9. **Expected:** Event removed from log

**Pass Criteria:** ✅ Removing events reverses stat changes and updates score

---

#### Test 1.3: Remove Non-Points Event Doesn't Affect Score
**Setup:**
- Game in progress

**Steps:**
1. Current score is 10-8
2. Add 1 rebound to player #5
3. Remove that rebound event from log (click X)
4. **Expected:** Rebounds decrease by 1
5. **Expected:** Score remains 10-8 (unchanged)

**Pass Criteria:** ✅ Non-scoring stats don't affect score when removed

---

#### Test 1.4: Remove Opponent Score Updates Away Score
**Setup:**
- Game in progress with opponent players added

**Steps:**
1. Add opponent player "John Doe"
2. Add 2 points to John Doe (opponent)
3. Observe away score increases by 2
4. Remove that event from log
5. **Expected:** Away score decreases by 2
6. **Expected:** John Doe's PTS decreases by 2

**Pass Criteria:** ✅ Opponent score removal works correctly

---

### 2. Foul Tracking - Basic Functionality

#### Test 2.1: Add Foul to Team Player
**Setup:**
- Game in progress with players on court

**Steps:**
1. Find player #24 card on the live tracker
2. Observe foul display shows "FOULS: 0" with gray background
3. Click the "+FOUL" button (orange button)
4. **Expected:** Foul count increases to "FOULS: 1"
5. **Expected:** Background stays gray (normal)
6. **Expected:** Game log shows "#24 FOULS +1"
7. Click "+FOUL" two more times
8. **Expected:** Foul count now shows "FOULS: 3"

**Pass Criteria:** ✅ Foul tracking increments correctly for team players

---

#### Test 2.2: Add Foul to Opponent Player
**Setup:**
- Game in progress with opponent players added

**Steps:**
1. Go to "Opponents" tab
2. Add opponent "Jane Smith"
3. Observe foul display shows "FOULS: 0" with gray background
4. Click the "+FOUL" button for Jane Smith
5. **Expected:** Foul count increases to "FOULS: 1"
6. **Expected:** Game log shows "Opp Jane Smith FOULS +1"

**Pass Criteria:** ✅ Foul tracking works for opponents

---

#### Test 2.3: Foul Visual Warnings - 4 Fouls
**Setup:**
- Game in progress

**Steps:**
1. Add 4 fouls to player #10 (click "+FOUL" four times)
2. **Expected:** Foul display shows "FOULS: 4 ⚠️"
3. **Expected:** Background changes to amber/yellow (bg-amber-500)
4. **Expected:** White text on amber background

**Pass Criteria:** ✅ Warning color appears at 4 fouls

---

#### Test 2.4: Foul Visual Warnings - 5+ Fouls (Fouled Out)
**Setup:**
- Game in progress

**Steps:**
1. Add 5 fouls to player #15
2. **Expected:** Foul display shows "FOULS: 5 FOULED OUT!"
3. **Expected:** Background changes to red (bg-red-600)
4. **Expected:** White text on red background
5. Add one more foul (6 total)
6. **Expected:** Still shows red background with "FOULED OUT!"

**Pass Criteria:** ✅ Red warning appears at 5+ fouls

---

### 3. Foul Undo/Remove Functionality

#### Test 3.1: Undo Foul
**Setup:**
- Player has 3 fouls

**Steps:**
1. Click "+FOUL" to give player 4 fouls (amber warning should appear)
2. Click "Undo" button
3. **Expected:** Foul count returns to 3
4. **Expected:** Amber warning disappears (returns to gray)
5. **Expected:** Log entry removed

**Pass Criteria:** ✅ Undo works for fouls

---

#### Test 3.2: Remove Foul Event from Log
**Setup:**
- Player has 4 fouls (amber warning showing)

**Steps:**
1. Find a foul event in the game log (e.g., "#10 FOULS +1")
2. Click the "X" button to remove it
3. **Expected:** Foul count decreases by 1 (4 → 3)
4. **Expected:** Amber warning disappears (returns to gray)
5. **Expected:** Event removed from log

**Pass Criteria:** ✅ Removing foul events updates foul count and warnings

---

#### Test 3.3: Remove Foul Below Fouled Out Threshold
**Setup:**
- Player has 5 fouls (red "FOULED OUT!" showing)

**Steps:**
1. Remove one foul event from log
2. **Expected:** Foul count becomes 4
3. **Expected:** Display changes from red "FOULED OUT!" to amber "⚠️"

**Pass Criteria:** ✅ Warning level updates when fouls decrease

---

### 4. Stats Persistence & Display

#### Test 4.1: Fouls Saved to Firestore
**Setup:**
- Complete a game with foul tracking

**Steps:**
1. Add fouls to several players during game
2. Player #5: 2 fouls
3. Player #10: 4 fouls
4. Player #15: 5 fouls
5. Click "Finish" tab, then "Save & Complete"
6. Wait for redirect to game.html
7. **Expected:** Player stats table includes "FOULS" column
8. **Expected:** Player #5 shows 2 fouls
9. **Expected:** Player #10 shows 4 fouls
10. **Expected:** Player #15 shows 5 fouls

**Pass Criteria:** ✅ Fouls saved correctly to database

---

#### Test 4.2: Fouls Display in Game Stats View
**Setup:**
- Completed game with fouls tracked

**Steps:**
1. Open game.html for the completed game
2. Check "Player Performance" table
3. **Expected:** "FOULS" column appears (even if not in original config)
4. **Expected:** All player foul counts displayed correctly
5. Scroll to "Opponent Stats" table
6. **Expected:** "FOULS" column appears for opponents
7. **Expected:** Opponent foul counts displayed

**Pass Criteria:** ✅ Fouls appear in game stats view

---

#### Test 4.3: Fouls in Player Season Stats
**Setup:**
- Player has multiple completed games with fouls

**Steps:**
1. Open player.html for a player
2. Click "Season Averages" tab
3. **Expected:** Season stats grid includes "FOULS"
4. **Expected:** Shows total fouls across all games
5. **Expected:** Shows average fouls per game (e.g., "2.3 per game")
6. Click "Game Stats" tab
7. **Expected:** Each game row shows fouls for that game

**Pass Criteria:** ✅ Fouls aggregate correctly in player stats

---

#### Test 4.4: Fouls in Email Recap
**Setup:**
- Game ready to complete

**Steps:**
1. Finish a game with various foul counts
2. Click "Finish" tab
3. Click "Generate Email" button
4. **Expected:** Email body includes "FOULS: X" for each player
5. **Expected:** Opponent section includes fouls if tracked

**Pass Criteria:** ✅ Fouls included in email recap

---

#### Test 4.5: Fouls in AI Summary
**Setup:**
- Game ready to complete with fouls tracked

**Steps:**
1. Click "Finish" tab
2. Click "AI Summary" button
3. Wait for AI generation
4. **Expected:** AI summary mentions fouls if significant (e.g., player fouled out)
5. Check that foul data was provided to AI (check console for context if needed)

**Pass Criteria:** ✅ Foul data available to AI summary

---

### 5. Edge Cases & Regression Testing

#### Test 5.1: Fouls Work Without Being in Config Columns
**Setup:**
- Team with basketball config
- Config columns: ['PTS', 'REB', 'AST'] (no FOULS listed)

**Steps:**
1. Track a game with this config
2. Add fouls to players
3. **Expected:** Fouls still track and display
4. Complete game
5. **Expected:** Fouls still saved to database

**Pass Criteria:** ✅ Fouls always available regardless of config

---

#### Test 5.2: Empty Config Still Includes Fouls
**Setup:**
- Game with no stat config assigned

**Steps:**
1. Track game
2. **Expected:** Can still add fouls
3. Complete game
4. **Expected:** Fouls saved

**Pass Criteria:** ✅ Fouls work even without config

---

#### Test 5.3: Fouls Don't Affect Score
**Setup:**
- Game in progress, score is 20-15

**Steps:**
1. Add 3 fouls to a player
2. **Expected:** Score remains 20-15 (unchanged)
3. Remove 1 foul from log
4. **Expected:** Score still 20-15

**Pass Criteria:** ✅ Fouls are tracked independently from score

---

#### Test 5.4: Multiple Stat Removals in Sequence
**Setup:**
- Player has: 12 PTS, 5 REB, 2 AST, 3 FOULS

**Steps:**
1. Remove a +2 PTS event → check score decreases
2. Remove a +1 REB event → check rebounds decrease
3. Remove a +1 FOUL event → check fouls decrease
4. **Expected:** All stats update correctly
5. **Expected:** Only PTS removal affects score

**Pass Criteria:** ✅ Multiple removals work independently

---

#### Test 5.5: Game with No Fouls Tracked
**Setup:**
- Track a game but don't add any fouls

**Steps:**
1. Complete game without clicking any +FOUL buttons
2. **Expected:** Game completes successfully
3. Check game.html
4. **Expected:** FOULS column shows 0 for all players
5. Check player.html
6. **Expected:** Season stats include 0 fouls

**Pass Criteria:** ✅ System handles games with no fouls gracefully

---

#### Test 5.6: Existing Games Unaffected
**Setup:**
- Game completed BEFORE this PR was merged (no foul tracking)

**Steps:**
1. Open old game in game.html
2. **Expected:** Stats display correctly
3. **Expected:** No errors in console
4. **Expected:** FOULS column may not appear (or shows 0)

**Pass Criteria:** ✅ Old games still work

---

### 6. Integration Testing

#### Test 6.1: Full Game Flow with Fouls
**End-to-end test:**

1. Create new basketball game
2. Start tracking (choose Beta tracker)
3. Add 5 players to court
4. Start timer
5. Track 10 minutes of gameplay:
   - Add various scores (2pt, 3pt)
   - Add rebounds, assists
   - Add fouls to multiple players
   - Get one player to 5 fouls (fouled out)
6. Make substitutions
7. Complete all quarters
8. Go to Finish tab
9. Verify playing time report
10. Generate email recap → check fouls included
11. Save & Complete
12. Check game.html → verify all stats including fouls
13. Check player.html for fouled-out player → verify fouls in season totals

**Pass Criteria:** ✅ Complete flow works end-to-end

---

#### Test 6.2: Undo After Multiple Actions
**Complex undo scenario:**

1. Player #10 has: 8 PTS, 3 REB, 2 FOULS
2. Add +2 PTS (now 10 PTS)
3. Add +1 REB (now 4 REB)
4. Add +1 FOUL (now 3 FOULS)
5. Undo (removes foul)
6. **Expected:** Back to 10 PTS, 4 REB, 2 FOULS
7. Undo again (removes rebound)
8. **Expected:** Back to 10 PTS, 3 REB, 2 FOULS
9. Undo again (removes points)
10. **Expected:** Back to 8 PTS, 3 REB, 2 FOULS

**Pass Criteria:** ✅ Undo stack works correctly in sequence

---

## 📊 Automated Tests

Run the automated test suite:
```bash
# Open in browser
open test-foul-tracking.html
# Or serve with:
python3 -m http.server 8004
# Then visit: http://127.0.0.1:8004/test-foul-tracking.html
```

**Expected Results:**
- ✅ All tests pass (29/29)
- statDefaults Function: 4 tests
- Foul Warning Colors: 7 tests
- Points Column Detection: 5 tests
- Score Undo/Remove Logic: 6 tests
- Stats Persistence: 4 tests
- Opponent Stats: 3 tests

---

## 🐛 Known Issues / Limitations

None identified. All changes are backward compatible.

**Note:** Foul popups were removed per user feedback. Visual warnings on player cards are sufficient.

---

## 📝 Testing Checklist

### Bug Fix Verification
- [ ] Undo button reverses score changes
- [ ] Remove event (X button) reverses score changes
- [ ] Removing non-points stats doesn't affect score
- [ ] Opponent score removals work correctly

### Foul Tracking - Basic
- [ ] Can add fouls to team players
- [ ] Can add fouls to opponents
- [ ] Foul count increments correctly
- [ ] Foul events appear in game log

### Foul Warnings
- [ ] 0-3 fouls: Gray background
- [ ] 4 fouls: Amber background with ⚠️
- [ ] 5+ fouls: Red background with "FOULED OUT!"

### Foul Undo/Remove
- [ ] Undo button works for fouls
- [ ] Remove foul event from log works
- [ ] Warning colors update when fouls decrease

### Stats Persistence
- [ ] Fouls saved to Firestore
- [ ] Fouls display in game.html stats table
- [ ] Fouls display in player.html season stats
- [ ] Fouls included in email recap
- [ ] Fouls included in AI summary context

### Edge Cases
- [ ] Fouls work without config
- [ ] Fouls don't affect score
- [ ] Multiple stat removals work
- [ ] Games with no fouls complete successfully
- [ ] Old games without fouls still work

### Integration
- [ ] Full game flow works end-to-end
- [ ] Complex undo sequences work correctly

---

## ✅ Sign-Off

**Tested By:** _____________
**Date:** _____________
**Environment:** Desktop / Mobile / Both
**Browser:** Chrome / Safari / Firefox / Other: _____________

**Results:**
- [ ] All bug fix tests passed
- [ ] All foul tracking tests passed
- [ ] All visual warning tests passed
- [ ] All persistence tests passed
- [ ] Edge cases handled correctly
- [ ] Automated tests pass (29/29)
- [ ] No issues found

**Notes:**
_______________________________________
_______________________________________
_______________________________________
