import { createHash } from 'node:crypto';
import { DomainError, loadManagedTeamsFromCallable, resolveUserContext } from './core.js';
import { extractBearerToken } from './identity.js';
import { createUserDb } from './firestoreRest.js';
import { createDirectFavoriteStore } from './directFavoriteStore.js';
import { createDirectStatConfigurationStore } from './directStatConfiguration.js';
import { createDirectScheduleStore } from './directSchedule.js';
import { createDirectRsvpStore } from './directRsvp.js';
import { createDirectRosterBatchStore } from './directRosterBatch.js';
import { createDirectTrackingBatchStore, createDirectTrackingLifecycleStore } from './directTrackingOperations.js';
import { createDirectTrackingStatusStore } from './directTrackingStatus.js';
import { createDirectAssignmentStore } from './directAssignments.js';
import { createDirectAssignmentClaimStore } from './directAssignmentClaims.js';
import { createDirectPlayerProfileStore } from './directPlayerProfile.js';
import { createDirectFamilyRsvpStore } from './directFamilyRsvp.js';
import { createDirectPracticeAttendanceStore } from './directPracticeAttendance.js';
import { createDirectIncentiveStore } from './directIncentives.js';
import { createDirectTeamSetupStore } from './directTeamSetup.js';
import { createDirectTrackingItemStore } from './directTrackingItem.js';
import { createDirectRosterLifecycleStore } from './directRosterLifecycle.js';
import { createDirectRosterStore } from './directRoster.js';
import { createDirectPracticeTimelineStore } from './directPracticeTimeline.js';

// Review consent permits preparation only. The separate, one-action approval
// in directFavoriteMcp is required for execution; no grant is upgraded here.
export function createDirectSessionAuthenticator({ oauth, resolveIdentity, now = Date.now }) {
    return async (authorization) => {
        const token = extractBearerToken(authorization);
        const grant = token ? await oauth.resolveAccessToken(token, { includeBinding: true }) : null;
        if (!grant || !grant.clientId || !Number.isFinite(grant.expiresAt) || grant.expiresAt <= now()) {
            throw new DomainError('unauthenticated', 'A current broker-issued connection is required.');
        }
        if (grant.reviewRequests !== true) throw new DomainError('insufficient_scope', 'Explicit review-request consent is required.');
        // Bypass the ordinary read cache: revoked Firebase refresh credentials
        // must fail before a new protocol interaction or execution step.
        const identity = await resolveIdentity(`Bearer ${grant.firebaseRefreshToken}`, { forceRefresh: true });
        if (identity?.via !== 'refresh-token' || !/^[A-Za-z0-9_-]{1,128}$/.test(identity.uid || '') || !identity.idToken) {
            throw new DomainError('unauthenticated', 'The connected identity could not be verified.');
        }
        return {
            uid: identity.uid, email: identity.email, idToken: identity.idToken,
            clientId: grant.clientId, expiresAt: grant.expiresAt,
            reviewRequests: true,
            grantKey: createHash('sha256').update(token).digest('hex')
        };
    };
}

export function directFavoriteDependencies({ projectId, fetchImpl = fetch }) {
    return (actor, getCurrentActor) => ({
        uid: actor.uid,
        store: createDirectFavoriteStore({ projectId, uid: actor.uid, fetchImpl, getIdToken: async () => (await getCurrentActor()).idToken }),
        statConfigurationStore: createDirectStatConfigurationStore({ projectId, uid: actor.uid, fetchImpl, getIdToken: async () => (await getCurrentActor()).idToken }),
        trackingBatchStore: createDirectTrackingBatchStore({ projectId, uid: actor.uid, fetchImpl, getIdToken: async () => (await getCurrentActor()).idToken }),
        trackingLifecycleStore: createDirectTrackingLifecycleStore({ projectId, uid: actor.uid, fetchImpl, getIdToken: async () => (await getCurrentActor()).idToken }),
        trackingStatusStore: createDirectTrackingStatusStore({ projectId, uid: actor.uid, fetchImpl, getIdToken: async () => (await getCurrentActor()).idToken }),
        assignmentStore: createDirectAssignmentStore({ projectId, uid: actor.uid, fetchImpl, getIdToken: async () => (await getCurrentActor()).idToken }),
        assignmentClaimStore: createDirectAssignmentClaimStore({ projectId, uid: actor.uid, fetchImpl, getIdToken: async () => (await getCurrentActor()).idToken }),
        playerProfileStore: createDirectPlayerProfileStore({ projectId, uid: actor.uid, fetchImpl, getIdToken: async () => (await getCurrentActor()).idToken }),
        familyRsvpStore: createDirectFamilyRsvpStore({ projectId, uid: actor.uid, fetchImpl, getIdToken: async () => (await getCurrentActor()).idToken }),
        familyRsvpNoteStore: createDirectFamilyRsvpStore({ projectId, uid: actor.uid, fetchImpl, getIdToken: async () => (await getCurrentActor()).idToken }, { staffNotes: true }),
        practiceAttendanceStore: createDirectPracticeAttendanceStore({ projectId, uid: actor.uid, fetchImpl, getIdToken: async () => (await getCurrentActor()).idToken }),
        incentiveStore: createDirectIncentiveStore({ projectId, uid: actor.uid, fetchImpl, getIdToken: async () => (await getCurrentActor()).idToken }),
        teamSetupStore: createDirectTeamSetupStore({ projectId, uid: actor.uid, fetchImpl, getIdToken: async () => (await getCurrentActor()).idToken }),
        trackingItemStore: createDirectTrackingItemStore({ projectId, uid: actor.uid, fetchImpl, getIdToken: async () => (await getCurrentActor()).idToken }),
        rosterLifecycleStore: createDirectRosterLifecycleStore({ projectId, uid: actor.uid, fetchImpl, getIdToken: async () => (await getCurrentActor()).idToken }),
        rosterStore: createDirectRosterStore({ projectId, uid: actor.uid, fetchImpl, getIdToken: async () => (await getCurrentActor()).idToken }),
        scheduleStore: createDirectScheduleStore({ projectId, uid: actor.uid, fetchImpl, getIdToken: async () => (await getCurrentActor()).idToken }),
        rsvpStore: createDirectRsvpStore({ projectId, uid: actor.uid, fetchImpl, getIdToken: async () => (await getCurrentActor()).idToken }),
        rosterBatchStore: createDirectRosterBatchStore({ projectId, uid: actor.uid, fetchImpl, getIdToken: async () => (await getCurrentActor()).idToken }),
        practiceTimelineStore: createDirectPracticeTimelineStore({ projectId, uid: actor.uid, fetchImpl, getIdToken: async () => (await getCurrentActor()).idToken }),
        getDb: async () => createUserDb({ projectId, idToken: (await getCurrentActor()).idToken, fetchImpl }),
        getContext: async () => {
            const current = await getCurrentActor();
            const managed = await loadManagedTeamsFromCallable({ projectId, idToken: current.idToken, fetchImpl });
            if (managed.isPartial) throw new DomainError('unavailable', 'Current manager access could not be verified completely.');
            return resolveUserContext(createUserDb({ projectId, idToken: current.idToken, fetchImpl }), current, { managedTeams: managed.teams });
        }
    });
}
