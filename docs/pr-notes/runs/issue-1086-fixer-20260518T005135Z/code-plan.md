# Implementation Plan for Issue #1086: Implement UI Trigger for Publishing Organization Schedule Draft

## 1. Overview

The goal is to add a "Publish to Team Schedule" button to the organization schedule draft UI and connect it to a placeholder Firebase Callable Function that logs the request. This will be a minimal, targeted change as per the issue scope.

## 2. Frontend Implementation

### 2.1. Locate and Modify `organization-schedule-detail.component.html` (or similar)

*   **Action:** Identify the appropriate HTML template where the "Publish to Team Schedule" button should be placed. Based on the "Likely Files," `src/app/organization/schedule/schedule-publishing.component.ts` is the component, which implies it will be used within a parent template, possibly `src/app/organization/schedule/organization-schedule-detail/organization-schedule-detail.component.html` or similar. I'll search for the appropriate file.
*   **Change:** Add a `<button>` element with the text "Publish to Team Schedule".
*   **Binding:** Bind the `(click)` event of this button to a new method in the component, e.g., `onPublishSchedule()`.

### 2.2. Create `schedule-publishing.component.ts` (if it doesn't exist) or integrate into existing component

*   **Action:** The issue suggests `src/app/organization/schedule/schedule-publishing.component.ts`. I will assume this is a new component to be created or integrated into an existing one like `organization-schedule-detail.component.ts`. If `schedule-publishing.component.ts` doesn't exist, I will integrate the button and logic directly into the `organization-schedule-detail.component.ts` for simplicity and minimal change.
*   **Dependencies:**
    *   Import `AngularFireFunctions` from `@angular/fire/functions` to interact with Firebase Callable Functions.
    *   Import `functions` from `firebase/app`.
*   **Method:** Implement `onPublishSchedule()` method.
    *   This method will get a reference to the Firebase Callable Function `publishOrganizationScheduleDraft`.
    *   It will call this function with necessary parameters (e.g., `organizationId`, `scheduleId`, which will need to be passed into the component).
    *   It will log the success or failure of the invocation to the console.

## 3. Backend Implementation (Firebase Functions)

### 3.1. Modify `firebase/functions/src/callable/schedule.ts`

*   **Action:** Create or modify `firebase/functions/src/callable/schedule.ts`.
*   **Function Definition:** Define a new Firebase Callable Function: `publishOrganizationScheduleDraft`.
    ```typescript
    import * as functions from 'firebase-functions';
    import * as admin from 'firebase-admin';

    // Initialize admin if not already initialized
    if (!admin.apps.length) {
      admin.initializeApp();
    }

    export const publishOrganizationScheduleDraft = functions.https.onCall(async (data, context) => {
      // Authentication check (minimal for this slice)
      if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'The function must be called while authenticated.');
      }

      const { organizationId, scheduleId } = data;

      // Log the request to fulfill acceptance criteria
      functions.logger.info(`Publish request received for organizationId: ${organizationId}, scheduleId: ${scheduleId}`, {
        uid: context.auth.uid,
        organizationId,
        scheduleId
      });

      // Return a placeholder success response
      return { status: 'success', message: 'Publish request logged successfully.' };
    });
    ```
*   **Export:** Ensure the function is exported so Firebase can discover and deploy it.

## 4. Testing Plan

*   **Frontend Unit Test:** Add a test to the relevant Angular component's spec file (`.spec.ts`) to ensure `onPublishSchedule` is called on button click and that it attempts to invoke the Firebase function. Mock `AngularFireFunctions`.
*   **Backend Unit Test (Conceptual for this slice):** A simple test to confirm the function logs correctly and returns the expected placeholder response. (Given the constraints, this might be a manual verification of logs post-deployment initially).

## 5. Risks and Rollback

*   **Risk:** Introducing a new UI element might break existing styling or responsiveness.
    *   **Mitigation:** Carefully place the button, reuse existing styling classes where possible, and perform UI validation.
*   **Risk:** Firebase Function deployment issues.
    *   **Mitigation:** Test the function locally with `firebase emulators:start` if feasible, and carefully review deployment logs.
*   **Rollback:** Revert the Git commit.

## 6. Pre-computation / Pre-analysis

*   I need to locate the existing `organization-schedule-detail.component.ts` and its associated HTML template to correctly place the button.
*   I will need to ensure `firebase/functions/src/callable/schedule.ts` exists, or create it.
