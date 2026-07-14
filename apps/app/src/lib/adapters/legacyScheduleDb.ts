import {
    addGame as legacyAddGame,
    addPractice as legacyAddPractice,
    broadcastLiveEvent as legacyBroadcastLiveEvent,
    cancelOccurrence as legacyCancelOccurrence,
    clearOccurrenceOverride as legacyClearOccurrenceOverride,
    cancelRideRequest as legacyCancelRideRequest,
    claimAssignmentSlot as legacyClaimAssignmentSlot,
    claimOpenOfficiatingSlot as legacyClaimOpenOfficiatingSlot,
    closeRideOffer as legacyCloseRideOffer,
    createRideOffer as legacyCreateRideOffer,
    getConfigs as legacyGetConfigs,
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
    submitRsvp as legacySubmitRsvp,
    submitRsvpForPlayer as legacySubmitRsvpForPlayer,
    updateEvent as legacyUpdateEvent,
    updateGame as legacyUpdateGame,
    updateOccurrence as legacyUpdateOccurrence,
    updatePracticeAttendance as legacyUpdatePracticeAttendance,
    updatePracticeSession as legacyUpdatePracticeSession,
    updateRideRequestStatus as legacyUpdateRideRequestStatus,
    updateSeries as legacyUpdateSeries,
    updateTeam as legacyUpdateTeam,
    upsertPracticeSessionForEvent as legacyUpsertPracticeSessionForEvent,
    upsertPracticePacketCompletion as legacyUpsertPracticePacketCompletion,
    listRideOffersForEvent as legacyListRideOffersForEvent
} from '@legacy/db.js';
import {
    collection as legacyFirebaseCollection,
    collectionGroup as legacyFirebaseCollectionGroup,
    db as legacyFirebaseDb,
    doc as legacyFirebaseDoc,
    deleteField as legacyFirebaseDeleteField,
    getDoc as legacyFirebaseGetDoc,
    getDocs as legacyFirebaseGetDocs,
    increment as legacyFirebaseIncrement,
    query as legacyFirebaseQuery,
    runTransaction as legacyFirebaseRunTransaction,
    serverTimestamp as legacyFirebaseServerTimestamp,
    Timestamp as legacyFirebaseTimestamp,
    where as legacyFirebaseWhere
} from '@legacy/firebase.js';

export const db = legacyFirebaseDb;
export const doc = legacyFirebaseDoc;
export const collection = legacyFirebaseCollection;
export const collectionGroup = legacyFirebaseCollectionGroup;
export const getDoc = legacyFirebaseGetDoc;
export const getDocs = legacyFirebaseGetDocs;
export const query = legacyFirebaseQuery;
export const runTransaction = legacyFirebaseRunTransaction;
export const where = legacyFirebaseWhere;
export const increment = legacyFirebaseIncrement;
export const serverTimestamp = legacyFirebaseServerTimestamp;
export const deleteField = legacyFirebaseDeleteField;
export const Timestamp = legacyFirebaseTimestamp;

export async function getAssignmentClaims(teamId: string, gameId: string) {
    return await Promise.resolve(legacyGetAssignmentClaims(teamId, gameId));
}

export async function claimOpenOfficiatingSlot(teamId: string, gameId: string, slotId: string, user: unknown) {
    return await Promise.resolve(legacyClaimOpenOfficiatingSlot(teamId, gameId, slotId, user));
}

export async function getGame(teamId: string, gameId: string) {
    return await Promise.resolve(legacyGetGame(teamId, gameId));
}

export type GamesQueryOptions = {
    startDate?: Date | null;
    endDate?: Date | null;
    tournamentGroup?: { poolName: string; divisionName: string } | null;
    tournamentGroups?: Array<{ poolName: string; divisionName: string }> | null;
};

export async function getGames(teamId: string, options: GamesQueryOptions = {}) {
    return await Promise.resolve(legacyGetGames(teamId, options));
}

export async function getConfigs(teamId: string, options?: { limit?: number }) {
    return await Promise.resolve(options === undefined ? legacyGetConfigs(teamId) : legacyGetConfigs(teamId, options));
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

export type PracticeSessionsQueryOptions = { startDate?: Date | null; endDate?: Date | null };

export async function getPracticeSessions(teamId: string, options: PracticeSessionsQueryOptions = {}) {
    return await Promise.resolve(legacyGetPracticeSessions(teamId, options));
}

export async function updatePracticeSession(teamId: string, sessionId: string, payload: Record<string, unknown>) {
    return await Promise.resolve(legacyUpdatePracticeSession(teamId, sessionId, payload));
}

export async function upsertPracticeSessionForEvent(teamId: string, eventId: string, payload: Record<string, unknown>) {
    return await Promise.resolve(legacyUpsertPracticeSessionForEvent(teamId, eventId, payload));
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

export type StaffTeamsQuery = {
    userId: string;
    email?: string | null;
    coachTeamIds?: string[];
    includeAll?: boolean;
};

export async function getStaffTeams({ userId, email, coachTeamIds = [], includeAll = false }: StaffTeamsQuery) {
    if (includeAll) {
        return await Promise.resolve(legacyGetTeams({ includePrivate: true }));
    }

    const teamsRef = legacyFirebaseCollection(legacyFirebaseDb, 'teams');
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const uniqueCoachTeamIds = [...new Set(coachTeamIds.map((teamId) => String(teamId || '').trim()).filter(Boolean))];
    const emptySnapshot = { docs: [] };
    const [ownedSnapshot, adminSnapshot, coachSnapshots] = await Promise.all([
        userId
            ? legacyFirebaseGetDocs(legacyFirebaseQuery(teamsRef, legacyFirebaseWhere('ownerId', '==', userId)))
            : Promise.resolve(emptySnapshot),
        normalizedEmail
            ? legacyFirebaseGetDocs(legacyFirebaseQuery(teamsRef, legacyFirebaseWhere('adminEmails', 'array-contains', normalizedEmail)))
            : Promise.resolve(emptySnapshot),
        Promise.all(uniqueCoachTeamIds.map((teamId) => (
            legacyFirebaseGetDoc(legacyFirebaseDoc(legacyFirebaseDb, 'teams', teamId)).catch(() => null)
        )))
    ]);

    const teamsById = new Map<string, Record<string, unknown>>();
    [...ownedSnapshot.docs, ...adminSnapshot.docs, ...coachSnapshots]
        .filter((snapshot): snapshot is NonNullable<typeof snapshot> => Boolean(snapshot && ('exists' in snapshot ? snapshot.exists() : true)))
        .forEach((snapshot) => {
            const id = String(snapshot.id || '').trim();
            if (id) teamsById.set(id, { id, ...snapshot.data() });
        });
    return [...teamsById.values()];
}

export class LegacyTournamentGameAdapterValidationError extends Error {
    readonly code = 'legacy-tournament-game-adapter-validation-error';
    readonly field: string;

    constructor(field: string, message: string) {
        super(message);
        this.name = 'LegacyTournamentGameAdapterValidationError';
        this.field = field;
    }
}

function isPlainLegacyScheduleRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function requireLegacyTournamentText(value: unknown, field: string) {
    if (typeof value !== 'string' || !value.trim()) {
        throw new LegacyTournamentGameAdapterValidationError(field, `Tournament adapter requires ${field}.`);
    }
}

function requireLegacyTournamentDate(value: unknown, field: string) {
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
        throw new LegacyTournamentGameAdapterValidationError(field, `Tournament adapter requires a valid ${field}.`);
    }
}

function validateLegacyTournamentGamePayload(payload: unknown) {
    if (!isPlainLegacyScheduleRecord(payload)) {
        throw new LegacyTournamentGameAdapterValidationError('payload', 'Tournament adapter requires a legacy game payload.');
    }
    if (payload.type !== 'game') {
        throw new LegacyTournamentGameAdapterValidationError('type', 'Tournament adapter requires a game payload.');
    }
    requireLegacyTournamentText(payload.opponent, 'opponent');
    requireLegacyTournamentDate(payload.date, 'date');
    if (payload.end !== null && payload.end !== undefined) {
        requireLegacyTournamentDate(payload.end, 'end');
        if ((payload.end as Date).getTime() <= (payload.date as Date).getTime()) {
            throw new LegacyTournamentGameAdapterValidationError('end', 'Tournament adapter requires end to be after date.');
        }
    }
    if (payload.arrivalTime !== null && payload.arrivalTime !== undefined) {
        requireLegacyTournamentDate(payload.arrivalTime, 'arrivalTime');
    }
}

function validateLegacyTournamentMetadata(tournament: unknown) {
    if (!isPlainLegacyScheduleRecord(tournament)) {
        throw new LegacyTournamentGameAdapterValidationError('tournament', 'Tournament adapter requires tournament metadata.');
    }
    requireLegacyTournamentText(tournament.divisionName, 'tournament.divisionName');
    requireLegacyTournamentText(tournament.bracketName, 'tournament.bracketName');
    requireLegacyTournamentText(tournament.roundName, 'tournament.roundName');
    if (tournament.poolName !== null && tournament.poolName !== undefined && (typeof tournament.poolName !== 'string' || !tournament.poolName.trim())) {
        throw new LegacyTournamentGameAdapterValidationError('tournament.poolName', 'Tournament adapter requires tournament.poolName to be a non-empty string when provided.');
    }
}

export function buildLegacyTournamentGameDocument(payload: Record<string, unknown>, tournament: Record<string, unknown>) {
    validateLegacyTournamentGamePayload(payload);
    validateLegacyTournamentMetadata(tournament);

    return {
        ...payload,
        competitionType: 'tournament',
        tournament: {
            ...tournament
        }
    };
}

export function buildSingleLegacyTournamentGameDocument(games: Array<Record<string, unknown> | null | undefined>, tournament: Record<string, unknown>) {
    if (!Array.isArray(games)) {
        throw new LegacyTournamentGameAdapterValidationError('games', 'Tournament adapter requires a single completed tournament game.');
    }
    if (games.length !== 1) {
        throw new LegacyTournamentGameAdapterValidationError('games', 'Tournament adapter only supports a single completed tournament game.');
    }
    if (!isPlainLegacyScheduleRecord(games[0])) {
        throw new LegacyTournamentGameAdapterValidationError('games[0]', 'Tournament adapter requires a complete tournament game payload.');
    }
    return buildLegacyTournamentGameDocument(games[0], tournament);
}

export function buildLegacyTournamentGameDocuments(games: Array<Record<string, unknown> | null | undefined>, tournament: Record<string, unknown>) {
    if (!Array.isArray(games)) {
        throw new LegacyTournamentGameAdapterValidationError('games', 'Tournament adapter requires tournament game payloads.');
    }
    validateLegacyTournamentMetadata(tournament);
    games.forEach((game, index) => {
        if (!isPlainLegacyScheduleRecord(game)) {
            throw new LegacyTournamentGameAdapterValidationError(`games[${index}]`, 'Tournament adapter requires complete tournament game payloads.');
        }
        validateLegacyTournamentGamePayload(game);
    });
    return games
        .map((game) => buildLegacyTournamentGameDocument(game as Record<string, unknown>, tournament));
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

export async function releaseAssignmentClaim(teamId: string, gameId: string, role: string, _userId?: string) {
    return await Promise.resolve(legacyReleaseAssignmentClaim(teamId, gameId, role));
}

export async function submitRsvpForPlayer(teamId: string, gameId: string, userId: string, payload: Record<string, unknown>) {
    return await Promise.resolve(legacySubmitRsvpForPlayer(teamId, gameId, userId, payload));
}

export async function submitRsvp(teamId: string, gameId: string, userId: string, payload: Record<string, unknown>) {
    return await Promise.resolve(legacySubmitRsvp(teamId, gameId, userId, payload));
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

export async function postSharedGameCancellationNotification(payload: Record<string, unknown>) {
    return await Promise.resolve(legacyPostSharedGameCancellationNotification(payload));
}

export async function cancelOccurrence(teamId: string, masterId: string, instanceDate: string, payload?: Record<string, unknown>) {
    return await Promise.resolve(payload === undefined
        ? legacyCancelOccurrence(teamId, masterId, instanceDate)
        : legacyCancelOccurrence(teamId, masterId, instanceDate, payload));
}

export async function updateEvent(teamId: string, eventId: string, payload: Record<string, unknown>) {
    return await Promise.resolve(legacyUpdateEvent(teamId, eventId, payload));
}

export async function updateOccurrence(teamId: string, masterId: string, instanceDate: string, payload: Record<string, unknown>) {
    return await Promise.resolve(legacyUpdateOccurrence(teamId, masterId, instanceDate, payload));
}

export async function clearOccurrenceOverride(teamId: string, masterId: string, instanceDate: string) {
    return await Promise.resolve(legacyClearOccurrenceOverride(teamId, masterId, instanceDate));
}

export async function updateSeries(teamId: string, masterId: string, payload: Record<string, unknown>) {
    return await Promise.resolve(legacyUpdateSeries(teamId, masterId, payload));
}
