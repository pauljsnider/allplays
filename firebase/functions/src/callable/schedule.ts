import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

// NOTE: Firebase Admin SDK is typically initialized once in index.ts or a central config file.
//       Assuming admin.initializeApp() is handled elsewhere for this slice.

/**
 * Firebase Callable Function to publish an organization schedule draft to a team schedule.
 * Assumes the draft contains a `targetTeamId` and the caller is authorized.
 */
export const publishOrganizationSchedule = functions.https.onCall(
  async (data, context) => {
    // --- 1. Authentication and Authorization (Basic Check) ---
    if (!context.auth) {
      throw new functions.https.HttpsError(
        'unauthenticated',
        'The function must be called while authenticated.'
      );
    }

    // Authorization check - verify user can publish schedules to target team
    const draftRef = firestore.collection('organizationScheduleDrafts').doc(draftScheduleId);
    const draftSnapshot = await draftRef.get();
    if (!draftSnapshot.exists) {
      throw new functions.https.HttpsError('not-found', 'Draft schedule not found.');
    }
    const targetTeamId = draftSnapshot.data()?.targetTeamId;
    if (!targetTeamId) {
      throw new functions.https.HttpsError('failed-precondition', 'Draft missing targetTeamId.');
    }

    // TODO: Implement actual authorization: Verify context.auth.uid has permission
    // to publish schedules to the extracted targetTeamId. This might involve checking
    // user roles (e.g., 'admin') or team membership/ownership in a 'users' or 'teams' collection.
    // This is critical for preventing privilege escalation.
    // Example:
    // const userDoc = await firestore.collection('users').doc(context.auth.uid).get();
    // const userData = userDoc.data();
    // if (!userData?.roles?.includes('admin') && !userData?.teamMemberships?.[targetTeamId]?.isOwner) {
    //   throw new functions.https.HttpsError('permission-denied', 'User is not authorized to publish schedules for this team.');
    // }

    const { draftScheduleId } = data; // Expecting { draftScheduleId: string }

    // --- 2. Input Validation ---
    if (!draftScheduleId || typeof draftScheduleId !== 'string') {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'Missing or invalid \'draftScheduleId\' parameter.'
      );
    }

    const firestore = admin.firestore();

    try {
      // --- 3. Fetch Organization Schedule Draft ---
      const draftRef = firestore.collection('organizationScheduleDrafts').doc(draftScheduleId);
      const draftDoc = await draftRef.get();

      if (!draftDoc.exists) {
        throw new functions.https.HttpsError(
          'not-found',
          `Organization schedule draft with ID ${draftScheduleId} not found.`
        );
      }

      const draftData = draftDoc.data();
      if (!draftData) {
          throw new functions.https.HttpsError(
            'internal',
            'Draft schedule data is unexpectedly empty after fetching.'
          );
      }

      // --- 4. Determine Target Team ID ---
      const targetTeamId = draftData.targetTeamId; // Assuming draftData contains this field

      if (!targetTeamId || typeof targetTeamId !== 'string') {
        throw new functions.https.HttpsError(
          'failed-precondition',
        'Draft schedule data is missing a valid \'targetTeamId\' for publishing.'
        );
      }

      // --- 5. Transform Data Model (Draft to Team Schedule) ---
      const teamScheduleData = {
        // Core fields
        name: draftData.name || 'Published Schedule', // Use default if name is missing
        description: draftData.description || '',
        startDate: draftData.startDate, // Assuming Firestore Timestamp or ISO string
        endDate: draftData.endDate,
        // Status fields
        isActive: true, // New schedule is active by default
        isDraft: false, // Mark as published, not a draft
        originalDraftId: draftScheduleId, // Reference back to the source draft
        // Timestamps
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        // Nested data - assuming direct copy is sufficient for this slice
        events: draftData.events || [],
        participants: draftData.participants || [],
        // TODO: Deep copy and re-generate IDs for nested objects (events, participants)
        // if their IDs need to be unique within the new team schedule context.
        // For this slice, direct copy is assumed.
      };

      // --- 6. Persist Transformed Team Schedule ---
      // Validate target team exists before creating schedule
      const teamDocRef = firestore.collection('teams').doc(targetTeamId);
      const teamDoc = await teamDocRef.get();
      if (!teamDoc.exists) {
        throw new functions.https.HttpsError(
          'not-found',
          `Target team with ID ${targetTeamId} does not exist.`
        );
      }

      const teamScheduleCollectionRef = teamDocRef.collection('schedules');

      const newScheduleDocRef = await teamScheduleCollectionRef.add(teamScheduleData);

      // --- 7. Return Success Response ---
      return { success: true, scheduleId: newScheduleDocRef.id, message: 'Organization schedule published successfully to team schedule.' };

    } catch (error) {
      if (error instanceof functions.https.HttpsError) {
        throw error; // Re-throw already handled HttpsErrors
      }
      console.error('Error publishing organization schedule:', error); // Log unexpected errors
      throw new functions.https.HttpsError(
        'internal',
        'An unexpected error occurred during schedule publishing.',
        (error as Error).message // Provide original error message for debugging
      );
    }
  }
);
