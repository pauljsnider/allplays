import {
  getAssignmentClaims,
  getGames,
  getPracticePacketCompletions,
  getPracticeSessions,
  getPlayers,
  getRsvps,
  getRsvpSummaries,
  getTeam,
  getTeams,
  getTrackedCalendarEventUids,
  createRideOffer,
  claimAssignmentSlot,
  requestRideSpot,
  listRideOffersForEvent,
  updateRideRequestStatus,
  closeRideOffer,
  cancelRideRequest,
  releaseAssignmentClaim,
  submitRsvpForPlayer,
  updateGame,
  upsertPracticePacketCompletion
} from '../../../../js/db.js';
import { sendPublicRsvpReminderEmails } from '../../../../js/schedule-notifications.js';
import {
  expandRecurrence,
  extractOpponent,
  fetchAndParseCalendar,
  getCalendarEventTrackingId,
  isPracticeEvent,
  isTrackedCalendarEvent
} from '../../../../js/utils.js';
import { filterVisiblePracticeSessions } from '../../../../js/parent-dashboard-practice-sessions.js';
import { buildPracticePacketCompletionPayload as buildPracticePacketCompletionPayloadBase } from '../../../../js/parent-dashboard-packets.js';
import { resolveMyRsvpByChildForGame } from '../../../../js/parent-dashboard-rsvp.js';
import { buildAvailabilityNoteRows, canViewAvailabilityNotes, formatAvailabilityCutoff, isAvailabilityLocked, normalizeAvailabilityPreferences } from '../../../../js/availability-preferences.js';
import { getEventRideshareSummary } from '../../../../js/rideshare-helpers.js';
import { mergeAssignmentsWithClaims } from '../../../../js/snack-helpers.js';
import { hasScorekeepingTeamAccess } from '../../../../js/team-access.js';
import { loadProfileDocument, saveProfileDocument } from './profileService';
import { firebaseAuth, getNativeAuthIdToken } from './authService';
import {
  getNextRideConfirmedSeatCount,
  getScheduleRideshareSummary,
  getScheduleTitle,
  normalizeScheduleAssignment,
  normalizeRideOfferDirection,
  normalizeRideOfferStatus,
  normalizeRideRequestStatus,
  normalizeRsvpResponse,
  normalizeScheduleDate,
  buildStaffRsvpReminderMetadata,
  buildStaffRsvpReminderMessage,
  buildStaffRsvpReminderPreview,
  getStaffRsvpReminderMetadataTarget,
  resolveStaffRsvpReminderEmailSentCount,
  type ParentScheduleEvent,
  type PracticeHomePacket,
  type PracticePacketCompletion,
  type RideOfferDirection,
  type RideOfferStatus,
  type RideRequestStatus,
  type RsvpResponse,
  type ScheduleAssignment,
  type StaffRsvpReminderPreview,
  type ScheduleRsvpSummary,
  type ScheduleRideOffer,
  type ScheduleRideSummary
} from './scheduleLogic';
import { sendTeamChatMessage } from './chatService';
import type { AuthUser } from './types';

const primaryDataTimeoutMs = 5000;

export type ParentScheduleChild = {
  teamId: string;
  teamName: string;
  playerId: string;
  playerName: string;
};

export type ParentScheduleLoadResult = {
  children: ParentScheduleChild[];
  events: ParentScheduleEvent[];
};

type FirestoreDocument = Record<string, any> & { id: string };

export type StaffRsvpReminderSendResult = StaffRsvpReminderPreview & {
  emailSentCount: number;
};

export type ParentPracticePacketChild = {
  id: string;
  name: string;
};

export type ParentPracticePacket = {
  sessionId: string;
  teamId: string;
  eventId: string;
  title: string;
  date: Date;
  location: string;
  homePacket: PracticeHomePacket;
  completions: PracticePacketCompletion[];
  children: ParentPracticePacketChild[];
};

export type GameScoreInput = {
  homeScore: number;
  awayScore: number;
  scoreStreamSessionId?: string | null;
};

function withTimeout<T>(promise: Promise<T>, label: string, timeoutMs = primaryDataTimeoutMs): Promise<T> {
  let timeoutId: number | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(`${label} timed out.`)), timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId) window.clearTimeout(timeoutId);
  });
}

function isNativeRuntime() {
  return window.location.protocol === 'capacitor:';
}

function getProjectId() {
  const projectId = firebaseAuth.app?.options?.projectId;
  if (!projectId) {
    throw new Error('Firebase project ID is missing.');
  }
  return projectId;
}

function getFirestoreBaseUrl() {
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(getProjectId())}/databases/(default)/documents`;
}

async function getNativeHeaders() {
  const token = await getNativeAuthIdToken(true);
  if (!token) {
    throw new Error('Native auth token is unavailable.');
  }

  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  };
}

async function nativeFirestoreRequest(path: string, init: RequestInit = {}) {
  const response = await withTimeout(fetch(`${getFirestoreBaseUrl()}${path}`, {
    ...init,
    headers: {
      ...(await getNativeHeaders()),
      ...(init.headers || {})
    }
  }), 'Firestore REST request');
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error?.message || `Firestore request failed (${response.status}).`) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return payload;
}

function encodeFirestoreValue(value: any): Record<string, unknown> {
  if (value === null || value === undefined) return { nullValue: 'NULL_VALUE' };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (Array.isArray(value)) return { arrayValue: { values: value.map((entry) => encodeFirestoreValue(entry)) } };
  if (typeof value === 'object') {
    return {
      mapValue: {
        fields: Object.keys(value).reduce<Record<string, Record<string, unknown>>>((acc, key) => {
          acc[key] = encodeFirestoreValue(value[key]);
          return acc;
        }, {})
      }
    };
  }
  return { stringValue: String(value) };
}

function decodeFirestoreValue(value: any): any {
  if (!value || typeof value !== 'object') return null;
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue || 0);
  if ('doubleValue' in value) return Number(value.doubleValue || 0);
  if ('timestampValue' in value) return new Date(value.timestampValue);
  if ('nullValue' in value) return null;
  if ('arrayValue' in value) return (value.arrayValue?.values || []).map((entry: any) => decodeFirestoreValue(entry));
  if ('mapValue' in value) return decodeFirestoreFields(value.mapValue?.fields || {});
  return null;
}

function decodeFirestoreFields(fields: Record<string, any> = {}) {
  return Object.keys(fields).reduce<Record<string, any>>((acc, key) => {
    acc[key] = decodeFirestoreValue(fields[key]);
    return acc;
  }, {});
}

function decodeFirestoreDocument(document: any): FirestoreDocument | null {
  if (!document?.name) return null;
  return {
    id: String(document.name).split('/').pop() || '',
    ...decodeFirestoreFields(document.fields || {})
  };
}

async function nativeGetDocument(path: string) {
  try {
    return decodeFirestoreDocument(await nativeFirestoreRequest(`/${path}`));
  } catch (error: any) {
    const message = String(error?.message || '').toLowerCase();
    if (error?.status === 404 || message.includes('not_found') || message.includes('not found')) {
      return null;
    }
    throw error;
  }
}

async function nativeListCollection(path: string) {
  const payload = await nativeFirestoreRequest(`/${path}`);
  return (payload.documents || [])
    .map((document: any) => decodeFirestoreDocument(document))
    .filter(Boolean) as FirestoreDocument[];
}

async function nativeRunQuery(collectionId: string, fieldPath: string, op: 'EQUAL' | 'ARRAY_CONTAINS', value: string) {
  const payload = await nativeFirestoreRequest(':runQuery', {
    method: 'POST',
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId }],
        where: {
          fieldFilter: {
            field: { fieldPath },
            op,
            value: encodeFirestoreValue(value)
          }
        }
      }
    })
  });

  return Array.isArray(payload)
    ? payload.map((entry) => decodeFirestoreDocument(entry.document)).filter(Boolean) as FirestoreDocument[]
    : [];
}

async function nativePatchDocument(path: string, data: Record<string, unknown>) {
  const fields = Object.keys(data).reduce<Record<string, Record<string, unknown>>>((acc, key) => {
    acc[key] = encodeFirestoreValue(data[key]);
    return acc;
  }, {});
  const params = new URLSearchParams();
  Object.keys(data).forEach((key) => params.append('updateMask.fieldPaths', key));
  const suffix = params.toString() ? `?${params.toString()}` : '';
  await nativeFirestoreRequest(`/${path}${suffix}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields })
  });
}

async function nativeCreateDocument(path: string, data: Record<string, unknown>) {
  const fields = Object.keys(data).reduce<Record<string, Record<string, unknown>>>((acc, key) => {
    acc[key] = encodeFirestoreValue(data[key]);
    return acc;
  }, {});
  return decodeFirestoreDocument(await nativeFirestoreRequest(`/${path}`, {
    method: 'POST',
    body: JSON.stringify({ fields })
  }));
}

async function nativeDeleteDocument(path: string) {
  await nativeFirestoreRequest(`/${path}`, {
    method: 'DELETE'
  });
}

async function readWithNativeFallback<T>(label: string, primary: () => Promise<T>, fallback: () => Promise<T>): Promise<T> {
  try {
    return await withTimeout(Promise.resolve(primary()), label);
  } catch (error) {
    if (!isNativeRuntime()) throw error;
    console.warn(`[schedule-service] Falling back to REST for ${label}:`, error);
    return fallback();
  }
}

function compactString(value: unknown) {
  return String(value || '').trim();
}

export function normalizeGameScoreValue(value: unknown) {
  const parsed = Number.parseInt(String(value ?? 0), 10);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, parsed);
}

function isActiveTeam(team: Record<string, any> | null | undefined) {
  return team?.active !== false;
}

function normalizeEmail(value: unknown) {
  return compactString(value).toLowerCase();
}

function isPublicRsvpReminderManager(team: any, user: AuthUser | null) {
  if (!team || !user?.uid) return false;
  if (team.ownerId === user.uid || (user as any).isAdmin === true) return true;
  const email = normalizeEmail(user.email);
  const adminEmails = Array.isArray(team.adminEmails) ? team.adminEmails.map(normalizeEmail) : [];
  return Boolean(email && adminEmails.includes(email));
}

function isTeamStaff(team: any, user: AuthUser | null) {
  if (!team || !user?.uid) return false;
  if (isPublicRsvpReminderManager(team, user)) return true;
  if (Array.isArray(user.coachOf) && user.coachOf.map(compactString).includes(compactString(team.id))) return true;
  return false;
}

async function loadStaffTeams(user: AuthUser) {
  return readWithNativeFallback(
    'staff teams',
    async () => {
      const coachTeamIds = Array.isArray(user.coachOf) ? user.coachOf.map(compactString).filter(Boolean) : [];
      const [visibleTeams, coachTeams] = await Promise.all([
        getTeams({ includePrivate: (user as any).isAdmin === true }),
        Promise.all(coachTeamIds.map((teamId) => getTeam(teamId).catch(() => null)))
      ]);
      const teamsById = new Map<string, any>();
      [...visibleTeams, ...coachTeams].filter(Boolean).forEach((team: any) => {
        if (team?.id && isActiveTeam(team) && isTeamStaff(team, user)) teamsById.set(team.id, team);
      });
      return [...teamsById.values()];
    },
    async () => {
      const coachTeamIds = Array.isArray(user.coachOf) ? user.coachOf.map(compactString).filter(Boolean) : [];
      const [ownedTeams, adminTeams] = await Promise.all([
        nativeRunQuery('teams', 'ownerId', 'EQUAL', user.uid).catch(() => []),
        user.email ? nativeRunQuery('teams', 'adminEmails', 'ARRAY_CONTAINS', normalizeEmail(user.email)).catch(() => []) : Promise.resolve([])
      ]);
      const coachTeams = await Promise.all(coachTeamIds.map((teamId) => nativeGetDocument(`teams/${encodeURIComponent(teamId)}`).catch(() => null)));
      const teamsById = new Map<string, any>();
      [...ownedTeams, ...adminTeams, ...coachTeams].forEach((team) => {
        if (team?.id && isActiveTeam(team) && team.archived !== true && isTeamStaff(team, user)) teamsById.set(team.id, team);
      });
      return [...teamsById.values()];
    }
  );
}

async function loadPlayers(teamId: string) {
  return readWithNativeFallback(
    `players ${teamId}`,
    () => Promise.resolve(getPlayers(teamId, { includeInactive: true })),
    () => nativeListCollection(`teams/${encodeURIComponent(teamId)}/players`)
  );
}

function normalizeChildLinks(user: AuthUser, profile: Record<string, unknown>): ParentScheduleChild[] {
  const parentOf = Array.isArray(profile.parentOf) && profile.parentOf.length > 0
    ? profile.parentOf
    : Array.isArray(user.parentOf) ? user.parentOf : [];

  const seen = new Set<string>();
  return parentOf
    .map((entry: any) => {
      const teamId = compactString(entry?.teamId);
      const playerId = compactString(entry?.playerId || entry?.childId);
      if (!teamId || !playerId) return null;
      const key = `${teamId}::${playerId}`;
      if (seen.has(key)) return null;
      seen.add(key);
      return {
        teamId,
        teamName: compactString(entry?.teamName),
        playerId,
        playerName: compactString(entry?.playerName || entry?.childName || entry?.name) || 'Player'
      };
    })
    .filter(Boolean) as ParentScheduleChild[];
}

function hasRecordedAttendance(attendance: any) {
  return !!attendance && Array.isArray(attendance.players) && attendance.players.length > 0;
}

function hasHomePacket(session: any) {
  return !!session?.homePacketContent && Array.isArray(session.homePacketContent.blocks) && session.homePacketContent.blocks.length > 0;
}

function getPracticeAttendanceSummary(attendance: any) {
  if (!hasRecordedAttendance(attendance)) return null;
  const players: Array<{ status?: string }> = Array.isArray(attendance.players) ? attendance.players : [];
  const present = players.filter((player) => player.status === 'present' || player.status === 'late').length;
  const late = players.filter((player) => player.status === 'late').length;
  const absent = players.filter((player) => player.status === 'absent').length;
  return [
    `${present}/${players.length} present`,
    late > 0 ? `${late} late` : '',
    absent > 0 ? `${absent} absent` : ''
  ].filter(Boolean).join(', ');
}

function getPracticePacketSummary(homePacket: any) {
  const blocks = Array.isArray(homePacket?.blocks) ? homePacket.blocks : [];
  if (blocks.length === 0) return null;
  const minutes = homePacket?.totalMinutes || blocks.reduce((sum: number, block: any) => sum + (Number.parseInt(block?.duration, 10) || 0), 0);
  return `${blocks.length} drill${blocks.length === 1 ? '' : 's'} · ${minutes} min`;
}

function normalizePracticePacketCompletions(completions: any[]): PracticePacketCompletion[] {
  return (Array.isArray(completions) ? completions : [])
    .map((completion) => ({
      ...completion,
      id: compactString(completion?.id),
      parentUserId: compactString(completion?.parentUserId) || null,
      parentName: compactString(completion?.parentName) || null,
      childId: compactString(completion?.childId) || null,
      childName: compactString(completion?.childName) || null,
      status: compactString(completion?.status) || null
    }))
    .filter((completion) => completion.childId);
}

function toEventDate(value: unknown) {
  return normalizeScheduleDate(value) || new Date();
}

function makeEventKey(teamId: string, id: string, childId: string, date: Date, type: string) {
  return `${teamId}::${id}::${childId}::${date.toISOString()}::${type}`;
}

async function loadTeam(teamId: string) {
  const team = await readWithNativeFallback(
    `team ${teamId}`,
    () => Promise.resolve(getTeam(teamId)),
    () => nativeGetDocument(`teams/${encodeURIComponent(teamId)}`)
  );
  return isActiveTeam(team as Record<string, any> | null) ? team : null;
}

async function loadGames(teamId: string) {
  return readWithNativeFallback(
    `games ${teamId}`,
    () => Promise.resolve(getGames(teamId)),
    async () => {
      const docs = await nativeListCollection(`teams/${encodeURIComponent(teamId)}/games`);
      return docs.sort((a, b) => toEventDate(a.date).getTime() - toEventDate(b.date).getTime());
    }
  );
}

async function loadPracticeSessions(teamId: string) {
  return readWithNativeFallback(
    `practice sessions ${teamId}`,
    () => Promise.resolve(getPracticeSessions(teamId)),
    async () => {
      const docs = await nativeListCollection(`teams/${encodeURIComponent(teamId)}/practiceSessions`);
      return docs.sort((a, b) => toEventDate(b.date).getTime() - toEventDate(a.date).getTime());
    }
  );
}

async function loadRsvps(teamId: string, gameId: string) {
  return readWithNativeFallback(
    `rsvps ${teamId}/${gameId}`,
    () => Promise.resolve(getRsvps(teamId, gameId)),
    () => nativeListCollection(`teams/${encodeURIComponent(teamId)}/games/${encodeURIComponent(gameId)}/rsvps`)
  );
}

async function loadRideOffers(teamId: string, gameId: string, fallbackGameIds: string[] = []) {
  return readWithNativeFallback(
    `ride offers ${teamId}/${gameId}`,
    () => Promise.resolve(listRideOffersForEvent(teamId, gameId, { fallbackGameIds })),
    async () => {
      const candidateIds = [gameId, ...fallbackGameIds].filter(Boolean);
      for (const candidateId of candidateIds) {
        const offers = await nativeListCollection(`teams/${encodeURIComponent(teamId)}/games/${encodeURIComponent(candidateId)}/rideOffers`);
        const withRequests = await Promise.all(offers.map(async (offer) => ({
          ...offer,
          sourceGameId: candidateId,
          requests: await nativeListCollection(`teams/${encodeURIComponent(teamId)}/games/${encodeURIComponent(candidateId)}/rideOffers/${encodeURIComponent(offer.id)}/requests`).catch(() => [])
        })));
        if (withRequests.length > 0 || candidateId === candidateIds[candidateIds.length - 1]) {
          return withRequests;
        }
      }
      return [];
    }
  );
}

function normalizeRideOffers(offers: any[]): ScheduleRideOffer[] {
  return (Array.isArray(offers) ? offers : []).map((offer) => ({
    ...offer,
    id: compactString(offer?.id),
    sourceGameId: compactString(offer?.sourceGameId),
    driverUserId: compactString(offer?.driverUserId),
    driverName: compactString(offer?.driverName) || null,
    seatCapacity: Math.max(0, Number.parseInt(String(offer?.seatCapacity ?? 0), 10) || 0),
    seatCountConfirmed: Math.max(0, Number.parseInt(String(offer?.seatCountConfirmed ?? 0), 10) || 0),
    direction: normalizeRideOfferDirection(offer?.direction),
    note: compactString(offer?.note) || null,
    status: normalizeRideOfferStatus(offer?.status),
    requests: (Array.isArray(offer?.requests) ? offer.requests : []).map((request: any) => ({
      ...request,
      id: compactString(request?.id),
      parentUserId: compactString(request?.parentUserId),
      childId: compactString(request?.childId),
      childName: compactString(request?.childName) || null,
      status: normalizeRideRequestStatus(request?.status)
    }))
  })).filter((offer) => offer.id);
}

async function loadAssignmentClaims(teamId: string, gameId: string) {
  return readWithNativeFallback(
    `assignment claims ${teamId}/${gameId}`,
    () => Promise.resolve(getAssignmentClaims(teamId, gameId)),
    async () => {
      const docs = await nativeListCollection(`teams/${encodeURIComponent(teamId)}/games/${encodeURIComponent(gameId)}/assignmentClaims`);
      return docs.reduce<Record<string, FirestoreDocument>>((acc, claim) => {
        acc[claim.id] = claim;
        return acc;
      }, {});
    }
  );
}

function normalizeAssignmentRole(role: unknown) {
  return String(role || '').trim();
}

function assertAssignmentEvent(event: ParentScheduleEvent) {
  if (!event.isDbGame) {
    throw new Error('Assignments open after this event is tracked in the schedule.');
  }
  if (event.isCancelled) {
    throw new Error('Assignments are closed for cancelled events.');
  }
}

function normalizeAssignments(assignments: any[]): ScheduleAssignment[] {
  return (Array.isArray(assignments) ? assignments : [])
    .map((assignment) => normalizeScheduleAssignment(assignment))
    .filter((assignment) => assignment.role || assignment.value);
}

async function loadRsvpSummaryMap(teamId: string, gameIds: string[]) {
  try {
    return await withTimeout(Promise.resolve(getRsvpSummaries(teamId, gameIds)), `RSVP summaries ${teamId}`);
  } catch (error) {
    if (!isNativeRuntime()) throw error;
    console.warn(`[schedule-service] Falling back to local RSVP summaries for ${teamId}:`, error);
    const map = new Map<string, ScheduleRsvpSummary>();
    await Promise.all(gameIds.map(async (gameId) => {
      const rsvps = await loadRsvps(teamId, gameId).catch(() => []);
      map.set(gameId, summarizeRsvps(rsvps));
    }));
    return map;
  }
}

function summarizeRsvps(rsvps: any[]): ScheduleRsvpSummary {
  return (Array.isArray(rsvps) ? rsvps : []).reduce<Required<ScheduleRsvpSummary>>((acc, rsvp) => {
    const response = normalizeRsvpResponse(rsvp?.response);
    if (response === 'going') acc.going += 1;
    else if (response === 'maybe') acc.maybe += 1;
    else if (response === 'not_going') acc.notGoing += 1;
    else acc.notResponded += 1;
    acc.total += 1;
    return acc;
  }, { going: 0, maybe: 0, notGoing: 0, notResponded: 0, total: 0 });
}

function resolvePracticeSessionForEvent(event: any, eventDate: Date | null, sessionsByEventId: Map<string, any>, sessions: any[], matchedSessionIds: Set<string>) {
  const candidates = [event?.id, event?.eventId, event?.calendarEventUid, event?.uid].filter(Boolean);
  for (const key of candidates) {
    if (sessionsByEventId.has(key)) {
      const found = sessionsByEventId.get(key);
      if (found?.id) matchedSessionIds.add(found.id);
      return found;
    }
  }

  const masterId = event?.id || event?.eventId;
  if (!masterId) return null;
  const recurringMatches = sessions.filter((session) => typeof session.eventId === 'string' && session.eventId.startsWith(`${masterId}__`));
  if (!recurringMatches.length) return null;
  if (!eventDate) return recurringMatches[0];
  const target = eventDate.getTime();
  recurringMatches.sort((a, b) => Math.abs((a._parsedDate?.getTime?.() || 0) - target) - Math.abs((b._parsedDate?.getTime?.() || 0) - target));
  if (recurringMatches[0]?.id) matchedSessionIds.add(recurringMatches[0].id);
  return recurringMatches[0];
}

function toNullableScore(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const score = Number(value);
  return Number.isFinite(score) ? score : null;
}

function getScheduleSourceLabel(game: any) {
  const metadata = game?.sourceMetadata || game?.registrationSource || {};
  const provider = compactString(metadata.providerName || metadata.provider || metadata.sourceName || metadata.sourceType || game?.source);
  if (provider) return provider;
  if (game?.source === 'calendar') return 'Imported calendar';
  if (game?.source === 'registration') return 'Registration import';
  return 'ALL PLAYS schedule';
}

function createScheduleEvent(input: {
  teamId: string;
  teamName: string;
  child: ParentScheduleChild;
  id: string;
  type: 'game' | 'practice';
  date: Date;
  endDate?: unknown;
  location?: string | null;
  opponent?: string | null;
  opponentTeamName?: string | null;
  opponentTeamPhoto?: string | null;
  title?: string | null;
  isDbGame: boolean;
  isCancelled?: boolean;
  status?: string | null;
  liveStatus?: string | null;
  homeScore?: unknown;
  awayScore?: unknown;
  isHome?: boolean | null;
  kitColor?: string | null;
  arrivalTime?: unknown;
  notes?: string | null;
  seasonLabel?: string | null;
  competitionType?: string | null;
  countsTowardSeasonRecord?: boolean | null;
  sourceType?: string | null;
  sourceLabel?: string | null;
  isImported?: boolean;
  visibility?: string | null;
  assignments?: any[];
  rsvpSummary?: ScheduleRsvpSummary | null;
  canUpdateScore?: boolean;
  practiceAttendance?: any;
  practiceHomePacket?: any;
  practiceSessionId?: string | null;
  availabilityPreferences?: any;
  isTeamAdmin?: boolean;
  isTeamStaff?: boolean;
  isTeamRsvpReminderManager?: boolean;
}): ParentScheduleEvent {
  const arrivalTime = normalizeScheduleDate(input.arrivalTime);
  const endDate = normalizeScheduleDate(input.endDate);
  const availabilityPreferences = normalizeAvailabilityPreferences(input.availabilityPreferences || {});
  const attendanceSummary = getPracticeAttendanceSummary(input.practiceAttendance);
  const packetSummary = getPracticePacketSummary(input.practiceHomePacket);
  const availabilityNotesVisible = canViewAvailabilityNotes(availabilityPreferences, input.isTeamAdmin === true);
  return {
    eventKey: makeEventKey(input.teamId, input.id, input.child.playerId, input.date, input.type),
    id: input.id,
    teamId: input.teamId,
    teamName: input.teamName || input.child.teamName || input.teamId,
    type: input.type,
    date: input.date,
    endDate,
    location: input.location || 'TBD',
    opponent: input.opponent || null,
    opponentTeamName: input.opponentTeamName || null,
    opponentTeamPhoto: input.opponentTeamPhoto || null,
    title: input.title || null,
    childId: input.child.playerId,
    childName: input.child.playerName,
    isDbGame: input.isDbGame,
    isCancelled: input.isCancelled === true,
    status: input.status || null,
    liveStatus: input.liveStatus || null,
    homeScore: toNullableScore(input.homeScore),
    awayScore: toNullableScore(input.awayScore),
    canUpdateScore: input.canUpdateScore === true,
    isHome: input.isHome ?? null,
    kitColor: input.kitColor || null,
    arrivalTime,
    notes: input.notes || null,
    seasonLabel: input.seasonLabel || null,
    competitionType: input.competitionType || null,
    countsTowardSeasonRecord: input.countsTowardSeasonRecord ?? null,
    sourceType: input.sourceType || (input.isDbGame ? 'db' : 'calendar'),
    sourceLabel: input.sourceLabel || (input.isDbGame ? 'ALL PLAYS schedule' : 'Team calendar'),
    isImported: input.isImported === true || !input.isDbGame,
    visibility: input.visibility || null,
    myRsvp: 'not_responded',
    myRsvpNote: null,
    rsvpSummary: input.rsvpSummary || null,
    rideshareSummary: null,
    assignments: Array.isArray(input.assignments) ? input.assignments : [],
    availabilityLocked: isAvailabilityLocked(input.date, availabilityPreferences),
    availabilityCutoffLabel: formatAvailabilityCutoff(availabilityPreferences),
    availabilityPreferences,
    availabilityNoteVisibility: availabilityPreferences.noteVisibility,
    availabilityNotesVisible,
    availabilityNotes: [],
    practiceAttendanceSummary: attendanceSummary,
    practiceHomePacketSummary: packetSummary,
    practiceSessionId: input.practiceSessionId || null,
    practiceHomePacket: packetSummary ? input.practiceHomePacket : null,
    practicePacketCompletions: [],
    isTeamStaff: input.isTeamStaff === true,
    isTeamRsvpReminderManager: input.isTeamRsvpReminderManager === true
  };
}

async function buildTeamSchedule(teamId: string, teamChildren: ParentScheduleChild[], user: AuthUser) {
  const events: ParentScheduleEvent[] = [];
  const [team, dbGames, trackedUids, practiceSessions] = await Promise.all([
    loadTeam(teamId),
    loadGames(teamId),
    getTrackedCalendarEventUids(teamId).catch(() => []),
    loadPracticeSessions(teamId)
  ]);
  if (!team) return events;

  const teamName = compactString(team.name) || teamId;
  const teamWithId = { ...team, id: team.id || teamId };
  const isStaff = isTeamStaff(teamWithId, user);
  const isRsvpReminderManager = isPublicRsvpReminderManager(teamWithId, user);
  teamChildren.forEach((child) => {
    child.teamName = child.teamName || teamName;
  });
  const availabilityPreferences = normalizeAvailabilityPreferences(team.availabilityPreferences);
  const visibleSessions = filterVisiblePracticeSessions(practiceSessions || [], dbGames || []);
  const sessionsByEventId = new Map<string, any>();
  const sessions: any[] = [];
  const matchedSessionIds = new Set<string>();

  visibleSessions.forEach((session: any) => {
    if (session?.eventId) sessionsByEventId.set(session.eventId, session);
    sessions.push({ ...session, _parsedDate: normalizeScheduleDate(session.date) });
  });

  for (const game of Array.isArray(dbGames) ? dbGames : []) {
    const isPractice = game.type === 'practice';
    const type = isPractice ? 'practice' : 'game';
    const isCancelled = game.status === 'cancelled';

    if (isPractice && game.isSeriesMaster && game.recurrence) {
      for (const occurrence of expandRecurrence(game)) {
        const date = normalizeScheduleDate(occurrence.date) || new Date(occurrence.date);
        const id = `${occurrence.masterId}__${occurrence.instanceDate}`;
        const session = resolvePracticeSessionForEvent({ id }, date, sessionsByEventId, sessions, matchedSessionIds);
        teamChildren.forEach((child) => {
          events.push(createScheduleEvent({
            teamId,
            teamName,
            child,
            id,
            type: 'practice',
            date,
            endDate: occurrence.endDate || occurrence.end || game.endDate || game.end || null,
            location: occurrence.location || 'TBD',
            opponent: 'TBD',
            title: occurrence.title || null,
            isDbGame: true,
            isCancelled,
            status: game.status || null,
            liveStatus: game.liveStatus || null,
            homeScore: game.homeScore ?? null,
            awayScore: game.awayScore ?? null,
            canUpdateScore: false,
            arrivalTime: game.arrivalTime || null,
            notes: occurrence.notes || null,
            seasonLabel: game.seasonLabel || null,
            competitionType: game.competitionType || null,
            countsTowardSeasonRecord: game.countsTowardSeasonRecord ?? null,
            sourceType: game.sourceMetadata?.sourceType || game.source || 'db',
            sourceLabel: getScheduleSourceLabel(game),
            isImported: Boolean(game.sourceMetadata || game.source === 'calendar' || game.source === 'registration'),
            visibility: game.visibility || null,
            assignments: [],
            practiceAttendance: hasRecordedAttendance(session?.attendance) ? session.attendance : null,
            practiceHomePacket: hasHomePacket(session) ? session.homePacketContent : null,
            practiceSessionId: compactString(session?.id) || null,
            availabilityPreferences,
            isTeamStaff: isStaff,
            isTeamRsvpReminderManager: isRsvpReminderManager
          }));
        });
      }
    } else {
      const date = toEventDate(game.date);
      const id = compactString(game.id || game.gameId);
      if (!id) continue;
      const session = isPractice ? resolvePracticeSessionForEvent(game, date, sessionsByEventId, sessions, matchedSessionIds) : null;
      teamChildren.forEach((child) => {
        events.push(createScheduleEvent({
          teamId,
          teamName,
          child,
          id,
          type,
          date,
          endDate: game.endDate || game.end || game.endTime || null,
          location: game.location || 'TBD',
          opponent: game.opponent || 'TBD',
          opponentTeamName: game.opponentTeamName || game.awayTeamName || null,
          opponentTeamPhoto: game.opponentTeamPhoto || null,
          title: game.title || null,
          isDbGame: true,
          isCancelled,
          status: game.status || null,
          liveStatus: game.liveStatus || null,
          homeScore: game.homeScore ?? null,
          awayScore: game.awayScore ?? null,
          canUpdateScore: type === 'game' && hasScorekeepingTeamAccess(user, teamWithId, game, null),
          isHome: game.isHome ?? null,
          kitColor: game.kitColor || null,
          arrivalTime: game.arrivalTime || null,
          notes: game.notes || null,
          seasonLabel: game.seasonLabel || null,
          competitionType: game.competitionType || null,
          countsTowardSeasonRecord: game.countsTowardSeasonRecord ?? null,
          sourceType: game.sourceMetadata?.sourceType || game.source || 'db',
          sourceLabel: getScheduleSourceLabel(game),
          isImported: Boolean(game.sourceMetadata || game.source === 'calendar' || game.source === 'registration'),
          visibility: game.visibility || null,
          assignments: Array.isArray(game.assignments) ? game.assignments : [],
          rsvpSummary: game.rsvpSummary || null,
          practiceAttendance: isPractice && hasRecordedAttendance(session?.attendance) ? session.attendance : null,
          practiceHomePacket: isPractice && hasHomePacket(session) ? session.homePacketContent : null,
          practiceSessionId: isPractice ? compactString(session?.id) || null : null,
          availabilityPreferences,
          isTeamStaff: isStaff,
          isTeamRsvpReminderManager: isRsvpReminderManager
        }));
      });
    }
  }

  if (Array.isArray(team.calendarUrls) && team.calendarUrls.length > 0) {
    const calendarResults = await Promise.all(team.calendarUrls.map(async (calendarUrl: string) => {
      try {
        return await fetchAndParseCalendar(calendarUrl);
      } catch (error) {
        console.warn('[schedule-service] Unable to load team calendar:', calendarUrl, error);
        return [];
      }
    }));

    calendarResults.flat().forEach((calendarEvent: any) => {
      if (isTrackedCalendarEvent(calendarEvent, trackedUids)) return;
      const date = normalizeScheduleDate(calendarEvent.dtstart);
      if (!date) return;
      const hasConflict = (dbGames || []).some((dbGame: any) => Math.abs(toEventDate(dbGame.date).getTime() - date.getTime()) < 60000);
      if (hasConflict) return;
      const isPractice = isPracticeEvent(calendarEvent.summary);
      const type = isPractice ? 'practice' : 'game';
      const cleanSummary = calendarEvent.summary?.replace(/\[CANCELED\]\s*/gi, '') || '';
      const id = getCalendarEventTrackingId(calendarEvent) || `ics-${date.getTime()}`;
      const session = isPractice ? resolvePracticeSessionForEvent(calendarEvent, date, sessionsByEventId, sessions, matchedSessionIds) : null;
      teamChildren.forEach((child) => {
        events.push(createScheduleEvent({
          teamId,
          teamName,
          child,
          id,
          type,
          date,
          endDate: calendarEvent.dtend || calendarEvent.end || null,
          location: calendarEvent.location || 'TBD',
          opponent: extractOpponent(cleanSummary, teamName),
          title: isPractice ? cleanSummary || 'Practice' : null,
          isDbGame: false,
          isCancelled: calendarEvent.status?.toUpperCase?.() === 'CANCELLED' || calendarEvent.summary?.includes('[CANCELED]'),
          sourceType: 'calendar',
          sourceLabel: 'Imported calendar',
          isImported: true,
          practiceAttendance: isPractice && hasRecordedAttendance(session?.attendance) ? session.attendance : null,
          practiceHomePacket: isPractice && hasHomePacket(session) ? session.homePacketContent : null,
          practiceSessionId: isPractice ? compactString(session?.id) || null : null,
          availabilityPreferences,
          isTeamStaff: isStaff,
          isTeamRsvpReminderManager: isRsvpReminderManager
        }));
      });
    });
  }

  sessions
    .filter((session) => session._parsedDate && !(session.id && matchedSessionIds.has(session.id)))
    .forEach((session) => {
      teamChildren.forEach((child) => {
        events.push(createScheduleEvent({
          teamId,
          teamName,
          child,
          id: compactString(session.eventId || session.id),
          type: 'practice',
          date: session._parsedDate,
          endDate: session.endDate || session.end || null,
          location: session.location || 'TBD',
          opponent: null,
          title: session.title || 'Practice',
          isDbGame: false,
          sourceType: 'practice-session',
          sourceLabel: 'Practice packet',
          isImported: false,
          practiceAttendance: hasRecordedAttendance(session?.attendance) ? session.attendance : null,
          practiceHomePacket: hasHomePacket(session) ? session.homePacketContent : null,
          practiceSessionId: compactString(session?.id) || null,
          availabilityPreferences,
          isTeamStaff: isStaff,
          isTeamRsvpReminderManager: isRsvpReminderManager
        }));
      });
    });

  return events;
}

function getRsvpPlayerIds(rsvp: any) {
  const directIds = Array.isArray(rsvp?.playerIds) ? rsvp.playerIds : [];
  const ids = [
    ...directIds,
    rsvp?.playerId,
    rsvp?.childId
  ].map((value) => compactString(value)).filter(Boolean);
  return [...new Set(ids)];
}

function rsvpTimestampMillis(rsvp: any) {
  const value = rsvp?.respondedAt || rsvp?.updatedAt || rsvp?.createdAt;
  const date = normalizeScheduleDate(value);
  return date?.getTime() || 0;
}

function resolveMyRsvpNotesByChildForGame(allScheduleEvents: ParentScheduleEvent[], teamId: string, gameId: string, rsvps: any[], userId: string) {
  const scopedPlayerIds = [...new Set((Array.isArray(allScheduleEvents) ? allScheduleEvents : [])
    .filter((event) => event.teamId === teamId && event.id === gameId)
    .map((event) => event.childId)
    .filter(Boolean))];
  const scopedSet = new Set(scopedPlayerIds);
  const byChild = new Map<string, { note: string; respondedAtMillis: number }>();

  (Array.isArray(rsvps) ? rsvps : []).forEach((rsvp) => {
    if (String(rsvp?.userId || '') !== userId) return;
    const note = compactString(rsvp?.note);
    const playerIds = getRsvpPlayerIds(rsvp);
    const scopedPlayerIdsForRsvp = playerIds.length ? playerIds : scopedPlayerIds;
    const respondedAtMillis = rsvpTimestampMillis(rsvp);

    scopedPlayerIdsForRsvp.forEach((playerId) => {
      if (!scopedSet.has(playerId)) return;
      const existing = byChild.get(playerId);
      if (!existing || respondedAtMillis >= existing.respondedAtMillis) {
        byChild.set(playerId, { note, respondedAtMillis });
      }
    });
  });

  return Object.fromEntries([...byChild.entries()].map(([playerId, value]) => [playerId, value.note]));
}

async function hydrateEventDetails(events: ParentScheduleEvent[], user: AuthUser) {
  const uniqueEventKeys = [...new Set(
    events
      .filter((event) => event.isDbGame && !event.isCancelled && event.teamId && event.id)
      .map((event) => `${event.teamId}::${event.id}`)
  )];

  const gameIdsByTeam = new Map<string, string[]>();
  uniqueEventKeys.forEach((key) => {
    const [teamId, gameId] = key.split('::');
    if (!teamId || !gameId) return;
    if (!gameIdsByTeam.has(teamId)) gameIdsByTeam.set(teamId, []);
    gameIdsByTeam.get(teamId)?.push(gameId);
  });

  const summaryMapsByTeam = new Map<string, Map<string, ScheduleRsvpSummary>>();
  await Promise.all([...gameIdsByTeam.entries()].map(async ([teamId, gameIds]) => {
    summaryMapsByTeam.set(teamId, await loadRsvpSummaryMap(teamId, gameIds).catch(() => new Map()));
  }));

  await Promise.all(uniqueEventKeys.map(async (key) => {
    const [teamId, gameId] = key.split('::');
    const matchingEvents = events.filter((event) => event.teamId === teamId && event.id === gameId);
    const firstEvent = matchingEvents[0];
    if (!firstEvent) return;

    const [rsvps, offers, claims] = await Promise.all([
      loadRsvps(teamId, gameId).catch(() => []),
      loadRideOffers(teamId, gameId).catch(() => []),
      loadAssignmentClaims(teamId, gameId).catch(() => ({}))
    ]);
    const myRsvpByChild = resolveMyRsvpByChildForGame(events, teamId, gameId, rsvps, user.uid);
    const myRsvpNotesByChild = resolveMyRsvpNotesByChildForGame(events, teamId, gameId, rsvps, user.uid);
    const summary = summaryMapsByTeam.get(teamId)?.get(gameId) || firstEvent.rsvpSummary || summarizeRsvps(rsvps);
    const rideshareSummary = getEventRideshareSummary(offers) as ScheduleRideSummary;
    const assignments = mergeAssignmentsWithClaims(firstEvent.assignments, claims) as ScheduleAssignment[];
    const preferences = firstEvent.availabilityPreferences || {};
    const availabilityNotesVisible = canViewAvailabilityNotes(preferences, false);
    const availabilityNotes = buildAvailabilityNoteRows(rsvps, preferences, false);

    matchingEvents.forEach((event) => {
      event.myRsvp = normalizeRsvpResponse(myRsvpByChild[event.childId]);
      event.myRsvpNote = myRsvpNotesByChild[event.childId] || null;
      event.rsvpSummary = summary;
      event.rideshareSummary = rideshareSummary;
      event.assignments = assignments;
      event.availabilityNotesVisible = availabilityNotesVisible;
      event.availabilityNotes = availabilityNotes;
    });
  }));

  return events;
}

export async function loadParentSchedule(user: AuthUser | null): Promise<ParentScheduleLoadResult> {
  if (!user?.uid) {
    return { children: [], events: [] };
  }

  const profile = await loadProfileDocument(user.uid);
  const children = normalizeChildLinks(user, profile as Record<string, unknown>);
  const byTeam = new Map<string, ParentScheduleChild[]>();
  children.forEach((child) => {
    if (!byTeam.has(child.teamId)) byTeam.set(child.teamId, []);
    byTeam.get(child.teamId)?.push(child);
  });

  const staffTeams = await loadStaffTeams(user).catch(() => []);
  await Promise.all(staffTeams.map(async (team: any) => {
    const teamId = compactString(team?.id);
    if (!teamId) return;
    const existingPlayerIds = new Set((byTeam.get(teamId) || []).map((child) => child.playerId));
    const players = await loadPlayers(teamId).catch(() => []);
    const staffChildren = (Array.isArray(players) ? players : [])
      .filter((player: any) => player?.active !== false && compactString(player?.id) && !existingPlayerIds.has(compactString(player.id)))
      .map((player: any) => ({
        teamId,
        teamName: compactString(team?.name) || teamId,
        playerId: compactString(player.id),
        playerName: compactString(player.name) || compactString(player.displayName) || 'Player'
      }));
    if (staffChildren.length) {
      byTeam.set(teamId, [...(byTeam.get(teamId) || []), ...staffChildren]);
    }
  }));

  const eventBatches = await Promise.all([...byTeam.entries()].map(async ([teamId, teamChildren]) => {
    try {
      return await buildTeamSchedule(teamId, teamChildren, user);
    } catch (error) {
      console.warn('[schedule-service] Failed to load team schedule:', teamId, error);
      return [];
    }
  }));

  const events = eventBatches.flat().sort((a, b) => a.date.getTime() - b.date.getTime());
  await hydrateEventDetails(events, user);
  return { children, events };
}

async function nativeSubmitRsvpForPlayer(teamId: string, gameId: string, user: AuthUser, childId: string, response: RsvpResponse, note = '') {
  const docId = `${user.uid}__${childId}`;
  await nativePatchDocument(`teams/${encodeURIComponent(teamId)}/games/${encodeURIComponent(gameId)}/rsvps/${encodeURIComponent(docId)}`, {
    userId: user.uid,
    displayName: user.displayName || user.email || null,
    playerIds: [childId],
    response,
    respondedAt: new Date(),
    note: compactString(note) || null
  });
  return null;
}

export async function submitParentScheduleRsvp(event: ParentScheduleEvent, user: AuthUser, response: Exclude<RsvpResponse, 'not_responded'>, note = '') {
  if (!event.isDbGame) {
    throw new Error('Availability opens after this event is tracked in the schedule.');
  }
  if (event.availabilityLocked) {
    throw new Error('Availability is locked for this event.');
  }
  if (!event.childId) {
    throw new Error('Select a child before submitting RSVP.');
  }

  try {
    return await withTimeout(Promise.resolve(submitRsvpForPlayer(event.teamId, event.id, user.uid, {
      displayName: user.displayName || user.email,
      playerId: event.childId,
      response,
      note: compactString(note) || null
    })), 'RSVP submit');
  } catch (error) {
    if (!isNativeRuntime()) throw error;
    console.warn('[schedule-service] Falling back to REST RSVP submit:', error);
    return nativeSubmitRsvpForPlayer(event.teamId, event.id, user, event.childId, response, note);
  }
}

export async function updateGameScore(teamId: string, gameId: string, score: GameScoreInput, user: AuthUser) {
  if (!teamId || !gameId) {
    throw new Error('A scheduled game is required before updating the score.');
  }
  if (!user?.uid) {
    throw new Error('Sign in before updating the score.');
  }

  const payload: Record<string, unknown> = {
    homeScore: normalizeGameScoreValue(score.homeScore),
    awayScore: normalizeGameScoreValue(score.awayScore),
    scoreUpdatedAt: new Date(),
    scoreUpdatedBy: user.uid
  };
  const scoreStreamSessionId = compactString(score.scoreStreamSessionId);
  if (scoreStreamSessionId) {
    payload.scoreStreamSessionId = scoreStreamSessionId;
  }

  try {
    await withTimeout(Promise.resolve(updateGame(teamId, gameId, payload)), 'Score update');
  } catch (error) {
    if (!isNativeRuntime()) throw error;
    console.warn('[schedule-service] Falling back to REST score update:', error);
    await nativePatchDocument(`teams/${encodeURIComponent(teamId)}/games/${encodeURIComponent(gameId)}`, payload);
  }

  return payload;
}

function assertStaffRsvpReminderEvent(event: ParentScheduleEvent, user: AuthUser | null) {
  if (!user?.uid) throw new Error('Sign in before sending RSVP reminders.');
  if (!event.isTeamRsvpReminderManager) throw new Error('Only team owners and admins can send RSVP reminders.');
  if (!event.isDbGame) throw new Error('RSVP reminders are available only for schedule events.');
  if (event.isCancelled) throw new Error('RSVP reminders are unavailable for cancelled events.');
}

async function loadStaffRsvpReminderData(event: ParentScheduleEvent) {
  const [players, rsvps] = await Promise.all([
    loadPlayers(event.teamId),
    loadRsvps(event.teamId, event.id)
  ]);
  return { players, rsvps };
}

export async function loadStaffRsvpReminderPreview(event: ParentScheduleEvent, user: AuthUser | null): Promise<StaffRsvpReminderPreview> {
  assertStaffRsvpReminderEvent(event, user);
  const { players, rsvps } = await loadStaffRsvpReminderData(event);
  return buildStaffRsvpReminderPreview(players, rsvps);
}

async function sendPublicRsvpReminderEmailsNativeSafe(event: ParentScheduleEvent) {
  if (!isNativeRuntime()) {
    return sendPublicRsvpReminderEmails({
      auth: firebaseAuth,
      teamId: event.teamId,
      gameId: event.id,
      eventType: event.type,
      eventTitle: getScheduleTitle(event),
      eventDate: event.date
    });
  }

  const token = await getNativeAuthIdToken(true);
  if (!token) throw new Error('Native auth token is unavailable.');
  const response = await withTimeout(fetch(`https://us-central1-${getProjectId()}.cloudfunctions.net/sendPublicRsvpEmails`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      teamId: event.teamId,
      gameId: event.id,
      eventType: event.type,
      eventTitle: getScheduleTitle(event),
      eventDate: event.date instanceof Date ? event.date.toISOString() : event.date || null
    })
  }), 'RSVP email reminders');
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || 'Unable to send RSVP email reminders.');
  }
  return payload;
}

async function updateRsvpReminderMetadata(event: ParentScheduleEvent, user: AuthUser, missingCount: number, emailCount: number) {
  const sentAt = new Date().toISOString();
  const metadata = buildStaffRsvpReminderMetadata(user.uid, missingCount, emailCount, sentAt);
  const { persistedEventId, occurrenceKey } = getStaffRsvpReminderMetadataTarget(event.id);

  if (isNativeRuntime()) {
    const existing = await nativeGetDocument(`teams/${encodeURIComponent(event.teamId)}/games/${encodeURIComponent(persistedEventId)}`).catch(() => null);
    const existingNotifications = existing?.scheduleNotifications || {};
    await nativePatchDocument(`teams/${encodeURIComponent(event.teamId)}/games/${encodeURIComponent(persistedEventId)}`, {
      scheduleNotifications: {
        ...existingNotifications,
        ...metadata,
        rsvpReminderOccurrences: occurrenceKey
          ? {
              ...(existingNotifications.rsvpReminderOccurrences || {}),
              [occurrenceKey]: metadata
            }
          : existingNotifications.rsvpReminderOccurrences || null
      }
    });
    return;
  }

  const updates: Record<string, unknown> = {
    'scheduleNotifications.sent': true,
    'scheduleNotifications.sentAt': sentAt,
    'scheduleNotifications.lastAction': 'rsvp_reminder',
    'scheduleNotifications.lastSentAt': sentAt,
    'scheduleNotifications.lastSentBy': user.uid || null,
    'scheduleNotifications.lastRsvpReminderCount': missingCount,
    'scheduleNotifications.lastRsvpEmailCount': emailCount
  };
  if (occurrenceKey) {
    updates[`scheduleNotifications.rsvpReminderOccurrences.${occurrenceKey}`] = metadata;
  }

  await updateGame(event.teamId, persistedEventId, updates);
}

export async function sendStaffRsvpReminder(event: ParentScheduleEvent, user: AuthUser, profile: Record<string, any> = {}): Promise<StaffRsvpReminderSendResult> {
  assertStaffRsvpReminderEvent(event, user);
  const preview = await loadStaffRsvpReminderPreview(event, user);
  if (preview.missingPlayerCount <= 0) {
    throw new Error('Everyone has responded. No RSVP reminder was sent.');
  }

  const emailResult = await sendPublicRsvpReminderEmailsNativeSafe(event);
  await sendTeamChatMessage({
    teamId: event.teamId,
    user,
    profile,
    text: buildStaffRsvpReminderMessage({
      eventType: event.type,
      title: getScheduleTitle(event),
      dateLabel: `${event.date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} at ${event.date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`,
      missingCount: preview.missingPlayerCount
    }),
    files: [],
    selectedConversationId: 'team',
    selectedRecipientTarget: 'full_team',
    selectedRecipientIds: []
  });
  const emailSentCount = resolveStaffRsvpReminderEmailSentCount(emailResult?.sentCount, preview.eligibleEmailCount);
  await updateRsvpReminderMetadata(event, user, preview.missingPlayerCount, emailSentCount);
  return {
    ...preview,
    emailSentCount
  };
}

async function nativeClaimAssignment(event: ParentScheduleEvent, user: AuthUser, role: string, name: string) {
  const path = `teams/${encodeURIComponent(event.teamId)}/games/${encodeURIComponent(event.id)}/assignmentClaims/${encodeURIComponent(role)}`;
  const existing = await nativeGetDocument(path);
  if (existing) {
    throw new Error('This slot has already been claimed.');
  }
  await nativePatchDocument(path, {
    claimedByUserId: user.uid,
    claimedByName: name.slice(0, 100),
    claimedAt: new Date()
  });
}

async function nativeReleaseAssignment(event: ParentScheduleEvent, role: string) {
  const path = `teams/${encodeURIComponent(event.teamId)}/games/${encodeURIComponent(event.id)}/assignmentClaims/${encodeURIComponent(role)}`;
  const existing = await nativeGetDocument(path);
  if (!existing) return;
  await nativeDeleteDocument(path);
}

export async function loadParentScheduleAssignments(event: ParentScheduleEvent) {
  const assignments = normalizeAssignments(event.assignments);
  if (!assignments.length || !event.isDbGame || event.isCancelled) {
    return assignments;
  }
  const claims = await loadAssignmentClaims(event.teamId, event.id).catch(() => ({}));
  return normalizeAssignments(mergeAssignmentsWithClaims(assignments, claims) as ScheduleAssignment[]);
}

export async function claimParentScheduleAssignmentSlot(event: ParentScheduleEvent, user: AuthUser, role: string) {
  assertAssignmentEvent(event);
  const trimmedRole = normalizeAssignmentRole(role);
  if (!trimmedRole) {
    throw new Error('Role is required.');
  }
  const name = String(user.displayName || user.email || 'Parent').trim();
  if (!name) {
    throw new Error('Name is required.');
  }

  try {
    await withTimeout(Promise.resolve(claimAssignmentSlot(event.teamId, event.id, trimmedRole, { name })), 'Assignment claim');
  } catch (error) {
    if (!isNativeRuntime()) throw error;
    console.warn('[schedule-service] Falling back to REST assignment claim:', error);
    await nativeClaimAssignment(event, user, trimmedRole, name);
  }
}

export async function releaseParentScheduleAssignmentClaim(event: ParentScheduleEvent, role: string) {
  assertAssignmentEvent(event);
  const trimmedRole = normalizeAssignmentRole(role);
  if (!trimmedRole) {
    throw new Error('Role is required.');
  }

  try {
    await withTimeout(Promise.resolve(releaseAssignmentClaim(event.teamId, event.id, trimmedRole)), 'Assignment release');
  } catch (error) {
    if (!isNativeRuntime()) throw error;
    console.warn('[schedule-service] Falling back to REST assignment release:', error);
    await nativeReleaseAssignment(event, trimmedRole);
  }
}

function getPracticePacketSessionId(event: ParentScheduleEvent) {
  return compactString(event.practiceSessionId) || compactString(event.id);
}

function getPracticePacketChildren(events: ParentScheduleEvent[], fallbackEvent: ParentScheduleEvent): ParentPracticePacketChild[] {
  const byId = new Map<string, ParentPracticePacketChild>();
  const candidates = (Array.isArray(events) && events.length ? events : [fallbackEvent])
    .filter((event) => event.teamId === fallbackEvent.teamId && event.id === fallbackEvent.id);
  candidates.forEach((event) => {
    if (!event.childId || byId.has(event.childId)) return;
    byId.set(event.childId, {
      id: event.childId,
      name: event.childName || 'Player'
    });
  });
  if (!byId.size && fallbackEvent.childId) {
    byId.set(fallbackEvent.childId, {
      id: fallbackEvent.childId,
      name: fallbackEvent.childName || 'Player'
    });
  }
  return [...byId.values()];
}

async function loadPracticePacketCompletions(teamId: string, sessionId: string) {
  return readWithNativeFallback(
    `packet completions ${teamId}/${sessionId}`,
    () => Promise.resolve(getPracticePacketCompletions(teamId, sessionId)),
    () => nativeListCollection(`teams/${encodeURIComponent(teamId)}/practiceSessions/${encodeURIComponent(sessionId)}/packetCompletions`)
  );
}

async function nativeUpsertPracticePacketCompletion(teamId: string, sessionId: string, payload: Record<string, unknown>) {
  const parentUserId = compactString(payload.parentUserId);
  const childId = compactString(payload.childId);
  if (!parentUserId || !childId) throw new Error('parentUserId and childId are required');
  const docId = `${parentUserId}__${childId}`;
  await nativePatchDocument(`teams/${encodeURIComponent(teamId)}/practiceSessions/${encodeURIComponent(sessionId)}/packetCompletions/${encodeURIComponent(docId)}`, {
    parentUserId,
    parentName: payload.parentName || 'Parent',
    childId,
    childName: payload.childName || null,
    status: 'completed',
    completedAt: new Date(),
    updatedAt: new Date()
  });
}

export async function loadParentPracticePacket(event: ParentScheduleEvent, childEvents: ParentScheduleEvent[] = []): Promise<ParentPracticePacket | null> {
  if (event.type !== 'practice' || !event.practiceHomePacketSummary || !event.practiceHomePacket) {
    return null;
  }
  const sessionId = getPracticePacketSessionId(event);
  if (!sessionId) {
    return null;
  }
  const completions = normalizePracticePacketCompletions(await loadPracticePacketCompletions(event.teamId, sessionId).catch(() => []));
  return {
    sessionId,
    teamId: event.teamId,
    eventId: event.id,
    title: event.title || 'Practice',
    date: event.date,
    location: event.location || 'TBD',
    homePacket: event.practiceHomePacket,
    completions,
    children: getPracticePacketChildren(childEvents, event)
  };
}

export async function markParentPracticePacketComplete(packet: ParentPracticePacket, user: AuthUser, child: ParentPracticePacketChild): Promise<PracticePacketCompletion> {
  if (!packet?.teamId || !packet?.sessionId) {
    throw new Error('Practice packet is not linked to a session.');
  }
  if (!child?.id) {
    throw new Error('Select a child before marking complete.');
  }
  await ensureParentTeamAccess(user, packet.teamId);
  const payload = buildPracticePacketCompletionPayloadBase({
    currentUserId: user.uid,
    currentUser: user,
    childId: child.id,
    childName: child.name || null
  });

  try {
    await withTimeout(Promise.resolve(upsertPracticePacketCompletion(packet.teamId, packet.sessionId, payload)), 'Packet completion');
  } catch (error) {
    if (!isNativeRuntime()) throw error;
    console.warn('[schedule-service] Falling back to REST packet completion:', error);
    await nativeUpsertPracticePacketCompletion(packet.teamId, packet.sessionId, payload);
  }

  return {
    ...payload,
    id: `${user.uid}__${child.id}`,
    status: 'completed',
    completedAt: new Date(),
    updatedAt: new Date()
  };
}

export type RideOfferInput = {
  seatCapacity: number;
  direction: RideOfferDirection;
  note?: string;
};

export type RideRequestChildInput = {
  childId: string;
  childName: string;
};

function getRideOfferGameId(event: ParentScheduleEvent, offer?: Pick<ScheduleRideOffer, 'sourceGameId'> | null) {
  return compactString(offer?.sourceGameId) || event.id;
}

function getRideRequestId(user: AuthUser, childId: string) {
  return `${user.uid}__${childId}`;
}

function assertRideshareEvent(event: ParentScheduleEvent) {
  if (!event.isDbGame) {
    throw new Error('Rideshare opens after this event is tracked in the schedule.');
  }
  if (event.isCancelled) {
    throw new Error('Rideshare is closed for cancelled events.');
  }
}

async function ensureParentTeamAccess(user: AuthUser, teamId: string) {
  if (!user?.uid || !teamId) return;
  const profile = await loadProfileDocument(user.uid) as Record<string, any>;
  const existingTeamIds = Array.isArray(profile.parentTeamIds) ? profile.parentTeamIds : [];
  const parentOf = Array.isArray(profile.parentOf) ? profile.parentOf : Array.isArray(user.parentOf) ? user.parentOf : [];
  const parentTeamIds = [...new Set([...existingTeamIds, teamId].filter(Boolean))];
  const parentPlayerKeys = [...new Set(parentOf
    .map((link: any) => link?.teamId && (link?.playerId || link?.childId) ? `${link.teamId}::${link.playerId || link.childId}` : '')
    .filter(Boolean))];
  const currentParentPlayerKeys = Array.isArray(profile.parentPlayerKeys) ? profile.parentPlayerKeys : [];
  const teamsChanged = parentTeamIds.length !== existingTeamIds.length ||
    parentTeamIds.some((id) => !existingTeamIds.includes(id));
  const keysChanged = parentPlayerKeys.length !== currentParentPlayerKeys.length ||
    parentPlayerKeys.some((key) => !currentParentPlayerKeys.includes(key));

  if (teamsChanged || keysChanged) {
    await saveProfileDocument(user.uid, {
      ...profile,
      parentTeamIds,
      parentPlayerKeys
    } as any);
  }
}

async function nativeCreateRideOfferForEvent(event: ParentScheduleEvent, user: AuthUser, input: RideOfferInput) {
  const doc = await nativeCreateDocument(`teams/${encodeURIComponent(event.teamId)}/games/${encodeURIComponent(event.id)}/rideOffers`, {
    driverUserId: user.uid,
    driverName: user.displayName || user.email || 'Parent Driver',
    seatCapacity: Math.max(1, Number.parseInt(String(input.seatCapacity), 10) || 0),
    seatCountConfirmed: 0,
    direction: normalizeRideOfferDirection(input.direction),
    note: compactString(input.note) || null,
    status: 'open',
    createdAt: new Date(),
    updatedAt: new Date()
  });
  return doc?.id || '';
}

async function nativeRequestRideSpotForChild(event: ParentScheduleEvent, offer: ScheduleRideOffer, user: AuthUser, child: RideRequestChildInput) {
  const gameId = getRideOfferGameId(event, offer);
  const requestId = getRideRequestId(user, child.childId);
  const requestPath = `teams/${encodeURIComponent(event.teamId)}/games/${encodeURIComponent(gameId)}/rideOffers/${encodeURIComponent(offer.id)}/requests/${encodeURIComponent(requestId)}`;
  const existing = await nativeGetDocument(requestPath);
  const existingStatus = normalizeRideRequestStatus(existing?.status);
  if (existing && existingStatus !== 'declined' && existingStatus !== 'waitlisted') {
    throw new Error('Ride request is already active.');
  }

  await nativePatchDocument(requestPath, {
    parentUserId: user.uid,
    childId: child.childId,
    childName: child.childName || null,
    status: 'pending',
    requestedAt: new Date(),
    respondedAt: null,
    updatedAt: new Date()
  });
  return requestId;
}

async function nativeUpdateRideRequestDecision(event: ParentScheduleEvent, offer: ScheduleRideOffer, requestId: string, status: RideRequestStatus) {
  const gameId = getRideOfferGameId(event, offer);
  const offerPath = `teams/${encodeURIComponent(event.teamId)}/games/${encodeURIComponent(gameId)}/rideOffers/${encodeURIComponent(offer.id)}`;
  const requestPath = `${offerPath}/requests/${encodeURIComponent(requestId)}`;
  const [offerDoc, requestDoc] = await Promise.all([
    nativeGetDocument(offerPath),
    nativeGetDocument(requestPath)
  ]);
  if (!offerDoc) throw new Error('Ride offer not found.');
  if (!requestDoc) throw new Error('Ride request not found.');
  if (normalizeRideOfferStatus(offerDoc.status) !== 'open') throw new Error('Ride offer is closed.');

  const nextSeatCount = getNextRideConfirmedSeatCount(offerDoc.seatCountConfirmed, requestDoc.status, status);
  const seatCapacity = Math.max(0, Number.parseInt(String(offerDoc.seatCapacity || 0), 10) || 0);
  if (nextSeatCount > seatCapacity) {
    throw new Error('Offer is full.');
  }

  await Promise.all([
    nativePatchDocument(requestPath, {
      status,
      respondedAt: new Date(),
      updatedAt: new Date()
    }),
    nativePatchDocument(offerPath, {
      seatCountConfirmed: nextSeatCount,
      updatedAt: new Date()
    })
  ]);
  return { seatCountConfirmed: nextSeatCount };
}

async function nativeSetRideOfferStatus(event: ParentScheduleEvent, offer: ScheduleRideOffer, status: RideOfferStatus) {
  const gameId = getRideOfferGameId(event, offer);
  await nativePatchDocument(`teams/${encodeURIComponent(event.teamId)}/games/${encodeURIComponent(gameId)}/rideOffers/${encodeURIComponent(offer.id)}`, {
    status: normalizeRideOfferStatus(status),
    updatedAt: new Date()
  });
}

async function nativeCancelRideRequestForChild(event: ParentScheduleEvent, offer: ScheduleRideOffer, requestId: string) {
  const gameId = getRideOfferGameId(event, offer);
  const offerPath = `teams/${encodeURIComponent(event.teamId)}/games/${encodeURIComponent(gameId)}/rideOffers/${encodeURIComponent(offer.id)}`;
  const requestPath = `${offerPath}/requests/${encodeURIComponent(requestId)}`;
  const [offerDoc, requestDoc] = await Promise.all([
    nativeGetDocument(offerPath),
    nativeGetDocument(requestPath)
  ]);
  if (!requestDoc) return;
  await nativeDeleteDocument(requestPath);
  if (!offerDoc) return;
  const nextSeatCount = getNextRideConfirmedSeatCount(offerDoc.seatCountConfirmed, requestDoc.status, 'declined');
  await nativePatchDocument(offerPath, {
    seatCountConfirmed: nextSeatCount,
    updatedAt: new Date()
  });
}

export async function loadParentScheduleRideOffers(event: ParentScheduleEvent) {
  if (!event.isDbGame || event.isCancelled) return [];
  return normalizeRideOffers(await loadRideOffers(event.teamId, event.id).catch(() => []));
}

export async function createParentScheduleRideOffer(event: ParentScheduleEvent, user: AuthUser, input: RideOfferInput) {
  assertRideshareEvent(event);
  const seatCapacity = Math.max(0, Number.parseInt(String(input.seatCapacity), 10) || 0);
  if (seatCapacity <= 0) {
    throw new Error('Seat capacity must be at least 1.');
  }

  await ensureParentTeamAccess(user, event.teamId);
  const payload = {
    seatCapacity,
    direction: normalizeRideOfferDirection(input.direction),
    note: compactString(input.note),
    driverName: user.displayName || user.email || 'Parent Driver'
  };

  try {
    return await withTimeout(Promise.resolve(createRideOffer(event.teamId, event.id, payload)), 'Ride offer create');
  } catch (error) {
    if (!isNativeRuntime()) throw error;
    console.warn('[schedule-service] Falling back to REST ride offer create:', error);
    return nativeCreateRideOfferForEvent(event, user, payload);
  }
}

export async function requestParentScheduleRideSpot(event: ParentScheduleEvent, offer: ScheduleRideOffer, user: AuthUser, child: RideRequestChildInput) {
  assertRideshareEvent(event);
  if (!child.childId) {
    throw new Error('Select a child first.');
  }
  const gameId = getRideOfferGameId(event, offer);
  const payload = {
    childId: child.childId,
    childName: child.childName || 'Player'
  };

  try {
    return await withTimeout(Promise.resolve(requestRideSpot(event.teamId, gameId, offer.id, payload)), 'Ride request create');
  } catch (error) {
    if (!isNativeRuntime()) throw error;
    console.warn('[schedule-service] Falling back to REST ride request create:', error);
    return nativeRequestRideSpotForChild(event, offer, user, payload);
  }
}

export async function updateParentScheduleRideRequestStatus(event: ParentScheduleEvent, offer: ScheduleRideOffer, requestId: string, status: RideRequestStatus) {
  assertRideshareEvent(event);
  const normalizedStatus = normalizeRideRequestStatus(status);
  if (!['confirmed', 'waitlisted', 'declined'].includes(normalizedStatus)) {
    throw new Error('Status must be confirmed, waitlisted, or declined.');
  }
  const gameId = getRideOfferGameId(event, offer);

  try {
    return await withTimeout(Promise.resolve(updateRideRequestStatus(event.teamId, gameId, offer.id, requestId, normalizedStatus)), 'Ride request update');
  } catch (error) {
    if (!isNativeRuntime()) throw error;
    console.warn('[schedule-service] Falling back to REST ride request update:', error);
    return nativeUpdateRideRequestDecision(event, offer, requestId, normalizedStatus);
  }
}

export async function setParentScheduleRideOfferStatus(event: ParentScheduleEvent, offer: ScheduleRideOffer, status: RideOfferStatus) {
  assertRideshareEvent(event);
  const normalizedStatus = normalizeRideOfferStatus(status);
  const gameId = getRideOfferGameId(event, offer);

  try {
    await withTimeout(Promise.resolve(closeRideOffer(event.teamId, gameId, offer.id, normalizedStatus)), 'Ride offer status update');
  } catch (error) {
    if (!isNativeRuntime()) throw error;
    console.warn('[schedule-service] Falling back to REST ride offer status update:', error);
    await nativeSetRideOfferStatus(event, offer, normalizedStatus);
  }
}

export async function cancelParentScheduleRideRequest(event: ParentScheduleEvent, offer: ScheduleRideOffer, requestId: string) {
  assertRideshareEvent(event);
  const gameId = getRideOfferGameId(event, offer);

  try {
    await withTimeout(Promise.resolve(cancelRideRequest(event.teamId, gameId, offer.id, requestId)), 'Ride request cancel');
  } catch (error) {
    if (!isNativeRuntime()) throw error;
    console.warn('[schedule-service] Falling back to REST ride request cancel:', error);
    await nativeCancelRideRequestForChild(event, offer, requestId);
  }
}

export function summarizeParentScheduleRideOffers(offers: ScheduleRideOffer[]) {
  return getScheduleRideshareSummary(offers);
}
