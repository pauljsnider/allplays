# QA Plan for PR #987 Remediation

This QA plan outlines the steps to verify the resolution of two critical issues identified in PR #987, related to post-game stat saving and private stat persistence.

## Issue 1: Use in-scope map for post-game stat saves (game.html)
**Feedback:** `saveCurrent` assigns `editorStatsMap[player.id]` even though `editorStatsMap` is not defined in `setupPostGameStatEditor`’s scope. This causes a `ReferenceError` and prevents stat persistence.

### Test Cases

**Test Case 1.1: Verify Post-Game Stat Save Functionality**
*   **Objective:** Ensure that post-game stats can be successfully edited and saved without `ReferenceError`.
*   **Steps:**
    1.  Start a local development server for the `allplays` repository.
    2.  Log in as a team manager.
    3.  Navigate to a completed game's stat editor page (`game.html`).
    4.  Make edits to a player's stats (e.g., change points, assists).
    5.  Click the "Save" or "Update Stats" button.
    6.  Observe the browser console for any JavaScript errors.
    7.  Refresh the page and re-enter the stat editor.
    8.  Verify that the changes made in step 4 are persisted.
*   **Expected Result:** No `ReferenceError` in the console. The edited stats are successfully saved and displayed correctly after refreshing the page.

**Test Case 1.2: Verify Save with No Changes**
*   **Objective:** Ensure saving without modifications does not trigger errors.
*   **Steps:**
    1.  Follow steps 1-3 from Test Case 1.1.
    2.  Without making any changes, click the "Save" or "Update Stats" button.
    3.  Observe the browser console for any JavaScript errors.
*   **Expected Result:** No `ReferenceError` in the console.

## Issue 2: Remove stale private stats when payload has none (js/db.js)
**Feedback:** When `privateStats` is empty, existing private values are not cleared, leading to old private data overriding current public stats if config visibility changes.

### Test Cases

**Test Case 2.1: Verify Private Stats are Cleared When Empty Payload is Saved**
*   **Objective:** Confirm that if `privateStats` is sent as empty, any existing private player stats for that game are removed from Firestore.
*   **Steps:**
    1.  **Prerequisite:** Ensure a game has private player stats recorded in Firestore (e.g., create a game, add some private stats through an admin tool or by temporarily setting some as private via config and saving).
    2.  Start a local development server for the `allplays` repository.
    3.  Log in as a team manager.
    4.  Navigate to the stat editor for the prerequisite game (`game.html`).
    5.  Change the stat configuration such that all previously private stats are now public, or remove any configuration that would generate private stats. This should result in an empty `privateStats` payload when saving.
    6.  Make a minor public stat edit (e.g., change a public stat for a player) to trigger a save.
    7.  Click the "Save" or "Update Stats" button.
    8.  Inspect the Firestore document for `privatePlayerStats` under the game.
*   **Expected Result:** The `privatePlayerStats` field in the Firestore game document should either be entirely removed or be an empty object/map, indicating that stale private stats have been cleared. No old private values should re-appear in the editor or override public stats after config changes.

**Test Case 2.2: Verify Private Stats Persistence When Payload is Not Empty**
*   **Objective:** Ensure private stats are correctly saved and retained when the payload is not empty.
*   **Steps:**
    1.  Start a local development server for the `allplays` repository.
    2.  Log in as a team manager.
    3.  Navigate to a game's stat editor page (`game.html`).
    4.  Ensure the stat configuration includes private stats (e.g., mark a custom stat as "private").
    5.  Enter some data for a player in a private stat field.
    6.  Click the "Save" or "Update Stats" button.
    7.  Refresh the page and re-enter the stat editor.
    8.  Verify that the private stat data is still present and correctly loaded.
*   **Expected Result:** The private stat data is persisted in Firestore and correctly displayed in the editor.

**Test Case 2.3: Edge Case - Toggling Private Stat Visibility**
*   **Objective:** Verify correct behavior when toggling a stat's visibility between private and public, and vice-versa.
*   **Steps:**
    1.  **Prerequisite:** Create a game and some stats.
    2.  Start a local development server.
    3.  Log in as a team manager.
    4.  Navigate to the game config or stat editor.
    5.  Set a stat to "private" and add some data for it, then save.
    6.  Confirm private data is saved (via Firestore inspection if necessary).
    7.  Now, set the same stat to "public" and save.
    8.  Verify that the data for this stat is now treated as public and any corresponding private stat entry for it has been removed from `privatePlayerStats` in Firestore.
    9.  Repeat the process in reverse: set a stat to "public", add data, save, then change it to "private", add/modify data, and save.
    10. Verify that the private data is correctly isolated and public data is not overwritten.
*   **Expected Result:** Private stats are correctly handled during visibility changes. When a stat goes from private to public, its private entry is cleared. When it goes from public to private, new private data is stored correctly without affecting public data.

## General QA Considerations
*   Test across different user roles (manager, admin).
*   Test with various game states (in-progress, completed).
*   Monitor browser console for any JavaScript errors during all tests.
*   Verify data directly in Firebase Firestore when necessary to confirm persistence.
