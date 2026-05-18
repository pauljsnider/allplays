# QA Strategy for 'Publish to Team Schedule' Feature

## Objective
To ensure the 'Publish to Team Schedule' feature is robust, reliable, and prevents data integrity issues, addressing all identified logic errors and ensuring the end-to-end flow functions as expected.

## Guiding Principles
*   **Risk-Based Testing:** Prioritize testing efforts on areas with high impact on data integrity, user experience, and system stability.
*   **End-to-End Verification:** Validate the entire user journey from frontend interaction to backend data persistence.
*   **Error Handling:** Verify graceful handling of invalid inputs and unexpected backend responses.
*   **Deployment Validation:** Confirm correct deployment and accessibility of backend components.

## Identified Logic Errors & Corresponding QA Focus

### 1. Backend function missing input validation for `organizationId` and `scheduleId`.
*   **Risk:** Backend errors, data corruption, or unexpected behavior if invalid or missing identifiers are processed.
*   **QA Focus:** Robust input validation for both parameters.
*   **Verification Steps:**
    *   **Manual:**
        *   Attempt to trigger the `publishOrganizationScheduleDraft` callable with `organizationId` and/or `scheduleId` as:
            *   `null`
            *   `undefined` (if possible to simulate from frontend or direct call)
            *   Empty string `""`
            *   Non-string types (e.g., `123`, `true`, `{}`)
        *   Verify that the backend callable correctly throws an `HttpsError` with an 'invalid-argument' code and a clear error message for each invalid input.
        *   Verify the frontend displays an appropriate user-friendly error message and prevents the operation.

### 2. No actual publishing logic in the backend function.
*   **Risk:** User perceives success, but no actual data is published, leading to data loss and significant frustration.
*   **QA Focus:** Verification of successful data persistence and state changes in the backend.
*   **Verification Steps:**
    *   **Manual (End-to-End):**
        *   Create a new draft schedule in the UI with several slots.
        *   Click "Publish to Team Schedule".
        *   Navigate to the team's official schedule view and confirm the newly published schedule appears correctly and contains all expected slots.
        *   Verify the state of the original draft (e.g., if it's marked as published or deleted, depending on the intended design).
        *   Directly inspect Firestore to confirm the `draftSlots` data has been moved/copied to the correct published schedule collection and that all relevant status fields are updated.

### 3. Draft data (`draftSlots`) not transmitted from frontend to backend.
*   **Risk:** Publishing an empty or incomplete schedule, rendering the feature useless.
*   **QA Focus:** Ensuring the complete `draftSlots` payload is sent and processed.
*   **Verification Steps:**
    *   **Manual (End-to-End):**
        *   Create a draft schedule with a variety of slots (e.g., different times, dates, opponent details).
        *   Publish the draft.
        *   Inspect the network request payload in browser developer tools to confirm that the `draftSlots` array is correctly included in the `publishOrganizationScheduleDraft` callable function call.
        *   Verify in the Firestore database that the published schedule document contains all the `draftSlots` data precisely as created in the UI.
        *   Confirm the published schedule in the UI accurately reflects all saved slots.

### 4. Incorrect `scheduleId` usage (reusing `anchorTeam.id`) in the frontend.
*   **Risk:** Data integrity issues, collisions if multiple drafts or published schedules exist for the same team, inability to manage distinct schedules.
*   **QA Focus:** Generation and usage of a unique `scheduleId` per schedule.
*   **Verification Steps:**
    *   **Manual:**
        *   Create two distinct draft schedules for the same team (e.g., "Season Schedule A" and "Season Schedule B").
        *   Publish "Season Schedule A". Note the `scheduleId` generated in Firestore.
        *   Publish "Season Schedule B". Note the `scheduleId` generated in Firestore.
        *   Verify that "Season Schedule A" and "Season Schedule B" each have a unique `scheduleId` and are independently accessible and correct in the UI and backend.
        *   Attempt to publish the same draft multiple times (if the design allows) and confirm `scheduleId` behavior (e.g., updates existing, creates new, throws error).

### 5. Use real Firebase Functions SDK for callable invocations.
*   **Risk:** Frontend calls will not reach the backend in production, leading to non-functional features.
*   **QA Focus:** Verifying that the actual SDK is used, not a dummy stub.
*   **Verification Steps:**
    *   **Manual:**
        *   Open browser developer tools and monitor network requests.
        *   Click "Publish to Team Schedule".
        *   Verify that a network request is made to a Firebase Cloud Function endpoint (e.g., `https://<your-project-id>.cloudfunctions.net/publishOrganizationScheduleDraft`) and not to a local dummy endpoint or failing with a client-side error.
        *   Perform end-to-end tests in a deployed staging environment to confirm real invocation.

### 6. Register callable in deployed Cloud Functions entrypoint.
*   **Risk:** The Cloud Function will not be deployed or accessible, resulting in "function not found" errors in production.
*   **QA Focus:** Confirmation of successful deployment and availability of the callable function.
*   **Verification Steps:**
    *   **Post-Deployment Manual Check (Dev/Staging Environment):**
        *   Run `firebase functions:list` in the terminal to confirm `publishOrganizationScheduleDraft` is listed as a deployed function.
        *   Alternatively, check the Google Cloud Console for the Firebase project to ensure the function appears and is healthy.
        *   Execute an end-to-end manual test of the "Publish to Team Schedule" feature in the deployed environment to confirm the callable is indeed invoked and processed successfully.

## Overall QA Strategy

1.  **Local Development Verification:**
    *   Developers should perform unit-level checks for frontend `scheduleId` generation and ensure correct data transmission (`draftSlots`).
    *   Backend developers should unit test the callable for input validation and core publishing logic (if automated tests are introduced in the future).
    *   Initial end-to-end manual tests on `http://localhost:8000/organization-schedule.html` to confirm basic functionality and network requests.

2.  **Staging Environment Testing:**
    *   **Full End-to-End Manual Testing:** The primary phase for comprehensive verification.
        *   **Test Cases:** Cover all verification steps outlined above for input validation, publishing logic, data transmission, and `scheduleId` uniqueness.
        *   **Data Scenarios:** Test with various draft sizes (empty, single slot, multiple slots), different team configurations, and edge cases for inputs.
        *   **Error Paths:** Explicitly test invalid inputs to confirm correct error handling.
    *   **Deployment Validation:** Confirm the Firebase Callable Function is successfully deployed and accessible in the staging environment before any functional testing begins.

3.  **Production Monitoring (Post-Release):**
    *   Monitor Firebase Function logs for `publishOrganizationScheduleDraft` for any unhandled errors or unexpected behavior.
    *   Monitor frontend error logs for issues related to the publishing flow.

## Test Data Requirements
*   A test Firebase project and environment (staging).
*   Test user accounts with different roles (e.g., Team Owner, Team Admin).
*   Pre-existing test teams.
*   Ability to create draft schedules with varied `draftSlots` content.

## Automation Opportunities (Future Consideration)
*   While this repository currently lacks an automated test runner, the following areas would benefit from automation:
    *   **Backend Callable Unit/Integration Tests:** To validate input, publishing logic, and Firestore interactions.
    *   **Frontend Unit Tests:** For helper functions, especially `scheduleId` generation and payload construction.
    *   **End-to-End UI Automation:** Using tools like Playwright or Cypress to simulate user flows and verify UI state changes and backend data.
