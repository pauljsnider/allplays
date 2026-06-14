import {
    addGame as legacyAddGame,
    addPractice as legacyAddPractice,
    broadcastLiveEvent as legacyBroadcastLiveEvent,
    cancelOccurrence as legacyCancelOccurrence,
    cancelRideRequest as legacyCancelRideRequest,
    claimAssignmentSlot as legacyClaimAssignmentSlot,
    claimOpenOfficiatingSlot as legacyClaimOpenOfficiatingSlot,
    closeRideOffer as legacyCloseRideOffer,
    createRideOffer as legacyCreateRideOffer,
    getAssignmentClaims as legacyGetAssignmentClaims,
    getGame as legacyGetGame,
    getGames as legacyGetGames,
    getLiveEvents as legacyGetLiveEvents,
    getPlayers as legacyGetPlayers,
    getPracticePacketCompletions as legacyGetPracticePacketCompletions,
    getPracticeSession as legacyGetPracticeSession,
    getPracticeSessionByEvent as legacyGetPracticeSessionByEvent,
    getPracticeSessions as legacyGetPracticeSessions,
    getRsvpBreakdownByPlayer as legacyGetRsvpBreakdownByPlayer,
    getRsvpSummaries as legacyGetRsvpSummaries,
    getRsvps as legacyGetRsvps,
    getTeam as legacyGetTeam,
    getTeams as legacyGetTeams,
    postChatMessage as legacyPostChatMessage,
    postSharedGameCancellationNotification as legacyPostSharedGameCancellationNotification,
    releaseAssignmentClaim as legacyReleaseAssignmentClaim,
    requestRideSpot as legacyRequestRideSpot,
    respondToOfficiatingAssignment as legacyRespondToOfficiatingAssignment,
    submitRsvpForPlayer as legacySubmitRsvpForPlayer,
    updateGame as legacyUpdateGame,
    updatePracticeAttendance as legacyUpdatePracticeAttendance,
    updateRideRequestStatus as legacyUpdateRideRequestStatus,
    updateTeam as legacyUpdateTeam,
    upsertPracticePacketCompletion as legacyUpsertPracticePacketCompletion,
    listRideOffersForEvent as legacyListRideOffersForEvent
} from '../../../../../js/db.js';
import {
    collection as legacyFirebaseCollection,
    collectionGroup as legacyFirebaseCollectionGroup,
    db as legacyFirebaseDb,
    doc as legacyFirebaseDoc,
    getDocs as legacyFirebaseGetDocs,
    increment as legacyFirebaseIncrement,
    query as legacyFirebaseQuery,
    runTransaction as legacyFirebaseRunTransaction,
    serverTimestamp as legacyFirebaseServerTimestamp,
    where as legacyFirebaseWhere
} from '../../../../../js/firebase.js';

export const db = legacyFirebaseDb;
export const doc = legacyFirebaseDoc;
export const collection = legacyFirebaseCollection;
export const collectionGroup = legacyFirebaseCollectionGroup;
export const getDocs = legacyFirebaseGetDocs;
export const query = legacyFirebaseQuery;
export const runTransaction = legacyFirebaseRunTransaction;
export const where = legacyFirebaseWhere;
export const increment = legacyFirebaseIncrement;
export const serverTimestamp = legacyFirebaseServerTimestamp;

export async function getAssignmentClaims(teamId: string, gameId: string) {
    return await Promise.resolve(legacyGetAssignmentClaims(teamId, gameId));
}

export async function claimOpenOfficiatingSlot(teamId: string, gameId: string, slotId: string, user: Record<string, unknown>) {
    return await Promise.resolve(legacyClaimOpenOfficiatingSlot(teamId, gameId, slotId, user));
}

export async function getGame(teamId: string, gameId: string) {
    return await Promise.resolve(legacyGetGame(teamId, gameId));
}

export async function getGames(teamId: string) {
    return await Promise.resolve(legacyGetGames(teamId));
}

export async function getPracticePacketCompletions(teamId: string, sessionId: string) {
    return await Promise.resolve(legacyGetPracticePacketCompletions(teamId, sessionId));
}

export async function getPracticeSession(teamId: string, sessionId: string) {
    return await Promise.resolve(legacyGetPracticeSession(teamId, sessionId));
}

export async function getPracticeSessionByEvent(teamId: string, eventId: string) {
    return await Promise.resolve(legacyGetPracticeSessionByEvent(teamId, eventId));
}

export async function getPracticeSessions(teamId: string) {
    return await Promise.resolve(legacyGetPracticeSessions(teamId));
}

export async function getPlayers(teamId: string, options?: { includeInactive?: boolean }) {
    return await Promise.resolve(options === undefined ? legacyGetPlayers(teamId) : legacyGetPlayers(teamId, options));
}

export async function getRsvps(teamId: string, gameId: string) {
    return await Promise.resolve(legacyGetRsvps(teamId, gameId));
}

export async function getRsvpBreakdownByPlayer(teamId: string, gameId: string) {
    return await Promise.resolve(legacyGetRsvpBreakdownByPlayer(teamId, gameId));
}

export async function getRsvpSummaries(teamId: string, gameIds: string[]) {
    return await Promise.resolve(legacyGetRsvpSummaries(teamId, gameIds));
}

export async function getTeam(teamId: string, options?: { includeInactive?: boolean }) {
    return await Promise.resolve(options === undefined ? legacyGetTeam(teamId) : legacyGetTeam(teamId, options));
}

export async function getTeams(options?: { includePrivate?: boolean }) {
    return await Promise.resolve(options === undefined ? legacyGetTeams() : legacyGetTeams(options));
}

export async function addGame(teamId: string, payload: Record<string, unknown>) {
    return await Promise.resolve(legacyAddGame(teamId, payload));
}

export async function addPractice(teamId: string, payload: Record<string, unknown>) {
    return await Promise.resolve(legacyAddPractice(teamId, payload));
}

export async function createRideOffer(teamId: string, gameId: string, payload: Record<string, unknown>) {
    return await Promise.resolve(legacyCreateRideOffer(teamId, gameId, payload));
}

export async function claimAssignmentSlot(teamId: string, gameId: string, role: string, payload: Record<string, unknown>) {
    return await Promise.resolve(legacyClaimAssignmentSlot(teamId, gameId, role, payload));
}

export async function respondToOfficiatingAssignment(teamId: string, gameId: string, slotId: string, response: string) {
    return await Promise.resolve(legacyRespondToOfficiatingAssignment(teamId, gameId, slotId, response));
}

export async function requestRideSpot(teamId: string, gameId: string, offerId: string, payload: Record<string, unknown>) {
    return await Promise.resolve(legacyRequestRideSpot(teamId, gameId, offerId, payload));
}

export async function listRideOffersForEvent(teamId: string, gameId: string, options?: { fallbackGameIds?: string[] }) {
    return await Promise.resolve(options === undefined ? legacyListRideOffersForEvent(teamId, gameId) : legacyListRideOffersForEvent(teamId, gameId, options));
}

export async function updateRideRequestStatus(teamId: string, gameId: string, offerId: string, requestId: string, status: string) {
    return await Promise.resolve(legacyUpdateRideRequestStatus(teamId, gameId, offerId, requestId, status));
}

export async function closeRideOffer(teamId: string, gameId: string, offerId: string, status?: string) {
    return await Promise.resolve(status === undefined
        ? (legacyCloseRideOffer as any)(teamId, gameId, offerId)
        : (legacyCloseRideOffer as any)(teamId, gameId, offerId, status));
}

export async function cancelRideRequest(teamId: string, gameId: string, offerId: string, requestId: string) {
    return await Promise.resolve(legacyCancelRideRequest(teamId, gameId, offerId, requestId));
}

export async function releaseAssignmentClaim(teamId: string, gameId: string, role: string, userId: string) {
    return await Promise.resolve(legacyReleaseAssignmentClaim(teamId, gameId, role, userId));
}

export async function submitRsvpForPlayer(teamId: string, gameId: string, userId: string, payload: Record<string, unknown>) {
    return await Promise.resolve(legacySubmitRsvpForPlayer(teamId, gameId, userId, payload));
}

export async function broadcastLiveEvent(teamId: string, gameId: string, payload: Record<string, unknown>) {
    return await Promise.resolve(legacyBroadcastLiveEvent(teamId, gameId, payload));
}

export async function getLiveEvents(teamId: string, gameId: string) {
    return await Promise.resolve(legacyGetLiveEvents(teamId, gameId));
}

export async function updateGame(teamId: string, gameId: string, payload: Record<string, unknown>) {
    return await Promise.resolve(legacyUpdateGame(teamId, gameId, payload));
}

export async function updatePracticeAttendance(teamId: string, sessionId: string, payload: Record<string, unknown>) {
    return await Promise.resolve(legacyUpdatePracticeAttendance(teamId, sessionId, payload));
}

export async function updateTeam(teamId: string, payload: Record<string, unknown>) {
    return await Promise.resolve(legacyUpdateTeam(teamId, payload));
}

export async function upsertPracticePacketCompletion(teamId: string, sessionId: string, payload: Record<string, unknown>) {
    return await Promise.resolve(legacyUpsertPracticePacketCompletion(teamId, sessionId, payload));
}

export async function postChatMessage(teamId: string, payload: Record<string, unknown>) {
    return await Promise.resolve(legacyPostChatMessage(teamId, payload));
}

export async function postSharedGameCancellationNotification(teamId: string, gameId: string, payload: Record<string, unknown>) {
    return await Promise.resolve(legacyPostSharedGameCancellationNotification(teamId, gameId, payload));
}

export async function cancelOccurrence(teamId: string, masterId: string, instanceDate: string, payload?: Record<string, unknown>) {
    return await Promise.resolve(payload === undefined
        ? legacyCancelOccurrence(teamId, masterId, instanceDate)
        : legacyCancelOccurrence(teamId, masterId, instanceDate, payload));
}
