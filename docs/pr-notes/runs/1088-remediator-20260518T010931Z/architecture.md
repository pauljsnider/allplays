# Architecture for 'Publish to Team Schedule' Feature Remediation

## Objective
To detail the implementation architecture for the 'Publish to Team Schedule' feature, addressing critical logic errors identified in the review feedback. This includes data flow for `draftSlots`, proper `scheduleId` handling, interaction with Firebase callable functions, and correct SDK usage/registration.

## Current State (Summary of Issues)
1.  **Backend Validation Missing:** `organizationId` and `scheduleId` are not validated in `publishOrganizationScheduleDraft`.
2.  **No Publishing Logic:** The backend function only logs, no actual data persistence.
3.  **`draftSlots` Not Transmitted:** Frontend does not send `draftGeneratorState.draftSlots` to the backend.
4.  **Incorrect `scheduleId` Usage:** Frontend reuses `anchorTeam.id` as `scheduleId`, which is not unique for a schedule publication.
5.  **Dummy Firebase Functions SDK:** Frontend uses a stub for Firebase Functions SDK, preventing actual backend calls.
6.  **Callable Not Registered:** The backend callable function is not imported into the main Cloud Functions entrypoint (`functions/index.js`), making it undeployable.

## Proposed Architecture

### 1. Frontend Changes (`organization-schedule.html` and potentially `js/db.js` if shared game logic is modified)

*   **Data Transmission:**
    *   When the "Publish to Team Schedule" button (`publishDraftScheduleBtn`) is clicked, the `onPublishDraftSchedule` function will collect `draftGeneratorState.draftSlots`.
    *   These `draftSlots` are an array of objects, each representing a proposed game slot (e.g., `{ homeTeamName, awayTeamName, startsAt, venueName, ... }`).
    *   The `httpsCallable` invocation will be updated to send this `draftSlots` array as part of the payload.
*   **`scheduleId` Generation:**
    *   Instead of `anchorTeam.id`, a unique identifier for the *publication event* will be generated on the frontend. A simple timestamp combined with a random string could suffice, or a dedicated UUID generation. This will serve as a `publicationBatchId` to group all games published in a single action.
    *   The `publishCallable` invocation will include this newly generated `publicationBatchId`.
*   **Firebase Functions SDK (Critical Dependency):**
    *   The `js/vendor/firebase-functions.js` file, currently identified as a stub, **MUST** be replaced with the actual Firebase client-side SDK for Cloud Functions. This is a foundational dependency for the feature to work in production. This will enable real `httpsCallable` invocations to reach the deployed Cloud Function. This is a *file system change* rather than a code change in `organization-schedule.html` or `js/firebase.js` (assuming `js/firebase.js` already correctly imports from `js/vendor/firebase-functions.js`).

### 2. Backend Changes (`functions/src/callable/schedule.ts` and `functions/index.js`)

*   **Input Validation (`functions/src/callable/schedule.ts`):**
    *   The `publishOrganizationScheduleDraft` callable function will add robust input validation for `organizationId`, `publicationBatchId` (the new `scheduleId`), and `draftSlots`.
    *   Checks will ensure `organizationId` and `publicationBatchId` are non-empty strings.
    *   `draftSlots` will be validated to be an array, and optionally, each slot within the array can have its critical fields validated (e.g., `homeTeamName`, `awayTeamName`, `startsAt`).
    *   Invalid inputs will result in `functions.https.HttpsError('invalid-argument')`.
*   **Publishing Logic (`functions/src/callable/schedule.ts`):**
    *   The function will iterate through each `draftSlot` in the received `data.draftSlots` array.
    *   For each slot, it will perform the actual publishing operation, which involves creating new game documents in Firestore.
    *   This logic will closely mirror the `addGame` functionality already present in the frontend (or derived from `buildOrganizationSharedGamePayload` and `addGame` in `js/db.js`). This means:
        *   Retrieving `homeTeam` and `awayTeam` details (e.g., IDs, names) from Firestore based on the names in `draftSlots` or direct IDs if passed.
        *   Creating two `game` documents in Firestore:
            1.  One for the `homeTeam` under `teams/{homeTeamId}/games`.
            2.  One mirrored for the `awayTeam` under `teams/{awayTeamId}/games`.
        *   Each game document will include all necessary fields (date, location, opponent details, notes, etc.) and specific metadata:
            *   `createdVia: 'organizationScheduleDraftPublish'`
            *   `publicationBatchId: <newly generated ID>`
            *   `publishedAt: admin.firestore.Timestamp.now()`
            *   `publishedBy: context.auth.uid`
            *   `publishedByEmail: context.auth.token.email`
    *   Error handling will be in place for individual game creation failures. The function should ideally either commit all or none (using a Firestore batch or transaction), or report partial success/failure clearly. Given the static site simplicity, reporting individual failures is probably acceptable if a full transaction isn't feasible/desired for large batches.
*   **Cloud Functions Entrypoint (`functions/index.js`):**
    *   The main `functions/index.js` file must be updated to explicitly `import { publishOrganizationScheduleDraft } from './src/callable/schedule';` (or equivalent TypeScript path if transpiled from `src/callable/schedule.ts`).
    *   Then, `exports.publishOrganizationScheduleDraft = publishOrganizationScheduleDraft;` will register it for deployment.

### 3. Data Flow

*   **Frontend to Backend:**
    1.  User clicks "Publish to Team Schedule".
    2.  `onPublishDraftSchedule` function is triggered.
    3.  A `publicationBatchId` is generated (e.g., `Date.now().toString() + '-' + Math.random().toString(36).substring(2, 8)`).
    4.  `draftGeneratorState.draftSlots` (an array of game objects) is retrieved.
    5.  `httpsCallable('publishOrganizationScheduleDraft')` is invoked with a payload like:
        ```json
        {
          "organizationId": "team-id-of-anchor",
          "publicationBatchId": "unique-id-for-this-batch",
          "draftSlots": [
            {
              "homeTeamName": "Team A",
              "awayTeamName": "Team B",
              "startsAt": "ISO String",
              "venueName": "Main Field",
              "durationMinutes": 60,
              // ... other draft slot details
            },
            // ... more slots
          ]
        }
        ```
*   **Backend to Firestore:**
    1.  `publishOrganizationScheduleDraft` receives the payload.
    2.  Validates `organizationId`, `publicationBatchId`, and `draftSlots`.
    3.  For each `draftSlot`:
        *   Identifies home and away team IDs (if not already provided, might need a Firestore lookup).
        *   Constructs a game object for the home team.
        *   Constructs a mirrored game object for the away team.
        *   Uses `admin.firestore().collection('teams').doc(teamId).collection('games').add(gameData)` to persist each game.
        *   Includes `publicationBatchId`, `publishedAt`, `publishedBy` in the game data.
    4.  Returns a success/failure status and message to the frontend.
*   **Backend to Frontend (Response):**
    *   The `result.data` from the `publishCallable` call will contain the `status` and `message` from the backend, indicating success or detailing any errors encountered during the batch publishing.

### 4. Reliability Considerations

*   **Idempotency:** While simple `addDoc` operations are not strictly idempotent, generating a `publicationBatchId` helps identify a batch of games. If a retry occurs, the backend could potentially check for existing games with that `publicationBatchId` to avoid duplicates, though this adds complexity not explicitly requested. For now, multiple calls would create duplicate games. A full transaction for all `draftSlots` would ensure atomicity (all or nothing), but might hit transaction limits for very large drafts. Batch writes are a good compromise for performance and atomicity for many `addDoc` operations.
*   **Error Handling:** Implement try-catch blocks in both frontend and backend for network issues, Firestore errors, and validation errors.
*   **User Feedback:** Frontend should clearly show publishing status, success, or detailed error messages.

This architecture addresses all the identified feedback points, providing a clear path for implementation.
