import {
  getAssignmentClaims,
  getGame,
  getGames,
  getPracticePacketCompletions,
  getPracticeSessionByEvent,
  getPracticeSessions,
  getPlayers,
  getRsvps,
  getRsvpBreakdownByPlayer,
  getRsvpSummaries,
  getTeam,
  getTeams,
  addGame,
  addPractice,
  createRideOffer,
  claimAssignmentSlot,
  requestRideSpot,
  listRideOffersForEvent,
  updateRideRequestStatus,
  closeRideOffer,
  cancelRideRequest,
  releaseAssignmentClaim,
  submitRsvpForPlayer,
  broadcastLiveEvent,
  updateGame,
  updateTeam,
  upsertPracticePacketCompletion,
  postSharedGameCancellationNotification,
  cancelOccurrence
} from '../../../../js/db.js';
import { sendPublicRsvpReminderEmails } from '../../../../js/schedule-notifications.js';
import { db, doc, collection, getDocs, runTransaction, increment, serverTimestamp } from '../../../../js/firebase.js';
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
import { buildGameDayRsvpBreakdown } from '../../../../js/game-day-rsvp-breakdown.js';
import { getEventRideshareSummary } from '../../../../js/rideshare-helpers.js';
import { mergeAssignmentsWithClaims } from '../../../../js/snack-helpers.js';
import { hasScorekeepingTeamAccess } from '../../../../js/team-access.js';
import { isTeamActive } from '../../../../js/team-visibility.js';
import { loadProfileDocument, saveProfileDocument } from './profileService';
import { firebaseAuth, getNativeAuthIdToken } from './authService';
import { startUxTimer } from './uxTiming';
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
  validateExternalCalendarUrl,
  buildStaffRsvpReminderMetadata,
  buildStaffRsvpReminderMessage,
  buildStaffRsvpReminderPreview,
  getStaffRsvpReminderMetadataTarget,
  resolveStaffRsvpReminderEmailSentCount,
  getPlayerParentUserIds,
  uniqueNonEmptyStrings,
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
import {
  LINEUP_FORMATIONS,
  buildAutoFilledLineupDraft,
  buildLineupPublishPayload,
  buildLineupPublishMessage,
  countLineupChanges,
  getLineupFormation,
  type AutoFilledLineupPlayer,
  type GamePlanPublishPayloadInput
} from './gameDayLineupPublish';
import { sendTeamChatMessage } from './chatService';
import { DEFAULT_TEAM_CONVERSATION_ID } from './chatLogic';
import type { AuthUser } from './types';

const primaryDataTimeoutMs = 5000;
const parentScheduleTeamConcurrency = 3;

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

export type ParentScheduleLoadOptions = {
  hydrateDetails?: boolean;
  expandStaffPlayers?: boolean;
};

export type ParentScheduleEventDetailLoadOptions = ParentScheduleLoadOptions & {
  teamId: string;
  eventId: string;
};

export type ParentPlayerScheduleLoadOptions = ParentScheduleLoadOptions & {
  teamId?: string;
  playerId: string;
};

export type ParentGameRouteResolution = {
  teamId: string;
  eventId: string;
  childId: string | null;
};

export type StaffScheduleRsvpRow = {
  playerId: string;
  playerName: string;
  playerNumber?: string | number | null;
  response: RsvpResponse;
  respondedAt?: unknown;
  note?: string | null;
  responderUserId?: string | null;
};

export type StaffScheduleRsvpBreakdown = {
  grouped: {
    going: StaffScheduleRsvpRow[];
    maybe: StaffScheduleRsvpRow[];
    not_going: StaffScheduleRsvpRow[];
    not_responded: StaffScheduleRsvpRow[];
  };
  counts: Required<ScheduleRsvpSummary>;
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

export type GameScoreSnapshot = {
  homeScore: number;
  awayScore: number;
};

export type ScheduleHomeScoringPlayer = {
  id: string;
  name: string;
  number: string;
  points: number;
};

export type PlayerScoringStatInput = {
  statKey: 'pts';
  value: 2;
  teamSide?: 'home' | 'away';
  playerName?: string | null;
  playerNumber?: string | number | null;
};

export type PlayerScoringStatResult = GameScoreSnapshot & {
  playerId: string;
  playerName: string;
  playerNumber: string;
  statKey: 'pts';
  value: 2;
  playerPoints: number;
  liveEvent: Record<string, unknown>;
};

export type CancelScheduledGameResult = {
  cancelled: true;
  notificationError: string | null;
};

export type CancelPracticeOccurrenceResult = {
  cancelled: true;
  masterId: string;
  instanceDate: string;
};

export type PublishGamePlanResult = {
  gamePlan: Record<string, any>;
  notificationError: string | null;
};

export type LineupDraftPreviewResult = {
  formationId: string;
  formationName: string;
  numPeriods: number;
  positions: Array<{ id: string; name: string; playerId: string | null; playerName: string | null; playerNumber: string | null }>;
  goingPlayers: AutoFilledLineupPlayer[];
  gamePlan: Record<string, any> | null;
};

function getGoingPlayerIdsFromRsvps(players: any[], rsvps: any[]) {
  const ids = new Set<string>();
  const playerIdsByParentUserId = new Map<string, string[]>();
  (Array.isArray(players) ? players : [])
    .filter(isActiveRosterPlayer)
    .forEach((player) => {
      const playerId = compactString(player?.id);
      if (!playerId) return;
      getPlayerParentUserIds(player).forEach((userId) => {
        playerIdsByParentUserId.set(userId, [...(playerIdsByParentUserId.get(userId) || []), playerId]);
      });
    });

  (Array.isArray(rsvps) ? rsvps : []).forEach((rsvp) => {
    if (normalizeRsvpResponse(rsvp?.response) !== 'going') return;
    const explicitPlayerIds = getRsvpPlayerIds(rsvp);
    const fallbackPlayerIds = explicitPlayerIds.length ? [] : (playerIdsByParentUserId.get(compactString(rsvp?.userId)) || []);
    [...explicitPlayerIds, ...fallbackPlayerIds].forEach((playerId) => ids.add(playerId));
  });
  return ids;
}

function getGoingLineupPlayers(players: any[], rsvps: any[]): AutoFilledLineupPlayer[] {
  const goingPlayerIds = getGoingPlayerIdsFromRsvps(players, rsvps);
  if (!goingPlayerIds.size) return [];
  return (Array.isArray(players) ? players : [])
    .filter(isActiveRosterPlayer)
    .map((player: any) => ({
      id: compactString(player?.id),
      name: normalizePlayerName(player),
      number: normalizePlayerNumber(player) || null
    }))
    .filter((player) => player.id && goingPlayerIds.has(player.id));
}

function buildLineupDraftPreview(formationId: string, goingPlayers: AutoFilledLineupPlayer[], gamePlan: Record<string, any> | null | undefined): LineupDraftPreviewResult {
  const formation = getLineupFormation(formationId);
  if (!formation) {
    throw new Error('Select a supported formation before saving a lineup draft.');
  }
  let draft: Record<string, any> | null = null;
  try {
    draft = buildAutoFilledLineupDraft({ formationId, goingPlayers, previousGamePlan: gamePlan || {} });
  } catch (error: any) {
    if (!String(error?.message || '').includes('No Going players')) throw error;
  }
  return {
    formationId: formation.id,
    formationName: formation.name,
    numPeriods: formation.numPeriods,
    positions: formation.positions.map((position, index) => {
      const player = goingPlayers[index] || null;
      return {
        id: position.id,
        name: position.name,
        playerId: player?.id || null,
        playerName: player?.name || null,
        playerNumber: player?.number || null
      };
    }),
    goingPlayers,
    gamePlan: draft
  };
}

function assertLineupDraftEvent(event: ParentScheduleEvent, user: AuthUser | null) {
  if (!user?.uid) throw new Error('Sign in before saving a lineup draft.');
  if (!event.isDbGame) throw new Error('A scheduled game is required before saving a lineup draft.');
  if (event.type === 'practice') throw new Error('Lineup drafts are available only for games.');
  if (event.isCancelled) throw new Error('Cancelled games cannot save lineup drafts.');
  if (!event.isTeamStaff) throw new Error('Only team coaches and admins can save lineup drafts.');
}

export async function loadAutoFilledLineupDraftPreviewForApp(event: ParentScheduleEvent, user: AuthUser | null, formationId: string): Promise<LineupDraftPreviewResult> {
  assertLineupDraftEvent(event, user);
  if (!LINEUP_FORMATIONS[compactString(formationId)]) {
    throw new Error('Select a supported formation before saving a lineup draft.');
  }
  const [players, rsvps] = await Promise.all([
    loadPlayers(event.teamId),
    loadRsvps(event.teamId, event.id)
  ]);
  return buildLineupDraftPreview(formationId, getGoingLineupPlayers(players, rsvps), event.gamePlan || {});
}

export async function saveScheduledGameLineupDraftForApp(event: ParentScheduleEvent, user: AuthUser | null, formationId: string): Promise<LineupDraftPreviewResult> {
  assertLineupDraftEvent(event, user);
  const [players, rsvps] = await Promise.all([
    loadPlayers(event.teamId),
    loadRsvps(event.teamId, event.id)
  ]);
  const goingPlayers = getGoingLineupPlayers(players, rsvps);
  const nextGamePlan = buildAutoFilledLineupDraft({ formationId, goingPlayers, previousGamePlan: event.gamePlan || {} });
  const payload: Record<string, unknown> = { gamePlan: nextGamePlan };

  try {
    await withTimeout(Promise.resolve(updateGame(event.teamId, event.id, payload)), 'Lineup draft save');
  } catch (error) {
    if (!isNativeRuntime()) throw error;
    console.warn('[schedule-service] Falling back to REST lineup draft updateGame:', error);
    await nativePatchDocument(`teams/${encodeURIComponent(event.teamId)}/games/${encodeURIComponent(event.id)}`, payload);
  }

  return buildLineupDraftPreview(formationId, goingPlayers, nextGamePlan);
}

export async function publishGamePlanForApp(event: ParentScheduleEvent, user: AuthUser): Promise<PublishGamePlanResult> {
  if (!event.isDbGame) {
    throw new Error('A scheduled game is required before publishing a lineup.');
  }
  if (!user?.uid) {
    throw new Error('Sign in before publishing a lineup.');
  }
  if (!event.gamePlan || !Object.keys(event.gamePlan.lineups || {}).length) {
    throw new Error('No lineup draft is available to publish.');
  }

  const { teamId, id: gameId } = event;
  const currentTeamPlayers = await loadPlayers(teamId);
  const recipientPlayerIds = uniqueNonEmptyStrings(currentTeamPlayers.map((p: any) => p.id));
  const recipientParentIds = uniqueNonEmptyStrings(currentTeamPlayers.flatMap(getPlayerParentUserIds));

  const previousGamePlan = event.gamePlan;
  const nextGamePlan = buildLineupPublishPayload({
    previousGamePlan,
    publishedBy: user.uid,
    publishedByName: user.displayName || user.email || 'Coach',
    publishedAt: new Date(),
    recipientPlayerIds,
    recipientParentIds
  });

  const payload: Record<string, unknown> = {
    gamePlan: nextGamePlan
  };

  try {
    await withTimeout(Promise.resolve(updateGame(teamId, gameId, payload)), 'Lineup publish');
  } catch (error) {
    if (!isNativeRuntime()) throw error;
    console.warn('[schedule-service] Falling back to REST lineup publish updateGame:', error);
    await nativePatchDocument(`teams/${encodeURIComponent(teamId)}/games/${encodeURIComponent(gameId)}`, payload);
  }

  const changedAssignments = countLineupChanges(
    previousGamePlan?.publishedLineups,
    nextGamePlan.publishedLineups
  );

  let notificationError: string | null = null;
  try {
    await sendTeamChatMessage({
      teamId: event.teamId,
      user,
      profile: {
        fullName: user.displayName || null,
        photoUrl: user.photoUrl || null
      },
      text: buildLineupPublishMessage({
        opponentName: event.opponent || event.title || null,
        publishedVersion: nextGamePlan.publishedVersion,
        changedAssignments
      }),
      selectedConversationId: DEFAULT_TEAM_CONVERSATION_ID,
      selectedRecipientTarget: 'full_team',
      selectedRecipientIds: [],
      aiMeta: {
        type: 'lineup-published',
        gameId: event.id,
        publishedVersion: nextGamePlan.publishedVersion,
        changedAssignments,
        recipientPlayerIds,
        recipientParentIds
      }
    });
  } catch (error: any) {
    console.error('[schedule-service] Failed to send lineup published chat message:', error);
    notificationError = error?.message || 'Unknown chat notification error';
  }

  return { gamePlan: nextGamePlan, notificationError };
}


export type PublishScheduledGameLineupResult = {
  gamePlan: Record<string, unknown>;
  changedAssignments: number;
  notificationError: string | null;
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
  return typeof window !== 'undefined' && window.location.protocol === 'capacitor:';
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

export function parseRecurringPracticeOccurrenceId(eventId: string) {
  const normalizedEventId = compactString(eventId);
  if (!normalizedEventId || !normalizedEventId.includes('__')) return null;
  const [masterId, instanceDate] = normalizedEventId.split(/__(.+)/).filter(Boolean);
  if (!masterId || !instanceDate || !/^\d{4}-\d{2}-\d{2}$/.test(instanceDate)) return null;
  return { masterId, instanceDate };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }));

  return results;
}

export function normalizeGameScoreValue(value: unknown) {
  const parsed = Number.parseInt(String(value ?? 0), 10);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, parsed);
}

function formatCancelledGameDate(value: unknown) {
  const eventDate = normalizeScheduleDate(value);
  if (!eventDate) return 'date TBD';
  return eventDate.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  });
}

export function buildCancelScheduledGameChatMessage(event: Pick<ParentScheduleEvent, 'opponent' | 'title' | 'date'>, titleOverride?: string | null) {
  const title = compactString(titleOverride);
  const opponent = compactString(event.opponent);
  const opponentLabel = title || (opponent ? `vs. ${opponent}` : compactString(event.title) || 'Game');
  return `⚠️ Game cancelled: ${opponentLabel} on ${formatCancelledGameDate(event.date)}`;
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
        if (team?.id && isTeamActive(team) && isTeamStaff(team, user)) teamsById.set(team.id, team);
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
        if (team?.id && isTeamActive(team) && isTeamStaff(team, user)) teamsById.set(team.id, team);
      });
      return [...teamsById.values()];
    }
  );
}

async function saveTeamCalendarUrls(teamId: string, calendarUrls: string[]) {
  if (isNativeRuntime()) {
    await nativePatchDocument(`teams/${encodeURIComponent(teamId)}`, { calendarUrls });
    return;
  }
  await updateTeam(teamId, { calendarUrls });
}


export type ScheduleImportNormalizedRow = {
  rowNumber?: number;
  eventType: 'game' | 'practice';
  startsAt: string;
  endsAt?: string | null;
  opponent?: string | null;
  title?: string | null;
  location?: string | null;
  arrivalTime?: string | null;
  isHome?: boolean | null;
  notes?: string | null;
};

function requireScheduleImportStaff(teamId: string, user: AuthUser | null) {
  if (!user?.uid) {
    throw new Error('You need to sign in before importing schedule rows.');
  }
  return loadTeam(teamId).then((team) => {
    const teamWithId = team ? { ...team, id: team.id || teamId } : null;
    if (!teamWithId || !isTeamStaff(teamWithId, user)) {
      throw new Error('You do not have permission to manage this team schedule.');
    }
    return teamWithId;
  });
}

function parseScheduleImportDate(value: string | null | undefined, label: string) {
  const date = new Date(String(value || ''));
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${label} is invalid.`);
  }
  return date;
}

function buildScheduleImportGamePayload(row: ScheduleImportNormalizedRow, user: AuthUser) {
  const startDate = parseScheduleImportDate(row.startsAt, 'Start time');
  return {
    type: 'game',
    date: startDate,
    end: row.endsAt ? parseScheduleImportDate(row.endsAt, 'End time') : null,
    opponent: compactString(row.opponent),
    title: null,
    location: compactString(row.location),
    isHome: row.isHome === null || row.isHome === undefined ? null : row.isHome === true,
    arrivalTime: row.arrivalTime ? parseScheduleImportDate(row.arrivalTime, 'Arrival time') : null,
    notes: compactString(row.notes),
    assignments: [],
    status: 'scheduled',
    homeScore: 0,
    awayScore: 0,
    competitionType: 'league',
    countsTowardSeasonRecord: true,
    statTrackerConfigId: null,
    createdBy: user.uid
  };
}

function buildScheduleImportPracticePayload(row: ScheduleImportNormalizedRow, user: AuthUser) {
  const startDate = parseScheduleImportDate(row.startsAt, 'Start time');
  return {
    type: 'practice',
    title: compactString(row.title) || 'Practice',
    date: startDate,
    end: row.endsAt ? parseScheduleImportDate(row.endsAt, 'End time') : null,
    opponent: null,
    location: compactString(row.location),
    arrivalTime: row.arrivalTime ? parseScheduleImportDate(row.arrivalTime, 'Arrival time') : null,
    notes: compactString(row.notes),
    status: 'scheduled',
    homeScore: 0,
    awayScore: 0,
    statTrackerConfigId: null,
    createdBy: user.uid
  };
}

export async function createScheduleImportGame(teamId: string, row: ScheduleImportNormalizedRow, user: AuthUser | null) {
  const normalizedTeamId = compactString(teamId);
  if (!normalizedTeamId) throw new Error('Team is required.');
  await requireScheduleImportStaff(normalizedTeamId, user);
  const payload = buildScheduleImportGamePayload(row, user as AuthUser);
  if (!payload.opponent) throw new Error('Game rows require an opponent.');

  try {
    return await withTimeout(Promise.resolve(addGame(normalizedTeamId, payload)), 'Schedule import game create');
  } catch (error) {
    if (!isNativeRuntime()) throw error;
    console.warn('[schedule-service] Falling back to REST schedule import game create:', error);
    const doc = await nativeCreateDocument(`teams/${encodeURIComponent(normalizedTeamId)}/games`, {
      ...payload,
      createdAt: new Date()
    });
    return doc?.id || '';
  }
}

export async function createScheduleImportPractice(teamId: string, row: ScheduleImportNormalizedRow, user: AuthUser | null) {
  const normalizedTeamId = compactString(teamId);
  if (!normalizedTeamId) throw new Error('Team is required.');
  await requireScheduleImportStaff(normalizedTeamId, user);
  const payload = buildScheduleImportPracticePayload(row, user as AuthUser);

  try {
    return await withTimeout(Promise.resolve(addPractice(normalizedTeamId, payload)), 'Schedule import practice create');
  } catch (error) {
    if (!isNativeRuntime()) throw error;
    console.warn('[schedule-service] Falling back to REST schedule import practice create:', error);
    const doc = await nativeCreateDocument(`teams/${encodeURIComponent(normalizedTeamId)}/games`, {
      ...payload,
      createdAt: new Date()
    });
    return doc?.id || '';
  }
}

export async function addTeamCalendarUrl(teamId: string, url: string, user: AuthUser | null) {
  const normalizedTeamId = compactString(teamId);
  if (!normalizedTeamId) {
    throw new Error('Team is required.');
  }
  if (!user?.uid) {
    throw new Error('You need to sign in before adding a calendar.');
  }

  const validation = validateExternalCalendarUrl(url);
  if (!validation.valid) {
    throw new Error(validation.error || 'Enter a valid .ics calendar URL.');
  }

  const team = await loadTeam(normalizedTeamId);
  const teamWithId = team ? { ...team, id: team.id || normalizedTeamId } : null;
  if (!teamWithId || !isTeamStaff(teamWithId, user)) {
    throw new Error('You do not have permission to manage this team schedule.');
  }

  const existingUrls = Array.isArray(teamWithId.calendarUrls)
    ? teamWithId.calendarUrls.map(compactString).filter(Boolean)
    : [];
  if (existingUrls.includes(validation.url)) {
    return { calendarUrls: existingUrls, added: false };
  }

  const calendarUrls = [...existingUrls, validation.url];
  await saveTeamCalendarUrls(normalizedTeamId, calendarUrls);
  return { calendarUrls, added: true };
}

export async function removeTeamCalendarUrl(teamId: string, url: string, user: AuthUser | null) {
  const normalizedTeamId = compactString(teamId);
  if (!normalizedTeamId) {
    throw new Error('Team is required.');
  }
  if (!user?.uid) {
    throw new Error('You need to sign in before removing a calendar.');
  }

  const normalizedUrl = compactString(url);
  if (!normalizedUrl) {
    throw new Error('Calendar URL is required.');
  }

  const team = await loadTeam(normalizedTeamId);
  const teamWithId = team ? { ...team, id: team.id || normalizedTeamId } : null;
  if (!teamWithId || !isTeamStaff(teamWithId, user)) {
    throw new Error('You do not have permission to manage this team schedule.');
  }

  const existingUrls = Array.isArray(teamWithId.calendarUrls)
    ? teamWithId.calendarUrls.map(compactString).filter(Boolean)
    : [];
  const calendarUrls = existingUrls.filter((calendarUrl: string) => calendarUrl !== normalizedUrl);
  if (calendarUrls.length === existingUrls.length) {
    return { calendarUrls: existingUrls, removed: false };
  }

  await saveTeamCalendarUrls(normalizedTeamId, calendarUrls);
  return { calendarUrls, removed: true };
}

async function loadPlayers(teamId: string) {
  return readWithNativeFallback(
    `players ${teamId}`,
    () => Promise.resolve(getPlayers(teamId, { includeInactive: true })),
    () => nativeListCollection(`teams/${encodeURIComponent(teamId)}/players`)
  );
}

function normalizePlayerName(player: any) {
  return compactString(player?.name || player?.displayName || player?.playerName) || 'Player';
}

function normalizePlayerNumber(player: any) {
  return compactString(player?.number ?? player?.num ?? player?.jerseyNumber ?? player?.playerNumber ?? '');
}

function isActiveRosterPlayer(player: any) {
  return player?.active !== false && player?.archived !== true && (!player?.status || player.status === 'active');
}

async function loadAggregatedStats(teamId: string, gameId: string) {
  return readWithNativeFallback(
    `aggregated stats ${teamId}/${gameId}`,
    async () => {
      const snapshot = await getDocs(collection(db, `teams/${teamId}/games/${gameId}/aggregatedStats`));
      return snapshot.docs.map((docSnap: any) => ({ id: docSnap.id, ...(docSnap.data() || {}) }));
    },
    () => nativeListCollection(`teams/${encodeURIComponent(teamId)}/games/${encodeURIComponent(gameId)}/aggregatedStats`)
  );
}

export async function loadHomeScoringPlayers(teamId: string, gameId: string): Promise<ScheduleHomeScoringPlayer[]> {
  if (!teamId || !gameId) return [];
  const [players, statRows] = await Promise.all([
    loadPlayers(teamId),
    loadAggregatedStats(teamId, gameId).catch(() => [])
  ]);
  const statsByPlayerId = new Map((statRows || []).map((row: any) => [String(row.id || ''), row?.stats || {}]));
  return (Array.isArray(players) ? players : [])
    .filter(isActiveRosterPlayer)
    .map((player: any) => {
      const id = compactString(player?.id);
      if (!id) return null;
      const stats = (statsByPlayerId.get(id) || {}) as Record<string, unknown>;
      return {
        id,
        name: normalizePlayerName(player),
        number: normalizePlayerNumber(player),
        points: normalizeGameScoreValue(stats.pts)
      };
    })
    .filter(Boolean) as ScheduleHomeScoringPlayer[];
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

function getTrackedCalendarEventUidsFromLoadedGames(games: any[] = []) {
  return (Array.isArray(games) ? games : [])
    .map((game) => compactString(game?.calendarEventUid))
    .filter(Boolean);
}

async function loadTeam(teamId: string) {
  const team = await readWithNativeFallback(
    `team ${teamId}`,
    () => Promise.resolve(getTeam(teamId)),
    () => nativeGetDocument(`teams/${encodeURIComponent(teamId)}`)
  );
  return isTeamActive(team as Record<string, any> | null) ? team : null;
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

async function loadGameById(teamId: string, gameId: string) {
  return readWithNativeFallback(
    `game ${teamId}/${gameId}`,
    () => Promise.resolve(getGame(teamId, gameId)),
    () => nativeGetDocument(`teams/${encodeURIComponent(teamId)}/games/${encodeURIComponent(gameId)}`)
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

async function loadPracticeSessionByEventId(teamId: string, eventId: string) {
  return readWithNativeFallback(
    `practice session ${teamId}/${eventId}`,
    () => Promise.resolve(getPracticeSessionByEvent(teamId, eventId)),
    async () => {
      const sessions = await nativeListCollection(`teams/${encodeURIComponent(teamId)}/practiceSessions`);
      return sessions.find((session) => compactString(session?.eventId) === eventId) || null;
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
  opponentTeamId?: string | null;
  opponentTeamName?: string | null;
  opponentTeamPhoto?: string | null;
  sharedScheduleOpponentTeamId?: string | null;
  counterpartTitle?: string | null;
  title?: string | null;
  isDbGame: boolean;
  isCancelled?: boolean;
  status?: string | null;
  liveStatus?: string | null;
  liveClockMs?: unknown;
  liveClockRunning?: unknown;
  liveClockPeriod?: string | null;
  liveClockUpdatedAt?: unknown;
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
  gamePlan?: Record<string, any> | null;
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
    opponentTeamId: compactString(input.opponentTeamId) || null,
    opponentTeamName: input.opponentTeamName || null,
    opponentTeamPhoto: input.opponentTeamPhoto || null,
    sharedScheduleOpponentTeamId: compactString(input.sharedScheduleOpponentTeamId) || null,
    counterpartTitle: compactString(input.counterpartTitle) || null,
    title: input.title || null,
    childId: input.child.playerId,
    childName: input.child.playerName,
    isDbGame: input.isDbGame,
    isCancelled: input.isCancelled === true,
    status: input.status || null,
    liveStatus: input.liveStatus || null,
    liveClockMs: toNullableScore(input.liveClockMs),
    liveClockRunning: typeof input.liveClockRunning === 'boolean' ? input.liveClockRunning : null,
    liveClockPeriod: input.liveClockPeriod || null,
    liveClockUpdatedAt: normalizeScheduleDate(input.liveClockUpdatedAt),
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
    isTeamAdmin: input.isTeamAdmin === true,
    isTeamStaff: input.isTeamStaff === true,
    isTeamRsvpReminderManager: input.isTeamRsvpReminderManager === true,
    gamePlan: input.gamePlan || null
  };
}

async function buildTeamSchedule(teamId: string, teamChildren: ParentScheduleChild[], user: AuthUser) {
  const events: ParentScheduleEvent[] = [];
  const [team, dbGames, practiceSessions] = await Promise.all([
    loadTeam(teamId),
    loadGames(teamId),
    loadPracticeSessions(teamId)
  ]);
  if (!team) return events;
  const trackedUids = getTrackedCalendarEventUidsFromLoadedGames(dbGames || []);

  const teamName = compactString(team.name) || teamId;
  const teamWithId = { ...team, id: team.id || teamId };
  const calendarUrls = Array.isArray(team.calendarUrls) ? team.calendarUrls.map(compactString).filter(Boolean) : [];
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
            liveClockMs: game.liveClockMs ?? null,
            liveClockRunning: game.liveClockRunning ?? null,
            liveClockPeriod: game.liveClockPeriod || null,
            liveClockUpdatedAt: game.liveClockUpdatedAt || null,
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
            isTeamAdmin: isRsvpReminderManager,
            isTeamStaff: isStaff,
            isTeamRsvpReminderManager: isRsvpReminderManager,
            gamePlan: game.gamePlan || null
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
          opponentTeamId: game.opponentTeamId || null,
          opponentTeamName: game.opponentTeamName || game.awayTeamName || null,
          opponentTeamPhoto: game.opponentTeamPhoto || null,
          sharedScheduleOpponentTeamId: game.sharedScheduleOpponentTeamId || null,
          counterpartTitle: teamName ? `vs. ${teamName}` : null,
          title: game.title || null,
          isDbGame: true,
          isCancelled,
          status: game.status || null,
          liveStatus: game.liveStatus || null,
          liveClockMs: game.liveClockMs ?? null,
          liveClockRunning: game.liveClockRunning ?? null,
          liveClockPeriod: game.liveClockPeriod || null,
          liveClockUpdatedAt: game.liveClockUpdatedAt || null,
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
          isTeamAdmin: isRsvpReminderManager,
          isTeamStaff: isStaff,
          isTeamRsvpReminderManager: isRsvpReminderManager,
          gamePlan: game.gamePlan || null
        }));
      });
    }
  }

  if (calendarUrls.length > 0) {
    const calendarResults = await Promise.all(calendarUrls.map(async (calendarUrl: string) => {
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
          isTeamAdmin: isRsvpReminderManager,
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
          isTeamAdmin: isRsvpReminderManager,
          isTeamStaff: isStaff,
          isTeamRsvpReminderManager: isRsvpReminderManager
        }));
      });
    });

  events.forEach((event) => {
    event.calendarUrls = calendarUrls;
  });

  return events;
}

async function buildTargetedTeamScheduleEvent(teamId: string, eventId: string, teamChildren: ParentScheduleChild[], user: AuthUser) {
  const [team, game] = await Promise.all([
    loadTeam(teamId),
    loadGameById(teamId, eventId)
  ]);
  if (!team || !game) return [];
  if (game.type === 'practice' && game.isSeriesMaster && game.recurrence) return [];

  const teamName = compactString(team.name) || teamId;
  const teamWithId = { ...team, id: team.id || teamId };
  const isPractice = game.type === 'practice';
  const type = isPractice ? 'practice' : 'game';
  const availabilityPreferences = normalizeAvailabilityPreferences(team.availabilityPreferences);
  const isStaff = isTeamStaff(teamWithId, user);
  const isRsvpReminderManager = isPublicRsvpReminderManager(teamWithId, user);
  const session = isPractice ? await loadPracticeSessionByEventId(teamId, eventId).catch(() => null) : null;
  const date = toEventDate(game.date);
  const normalizedId = compactString(game.id || game.gameId || eventId);
  const isCancelled = game.status === 'cancelled';
  if (!normalizedId) return [];

  teamChildren.forEach((child) => {
    child.teamName = child.teamName || teamName;
  });

  return teamChildren.map((child) => createScheduleEvent({
    teamId,
    teamName,
    child,
    id: normalizedId,
    type,
    date,
    endDate: game.endDate || game.end || game.endTime || null,
    location: game.location || 'TBD',
    opponent: game.opponent || 'TBD',
    opponentTeamId: game.opponentTeamId || null,
    opponentTeamName: game.opponentTeamName || game.awayTeamName || null,
    opponentTeamPhoto: game.opponentTeamPhoto || null,
    sharedScheduleOpponentTeamId: game.sharedScheduleOpponentTeamId || null,
    counterpartTitle: teamName ? `vs. ${teamName}` : null,
    title: game.title || null,
    isDbGame: true,
    isCancelled,
    status: game.status || null,
    liveStatus: game.liveStatus || null,
    liveClockMs: game.liveClockMs ?? null,
    liveClockRunning: game.liveClockRunning ?? null,
    liveClockPeriod: game.liveClockPeriod || null,
    liveClockUpdatedAt: game.liveClockUpdatedAt || null,
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
    isTeamAdmin: isRsvpReminderManager,
    isTeamStaff: isStaff,
    isTeamRsvpReminderManager: isRsvpReminderManager,
    gamePlan: game.gamePlan || null
  }));
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

export async function hydrateParentScheduleDetails(schedule: ParentScheduleLoadResult, user: AuthUser | null): Promise<ParentScheduleLoadResult> {
  if (!user?.uid || !schedule.events.length) {
    return schedule;
  }
  await hydrateEventDetails(schedule.events, user);
  return schedule;
}

async function buildParentScheduleTeamChildren(user: AuthUser, profile: Record<string, unknown>, options: ParentScheduleLoadOptions = {}) {
  const expandStaffPlayers = options.expandStaffPlayers !== false;
  const children = normalizeChildLinks(user, profile as Record<string, unknown>);
  const byTeam = new Map<string, ParentScheduleChild[]>();
  children.forEach((child) => {
    if (!byTeam.has(child.teamId)) byTeam.set(child.teamId, []);
    byTeam.get(child.teamId)?.push(child);
  });

  const staffTeams = await loadStaffTeams(user).catch(() => []);
  await mapWithConcurrency(staffTeams, parentScheduleTeamConcurrency, async (team: any) => {
    const teamId = compactString(team?.id);
    if (!teamId) return;
    const teamName = compactString(team?.name) || teamId;
    const existingPlayerIds = new Set((byTeam.get(teamId) || []).map((child) => child.playerId));
    if (!expandStaffPlayers) {
      if (!existingPlayerIds.size) {
        byTeam.set(teamId, [{
          teamId,
          teamName,
          playerId: `staff-team-${teamId}`,
          playerName: 'Team schedule'
        }]);
      }
      return;
    }
    const players = await loadPlayers(teamId).catch(() => []);
    const staffChildren = (Array.isArray(players) ? players : [])
      .filter((player: any) => player?.active !== false && compactString(player?.id) && !existingPlayerIds.has(compactString(player.id)))
      .map((player: any) => ({
        teamId,
        teamName,
        playerId: compactString(player.id),
        playerName: compactString(player.name) || compactString(player.displayName) || 'Player'
      }));
    if (staffChildren.length) {
      byTeam.set(teamId, [...(byTeam.get(teamId) || []), ...staffChildren]);
    }
  });

  return { children, byTeam, staffTeams };
}

export async function loadParentScheduleEventDetail(user: AuthUser | null, options: ParentScheduleEventDetailLoadOptions): Promise<ParentScheduleLoadResult> {
  const requestedTeamId = compactString(options?.teamId);
  const requestedEventId = compactString(options?.eventId);

  if (!user?.uid || !requestedTeamId || !requestedEventId) {
    return { children: [], events: [] };
  }

  const timer = startUxTimer('parent schedule event detail load');
  const hydrateDetails = options.hydrateDetails !== false;
  const expandStaffPlayers = options.expandStaffPlayers === true;

  try {
    const profile = await loadProfileDocument(user.uid);
    const { children, byTeam, staffTeams } = await buildParentScheduleTeamChildren(user, profile as Record<string, unknown>, { expandStaffPlayers });
    const teamChildren = byTeam.get(requestedTeamId) || [];

    if (!teamChildren.length) {
      timer.end({ hydrateDetails, expandStaffPlayers, teamId: requestedTeamId, eventId: requestedEventId, childLinks: children.length, teams: byTeam.size, staffTeams: staffTeams.length, eventRows: 0 });
      return { children, events: [] };
    }

    let fallback = false;
    let teamEventRows: number | undefined;
    let events = await buildTargetedTeamScheduleEvent(requestedTeamId, requestedEventId, teamChildren, user);
    if (!events.length) {
      fallback = true;
      const teamEvents = await buildTeamSchedule(requestedTeamId, teamChildren, user);
      teamEventRows = teamEvents.length;
      events = teamEvents.filter((event) => event.id === requestedEventId);
    }
    if (hydrateDetails && events.length) {
      await hydrateEventDetails(events, user);
    }
    timer.end({
      hydrateDetails,
      expandStaffPlayers,
      teamId: requestedTeamId,
      eventId: requestedEventId,
      childLinks: children.length,
      teams: byTeam.size,
      staffTeams: staffTeams.length,
      teamEventRows,
      eventRows: events.length,
      fallback
    });
    return { children, events };
  } catch (error: any) {
    timer.end({ hydrateDetails, expandStaffPlayers, teamId: requestedTeamId, eventId: requestedEventId, error: error?.message || 'Unable to load schedule event detail.' });
    throw error;
  }
}

export async function loadParentPlayerSchedule(user: AuthUser | null, options: ParentPlayerScheduleLoadOptions): Promise<ParentScheduleLoadResult> {
  const requestedTeamId = compactString(options?.teamId);
  const requestedPlayerId = compactString(options?.playerId);

  if (!user?.uid || !requestedPlayerId) {
    return { children: [], events: [] };
  }

  const timer = startUxTimer('parent player schedule load');
  const hydrateDetails = options.hydrateDetails !== false;

  try {
    const profile = await loadProfileDocument(user.uid);
    const children = normalizeChildLinks(user, profile as Record<string, unknown>);
    const child = (requestedTeamId && requestedPlayerId)
      ? children.find((entry) => entry.teamId === requestedTeamId && entry.playerId === requestedPlayerId)
      : children.find((entry) => entry.playerId === requestedPlayerId);

    if (!child) {
      timer.end({ hydrateDetails, teamId: requestedTeamId || null, playerId: requestedPlayerId, childLinks: children.length, eventRows: 0 });
      return { children, events: [] };
    }

    const events = await buildTeamSchedule(child.teamId, [child], user);
    if (hydrateDetails && events.length) {
      await hydrateEventDetails(events, user);
    }
    timer.end({
      hydrateDetails,
      requestedTeamId: requestedTeamId || null,
      resolvedTeamId: child.teamId,
      playerId: child.playerId,
      childLinks: children.length,
      eventRows: events.length
    });
    return { children, events };
  } catch (error: any) {
    timer.end({ hydrateDetails, teamId: requestedTeamId || null, playerId: requestedPlayerId, error: error?.message || 'Unable to load player schedule.' });
    throw error;
  }
}

export async function resolveParentGameRoute(user: AuthUser | null, gameId: string, options: ParentScheduleLoadOptions = {}): Promise<ParentGameRouteResolution | null> {
  const requestedGameId = compactString(gameId);

  if (!user?.uid || !requestedGameId) {
    return null;
  }

  const timer = startUxTimer('parent game route resolve');
  const expandStaffPlayers = options.expandStaffPlayers === true;

  try {
    const profile = await loadProfileDocument(user.uid);
    const { children, byTeam, staffTeams } = await buildParentScheduleTeamChildren(user, profile as Record<string, unknown>, { expandStaffPlayers });
    const teamEntries = [...byTeam.entries()];

    const matches = await mapWithConcurrency(teamEntries, parentScheduleTeamConcurrency, async ([teamId, teamChildren]) => {
      try {
        const game = await loadGameById(teamId, requestedGameId);
        const eventId = compactString(game?.id || game?.gameId || requestedGameId);
        if (!game || eventId !== requestedGameId) return null;
        const childId = (teamChildren || [])
          .map((child) => compactString(child?.playerId))
          .find((value) => value && !value.startsWith(`staff-team-${teamId}`)) || null;
        return {
          teamId,
          eventId,
          childId
        };
      } catch (error) {
        console.warn('[schedule-service] Failed to resolve game route for team:', teamId, error);
        return null;
      }
    });

    const resolution = matches.find(Boolean) || null;
    timer.end({ gameId: requestedGameId, expandStaffPlayers, childLinks: children.length, teams: byTeam.size, staffTeams: staffTeams.length, matched: Boolean(resolution) });
    return resolution;
  } catch (error: any) {
    timer.end({ gameId: requestedGameId, expandStaffPlayers, error: error?.message || 'Unable to resolve game route.' });
    throw error;
  }
}

export async function loadParentSchedule(user: AuthUser | null, options: ParentScheduleLoadOptions = {}): Promise<ParentScheduleLoadResult> {
  if (!user?.uid) {
    return { children: [], events: [] };
  }
  const timer = startUxTimer('parent schedule service load');
  const hydrateDetails = options.hydrateDetails !== false;
  const expandStaffPlayers = options.expandStaffPlayers !== false;

  try {
    const profile = await loadProfileDocument(user.uid);
    const { children, byTeam, staffTeams } = await buildParentScheduleTeamChildren(user, profile as Record<string, unknown>, { expandStaffPlayers });

    const teamEntries = [...byTeam.entries()];
    const eventBatches = await mapWithConcurrency(teamEntries, parentScheduleTeamConcurrency, async ([teamId, teamChildren]) => {
      try {
        return await buildTeamSchedule(teamId, teamChildren, user);
      } catch (error) {
        console.warn('[schedule-service] Failed to load team schedule:', teamId, error);
        return [];
      }
    });

    const events = eventBatches.flat().sort((a, b) => a.date.getTime() - b.date.getTime());
    if (hydrateDetails) {
      await hydrateEventDetails(events, user);
    }
    timer.end({
      hydrateDetails,
      expandStaffPlayers,
      childLinks: children.length,
      teams: byTeam.size,
      staffTeams: staffTeams.length,
      eventRows: events.length
    });
    return { children, events };
  } catch (error: any) {
    timer.end({ hydrateDetails, expandStaffPlayers, error: error?.message || 'Unable to load parent schedule.' });
    throw error;
  }
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

function assertStaffRsvpManagementEvent(event: ParentScheduleEvent, user: AuthUser | null) {
  if (!event.isDbGame) {
    throw new Error('Availability opens after this event is tracked in the schedule.');
  }
  if (!user?.uid) {
    throw new Error('Sign in before managing player RSVPs.');
  }
  if (!event.isTeamAdmin) {
    throw new Error('Only team owners and admins can manage player RSVPs.');
  }
}

function normalizeStaffScheduleRsvpBreakdown(value: any): StaffScheduleRsvpBreakdown {
  const grouped = value?.grouped || {};
  const normalizeRows = (rows: any[], fallbackResponse: RsvpResponse): StaffScheduleRsvpRow[] => (
    Array.isArray(rows)
      ? rows.map((row) => ({
        playerId: compactString(row?.playerId),
        playerName: compactString(row?.playerName) || 'Player',
        playerNumber: compactString(row?.playerNumber ?? ''),
        response: normalizeRsvpResponse(row?.response || fallbackResponse),
        respondedAt: row?.respondedAt || null,
        note: compactString(row?.note) || null,
        responderUserId: compactString(row?.responderUserId) || null
      })).filter((row) => row.playerId)
      : []
  );

  const normalizedGrouped = {
    going: normalizeRows(grouped.going, 'going'),
    maybe: normalizeRows(grouped.maybe, 'maybe'),
    not_going: normalizeRows(grouped.not_going, 'not_going'),
    not_responded: normalizeRows(grouped.not_responded, 'not_responded')
  };

  return {
    grouped: normalizedGrouped,
    counts: {
      going: normalizedGrouped.going.length,
      maybe: normalizedGrouped.maybe.length,
      notGoing: normalizedGrouped.not_going.length,
      notResponded: normalizedGrouped.not_responded.length,
      total: normalizedGrouped.going.length + normalizedGrouped.maybe.length + normalizedGrouped.not_going.length + normalizedGrouped.not_responded.length
    }
  };
}

export async function loadStaffScheduleRsvpBreakdown(event: ParentScheduleEvent, user: AuthUser | null): Promise<StaffScheduleRsvpBreakdown> {
  assertStaffRsvpManagementEvent(event, user);

  try {
    const breakdown = await withTimeout(Promise.resolve(getRsvpBreakdownByPlayer(event.teamId, event.id)), 'Staff RSVP breakdown');
    return normalizeStaffScheduleRsvpBreakdown(breakdown);
  } catch (error) {
    if (!isNativeRuntime()) throw error;
    console.warn('[schedule-service] Falling back to REST RSVP breakdown load:', error);
    const [players, rsvps] = await Promise.all([
      loadPlayers(event.teamId),
      loadRsvps(event.teamId, event.id)
    ]);
    return normalizeStaffScheduleRsvpBreakdown(buildGameDayRsvpBreakdown({ players, rsvps }));
  }
}

export async function submitStaffScheduleRsvpOverride(event: ParentScheduleEvent, user: AuthUser | null, playerId: string, response: Exclude<RsvpResponse, 'not_responded'>) {
  assertStaffRsvpManagementEvent(event, user);
  const normalizedPlayerId = compactString(playerId);
  if (!normalizedPlayerId) {
    throw new Error('Select a player before updating the RSVP.');
  }
  if (event.isCancelled) {
    throw new Error('Cancelled events cannot be updated.');
  }
  if (event.availabilityLocked) {
    throw new Error('Availability is locked for this event.');
  }

  try {
    await withTimeout(Promise.resolve(submitRsvpForPlayer(event.teamId, event.id, user!.uid, {
      displayName: user!.displayName || user!.email,
      playerId: normalizedPlayerId,
      response,
      note: null
    })), 'Staff RSVP override');
  } catch (error) {
    if (!isNativeRuntime()) throw error;
    console.warn('[schedule-service] Falling back to REST staff RSVP override:', error);
    await nativeSubmitRsvpForPlayer(event.teamId, event.id, user!, normalizedPlayerId, response);
  }

  return {
    playerId: normalizedPlayerId,
    response
  };
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

function buildLiveScoreUpdateDescription(score: GameScoreSnapshot) {
  return `Score update: Home ${normalizeGameScoreValue(score.homeScore)}, Away ${normalizeGameScoreValue(score.awayScore)}.`;
}

export async function publishLiveScoreUpdateEvent(teamId: string, gameId: string, score: GameScoreSnapshot, user: AuthUser, previousScore?: Partial<GameScoreSnapshot> | null) {
  if (!teamId || !gameId) {
    throw new Error('A scheduled game is required before posting live play-by-play.');
  }
  if (!user?.uid) {
    throw new Error('Sign in before posting live play-by-play.');
  }

  const payload = {
    type: 'score_update',
    description: buildLiveScoreUpdateDescription(score),
    homeScore: normalizeGameScoreValue(score.homeScore),
    awayScore: normalizeGameScoreValue(score.awayScore),
    previousHomeScore: previousScore?.homeScore !== undefined ? normalizeGameScoreValue(previousScore.homeScore) : null,
    previousAwayScore: previousScore?.awayScore !== undefined ? normalizeGameScoreValue(previousScore.awayScore) : null,
    createdBy: user.uid,
    createdByName: user.displayName || user.email || 'Staff',
    createdAt: new Date()
  };

  try {
    await withTimeout(Promise.resolve(broadcastLiveEvent(teamId, gameId, payload)), 'Live score event');
  } catch (error) {
    if (!isNativeRuntime()) throw error;
    console.warn('[schedule-service] Falling back to REST live score event publish:', error);
    await nativeCreateDocument(`teams/${encodeURIComponent(teamId)}/games/${encodeURIComponent(gameId)}/liveEvents`, payload);
  }

  return payload;
}

export function buildPlayerScoringLiveEvent({
  playerId,
  playerName,
  playerNumber,
  statKey,
  value,
  homeScore,
  awayScore,
  user
}: {
  playerId: string;
  playerName: string;
  playerNumber: string;
  statKey: 'pts';
  value: 2;
  homeScore: number;
  awayScore: number;
  user: AuthUser;
}) {
  const identity = playerNumber ? `#${playerNumber} ${playerName}` : playerName;
  return {
    type: 'stat',
    playerId,
    playerName,
    playerNumber,
    statKey,
    value,
    isOpponent: false,
    description: `${identity} scored ${value} points.`,
    homeScore: normalizeGameScoreValue(homeScore),
    awayScore: normalizeGameScoreValue(awayScore),
    createdBy: user.uid,
    createdByName: user.displayName || user.email || 'Staff',
    createdAt: serverTimestamp()
  };
}

export async function recordPlayerScoringStat(teamId: string, gameId: string, playerId: string, stat: PlayerScoringStatInput, user: AuthUser): Promise<PlayerScoringStatResult> {
  if (!teamId || !gameId) {
    throw new Error('A scheduled game is required before recording player scoring.');
  }
  if (!playerId) {
    throw new Error('Select a player before recording player scoring.');
  }
  if (!user?.uid) {
    throw new Error('Sign in before recording player scoring.');
  }
  if (stat?.statKey !== 'pts' || stat?.value !== 2) {
    throw new Error('Only the +2 player scoring action is supported here.');
  }

  const playerName = compactString(stat.playerName) || 'Player';
  const playerNumber = compactString(stat.playerNumber);
  const teamSide = stat.teamSide === 'away' ? 'away' : 'home';
  const gamePath = `teams/${teamId}/games/${gameId}`;
  const statsPath = `${gamePath}/aggregatedStats/${playerId}`;
  const liveEventsPath = `${gamePath}/liveEvents`;

  try {
    return await withTimeout(runTransaction(db, async (transaction: any) => {
      const gameRef = doc(db, gamePath);
      const statsRef = doc(db, statsPath);
      const eventRef = doc(collection(db, liveEventsPath));
      const [gameSnap, statsSnap] = await Promise.all([
        transaction.get(gameRef),
        transaction.get(statsRef)
      ]);
      const gameData = gameSnap.exists?.() ? gameSnap.data() || {} : {};
      const statsData = statsSnap.exists?.() ? statsSnap.data() || {} : {};
      const awayScore = normalizeGameScoreValue(gameData.awayScore) + (teamSide === 'away' ? 2 : 0);
      const homeScore = normalizeGameScoreValue(gameData.homeScore) + (teamSide === 'home' ? 2 : 0);
      const playerPoints = normalizeGameScoreValue(statsData?.stats?.pts) + 2;
      const scoreUpdatedAt = new Date();
      const liveEvent = buildPlayerScoringLiveEvent({ playerId, playerName, playerNumber, statKey: 'pts', value: 2, homeScore, awayScore, user });

      transaction.set(gameRef, {
        homeScore,
        awayScore,
        scoreUpdatedAt,
        scoreUpdatedBy: user.uid
      }, { merge: true });
      transaction.set(statsRef, {
        playerName,
        playerNumber,
        stats: { pts: increment(2) }
      }, { merge: true });
      transaction.set(eventRef, liveEvent);

      return {
        homeScore,
        awayScore,
        playerId,
        playerName,
        playerNumber,
        statKey: 'pts',
        value: 2,
        playerPoints,
        liveEvent
      };
    }), 'Player scoring stat');
  } catch (error) {
    if (!isNativeRuntime()) throw error;
    console.warn('[schedule-service] Falling back to REST player scoring stat:', error);
    const [gameDoc, statsDoc] = await Promise.all([
      nativeGetDocument(`teams/${encodeURIComponent(teamId)}/games/${encodeURIComponent(gameId)}`),
      nativeGetDocument(`teams/${encodeURIComponent(teamId)}/games/${encodeURIComponent(gameId)}/aggregatedStats/${encodeURIComponent(playerId)}`)
    ]);
    const awayScore = normalizeGameScoreValue(gameDoc?.awayScore) + (teamSide === 'away' ? 2 : 0);
    const homeScore = normalizeGameScoreValue(gameDoc?.homeScore) + (teamSide === 'home' ? 2 : 0);
    const existingStats = { ...((statsDoc?.stats || {}) as Record<string, unknown>) };
    const playerPoints = normalizeGameScoreValue(existingStats.pts) + 2;
    existingStats.pts = playerPoints;
    const scoreUpdatedAt = new Date();
    const liveEvent = buildPlayerScoringLiveEvent({ playerId, playerName, playerNumber, statKey: 'pts', value: 2, homeScore, awayScore, user });

    await nativePatchDocument(`teams/${encodeURIComponent(teamId)}/games/${encodeURIComponent(gameId)}`, {
      homeScore,
      awayScore,
      scoreUpdatedAt,
      scoreUpdatedBy: user.uid
    });
    await nativePatchDocument(`teams/${encodeURIComponent(teamId)}/games/${encodeURIComponent(gameId)}/aggregatedStats/${encodeURIComponent(playerId)}`, {
      playerName,
      playerNumber,
      stats: existingStats
    });
    await nativeCreateDocument(`teams/${encodeURIComponent(teamId)}/games/${encodeURIComponent(gameId)}/liveEvents`, {
      ...liveEvent,
      createdAt: scoreUpdatedAt
    });

    return {
      homeScore,
      awayScore,
      playerId,
      playerName,
      playerNumber,
      statKey: 'pts',
      value: 2,
      playerPoints,
      liveEvent
    };
  }
}

function assertStaffRsvpReminderEvent(event: ParentScheduleEvent, user: AuthUser | null) {
  if (!user?.uid) throw new Error('Sign in before sending RSVP reminders.');
  if (!event.isTeamRsvpReminderManager) throw new Error('Only team owners and admins can send RSVP reminders.');
  if (!event.isDbGame) throw new Error('RSVP reminders are available only for schedule events.');
  if (event.isCancelled) throw new Error('RSVP reminders are unavailable for cancelled events.');
}

async function loadStaffRsvpReminderData(event: ParentScheduleEvent) {
  const { players, rsvps } = await getRsvpBreakdownByPlayer(event.teamId, event.id);
  return { players, rsvps };
}

export async function loadStaffRsvpReminderPreview(event: ParentScheduleEvent, user: AuthUser | null): Promise<StaffRsvpReminderPreview> {
  assertStaffRsvpReminderEvent(event, user);
  const { players, rsvps } = await loadStaffRsvpReminderData(event);
  return buildStaffRsvpReminderPreview(players, rsvps);
}

export function createStaffRsvpReminderPreviewLoader() {
  const playersByTeamId = new Map<string, Promise<any[]>>();
  const previewByEventKey = new Map<string, Promise<StaffRsvpReminderPreview>>();

  const getPlayersForTeam = (teamId: string) => {
    const normalizedTeamId = compactString(teamId);
    if (!normalizedTeamId) return Promise.resolve([]);
    const existing = playersByTeamId.get(normalizedTeamId);
    if (existing) return existing;
    const nextLoad = loadPlayers(normalizedTeamId).catch((error) => {
      playersByTeamId.delete(normalizedTeamId);
      throw error;
    });
    playersByTeamId.set(normalizedTeamId, nextLoad);
    return nextLoad;
  };

  return {
    async loadPreview(event: ParentScheduleEvent, user: AuthUser | null): Promise<StaffRsvpReminderPreview> {
      assertStaffRsvpReminderEvent(event, user);
      const previewKey = `${compactString(event.teamId)}:${compactString(event.id)}`;
      const existing = previewByEventKey.get(previewKey);
      if (existing) return existing;
      const nextLoad = Promise.all([
        getPlayersForTeam(event.teamId),
        loadRsvps(event.teamId, event.id)
      ])
        .then(([players, rsvps]) => buildStaffRsvpReminderPreview(players, rsvps))
        .catch((error) => {
          previewByEventKey.delete(previewKey);
          throw error;
        });
      previewByEventKey.set(previewKey, nextLoad);
      return nextLoad;
    }
  };
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

export async function cancelScheduledGameForApp(event: ParentScheduleEvent, user: AuthUser): Promise<CancelScheduledGameResult> {
  if (!event?.teamId || !event?.id || !event.isDbGame || event.type !== 'game') {
    throw new Error('A scheduled game is required before cancelling.');
  }
  if (event.isCancelled) {
    throw new Error('This game is already cancelled.');
  }
  if (!user?.uid) {
    throw new Error('Sign in before cancelling the game.');
  }
  if (!event.canUpdateScore) {
    throw new Error('Coach or admin access is required to cancel this game.');
  }

  const payload: Record<string, unknown> = {
    status: 'cancelled',
    cancelledAt: new Date(),
    cancelledBy: user.uid
  };

  try {
    await withTimeout(Promise.resolve(updateGame(event.teamId, event.id, payload)), 'Game cancellation');
  } catch (error) {
    if (!isNativeRuntime()) throw error;
    console.warn('[schedule-service] Falling back to REST game cancellation:', error);
    await nativePatchDocument(`teams/${encodeURIComponent(event.teamId)}/games/${encodeURIComponent(event.id)}`, payload);
  }

  const notificationFailures: string[] = [];
  const { postChatMessage } = await import('../../../../js/db.js');
  const senderName = user.displayName || user.email;
  const senderEmail = user.email;
  const counterpartTeamId = compactString(event.opponentTeamId || event.sharedScheduleOpponentTeamId) || null;

  try {
    await postChatMessage(event.teamId, {
      text: buildCancelScheduledGameChatMessage(event),
      senderId: user.uid,
      senderName,
      senderEmail
    });
  } catch (error: any) {
    notificationFailures.push(error?.message || 'Team chat notification failed.');
  }

  if (counterpartTeamId && counterpartTeamId !== event.teamId) {
    try {
      await postSharedGameCancellationNotification({
        teamId: event.teamId,
        gameId: event.id,
        counterpartTeamId,
        text: buildCancelScheduledGameChatMessage(event, event.counterpartTitle),
        senderName,
        senderEmail
      });
    } catch (error: any) {
      notificationFailures.push(error?.message || 'Counterpart team chat notification failed.');
    }
  }

  const notificationError = notificationFailures.length > 0 ? notificationFailures.join('; ') : null;

  return {
    cancelled: true,
    notificationError
  };
}

export async function cancelPracticeOccurrenceForApp(event: ParentScheduleEvent, user: AuthUser | null): Promise<CancelPracticeOccurrenceResult> {
  if (!event?.teamId || !event?.id || !event.isDbGame || event.type !== 'practice') {
    throw new Error('A recurring practice occurrence is required before cancelling.');
  }
  if (event.isCancelled) {
    throw new Error('This practice occurrence is already cancelled.');
  }
  if (!user?.uid) {
    throw new Error('Sign in before cancelling this practice occurrence.');
  }
  if (!event.isTeamAdmin) {
    throw new Error('Team owner or admin access is required to cancel this practice occurrence.');
  }

  const occurrence = parseRecurringPracticeOccurrenceId(event.id);
  if (!occurrence) {
    throw new Error('Only recurring practice occurrences can be cancelled here.');
  }

  try {
    await withTimeout(Promise.resolve(cancelOccurrence(event.teamId, occurrence.masterId, occurrence.instanceDate)), 'Practice occurrence cancellation');
  } catch (error) {
    if (!isNativeRuntime()) throw error;
    console.warn('[schedule-service] Falling back to REST practice occurrence cancellation:', error);
    const path = `teams/${encodeURIComponent(event.teamId)}/games/${encodeURIComponent(occurrence.masterId)}`;
    const existing = await nativeGetDocument(path);
    const nextExDates = uniqueNonEmptyStrings([...(Array.isArray(existing?.exDates) ? existing.exDates : []), occurrence.instanceDate]);
    await nativePatchDocument(path, {
      exDates: nextExDates,
      updatedAt: new Date(),
      updatedBy: user.uid
    });
  }

  return {
    cancelled: true,
    masterId: occurrence.masterId,
    instanceDate: occurrence.instanceDate
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
