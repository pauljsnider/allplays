# Requirements for 'Publish to Team Schedule' Feature

## Objective
To enable users to reliably publish a drafted schedule to a team's official schedule, ensuring data integrity, proper validation, and a clear user experience. This document addresses critical logic errors identified in the PR review.

## Functional Requirements

### FR1: Input Validation in Backend
**Description:** The backend `publishOrganizationScheduleDraft` callable function MUST validate the `organizationId` and `scheduleId` parameters upon receipt.
**Acceptance Criteria:**
- If `organizationId` is missing, null, or not a string, the function MUST throw an `HttpsError` with `invalid-argument` status and a clear message.
- If `scheduleId` is missing, null, or not a string, the function MUST throw an `HttpsError` with `invalid-argument` status and a clear message.

### FR2: Implement Actual Publishing Logic
**Description:** The backend `publishOrganizationScheduleDraft` callable function MUST contain the actual business logic to persist the provided draft schedule data (draft slots) to the official team schedule.
**Acceptance Criteria:**
- The function MUST successfully process and store the `draftSlots` associated with the given `organizationId` and `scheduleId` in Firestore or other persistent storage.
- The operation MUST be atomic, ensuring either the entire schedule is published or no changes are made if an error occurs.
- A successful publication MUST update the system state such that the schedule is visible and active according to the application's design.

### FR3: Transmit Draft Data from Frontend
**Description:** The frontend MUST transmit the complete draft schedule data (`draftSlots`) from the `draftGeneratorState` to the backend `publishOrganizationScheduleDraft` callable function.
**Acceptance Criteria:**
- The `publishCallable` function call in `organization-schedule.html` MUST include a `draftSlots` parameter in its payload, containing the array of draft schedule entries.
- The structure of `draftSlots` sent from the frontend MUST match the expected input structure of the backend function.

### FR4: Unique Schedule ID Generation/Identification
**Description:** The frontend MUST use a unique `scheduleId` that correctly identifies the specific draft schedule being published, rather than reusing `anchorTeam.id`.
**Acceptance Criteria:**
- **Option 1 (Preferred):** A new `scheduleId` is generated client-side upon the creation of a new draft or retrieved from the server if the draft is being edited. This `scheduleId` MUST be globally unique within the context of schedules.
- **Option 2:** The `scheduleId` is assigned and managed by the backend during the draft creation process, and the frontend retrieves and uses this unique ID when publishing.
- The `scheduleId` MUST not conflict with `anchorTeam.id` or other existing identifiers, preventing data integrity issues.
- The `scheduleId` MUST allow for multiple distinct draft schedules to exist for a single organization.

## Non-Functional Requirements

### NFR1: Error Handling and User Feedback
**Description:** The frontend MUST provide appropriate feedback to the user based on the success or failure of the publish operation.
**Acceptance Criteria:**
- On successful publication, a clear success message (e.g., "Schedule published successfully!") MUST be displayed.
- On failure (e.g., due to validation errors or backend issues), a clear, actionable error message MUST be displayed to the user.

## Data Flow
1.  **User Action:** User initiates "Publish to Team Schedule" from `organization-schedule.html`.
2.  **Frontend Collects Data:** The frontend gathers `organizationId` (from `anchorTeam.id`), the uniquely identified `scheduleId` (as per FR4), and the `draftSlots` array from `draftGeneratorState`.
3.  **Frontend Calls Backend:** `httpsCallable(functions, 'publishOrganizationScheduleDraft')` is invoked with a payload containing `organizationId`, `scheduleId`, and `draftSlots`.
4.  **Backend Receives & Validates:** The `publishOrganizationScheduleDraft` function receives the payload. It first validates `organizationId` and `scheduleId` (FR1).
5.  **Backend Publishes:** If validation passes, the backend executes the publishing logic to save `draftSlots` to the canonical schedule (FR2) under the specified `organizationId` and `scheduleId`.
6.  **Backend Responds:** The backend returns a success or failure response.
7.  **Frontend Updates UI:** The frontend displays appropriate user feedback based on the backend response (NFR1).

## `scheduleId` Generation/Identification Strategy (FR4 Detail)

Given the current context, the most straightforward approach for `scheduleId` would be:

**Option 1 (Recommended): Client-side UUID generation for new drafts, server-side persistence for existing drafts.**

-   **New Drafts:** When a user starts a *new* schedule draft, the frontend generates a `UUID` (Universally Unique Identifier) for `scheduleId`. This ensures uniqueness without immediate backend interaction.
-   **Existing Drafts:** If a user loads an *existing* draft (e.g., from local storage or a previously saved draft on Firebase), the `scheduleId` associated with that draft is retrieved and reused for publishing.
-   **Backend Role:** The backend validates that the `scheduleId` is a valid UUID format and ensures that it is associated with the `organizationId` for which the schedule is being published (to prevent cross-organization data leakage).

This approach allows for immediate client-side creation of drafts while maintaining unique identification and preventing reuse of `anchorTeam.id` for schedules.
