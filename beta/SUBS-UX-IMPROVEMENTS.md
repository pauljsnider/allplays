# Basketball Tracker - Substitutions UX Improvements

## Overview
Redesigned the substitutions workflow from a coach and UX perspective to be more intuitive, faster, and better suited for one-handed sideline use.

## Problems Identified

### Original Workflow Issues:
1. **Confusing two-step process** - "Out then In" workflow wasn't intuitive
2. **Queue vs immediate unclear** - Users couldn't tell if they were building a queue or making an immediate swap
3. **Poor visual feedback** - Hard to see what was selected or queued
4. **Broken undo** - Only removed log entries, didn't restore game state
5. **Events not rendering** - Needed verification

## New Workflow

### Two Distinct Modes:

#### 1. Quick Swap Mode (Default)
**Use case:** Making a single substitution during live play
- Tap player on court → highlights in teal
- Tap bench player → highlights in teal
- Click "Make Swap" → swap happens immediately, modal closes
- **Fast, simple, thumb-friendly**

#### 2. Queue Multiple Mode
**Use case:** Planning multiple substitutions during a timeout
- Switch to "Queue Multiple" tab
- Queue display area shows all pending swaps
- Tap player on court, then bench player → adds to queue and resets
- Continue building queue with multiple swaps
- See all queued swaps clearly displayed with count
- Click "Apply X Swaps" → all swaps execute at once
- **Perfect for timeout substitutions**

### Visual Improvements:
- **Mode toggle** - Clear two-tab system (Quick Swap / Queue Multiple)
- **Selected players highlight** - Teal background on selected players
- **Queue visibility** - Dedicated teal-themed queue display area
- **Dynamic button text** - "Make Swap" vs "Apply 3 Swaps"
- **Contextual hints** - Clear instructions update based on state
- **Queue count badge** - Shows number of queued swaps

## Fixed Issues

### 1. Proper Undo Functionality
- **Before:** Only removed log entry, didn't restore state
- **After:**
  - Saves complete state snapshot before each action
  - Restores all game data: score, stats, lineup, opponent stats
  - Keeps last 50 actions in history
  - Works for stats, subs, opponent actions, etc.

### 2. Event Log Rendering
- Verified `renderLog()` is called on init
- Events populate from the start
- Shows recent 40 events with timestamps

### 3. State Management
- Added `queueMode` flag to track current mode
- Added `history` array for undo functionality
- History saves before: stats, opponent stats, subs, line swaps

## Coach-Friendly Features

### One-Handed Operation:
- Large touch targets for thumb reach
- Minimal taps required (2 taps for quick swap)
- Clear visual feedback at each step

### Live Game Mode (Quick):
- Make instant substitutions without extra steps
- No queue management needed
- Modal closes automatically after swap

### Timeout Mode (Queue):
- Build entire substitution plan
- See all changes before applying
- Apply all at once when ready
- Clear queue easily if needed

### Error Prevention:
- Can't apply without selection
- Clear visual indication of pending actions
- Easy to clear queue and start over
- Undo button for mistakes

## Technical Implementation

### New Functions:
- `setSubMode(mode)` - Switch between quick/queue modes
- `updateSubHint()` - Context-aware hint text
- `updateSubButton()` - Dynamic button state and text
- `renderSubPlayers()` - Show selected state visually
- `saveHistory(action)` - Deep clone state for undo
- `undo()` - Restore previous state
- `renderAll()` - Refresh all UI components

### Updated Functions:
- `openSubModal()` - Initialize with correct mode
- `applyQueue()` - Save history before bulk application
- `addStat()` - Save history before stat changes
- `addOppStat()` - Save history before opponent stat changes
- `renderQueue()` - Show queue count and swaps clearly

### Event Handlers:
- Mode switching (Quick/Queue tabs)
- Player selection with visual feedback
- Queue building vs immediate swap logic
- Clear queue functionality
- Apply with context-aware behavior

## User Testing Recommendations

### Quick Swap Test:
1. Click "Subs"
2. Tap #1 on court
3. Tap #15 on bench
4. Click "Make Swap"
5. Verify swap happened and modal closed

### Queue Multiple Test:
1. Click "Subs"
2. Switch to "Queue Multiple"
3. Tap #1 → #15 (should add to queue)
4. Tap #4 → #20 (should add to queue)
5. Verify queue shows both swaps
6. Click "Apply 2 Swaps"
7. Verify both swaps happened

### Undo Test:
1. Score some points for #1
2. Click undo
3. Verify points were removed
4. Make a substitution
5. Click undo
6. Verify substitution was reversed

## Design Philosophy

**Principle:** The interface should match the coach's mental model
- **Quick swap** = "Get this player out now"
- **Queue mode** = "Here's my timeout substitution plan"
- **Undo** = "Oops, wrong button - fix it"

**Mobile-first:**
- Designed for thumb reach from sideline
- Works one-handed while holding clipboard
- Large, clear touch targets
- Minimal taps to complete actions

**Visual clarity:**
- Color coding (teal = selected/active/queued)
- Count badges for awareness
- Clear mode separation
- Contextual hints guide user

**Professional coaching tool:**
- Fast enough for live game use
- Precise enough for planning
- Forgiving with undo
- Clear feedback at every step
