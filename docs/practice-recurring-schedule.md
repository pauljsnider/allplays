# Practice & Recurring Schedule Feature - Implementation Plan

**Last Updated:** February 16, 2026
**Status:** IMPLEMENTED (Recurring schedule + Practice Command Center + parent packet flow)

---

## Implementation Summary

Both Phase 1 (Basic Practices) and Phase 2 (Recurring Practices) have been fully implemented.

### 2026 Additions (Practice Command Center)

- Practice-specific planning entry from `edit-schedule.html` via **Plan Practice**.
- Event-linked practice planning in `drills.html` (one session per practice event).
- Drill Library support for:
  - Community drills
  - Team custom drills (add/edit/delete)
  - Favorites and publish-to-community workflow
- ALL PLAYS COACH chat for attendance-aware practice planning.
- Practice Timeline with drill block durations and gap visibility.
- Practice Mode attendance tracking (`present`, `late`, `absent`) and coach notes.
- Home Packet builder tied to each practice session.
- Parent Dashboard support for:
  - Schedule filters (`All Upcoming`, `Upcoming Games`, `Upcoming Practices`, `Past Events`)
  - Practice attendance visibility
  - Home packet per-practice completion by parent/player

### What Was Built

**Database Layer (`js/db.js`):**
- `normalizeEvent()` - Backward compatibility for legacy game docs
- `getEvents(teamId, options)` - Fetch all events with optional type filtering
- `addEvent()`, `addPractice()` - Create events
- `updateEvent()`, `deleteEvent()` - Modify events
- `cancelOccurrence()` - Skip a single recurring date
- `updateOccurrence()` - Override a single recurring date
- `restoreOccurrence()` - Un-skip a cancelled date
- `clearOccurrenceOverride()` - Revert to series defaults
- `updateSeries()`, `deleteSeries()` - Manage recurring series
- `getSeriesMaster()` - Find series by seriesId

**Utilities (`js/utils.js`):**
- `formatTimeRange()` - Display time ranges
- `getDefaultEndTime()` - Calculate default end times
- `generateSeriesId()` - UUID for recurring series
- `expandRecurrence()` - Generate occurrences from series master
- `formatRecurrence()` - Human-readable recurrence description

**UI (`edit-schedule.html`):**
- Practice tab with full CRUD form
- Recurrence builder (weekly/daily, day selection, end conditions)
- Occurrence choice modal (Edit This / Edit Series / Cancel This)
- Single occurrence edit modal with revert option
- Practice rendering with badges (Practice, Recurring, Modified)

**Other Pages:**
- `track.html` - Blocks practices with redirect
- `game.html` - Blocks practices with redirect
- `game-plan.html` - Filters to games only
- `team.html` - Shows practices with proper styling, respects toggle

---

## Executive Summary

This document outlines a phased approach to add practice events as first-class citizens in ALL PLAYS. The plan is based on thorough analysis of the existing codebase architecture and follows established patterns.

**Key Principle:** Start simple, iterate. Phase 1 adds basic practice support. Phase 2 adds recurring schedules.

---

## Current State Analysis

### Existing Data Model (`teams/{teamId}/games/{gameId}`)
```javascript
{
  date: Timestamp,           // Single datetime (start time, no end)
  opponent: string,          // Required for games
  location: string,          // Optional
  status: 'scheduled' | 'completed',
  homeScore: number,
  awayScore: number,
  statTrackerConfigId: string | null,
  calendarEventUid: string | null,  // Links to external ICS event
  createdAt: Timestamp
}
```

### Existing Practice Detection
- `isPracticeEvent(summary)` in `js/utils.js:379-385` detects practices from ICS calendar event summaries
- "Show Practices" checkbox exists in `edit-schedule.html:192` and `team.html:122`
- Currently only filters **external calendar events**, not stored DB events
- Practices from ICS calendars are displayed but cannot be tracked or stored

### Pages That Need Updates
| Page | Current Behavior | Required Change |
|------|-----------------|-----------------|
| `edit-schedule.html` | Renders games only from DB | Add practice CRUD, show both types |
| `track.html` | Shows all games | Filter to `type === 'game'` only |
| `game.html` | Shows game report | Filter to `type === 'game'` only |
| `team.html` | Public schedule view | Show both, respect "Show Practices" toggle |
| `game-plan.html` | Game planning | Filter to `type === 'game'` only |

### Key Files to Modify
- `/home/paul/allplays/js/db.js` - Database API layer (332 lines)
- `/home/paul/allplays/js/utils.js` - Helpers (385 lines)
- `/home/paul/allplays/edit-schedule.html` - Schedule management (1,085 lines)
- `/home/paul/allplays/track.html` - Filter games only
- `/home/paul/allplays/game.html` - Filter games only
- `/home/paul/allplays/team.html` - Public view with toggle
- `/home/paul/allplays/firestore.rules` - Security rules

---

## Phase 1: Basic Practice Support

### 1.1 Data Model Extension

**Extended Game/Event Document:**
```javascript
{
  // Existing fields (backward compatible)
  date: Timestamp,              // Renamed conceptually to "start" but kept as "date" for compatibility
  opponent: string | null,      // Required for games, null for practices
  location: string,
  status: 'scheduled' | 'completed',
  homeScore: number,
  awayScore: number,
  statTrackerConfigId: string | null,
  calendarEventUid: string | null,
  createdAt: Timestamp,

  // New fields
  type: 'game' | 'practice',    // Default: 'game' for backward compat
  title: string | null,         // Practice title (default: "Practice"), null for games
  end: Timestamp | null,        // End time (inferred as start + 2h if missing)
  notes: string | null          // Optional notes for practices
}
```

**Backward Compatibility Strategy:**
- Existing documents without `type` field are treated as `type: 'game'`
- Documents without `end` field get `end = date + 2 hours` computed at read time
- No migration required - defaults applied in code

### 1.2 Database API Changes (`js/db.js`)

**New/Modified Functions:**

```javascript
// Normalize legacy game docs with defaults
export function normalizeEvent(doc) {
  return {
    ...doc,
    type: doc.type || 'game',
    title: doc.title || (doc.type === 'practice' ? 'Practice' : null),
    end: doc.end || null  // Compute in UI: date + 2h
  };
}

// Get all events (games + practices) with optional filtering
export async function getEvents(teamId, options = {}) {
  // options: { type: 'game' | 'practice' | 'all', startDate, endDate }
  const q = query(collection(db, `teams/${teamId}/games`), orderBy("date"));
  const snapshot = await getDocs(q);
  let events = snapshot.docs.map(doc => normalizeEvent({ id: doc.id, ...doc.data() }));

  if (options.type && options.type !== 'all') {
    events = events.filter(e => e.type === options.type);
  }
  return events;
}

// Alias for backward compatibility
export async function getGames(teamId) {
  return getEvents(teamId, { type: 'game' });
}

// Add event (game or practice)
export async function addEvent(teamId, eventData) {
  eventData.createdAt = Timestamp.now();
  eventData.type = eventData.type || 'game';
  const docRef = await addDoc(collection(db, `teams/${teamId}/games`), eventData);
  return docRef.id;
}

// Alias for backward compatibility
export async function addGame(teamId, gameData) {
  return addEvent(teamId, { ...gameData, type: 'game' });
}

// Add practice specifically
export async function addPractice(teamId, practiceData) {
  return addEvent(teamId, {
    ...practiceData,
    type: 'practice',
    title: practiceData.title || 'Practice',
    opponent: null,
    status: 'scheduled',
    homeScore: 0,
    awayScore: 0,
    statTrackerConfigId: null
  });
}
```

### 1.3 UI Changes (`edit-schedule.html`)

**Form Update - Replace "Add Game" with "Add Event" tabs:**

```
┌─────────────────────────────────────────────────────┐
│  [Add Game]  [Add Practice]  [Bulk AI Update]       │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Add Game Tab:                                      │
│  - Date & Time (start)                              │
│  - End Time (default: start + 2h)                   │
│  - Opponent (required)                              │
│  - Location                                         │
│  - Stat Config                                      │
│  [Add Game]                                         │
│                                                     │
│  Add Practice Tab:                                  │
│  - Title (default: "Practice")                      │
│  - Date & Time (start)                              │
│  - End Time (default: start + 1.5h)                 │
│  - Location                                         │
│  - Notes (optional)                                 │
│  [Add Practice]                                     │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**Schedule List Rendering:**

| Event Type | Display | Actions |
|------------|---------|---------|
| Game (DB) | Blue left border, "vs. {opponent}" | Edit, Track, Report, Game Plan, Delete |
| Practice (DB) | Green left border, "{title}", time range | Edit, Delete |
| Calendar Game | Light blue border, "Calendar" badge | Track |
| Calendar Practice | Yellow border, "Practice" badge | (view only) |

**Badge Styles (following existing pattern):**
```html
<!-- Game badge -->
<span class="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded font-semibold">Game</span>

<!-- Practice badge -->
<span class="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded font-semibold">Practice</span>
```

### 1.4 Utility Functions (`js/utils.js`)

**New Functions:**

```javascript
// Format time range for display
export function formatTimeRange(start, end) {
  if (!start) return '';
  const startStr = formatTime(start);
  if (!end) return startStr;
  const endStr = formatTime(end);
  return `${startStr} - ${endStr}`;
}

// Compute default end time
export function getDefaultEndTime(startDate, type = 'game') {
  if (!startDate) return null;
  const date = startDate.toDate ? startDate.toDate() : new Date(startDate);
  const durationMs = type === 'practice' ? 90 * 60 * 1000 : 120 * 60 * 1000; // 1.5h or 2h
  return new Date(date.getTime() + durationMs);
}
```

### 1.5 Security Rules (`firestore.rules`)

No changes required - practices use the same `teams/{teamId}/games` collection with identical permission rules:
- Read: Public
- Write: Team owner, team admin, or global admin

### 1.6 Filter Updates for Other Pages

**track.html (line ~200):**
```javascript
// Change getGames to filter
const games = await getEvents(teamId, { type: 'game' });
```

**game.html:**
```javascript
// Verify event is a game
const game = await getGame(teamId, gameId);
if (game.type === 'practice') {
  alert('Cannot view report for practices');
  window.location.href = `team.html#teamId=${teamId}`;
  return;
}
```

**team.html:**
```javascript
// Load all events, filter by checkbox
const events = await getEvents(teamId, { type: showPractices ? 'all' : 'game' });
```

---

## Phase 2: Recurring Practices (Future)

### 2.1 Overview

Recurring practices allow coaches to set up weekly practice schedules (e.g., "Tue/Thu 6-8pm") without manually creating each event.

**Approach:** Store a single "series master" document; expand occurrences client-side.

### 2.2 Extended Data Model

**Series Master Document:**
```javascript
{
  // Base practice fields
  type: 'practice',
  title: 'Tuesday/Thursday Practice',
  location: 'Main Gym',
  notes: 'Bring water bottles',

  // Time template (applied to each occurrence)
  startTime: '18:00',          // HH:mm format
  endTime: '20:00',            // HH:mm format

  // Recurrence definition
  isSeriesMaster: true,
  seriesId: 'uuid-v4',         // Unique identifier for the series
  recurrence: {
    freq: 'weekly',            // 'weekly' | 'daily'
    interval: 1,               // Every N weeks/days
    byDays: ['TU', 'TH'],      // Day codes: MO, TU, WE, TH, FR, SA, SU
    until: Timestamp | null,   // End date (null = indefinite)
    count: number | null       // Max occurrences (alternative to until)
  },

  // Exceptions
  exDates: ['2024-12-24', '2024-12-31'],  // ISO date strings to skip
  overrides: {
    '2024-12-19': {             // ISO date key
      startTime: '17:00',       // Changed time for this occurrence
      endTime: '19:00',
      location: 'Auxiliary Gym',
      title: 'Special Practice'
    }
  }
}
```

### 2.3 Client-Side Expansion

**Expansion Logic:**
```javascript
// In js/utils.js
export function expandRecurrence(master, windowDays = 180) {
  if (!master.isSeriesMaster || !master.recurrence) return [master];

  const occurrences = [];
  const now = new Date();
  const windowEnd = new Date(now.getTime() + windowDays * 24 * 60 * 60 * 1000);
  const { freq, interval, byDays, until, count } = master.recurrence;

  // Generate occurrences within window
  let current = new Date(master.createdAt.toDate());
  let generated = 0;

  while (current <= windowEnd) {
    if (until && current > until.toDate()) break;
    if (count && generated >= count) break;

    const isoDate = current.toISOString().split('T')[0];
    const dayCode = ['SU','MO','TU','WE','TH','FR','SA'][current.getDay()];

    if (byDays.includes(dayCode) && !master.exDates?.includes(isoDate)) {
      const override = master.overrides?.[isoDate] || {};
      occurrences.push({
        ...master,
        instanceDate: isoDate,
        startTime: override.startTime || master.startTime,
        endTime: override.endTime || master.endTime,
        location: override.location || master.location,
        title: override.title || master.title,
        isInstance: true
      });
      generated++;
    }

    // Advance by interval
    if (freq === 'weekly') {
      current.setDate(current.getDate() + 1); // Check each day
    } else {
      current.setDate(current.getDate() + interval);
    }
  }

  return occurrences;
}
```

### 2.4 Recurrence UI Builder

**Add Practice Form Extension:**
```
┌─────────────────────────────────────────────────────┐
│  [ ] Make this a recurring practice                 │
├─────────────────────────────────────────────────────┤
│  Repeat: [Weekly ▼]  Every [1] week(s)              │
│                                                     │
│  On days: [M] [T] [W] [Th] [F] [Sa] [Su]            │
│           [ ] [✓] [ ] [✓]  [ ] [ ]  [ ]             │
│                                                     │
│  Ends: ( ) Never                                    │
│        (•) On date: [____12/31/2024____]            │
│        ( ) After [__] occurrences                   │
└─────────────────────────────────────────────────────┘
```

### 2.5 Edit Occurrence Modal

When editing a recurring practice instance:
```
┌─────────────────────────────────────────────────────┐
│  Edit Practice                                      │
├─────────────────────────────────────────────────────┤
│  This practice is part of a recurring series.       │
│                                                     │
│  What would you like to edit?                       │
│                                                     │
│  [Edit This Occurrence Only]                        │
│  [Edit Entire Series]                               │
│  [Cancel This Occurrence]                           │
│                                                     │
│                              [Cancel]               │
└─────────────────────────────────────────────────────┘
```

### 2.6 Database Functions for Occurrence Management (`js/db.js`)

**Cancel a single occurrence (add to exDates):**
```javascript
import { arrayUnion } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";

/**
 * Cancel a single occurrence of a recurring practice
 * @param {string} teamId - Team ID
 * @param {string} masterId - The series master document ID
 * @param {string} isoDate - The date to cancel (e.g., '2024-12-24')
 */
export async function cancelOccurrence(teamId, masterId, isoDate) {
  const docRef = doc(db, `teams/${teamId}/games`, masterId);
  await updateDoc(docRef, {
    exDates: arrayUnion(isoDate)
  });
}
```

**Update a single occurrence (write to overrides):**
```javascript
/**
 * Update a single occurrence of a recurring practice
 * @param {string} teamId - Team ID
 * @param {string} masterId - The series master document ID
 * @param {string} isoDate - The date to override (e.g., '2024-12-19')
 * @param {Object} changes - The fields to override { startTime, endTime, location, title, notes }
 */
export async function updateOccurrence(teamId, masterId, isoDate, changes) {
  const docRef = doc(db, `teams/${teamId}/games`, masterId);

  // Build the update object with dot notation for nested field
  const updateData = {};
  Object.keys(changes).forEach(key => {
    updateData[`overrides.${isoDate}.${key}`] = changes[key];
  });

  await updateDoc(docRef, updateData);
}
```

**Restore a cancelled occurrence (remove from exDates):**
```javascript
import { arrayRemove } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";

/**
 * Restore a previously cancelled occurrence
 * @param {string} teamId - Team ID
 * @param {string} masterId - The series master document ID
 * @param {string} isoDate - The date to restore (e.g., '2024-12-24')
 */
export async function restoreOccurrence(teamId, masterId, isoDate) {
  const docRef = doc(db, `teams/${teamId}/games`, masterId);
  await updateDoc(docRef, {
    exDates: arrayRemove(isoDate)
  });
}
```

**Clear an override (revert to series defaults):**
```javascript
import { deleteField } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";

/**
 * Remove override for a specific occurrence, reverting to series defaults
 * @param {string} teamId - Team ID
 * @param {string} masterId - The series master document ID
 * @param {string} isoDate - The date to clear override for
 */
export async function clearOccurrenceOverride(teamId, masterId, isoDate) {
  const docRef = doc(db, `teams/${teamId}/games`, masterId);
  await updateDoc(docRef, {
    [`overrides.${isoDate}`]: deleteField()
  });
}
```

**Update entire series:**
```javascript
/**
 * Update the entire recurring series (affects all future occurrences)
 * @param {string} teamId - Team ID
 * @param {string} masterId - The series master document ID
 * @param {Object} seriesData - Fields to update on the master { title, location, startTime, endTime, recurrence, notes }
 */
export async function updateSeries(teamId, masterId, seriesData) {
  const docRef = doc(db, `teams/${teamId}/games`, masterId);
  await updateDoc(docRef, seriesData);
}
```

**Delete entire series:**
```javascript
/**
 * Delete the entire recurring series and all its occurrences
 * @param {string} teamId - Team ID
 * @param {string} masterId - The series master document ID
 */
export async function deleteSeries(teamId, masterId) {
  await deleteDoc(doc(db, `teams/${teamId}/games`, masterId));
}
```

**Get series master by seriesId:**
```javascript
/**
 * Find the series master document by its seriesId
 * @param {string} teamId - Team ID
 * @param {string} seriesId - The UUID of the series
 * @returns {Object|null} The master document or null
 */
export async function getSeriesMaster(teamId, seriesId) {
  const q = query(
    collection(db, `teams/${teamId}/games`),
    where("seriesId", "==", seriesId),
    where("isSeriesMaster", "==", true)
  );
  const snapshot = await getDocs(q);
  if (snapshot.empty) return null;
  return { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
}
```

### 2.7 Edit Occurrence Form (`edit-schedule.html`)

**Single Occurrence Edit Form:**
```html
<!-- Edit Single Occurrence Modal -->
<div id="edit-occurrence-modal" class="hidden fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
  <div class="bg-white rounded-lg p-6 max-w-md w-full mx-4">
    <h3 class="text-xl font-bold mb-2">Edit Practice</h3>
    <p class="text-sm text-gray-600 mb-4">
      Editing <span id="occurrence-date-display" class="font-semibold"></span> only.
      Other occurrences in this series will not be affected.
    </p>

    <form id="edit-occurrence-form" class="space-y-4">
      <input type="hidden" id="occurrence-master-id">
      <input type="hidden" id="occurrence-iso-date">

      <div>
        <label class="block text-sm font-medium text-gray-700">Title</label>
        <input type="text" id="occurrence-title"
          class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 border p-2">
      </div>

      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium text-gray-700">Start Time</label>
          <input type="time" id="occurrence-start-time"
            class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 border p-2">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700">End Time</label>
          <input type="time" id="occurrence-end-time"
            class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 border p-2">
        </div>
      </div>

      <div>
        <label class="block text-sm font-medium text-gray-700">Location</label>
        <input type="text" id="occurrence-location"
          class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 border p-2">
      </div>

      <div>
        <label class="block text-sm font-medium text-gray-700">Notes</label>
        <textarea id="occurrence-notes" rows="2"
          class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 border p-2"></textarea>
      </div>

      <div class="flex gap-2 justify-end pt-2">
        <button type="button" id="cancel-occurrence-edit-btn"
          class="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600">Cancel</button>
        <button type="button" id="revert-occurrence-btn"
          class="px-4 py-2 border border-gray-300 text-gray-700 rounded hover:bg-gray-50">Revert to Series</button>
        <button type="submit"
          class="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700">Save This Occurrence</button>
      </div>
    </form>
  </div>
</div>
```

**JavaScript handlers for occurrence editing:**
```javascript
// State for occurrence editing
let editingOccurrence = null; // { masterId, isoDate, master }

// Open the occurrence choice modal
function showOccurrenceChoiceModal(masterId, isoDate, master) {
  editingOccurrence = { masterId, isoDate, master };
  document.getElementById('occurrence-choice-modal').classList.remove('hidden');
}

// Handle "Edit This Occurrence Only"
document.getElementById('edit-this-occurrence-btn').addEventListener('click', () => {
  document.getElementById('occurrence-choice-modal').classList.add('hidden');

  const { masterId, isoDate, master } = editingOccurrence;
  const override = master.overrides?.[isoDate] || {};

  // Populate form with current values (override or master defaults)
  document.getElementById('occurrence-master-id').value = masterId;
  document.getElementById('occurrence-iso-date').value = isoDate;
  document.getElementById('occurrence-date-display').textContent = new Date(isoDate).toLocaleDateString();
  document.getElementById('occurrence-title').value = override.title || master.title;
  document.getElementById('occurrence-start-time').value = override.startTime || master.startTime;
  document.getElementById('occurrence-end-time').value = override.endTime || master.endTime;
  document.getElementById('occurrence-location').value = override.location || master.location;
  document.getElementById('occurrence-notes').value = override.notes || master.notes || '';

  document.getElementById('edit-occurrence-modal').classList.remove('hidden');
});

// Handle "Cancel This Occurrence"
document.getElementById('cancel-this-occurrence-btn').addEventListener('click', async () => {
  const { masterId, isoDate } = editingOccurrence;

  if (confirm(`Cancel practice on ${new Date(isoDate).toLocaleDateString()}? This occurrence will be removed from the schedule.`)) {
    await cancelOccurrence(currentTeamId, masterId, isoDate);
    document.getElementById('occurrence-choice-modal').classList.add('hidden');
    loadSchedule();
  }
});

// Handle "Edit Entire Series"
document.getElementById('edit-series-btn').addEventListener('click', () => {
  document.getElementById('occurrence-choice-modal').classList.add('hidden');
  // Open series edit form (reuse Add Practice form in edit mode)
  startEditSeries(editingOccurrence.masterId);
});

// Save single occurrence override
document.getElementById('edit-occurrence-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const masterId = document.getElementById('occurrence-master-id').value;
  const isoDate = document.getElementById('occurrence-iso-date').value;

  const changes = {
    title: document.getElementById('occurrence-title').value,
    startTime: document.getElementById('occurrence-start-time').value,
    endTime: document.getElementById('occurrence-end-time').value,
    location: document.getElementById('occurrence-location').value,
    notes: document.getElementById('occurrence-notes').value
  };

  await updateOccurrence(currentTeamId, masterId, isoDate, changes);
  document.getElementById('edit-occurrence-modal').classList.add('hidden');
  loadSchedule();
});

// Revert occurrence to series defaults
document.getElementById('revert-occurrence-btn').addEventListener('click', async () => {
  const masterId = document.getElementById('occurrence-master-id').value;
  const isoDate = document.getElementById('occurrence-iso-date').value;

  if (confirm('Revert this occurrence to use the series defaults?')) {
    await clearOccurrenceOverride(currentTeamId, masterId, isoDate);
    document.getElementById('edit-occurrence-modal').classList.add('hidden');
    loadSchedule();
  }
});
```

### 2.8 Visual Indicators for Modified Occurrences

**Schedule list should show visual cues:**

```javascript
function renderRecurringPractice(occurrence) {
  const isModified = occurrence.isInstance && editingOccurrence?.master?.overrides?.[occurrence.instanceDate];
  const isCancelled = occurrence.isInstance && editingOccurrence?.master?.exDates?.includes(occurrence.instanceDate);

  // Cancelled occurrences shown with strikethrough (if showing cancelled)
  if (isCancelled) {
    return `
      <div class="p-6 hover:bg-gray-50 flex justify-between items-center opacity-50 border-l-4 border-gray-300">
        <div>
          <span class="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded font-semibold">Cancelled</span>
          <div class="text-sm text-gray-400 line-through">${formatDate(occurrence.instanceDate)}</div>
          <div class="text-gray-400 line-through">${occurrence.title}</div>
        </div>
        <button onclick="restoreOccurrence('${occurrence.id}', '${occurrence.instanceDate}')"
          class="px-3 py-1 text-sm text-indigo-600 hover:underline">Restore</button>
      </div>
    `;
  }

  return `
    <div class="p-6 hover:bg-gray-50 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-l-4 border-green-500">
      <div>
        <div class="flex items-center gap-2 mb-1">
          <span class="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded font-semibold">Practice</span>
          <span class="text-xs bg-purple-100 text-purple-800 px-2 py-0.5 rounded font-semibold">Recurring</span>
          ${isModified ? '<span class="text-xs bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded font-semibold">Modified</span>' : ''}
        </div>
        <div class="text-sm text-gray-500 font-semibold uppercase tracking-wide mb-1">
          ${formatDate(occurrence.instanceDate)} • ${occurrence.startTime} - ${occurrence.endTime}
        </div>
        <div class="text-lg font-bold text-gray-900">${occurrence.title}</div>
        <div class="text-sm text-gray-600">${occurrence.location || 'TBD'}</div>
      </div>
      <div class="flex space-x-2">
        <button onclick="showOccurrenceChoiceModal('${occurrence.id}', '${occurrence.instanceDate}', ${JSON.stringify(occurrence).replace(/"/g, '&quot;')})"
          class="px-3 py-1 bg-blue-100 text-blue-700 rounded text-sm hover:bg-blue-200">Edit</button>
      </div>
    </div>
  `;
}
```

---

## Implementation Checklist

### Phase 1: Basic Practices - COMPLETE

#### Database Layer (`js/db.js`)
- [x] Add `normalizeEvent()` helper function
- [x] Add `getEvents(teamId, options)` with type filtering
- [x] Update `getGames()` to call `getEvents({ type: 'game' })`
- [x] Add `addEvent()` generic function
- [x] Add `addPractice()` convenience function
- [x] Update `updateGame()` to `updateEvent()`

#### Utilities (`js/utils.js`)
- [x] Add `formatTimeRange(start, end)`
- [x] Add `getDefaultEndTime(startDate, type)`

#### Edit Schedule Page (`edit-schedule.html`)
- [x] Add "Add Practice" tab to form
- [x] Create practice form fields (title, start, end, location, notes)
- [x] Update `loadSchedule()` to fetch all events
- [x] Update `renderDbGame()` to handle both types
- [x] Add practice-specific rendering with green styling
- [x] Update form submission to handle practice type
- [ ] Add end time input to game form (optional) - *deferred*

#### Other Pages
- [x] `track.html`: Filter to games only
- [x] `game.html`: Verify event is game, redirect if practice
- [x] `game-plan.html`: Filter to games only
- [x] `team.html`: Respect "Show Practices" toggle for DB events

#### Testing
- [ ] Add single practice with start/end time
- [ ] Verify practice appears in schedule with correct styling
- [ ] Verify "Show Practices" toggle hides/shows DB practices
- [ ] Verify existing games still work (backward compat)
- [ ] Verify practices don't appear in track.html
- [ ] Verify practices don't appear in game reports
- [ ] Test edit and delete for practices

### Phase 2: Recurring Practices - COMPLETE

#### Database Layer (`js/db.js`)
- [x] Add `cancelOccurrence(teamId, masterId, isoDate)` - add date to exDates
- [x] Add `updateOccurrence(teamId, masterId, isoDate, changes)` - write to overrides
- [x] Add `restoreOccurrence(teamId, masterId, isoDate)` - remove from exDates
- [x] Add `clearOccurrenceOverride(teamId, masterId, isoDate)` - delete override
- [x] Add `updateSeries(teamId, masterId, seriesData)` - update master doc
- [x] Add `deleteSeries(teamId, masterId)` - delete master doc
- [x] Add `getSeriesMaster(teamId, seriesId)` - find master by seriesId
- [x] Import `arrayUnion`, `arrayRemove`, `deleteField` from Firestore

#### Utilities (`js/utils.js`)
- [x] Add `expandRecurrence(master, windowDays)` - generate occurrences from master
- [x] Add `generateSeriesId()` - create UUID for new series

#### UI Components (`edit-schedule.html`)
- [x] Add recurrence toggle checkbox to practice form
- [x] Add recurrence builder (frequency, days, end condition)
- [x] Add occurrence choice modal (Edit This / Edit Series / Cancel This)
- [x] Add single occurrence edit modal with form
- [x] Add "Revert to Series" button functionality
- [x] Add visual badges: "Recurring", "Modified", "Cancelled"
- [x] Update `renderDbGame()` to call `renderRecurringPractice()` for series instances
- [ ] Show cancelled occurrences with restore option (optional toggle) - *deferred*

#### Schedule Rendering
- [x] Modify `loadSchedule()` to expand recurring series via `expandRecurrence()`
- [x] Sort expanded occurrences into unified timeline
- [x] Pass master document reference to occurrence render function

#### Testing - Recurrence Creation
- [ ] Create weekly recurring practice (single day, e.g., every Tuesday)
- [ ] Create weekly recurring practice (multiple days, e.g., Tue/Thu)
- [ ] Create daily recurring practice
- [ ] Set end date and verify occurrences stop
- [ ] Set occurrence count and verify limit respected

#### Testing - Single Occurrence Management
- [ ] Edit single occurrence title → verify "Modified" badge appears
- [ ] Edit single occurrence time → verify updated time displays
- [ ] Edit single occurrence location → verify override applied
- [ ] Cancel single occurrence → verify removed from schedule
- [ ] Restore cancelled occurrence → verify reappears
- [ ] Revert modified occurrence → verify returns to series defaults

#### Testing - Series Management
- [ ] Edit entire series title → verify all occurrences update
- [ ] Edit series recurrence days → verify schedule changes
- [ ] Edit series end date → verify future occurrences removed/added
- [ ] Delete entire series → verify all occurrences removed

#### Testing - Edge Cases
- [ ] Occurrence on same day as a game (both should display)
- [ ] Series spanning DST change (times should remain correct)
- [ ] Series with no remaining future occurrences
- [ ] Override then cancel same occurrence (exDates should win)
- [ ] Large series (50+ occurrences) performance check

---

## Design Decisions & Rationale

### Why extend `games` collection instead of new `practices` collection?

1. **Unified timeline** - Schedule views need chronological list of all events
2. **Shared permissions** - Same owner/admin access model
3. **Simpler queries** - One collection to fetch for schedule display
4. **Easier migration** - No data copying required

### Why client-side recurrence expansion?

1. **Simpler writes** - Only one document to update for series changes
2. **Flexible exceptions** - Easy to skip dates or override individual occurrences
3. **No cleanup** - Don't need to delete future occurrences when series changes
4. **Cost efficient** - Fewer Firestore documents and writes

### Why Phase 1 before Phase 2?

1. **Immediate value** - Coaches can track practices right away
2. **Lower risk** - Simple changes, easier to test
3. **User feedback** - Learn what coaches actually need before building recurrence
4. **Incremental complexity** - Team learns the patterns before tackling harder problem

---

## AI Bulk Update Feature Impact

### Phase 1: No Changes (Game-Only)

The AI bulk update feature remains **game-only**. Rationale:
- Practice schedules are typically simple (same time weekly) - manual entry is fast
- Uploaded schedule images are usually league game schedules, not practices
- Parsing "Practice Tue/Thu 6-8pm" into recurring series is complex

**No code changes required** - the AI prompt already specifies games:
```javascript
// From edit-schedule.html line ~800
// AI returns: { action: 'add', game: { date, opponent, location } }
// Games are created with type: 'game' by default
```

### Phase 2: Optional Enhancement

If desired, the AI could be extended to:

1. **Detect practices in schedule images:**
   ```javascript
   // Extended schema
   operations: [{
     action: 'add',
     eventType: 'game' | 'practice',  // NEW
     game: { ... },      // For games
     practice: { ... }   // For practices: { title, date, endDate, location }
   }]
   ```

2. **Update AI prompt to recognize practices:**
   ```
   "If an event contains 'practice', 'training', or 'skills' in the title,
   classify it as eventType: 'practice' with title, date, endDate, and location.
   Otherwise classify as eventType: 'game' with opponent, date, and location."
   ```

3. **Recurring practice detection (complex):**
   - AI would need to identify patterns like "Every Tuesday 6-8pm"
   - Convert to recurrence object: `{ freq: 'weekly', byDays: ['TU'], ... }`
   - **Recommendation:** Skip this - too error-prone, manual recurrence builder is better

### Implementation Checklist (if extending AI)

- [ ] Update JSON schema to include `eventType` field
- [ ] Update AI prompt to distinguish games vs practices
- [ ] Modify `renderProposedChange()` to show practice-specific preview
- [ ] Update `applyChanges()` to call `addPractice()` for practice events
- [ ] Add practice badge to proposed changes UI

---

## Open Questions

1. **Notifications** - Should practice reminders be sent? (Future feature)
2. **Attendance tracking** - Should we track who attended practice? (Future feature)
3. **Practice stats** - Should any metrics be trackable during practice? (Out of scope for now)
4. **Calendar export** - Should practices be exportable to ICS? (Nice to have)
5. **AI practice detection** - Should the AI bulk feature detect/create practices? (Optional Phase 2)

---

## Appendix: Existing Code Patterns

### Modal Pattern (from edit-schedule.html)
```html
<div id="modal-id" class="hidden fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
  <div class="bg-white rounded-lg p-6 max-w-md w-full mx-4">
    <h3 class="text-xl font-bold mb-4">Modal Title</h3>
    <!-- Content -->
    <div class="flex gap-2 justify-end">
      <button class="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600">Cancel</button>
      <button class="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700">Confirm</button>
    </div>
  </div>
</div>
```

### Tab Pattern (from edit-schedule.html)
```html
<div class="flex border-b border-gray-200">
  <button id="tab-1" class="flex-1 px-4 py-3 text-sm font-medium text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50">
    Tab 1
  </button>
  <button id="tab-2" class="flex-1 px-4 py-3 text-sm font-medium text-gray-600 hover:text-gray-800 hover:bg-gray-50">
    Tab 2
  </button>
</div>
```

### Form Field Pattern
```html
<div>
  <label class="block text-sm font-medium text-gray-700">Label</label>
  <input type="text"
    class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 border p-2">
</div>
```

### List Item with Actions Pattern
```html
<div class="p-6 hover:bg-gray-50 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-l-4 border-green-500">
  <div>
    <div class="text-sm text-gray-500 font-semibold uppercase tracking-wide mb-1">DATE • TIME</div>
    <div class="text-lg font-bold text-gray-900">Title</div>
    <div class="text-sm text-gray-600">Location</div>
  </div>
  <div class="flex space-x-2">
    <button class="px-3 py-1 bg-blue-100 text-blue-700 rounded text-sm hover:bg-blue-200">Edit</button>
    <button class="px-3 py-1 border border-red-300 text-red-600 rounded text-sm hover:bg-red-50">Delete</button>
  </div>
</div>
```
