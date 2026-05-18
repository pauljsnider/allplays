# Code Plan for Issue #1087: Develop Backend Logic for Publishing Organization Schedule Draft to Team Schedule

## Objective
Implement a new Firebase Callable Function `publishOrganizationSchedule` to transform and persist a draft organization schedule into an official team schedule in Firestore.

## Implementation Details

### 1. Firebase Function Definition
-   **File**: `firebase/functions/src/callable/schedule.ts`
-   **Function Signature**:
    ```typescript
    import * as functions from 'firebase-functions';
    import * as admin from 'firebase-admin';

    // Initialize Firebase Admin if not already done
    if (!admin.apps.length) {
        admin.initializeApp();
    }

    export const publishOrganizationSchedule = functions.https.onCall(async (data, context) => {
        // ... implementation ...
    });
    ```
-   **Authentication**: The function will ensure the user is authenticated and potentially has appropriate permissions (e.g., admin role) using `context.auth`.

### 2. Input Validation
-   The function will expect `data.draftScheduleId` as a string.
-   **Validation Logic**:
    ```typescript
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated to publish a schedule.');
    }
    // Optional: Add role-based authorization check here
    // if (!context.auth.token.isAdmin) { ... }

    const draftScheduleId = data.draftScheduleId;
    if (typeof draftScheduleId !== 'string' || draftScheduleId.trim() === '') {
        throw new functions.https.HttpsError('invalid-argument', 'The function must be called with a valid draftScheduleId.');
    }
    ```

### 3. Data Transformation Logic
-   **Fetch Draft Schedule**:
    ```typescript
    const db = admin.firestore();
    const draftScheduleRef = db.collection('draftOrganizationSchedules').doc(draftScheduleId);
    const draftScheduleDoc = await draftScheduleRef.get();

    if (!draftScheduleDoc.exists) {
        throw new functions.https.HttpsError('not-found', 'Draft schedule not found.');
    }

    const draftScheduleData = draftScheduleDoc.data();
    // Ensure draftScheduleData is not undefined and has expected structure
    if (!draftScheduleData) {
        throw new functions.https.HttpsError('internal', 'Draft schedule data is empty.');
    }
    ```
-   **Mapping**: A transformation function or logic will be implemented to map fields from `draftScheduleData` to the `teamSchedule` data model. This will involve:
    -   Copying core schedule details (name, description, dates, etc.).
    -   Potentially generating unique IDs for the new team schedule document and any nested sub-collections (e.g., `events`, `games`).
    -   Setting `publishedAt: admin.firestore.FieldValue.serverTimestamp()`.
    -   Setting `status: 'published'`.
    -   Ensuring all required fields for the `teamSchedule` data model are present.

### 4. Persistence
-   **Create Team Schedule Document**:
    ```typescript
    const teamScheduleCollectionRef = db.collection('teamSchedules');
    const newTeamScheduleRef = teamScheduleCollectionRef.doc(); // Let Firestore generate ID
    await newTeamScheduleRef.set(transformedTeamScheduleData);
    ```
-   **Return Value**: The function will return the ID of the newly created `teamSchedule` document upon successful publication.
    ```typescript
    return { teamScheduleId: newTeamScheduleRef.id };
    ```

## Out of Scope (as per issue)
-   UI changes.
-   Advanced error recovery, rollback, or detailed audit logging.

## Affected File
-   `firebase/functions/src/callable/schedule.ts`
