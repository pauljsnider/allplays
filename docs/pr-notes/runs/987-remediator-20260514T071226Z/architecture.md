# Architectural Implications and Proposed Solutions for PR #987 Feedback

## Feedback Item 1: `game.html` - Use in-scope map for post-game stat saves

**Problem Description:**
The `saveCurrent` function within `setupPostGameStatEditor` in `game.html` attempts to assign values to `editorStatsMap[player.id]`, but `editorStatsMap` is not defined within `saveCurrent`'s scope. This results in a `ReferenceError` when a manager attempts to save edited stats, preventing persistence of updates and leading to a runtime regression. This issue was introduced with the new private-stat split logic.

**Architectural Implications:**
This problem highlights a breakdown in JavaScript's variable scoping and state management within a critical UI component. The introduction of private-stat logic likely altered the expected data flow or variable accessibility, leading to `saveCurrent` losing its correct reference to the editor's primary state map. This suggests:
1.  **Poor Encapsulation:** The `editorStatsMap` is not adequately encapsulated within the `setupPostGameStatEditor` module or passed explicitly to dependent functions, making it vulnerable to scope changes.
2.  **Lack of Cohesion:** The stat saving logic is tightly coupled to an implicitly available variable, rather than relying on clearly defined inputs or an explicitly managed state.
3.  **Fragile Data Flow:** Changes in one part of the system (private-stat split) have an unintended, breaking impact on another due to implicit dependencies.

**Proposed Solutions:**
1.  **Explicit Scope Management:** Refactor `setupPostGameStatEditor` to ensure `editorStatsMap` is explicitly accessible within the `saveCurrent` function's closure. This could involve defining `saveCurrent` directly within `setupPostGameStatEditor`'s scope or passing `editorStatsMap` as an argument if `saveCurrent` is a separate helper.
2.  **Module-Level State:** If `editorStatsMap` is intended to be a shared state for the editor, ensure it's declared at a scope that makes it correctly available to all necessary sub-functions without creating global leakage.
3.  **Data Flow Review:** Conduct a targeted review of the data flow within `setupPostGameStatEditor` and related saving functions, specifically focusing on how `editorStatsMap` is initialized, updated, and referenced, especially in the context of the new public/private stat distinction.

## Feedback Item 2: `js/db.js` - Remove stale private stats when payload has none

**Problem Description:**
The `db.js` function responsible for writing `privatePlayerStats` to Firestore does not clear existing private values when the `privateStats` payload is empty. This leaves stale data in the database. Subsequently, `game.html` (lines 1296-1302) merges these stale private values back into the editor map, which can override current public stats if config visibility changes, leading managers to see and resave incorrect or outdated data.

**Architectural Implications:**
This issue points to a significant data consistency and integrity problem, stemming from an incomplete implementation of data synchronization and deletion semantics.
1.  **Partial Update Semantics:** The current `db.js` implementation performs an "upsert" or "merge" operation without considering the "delete" scenario for sub-collections or maps when the incoming payload indicates an absence of data.
2.  **Client-Side Data Trust:** The client-side logic in `game.html` implicitly trusts the `privatePlayerStats` data retrieved from Firestore to be always accurate and up-to-date, even when it might be stale due to a previous partial write.
3.  **Implicit Merge Conflicts:** The merge behavior in `game.html` can lead to conflicts where old private data overrides new public data, breaking the expected data hierarchy and user experience.

**Proposed Solutions:**
1.  **Explicit Deletion on Empty Payload:** Modify the `db.js` function to explicitly delete the `privatePlayerStats` document or field in Firestore when the incoming `privateStats` payload is empty or signals a clear intention to remove all private stats for a player. Firestore's `FieldValue.delete()` or conditional document deletion can be used.
2.  **Data Synchronization Strategy:** Establish a clear strategy for handling empty or absent data for sub-collections. If `privateStats` represents an optional component, ensure its absence in a write payload translates to its removal (or nullification) in the database.
3.  **Robust Client-Side Merge Logic:** Enhance the merge logic in `game.html` (lines 1296-1302) to intelligently handle the prioritization of public vs. private stats. This might involve timestamp checks, explicit flags, or a clearer definition of when private stats are meant to override public ones, and when they should be ignored if empty/stale.
4.  **Schema Enforcement (Future Consideration):** For larger changes, consider if Firestore security rules could enforce data integrity, though for client-initiated deletions, explicit client-side logic is often required.
