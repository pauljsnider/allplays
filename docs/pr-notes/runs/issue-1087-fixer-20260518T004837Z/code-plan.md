# Code Implementation Plan for Issue #1087: Develop Backend Logic for Publishing Organization Schedule Draft to Team Schedule

**Objective:** Implement a Firebase HTTPS Callable Function `publishOrganizationSchedule` to transform an organization schedule draft into a team schedule and persist it in Firestore.

## 1. File Location

*   **Likely File:** `firebase/functions/src/callable/schedule.ts`
    *   This file will be created or modified to house the new Firebase Function.

## 2. Function Definition

*   **Type:** HTTPS Callable Function (`functions.https.onCall`).
*   **Name:** `publishOrganizationSchedule`.
*   **Input:** The function will accept a `data` object containing `draftScheduleIdentifier` (string).
*   **Dependencies:** `firebase-functions`, `firebase-admin`.

## 3. Implementation Steps

### 3.1. Firebase Admin SDK Initialization

*   Ensure the Firebase Admin SDK is initialized at the top of the `schedule.ts` file if not already globally initialized.

    ```typescript
    import * as functions from 'firebase-functions';
    import * as admin from 'firebase-admin';

    if (!admin.apps.length) {
      admin.initializeApp();
    }
    const db = admin.firestore();
    ```

### 3.2. Function Stub

*   Create the basic structure for the HTTPS Callable Function.

    ```typescript
    export const publishOrganizationSchedule = functions.https.onCall(async (data, context) => {
      // Implementation details will go here
    });
    ```

### 3.3. Authentication and Authorization

*   **Requirement:** The function must be called by an authenticated user.
*   **Implementation:** Check `context.auth`. If `context.auth` is null, throw an `HttpsError` (`unauthenticated`).
*   **Further Authorization (Future Scope/Consideration):** While out of scope for *this slice*, a robust implementation would verify the caller's role (e.g., `isAdmin`, `teamOwner`) to ensure they have permission to publish schedules for the associated organization/team. For this slice, assume a logged-in user is sufficient if the parent issue doesn't define specific roles.

### 3.4. Input Validation

*   **Requirement:** Basic validation for `draftScheduleIdentifier`.
*   **Implementation:**
    *   Extract `draftScheduleIdentifier` from the `data` object.
    *   Verify `draftScheduleIdentifier` is present and is a string.
    *   If invalid, throw an `HttpsError` (`invalid-argument`).

### 3.5. Retrieve Draft Schedule

*   **Requirement:** Fetch the draft schedule from Firestore.
*   **Implementation:**
    *   Query the Firestore collection (e.g., `/organizationDraftSchedules`) using `draftScheduleIdentifier`.
    *   Check if the document exists. If not, throw an `HttpsError` (`not-found`).
    *   Extract the `data()` from the `draftScheduleDoc`.
    *   **Assumption:** The draft schedule data will contain a `teamId` field to associate it with a specific team. Validate `teamId` presence; if missing, throw `HttpsError` (`failed-precondition`).

### 3.6. Data Transformation

*   **Requirement:** Correctly transform draft schedule data into the target team schedule data model.
*   **Implementation:**
    *   Create a new object `teamScheduleData`.
    *   Map relevant fields from `draftScheduleData` to `teamScheduleData`. This includes:
        *   Directly transferable fields (e.g., `name`, `description`, `startDate`, `endDate`, `events`).
        *   Potentially new fields to be added (e.g., `createdAt` using `admin.firestore.FieldValue.serverTimestamp()`, `publishedBy` from `context.auth.uid`, `organizationId` to link back to the draft).
    *   **Note:** The exact transformation logic depends on the specific schemas of `organizationDraftSchedules` and `team.schedules`. This will require clarification if not already defined in a spec. For this task, a direct field copy and addition of metadata is assumed.

### 3.7. Persist Transformed Team Schedule

*   **Requirement:** Persist the transformed team schedule in the appropriate Firebase collection.
*   **Implementation:**
    *   Save `teamScheduleData` to the `/teams/{teamId}/schedules` subcollection.
    *   Use `collection('teams').doc(teamId).collection('schedules').add(teamScheduleData)` to allow Firestore to auto-generate a new document ID.
    *   Return a success response including the new `scheduleId`.

### 3.8. Error Handling and Logging

*   **Requirement:** Include basic error recovery and logging.
*   **Implementation:**
    *   Wrap the core logic in a `try-catch` block.
    *   Log unexpected errors using `console.error` or `functions.logger.error`.
    *   Re-throw `HttpsError` instances that were intentionally thrown.
    *   For unhandled errors, throw a generic `HttpsError` (`internal`) with a user-friendly message, optionally including the original error message for debugging (but not to the client in production).

## 4. Example Code Structure (`firebase/functions/src/callable/schedule.ts`)

```typescript
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

// Initialize Firebase Admin SDK if not already initialized
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

/**
 * Publishes an organization schedule draft to a team's official schedule.
 *
 * Expects `data` to contain:
 * - `draftScheduleIdentifier`: string, the ID of the draft schedule to publish.
 */
export const publishOrganizationSchedule = functions.https.onCall(async (data, context) => {
  // 1. Authentication Check
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'The function must be called while authenticated.');
  }
  // Optional: Add more granular authorization checks here (e.g., user is admin or owner)
  // const userId = context.auth.uid;
  // const userDoc = await db.collection('users').doc(userId).get();
  // if (!userDoc.exists || !userDoc.data()?.isAdmin) {
  //   throw new functions.https.HttpsError('permission-denied', 'Only authorized users can publish schedules.');
  // }

  // 2. Input Validation
  const { draftScheduleIdentifier } = data;
  if (typeof draftScheduleIdentifier !== 'string' || draftScheduleIdentifier.trim() === '') {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'The function must be called with a valid non-empty draftScheduleIdentifier (string).'
    );
  }

  try {
    // 3. Retrieve Draft Schedule
    const draftScheduleRef = db.collection('organizationDraftSchedules').doc(draftScheduleIdentifier);
    const draftScheduleDoc = await draftScheduleRef.get();

    if (!draftScheduleDoc.exists) {
      throw new functions.https.HttpsError('not-found', `Draft schedule with ID "${draftScheduleIdentifier}" not found.`);
    }

    const draftScheduleData = draftScheduleDoc.data();
    if (!draftScheduleData) {
      throw new functions.https.HttpsError('internal', 'Draft schedule data is unexpectedly empty.');
    }

    // Ensure teamId is present in the draft schedule for association
    const teamId = draftScheduleData.teamId;
    if (typeof teamId !== 'string' || teamId.trim() === '') {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Draft schedule is missing an associated teamId. Cannot publish without a target team.'
      );
    }

    // 4. Data Transformation
    // This mapping assumes a basic structure for draft and team schedules.
    // Adjust fields based on actual data models.
    const teamScheduleData = {
      name: draftScheduleData.name || 'Untitled Schedule',
      description: draftScheduleData.description || '',
      startDate: draftScheduleData.startDate, // Assuming Firestore Timestamp or Date object
      endDate: draftScheduleData.endDate,     // Assuming Firestore Timestamp or Date object
      events: draftScheduleData.events || [], // Assuming an array of event objects
      organizationDraftId: draftScheduleIdentifier, // Link back to the original draft
      teamId: teamId,
      status: 'published', // New status field
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      publishedBy: context.auth.uid,
      // Add other relevant fields as per the team schedule data model
      // e.g., location, type, etc.
    };

    // 5. Persist Transformed Team Schedule
    const teamScheduleCollectionRef = db.collection('teams').doc(teamId).collection('schedules');
    const newTeamScheduleRef = await teamScheduleCollectionRef.add(teamScheduleData);

    functions.logger.info(`Successfully published draft schedule "${draftScheduleIdentifier}" to team "${teamId}" as schedule ID "${newTeamScheduleRef.id}".`);

    return { success: true, scheduleId: newTeamScheduleRef.id };

  } catch (error) {
    if (error instanceof functions.https.HttpsError) {
      functions.logger.warn(`Callable function error: ${error.code} - ${error.message}`);
      throw error; // Re-throw already handled HTTPS errors
    }
    functions.logger.error('Unhandled error publishing schedule:', error);
    throw new functions.https.HttpsError(
      'internal',
      'An unexpected error occurred while publishing the schedule. Please try again later.'
    );
  }
});
```

## 5. Testing and Validation (Manual)

*   As per `AGENTS.md` and `CLAUDE.md`, there is no automated test runner.
*   **Manual Test Plan:**
    1.  Deploy the Firebase Function (`firebase deploy --only functions`).
    2.  Use a client-side script (e.g., from `test-pr-changes.html` or a new test page) to call the `publishOrganizationSchedule` function.
    3.  **Scenario 1 (Success):** Call with a valid `draftScheduleIdentifier` that exists in Firestore and has a `teamId`.
        *   **Expected:** Function returns `success: true` and a `scheduleId`.
        *   **Verification:** Check Firestore to confirm a new document exists in `/teams/{teamId}/schedules` with the transformed data.
    4.  **Scenario 2 (Invalid Input):** Call without `draftScheduleIdentifier` or with an invalid type.
        *   **Expected:** Function returns an `HttpsError` with code `invalid-argument`.
    5.  **Scenario 3 (Draft Not Found):** Call with a `draftScheduleIdentifier` that does not exist.
        *   **Expected:** Function returns an `HttpsError` with code `not-found`.
    6.  **Scenario 4 (Unauthenticated):** Call the function without being authenticated.
        *   **Expected:** Function returns an `HttpsError` with code `unauthenticated`.
    7.  **Scenario 5 (Missing teamId in Draft):** Create a draft schedule document in Firestore that is missing the `teamId` field, then try to publish it.
        *   **Expected:** Function returns an `HttpsError` with code `failed-precondition`.

## 6. Out of Scope Reminders

*   No UI changes are included in this plan.
*   No advanced error recovery (e.g., rollbacks for partial failures) or detailed audit logging beyond basic function logs.
