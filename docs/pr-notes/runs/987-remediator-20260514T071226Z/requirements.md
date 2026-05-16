# Requirements for PR #987 Remediation

## 1. Post-Game Stat Editor Save Functionality

**Problem:** Managers cannot save edited post-game player statistics due to a `ReferenceError` when `editorStatsMap` is not defined in the scope of the `saveCurrent` function within `setupPostGameStatEditor` in `game.html`.

**User Impact:** Managers experience data loss and frustration as their manual edits to player statistics after a game cannot be persisted, leading to inaccurate historical records and requiring re-entry of data.

**Desired Outcomes:**
*   **REQ-987-1.1:** The post-game stat editor must allow managers to successfully save all edited player statistics without encountering any runtime errors.
*   **REQ-987-1.2:** The `saveCurrent` function within `setupPostGameStatEditor` in `game.html` must correctly access and update player statistics, ensuring all necessary data structures (`editorStatsMap` or its equivalent) are properly scoped and available.

## 2. Private Player Stats Data Consistency

**Problem:** When the `privateStats` payload is empty in `js/db.js`, existing `privatePlayerStats` documents in Firestore are not explicitly cleared. This leaves stale private data that can re-surface and override current public stats in the `game.html` editor (lines 1296-1302) if configuration visibility changes.

**User Impact:** Managers may be presented with outdated or incorrect private player statistics, leading to confusion and the potential for them to inadvertently resave incorrect data, causing data inconsistency across the application.

**Desired Outcomes:**
*   **REQ-987-2.1:** When `privateStats` are updated with an empty payload, any existing corresponding private player statistics in Firestore must be explicitly deleted or cleared to maintain data integrity.
*   **REQ-987-2.2:** The `game.html` editor must consistently display accurate player statistics, ensuring that stale private data does not override current public stats or reappear unexpectedly after changes in configuration visibility.
*   **REQ-987-2.3:** The system must prevent the re-introduction of previously removed private player stats if the intent was to clear them.
