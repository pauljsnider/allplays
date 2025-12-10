# Substitutions Workflow Updates

## Issues Fixed

### 1. Detailed Event Logging ✅
**Problem:** Events weren't showing player names in substitution logs

**Solution:**
- All substitution events now include both player numbers AND names
- Individual swaps: `Sub: #1 Avery → #15 Reese`
- Queue applications log each swap individually for clarity
- Easy to scan and understand who substituted for whom

### 2. Persistent Queue Workflow ✅
**Problem:** Queue was lost when closing the modal, making it hard to plan ahead

**Solution - New "Queue & Apply Later" Workflow:**

#### Building a Queue:
1. Click "Subs" button
2. Switch to "Queue Multiple" mode
3. Build your substitution plan (player out → player in)
4. **Close the modal** - queue persists!

#### Queue Persistence:
- Queue stays in memory even when modal is closed
- "Subs" button shows count: "Subs (2 queued)"
- Teal "Apply Now" button appears in main UI showing queue count
- Perfect for planning timeout substitutions in advance

#### Applying the Queue:
**Two ways to apply:**

**Option A - Quick Apply (Main UI):**
- Just click the "Apply Now" button in the main UI
- No need to reopen modal
- Fast and efficient for timeouts

**Option B - Via Modal:**
- Click "Subs" to reopen
- Modal automatically switches to Queue Multiple mode
- Shows your queued swaps
- Click "Apply X Swaps"

#### Auto-Detection:
- If you have a queue and open the modal, it automatically switches to Queue Multiple mode
- No manual mode switching needed
- Queue is always visible when it exists

## Use Cases

### Planning Ahead (New!)
**Scenario:** You know you want to make multiple subs at the next timeout

1. During live play, click "Subs"
2. Switch to "Queue Multiple"
3. Plan your swaps: #1→#15, #4→#20, #7→#23
4. Close modal - queue persists
5. When timeout happens, click "Apply Now" in main UI
6. All 3 swaps execute instantly

### Quick Single Swap (Existing)
**Scenario:** Need to make one substitution right now

1. Click "Subs"
2. Tap player on court
3. Tap replacement
4. Click "Make Swap"
5. Done!

### Multiple Swaps During Timeout (Existing)
**Scenario:** Making multiple swaps during an active timeout

1. Click "Subs"
2. Switch to "Queue Multiple"
3. Build queue with multiple swaps
4. Click "Apply 3 Swaps"
5. All execute at once

## UI Enhancements

### Main UI:
- **Teal alert bar** appears when queue exists
- Shows count: "Ready to apply 2 queued swap(s)"
- Big "Apply Now" button for instant application
- Disappears when queue is applied

### Modal:
- Queue display always visible in Queue Multiple mode
- Shows exact swaps: `#1 → #15  #4 → #20`
- Count badge updates live
- Clear All button to reset queue

### Event Log:
- Detailed logging with player names
- Each swap logged individually
- Easy to audit and review
- Timestamps for all events

## Technical Implementation

### New Features:
- `applyQueue(closeModal)` - Optional parameter to control modal behavior
- Queue persistence across modal open/close
- Auto-detection of queue mode on modal open
- Main UI quick apply button with visibility control

### Event Logging:
```javascript
// Before
addLog(`Sub: #${getNum(outId)} → #${getNum(inId)}`);

// After
addLog(`Sub: #${getNum(outId)} ${playerName(outId)} → #${getNum(inId)} ${playerName(inId)}`);
```

### State Management:
- Queue persists in `state.subQueue` across modal sessions
- Queue mode automatically activated when queue exists
- Clear separation between pending swap and queued swaps

## Benefits for Coaches

✅ **Plan ahead** - Build substitution strategy before timeout
✅ **Fast execution** - One click to apply entire queue
✅ **No mental load** - Queue remembers your plan
✅ **Clear audit trail** - Detailed logs with names
✅ **Flexible workflow** - Apply from modal or main UI
✅ **Error prevention** - See exactly what will happen before applying
