# Requirements

## Problem Statement
When a media type filter is active in the ALL PLAYS team media interface, reordering operations apply only to the currently filtered subset of items. This leads to data inconsistencies, duplicate entries, and an unstable order for the full list of media items. This creates confusion for users, corrupts the intended media sequence, and degrades the operational reliability of team media management.

## User Segments Impacted
*   **Coaches:** Directly impacted when attempting to organize team media for practice plans, game highlights, or sharing with the team. Inconsistent ordering disrupts workflow, wastes time, and leads to incorrect content sequencing.
*   **Parents:** Indirectly impacted if media they've contributed or expect to see in a specific order appears out of sequence or duplicated, leading to frustration and reduced trust in the platform's ability to reliably manage content.
*   **Admins/Program Managers:** Responsible for overall data integrity and user experience. They will encounter issues when auditing or managing media across teams, leading to increased support requests and operational toil.

## Acceptance Criteria
1.  **Reorder Consistency (Unfiltered View):** When a user reorders media items while *no* media type filter is active, the order change MUST persist correctly across all media items in the database and be reflected consistently upon subsequent visits.
2.  **Reorder Consistency (Filtered View - Coach/Admin):** When a user reorders media items while a *single or multiple* media type filter is active (e.g., "videos only"), the reordering operation MUST apply to the *entire, unfiltered list* of media items. The visual change in order within the filtered view MUST correctly represent the new position of those items relative to the complete media collection.
    *   **Coach Perspective:** "I want to drag my important highlight video to the top, and know it will always be at the top, regardless of whether I'm looking at 'All Media' or just 'Videos'."
3.  **No Duplicate or Lost Items:** After any reordering operation, regardless of filter state, no media items MUST be duplicated, and no existing media items MUST be lost from the collection.
4.  **Stable Ordering:** The relative order of media items *not visible* in a currently active filter MUST remain unchanged during a reorder operation on filtered items.
    *   **Parent Perspective:** "If a coach reorders videos, my photos shouldn't randomly jump around."
5.  **UI Reflection:** Any reorder performed while a filter is active MUST be immediately and accurately reflected if the user clears the filter or switches to a different filter view.
6.  **Error Handling (Operational Reliability):** In cases where reordering fails (e.g., network error, backend issue), the system MUST provide clear feedback to the user, and the media order MUST revert to its last stable state or clearly indicate the failure.

## Non-Goals
*   Changes to the visual presentation or styling of media items.
*   The introduction of new media filtering capabilities (e.g., filtering by date, user, or tags).
*   Any changes to media upload, deletion, or metadata editing functionality.

## Edge Cases
*   **Empty Filtered Set:** Reordering attempts when the active filter results in no visible media items. The system should gracefully handle this without error and make no changes to the overall order.
*   **Single Item Filtered Set:** Reordering attempts when the active filter results in only one visible media item. No reorder operation should occur, and the system should make no changes to the overall order.
*   **Max Items Reordered:** Performance and stability when reordering a very large number of media items within a filtered view (if applicable, define "very large").
*   **Concurrent Editing:** While the core bug is client-side, consider if backend reordering mechanisms are robust to multiple users attempting to reorder the same media list concurrently.

## Open Questions
*   Is there a specific technical constraint in the existing `getFilteredItems` implementation that prevents it from returning the full item set for reordering purposes?
*   What is the acceptable latency for a reorder operation to reflect the change across all items, especially if the media list is very long?
*   Are there any existing integration tests that specifically cover media reordering in filtered and unfiltered states, which could be expanded or remediated?
