import {
  getAssignmentClaims,
  claimOpenOfficiatingSlot,
  getConfigs,
  getGame,
  getGames,
  getPracticePacketCompletions,
  getPracticeSession,
  getPracticeSessionByEvent,
  getPracticeSessions,
  getPlayers,
  getRsvps,
  getRsvpBreakdownByPlayer,
  getTeam,
  getTeams,
  addGame,
  addPractice,
  buildLegacyTournamentGameDocuments,
  buildSingleLegacyTournamentGameDocument,
  createRideOffer,
  claimAssignmentSlot,
  respondToOfficiatingAssignment,
  requestRideSpot,
  listRideOffersForEvent,
  updateRideRequestStatus,
  closeRideOffer,
  cancelRideRequest,
  releaseAssignmentClaim,
  submitRsvpForPlayer,
  broadcastLiveEvent,
  getLiveEvents,
  updateGame,
  updatePracticeAttendance,
  updatePracticeSession,
  updateTeam,
  upsertPracticeSessionForEvent,
  upsertPracticePacketCompletion,
  postChatMessage,
  postSharedGameCancellationNotification,
  cancelOccurrence,
  clearOccurrenceOverride,
  db,
  doc,
  collection,
  collectionGroup,
  getDoc,
  getDocs,
  query,
  runTransaction,
  updateEvent,
  updateOccurrence,
  updateSeries,
  where,
  increment,
  serverTimestamp,
  deleteField,
  Timestamp
} from './adapters/legacyScheduleDb';
import {
  sendPublicRsvpReminderEmails,
  normalizeOfficialLinkEmail,
  normalizeOfficialLinkPhone,
  getAssignedOfficiatingSlots,
  getOpenOfficiatingSlots,
  expandRecurrence,
  extractOpponent,
  fetchAndParseCalendar,
  getCalendarEventTrackingId,
  isPracticeEvent,
  isTrackedCalendarEvent,
  filterVisiblePracticeSessions,
  buildPracticePacketCompletionPayload,
  resolveMyRsvpByChildForGame,
  applyPracticeRecurrenceFields,
  buildGameDayRsvpBreakdown,
  generateSeriesId,
  getPeriodsForFormation,
  getEventRideshareSummary,
  mergeAssignmentsWithClaims,
  hasScorekeepingTeamAccess,
  isTeamActive
} from './adapters/legacyScheduleHelpers';
import { buildAvailabilityNoteRows, canViewAvailabilityNotes, formatAvailabilityCutoff, isAvailabilityLocked, normalizeAvailabilityPreferences } from './adapters/legacyAvailability';
import { buildTrackerEventDocument } from './statTrackingEvent';
import {
  enrichTournamentScheduleStandings,
  getTournamentScheduleGroupQuery,
  hasTournamentScheduleGames,
  matchesTournamentScheduleGroup,
  type TournamentScheduleGroupQuery
} from './tournamentScheduleStandings';
import { loadProfileDocument, saveProfileDocument } from './profileService';
import { firebaseAuth, getNativeAuthIdToken } from './authService';
import { startUxTimer } from './uxTiming';
import {
  countOpenScheduleAssignments,
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
import type { AutoFilledLineupPlayer, GamePlanPublishPayloadInput } from './gameDayLineupPublish';
import { DEFAULT_TEAM_CONVERSATION_ID } from './chatLogic';
import { getCachedAppData, getParentScheduleSummaryCacheKey, loadCachedAppData } from './appDataCache';
import { toAppServiceError } from './appErrors';
import { createLogger } from './logger';
import { getNativeRestDedupKey, loadDedupedNativeRestRequest, shouldDedupNativeRestRequest } from './nativeRestDedup';
import { mapFirestoreDocument, mapScheduleEventDocument, mapScheduleEventDocuments, mapScheduleEventRecord, mapScheduleEventRecords } from './firestore/mappers';
import type { FirestoreDecodedDocument, FirestoreDocument as NativeFirestoreDocument, ScheduleEventFirestoreRecord } from './firestore/types';
import type { AuthUser } from './types';

const buildPracticePacketCompletionPayloadBase = buildPracticePacketCompletionPayload;

const primaryDataTimeoutMs = 5000;
// Per-team schedule builds are network-bound (team + games + practiceSessions
// reads each); 3 workers made a 5-team account load in two serialized waves
// (~18 sequential-ish Firestore round trips measured via the parent schedule
// service load timer). 6 covers typical multi-team accounts in one wave.
const parentScheduleTeamConcurrency = 6;
const parentSchedulePlayerConcurrency = 8;
const scheduleHydrationCacheTtlMs = 30 * 1000;
const parentHomeHydrationLookAheadMs = 14 * 24 * 60 * 60 * 1000;
const parentHomeHydrationLookBehindMs = 12 * 60 * 60 * 1000;
// Default games window for schedule views: ~13 months covers the current and
// previous season so the "Past Events" filter still shows recent history before
// an explicit full-history load. Tune here if season length assumptions change.
const defaultScheduleHistoryWindowMs = 400 * 24 * 60 * 60 * 1000;
const logger = createLogger('schedule-service');
type GameDayLineupPublishModule = typeof import('./gameDayLineupPublish');

function logScheduleWarning(message: string, operation: string, error: unknown, context: Record<string, unknown> = {}) {
  logger.warn(message, {
    operation,
    ...context,
    error
  });
}

function logScheduleError(message: string, operation: string, error: unknown, context: Record<string, unknown> = {}) {
  logger.error(message, {
    operation,
    ...context,
    error
  });
}

function rethrowScheduleLoadError(error: unknown): never {
  throw toAppServiceError(error, 'Unable to load schedule.');
}

export type ParentScheduleChild = {
  teamId: string;
  teamName: string;
  playerId: string;
  playerName: string;
};

type ParentScopeLink = ParentScheduleChild & {
  playerNumber?: string;
  playerPhotoUrl?: string | null;
  hasMetadata: boolean;
};

export type ParentScheduleLoadResult = {
  children: ParentScheduleChild[];
  events: ParentScheduleEvent[];
  isPartial?: boolean;
};

export type ParentScheduleScope = {
  profile: Record<string, unknown>;
  children: ParentScheduleChild[];
};

function hasResolvedParentProfile(profile: unknown): profile is Record<string, unknown> {
  return Boolean(profile && typeof profile === 'object' && !Array.isArray(profile) && Object.keys(profile as Record<string, unknown>).length > 0);
}

export type ParentScheduleLoadOptions = {
  hydrateDetails?: boolean;
  expandStaffPlayers?: boolean;
  /** Load the team's full game history instead of the default recent window (#2034). */
  includePastGames?: boolean;
  scheduleRangeByTeam?: ScheduleDateRangeByTeam;
  parentScope?: ParentScheduleScope;
};

export type OfficialAssignmentsAccess = {
  hasAccess: boolean;
  teamIds: string[];
  teamCount: number;
};

export type OfficialAssignmentItem = {
  kind: 'assigned' | 'open';
  teamId: string;
  teamName: string;
  gameId: string;
  slotId: string;
  position: string;
  status: string;
  opponent: string;
  location: string;
  date: Date;
  canClaim: boolean;
  scheduleReviewRequired: boolean;
};

export type OfficialAssignmentsResult = OfficialAssignmentsAccess & {
  assignments: OfficialAssignmentItem[];
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
  cachedEvent?: ParentScheduleEvent;
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

type FirestoreDocument = FirestoreDecodedDocument;

export type StaffRsvpReminderSendResult = StaffRsvpReminderPreview & {
  emailSentCount: number;
  rsvpPushSuccessCount: number;
  rsvpPushFailureCount: number;
  rsvpPushTargetCount: number;
  rsvpPushError: string | null;
};

type StaffRsvpEventData = {
  breakdown: StaffScheduleRsvpBreakdown;
  reminderPreview: StaffRsvpReminderPreview;
};

export type StaffRsvpAvailabilityLoader = ReturnType<typeof createStaffRsvpAvailabilityLoader>;

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

export type StaffPracticePacketBlock = {
  drillId?: string | null;
  drillTitle: string;
  type?: string | null;
  duration: number;
  description?: string | null;
  notes?: string | null;
};

export type StaffPracticePacketInput = {
  packetTitle?: string | null;
  dueDate?: string | Date | null;
  blocks: StaffPracticePacketBlock[];
};

export type StaffPracticePacket = ParentPracticePacket & {
  packetTitle: string;
  dueDate: string | null;
  totalMinutes: number;
};

export type PracticeAttendanceStatus = 'present' | 'late' | 'absent';

export type PracticeAttendancePlayer = {
  playerId: string;
  displayName: string;
  playerNumber?: string | null;
  status: PracticeAttendanceStatus;
  checkedInAt?: unknown;
  note?: string | null;
};

export type StaffPracticeAttendance = {
  sessionId: string;
  teamId: string;
  eventId: string;
  rosterSize: number;
  checkedInCount: number;
  players: PracticeAttendancePlayer[];
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

type LiveScoreUpdateResult = GameScoreSnapshot & {
  eventId: string;
  type: 'score_update';
  period: string | null;
  gameClockMs: number;
  description: string;
  previousHomeScore: number | null;
  previousAwayScore: number | null;
  createdBy: string;
  createdByName: string;
  createdAt: Date;
};

export type ScheduleHomeScoringPlayer = {
  id: string;
  name: string;
  number: string;
  photoUrl?: string;
  points: number;
  fouls: number;
  stats?: Record<string, number>;
};

export type ScheduleOpponentStatsEntry = {
  name?: string | null;
  number?: string | null;
  playerId?: string | null;
  photoUrl?: string | null;
  [key: string]: unknown;
};

export type PlayerGameStatInput = {
  statKey: 'pts' | 'fouls';
  value: 1 | 2;
  teamSide?: 'home' | 'away';
  playerName?: string | null;
  playerNumber?: string | number | null;
};

export type PlayerGameStatResult = GameScoreSnapshot & {
  playerId: string;
  playerName: string;
  playerNumber: string;
  statKey: 'pts' | 'fouls';
  value: 1 | 2;
  playerStatTotal: number;
  trackerEventId: string;
  liveEventId: string;
  liveEvent: Record<string, unknown>;
};

export type UndoPlayerGameStatInput = {
  trackerEventId: string;
  liveEventId: string;
  playerId: string;
  playerName?: string | null;
  playerNumber?: string | number | null;
  statKey: 'pts' | 'fouls';
  value: 1 | 2;
  teamSide?: 'home' | 'away';
};

export type UndoPlayerGameStatResult = GameScoreSnapshot & {
  playerId: string;
  statKey: 'pts' | 'fouls';
  playerStatTotal: number;
  trackerEventId: string;
  liveEventId: string;
  liveEvent: Record<string, unknown>;
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
  availablePlayers: AutoFilledLineupPlayer[];
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

function getAvailableLineupPlayers(players: any[]): AutoFilledLineupPlayer[] {
  return (Array.isArray(players) ? players : [])
    .filter(isActiveRosterPlayer)
    .map((player: any) => ({
      id: compactString(player?.id),
      name: normalizePlayerName(player),
      number: normalizePlayerNumber(player) || null
    }))
    .filter((player) => player.id);
}

function hasLineupAssignments(gamePlan: Record<string, any> | null | undefined) {
  return Boolean(gamePlan?.lineups && typeof gamePlan.lineups === 'object');
}

function normalizeLineupAssignments(lineups: Record<string, unknown> | null | undefined) {
  return Object.entries(lineups || {}).reduce<Record<string, string>>((acc, [key, value]) => {
    const safeKey = compactString(key);
    const safeValue = compactString(value);
    if (!safeKey || !safeValue) return acc;
    acc[safeKey] = safeValue;
    return acc;
  }, {});
}

function buildManualLineupDraft(lineupModule: GameDayLineupPublishModule, formationId: string, lineups: Record<string, string>, previousGamePlan: Record<string, any> | null | undefined) {
  const formation = lineupModule.getLineupFormation(formationId);
  if (!formation) {
    throw new Error('Select a supported formation before saving a lineup draft.');
  }
  const sourcePlan = previousGamePlan || {};
  return {
    ...sourcePlan,
    formationId: formation.id,
    numPeriods: formation.numPeriods,
    lineups,
    isPublished: false,
    publishedAt: sourcePlan.publishedAt || null,
    publishedBy: sourcePlan.publishedBy || null,
    publishedByName: sourcePlan.publishedByName || null,
    publishedVersion: Number.parseInt(sourcePlan.publishedVersion, 10) || 0,
    publishedFormationId: sourcePlan.publishedFormationId || null,
    publishedNumPeriods: Number.parseInt(sourcePlan.publishedNumPeriods, 10) || null,
    publishedLineups: normalizeLineupAssignments(sourcePlan.publishedLineups),
    publishedRecipientPlayerIds: Array.isArray(sourcePlan.publishedRecipientPlayerIds) ? [...new Set(sourcePlan.publishedRecipientPlayerIds.map(compactString).filter(Boolean))] : [],
    publishedRecipientParentIds: Array.isArray(sourcePlan.publishedRecipientParentIds) ? [...new Set(sourcePlan.publishedRecipientParentIds.map(compactString).filter(Boolean))] : [],
    publishedReadBy: Array.isArray(sourcePlan.publishedReadBy) ? [...sourcePlan.publishedReadBy] : []
  };
}

function buildLineupDraftPreview(lineupModule: GameDayLineupPublishModule, formationId: string, availablePlayers: AutoFilledLineupPlayer[], goingPlayers: AutoFilledLineupPlayer[], gamePlan: Record<string, any> | null | undefined): LineupDraftPreviewResult {
  const formation = lineupModule.getLineupFormation(formationId);
  if (!formation) {
    throw new Error('Select a supported formation before saving a lineup draft.');
  }
  let draft: Record<string, any> | null = null;
  if (hasLineupAssignments(gamePlan)) {
    draft = {
      ...(gamePlan || {}),
      formationId: formation.id,
      numPeriods: formation.numPeriods
    };
  } else {
    try {
      draft = lineupModule.buildAutoFilledLineupDraft({ formationId, goingPlayers, previousGamePlan: gamePlan || {} });
    } catch (error: any) {
      if (!String(error?.message || '').includes('No Going players')) throw error;
    }
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
    availablePlayers,
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
  const lineupModule = await import('./gameDayLineupPublish');
  if (!lineupModule.LINEUP_FORMATIONS[compactString(formationId)]) {
    throw new Error('Select a supported formation before saving a lineup draft.');
  }
  const [players, rsvps] = await Promise.all([
    loadPlayers(event.teamId),
    loadRsvps(event.teamId, event.id)
  ]);
  return buildLineupDraftPreview(lineupModule, formationId, getAvailableLineupPlayers(players), getGoingLineupPlayers(players, rsvps), event.gamePlan || {});
}

export async function saveScheduledGameLineupDraftForApp(
  event: ParentScheduleEvent,
  user: AuthUser | null,
  formationId: string,
  options?: { lineups?: Record<string, string> | null }
): Promise<LineupDraftPreviewResult> {
  assertLineupDraftEvent(event, user);
  const lineupModule = await import('./gameDayLineupPublish');
  const [players, rsvps] = await Promise.all([
    loadPlayers(event.teamId),
    loadRsvps(event.teamId, event.id)
  ]);
  const availablePlayers = getAvailableLineupPlayers(players);
  const goingPlayers = getGoingLineupPlayers(players, rsvps);
  const hasLineupOverride = Boolean(options && Object.prototype.hasOwnProperty.call(options, 'lineups'));
  const overrideLineups = hasLineupOverride && options?.lineups && typeof options.lineups === 'object'
    ? normalizeLineupAssignments(options.lineups)
    : null;
  const nextGamePlan = hasLineupOverride
    ? buildManualLineupDraft(lineupModule, formationId, overrideLineups || {}, event.gamePlan || {})
    : lineupModule.buildAutoFilledLineupDraft({ formationId, goingPlayers, previousGamePlan: event.gamePlan || {} });
  const payload: Record<string, unknown> = { gamePlan: nextGamePlan };

  try {
    await withTimeout(Promise.resolve(updateGame(event.teamId, event.id, payload)), 'Lineup draft save');
  } catch (error) {
    if (!isNativeRuntime()) throw error;
    logScheduleWarning('Falling back to REST lineup draft updateGame.', 'lineup-draft-update', error, { fallback: 'rest', teamId: event.teamId, gameId: event.id });
    await nativePatchDocument(`teams/${encodeURIComponent(event.teamId)}/games/${encodeURIComponent(event.id)}`, payload);
  }

  return buildLineupDraftPreview(lineupModule, formationId, availablePlayers, goingPlayers, nextGamePlan);
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
  const lineupModule = await import('./gameDayLineupPublish');
  const currentTeamPlayers = await loadPlayers(teamId);
  const recipientPlayerIds = uniqueNonEmptyStrings(currentTeamPlayers.map((p: any) => p.id));
  const recipientParentIds = uniqueNonEmptyStrings(currentTeamPlayers.flatMap(getPlayerParentUserIds));

  const previousGamePlan = event.gamePlan;
  const nextGamePlan = lineupModule.buildLineupPublishPayload({
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
    logScheduleWarning('Falling back to REST lineup publish updateGame.', 'lineup-publish-update', error, { fallback: 'rest', teamId, gameId });
    await nativePatchDocument(`teams/${encodeURIComponent(teamId)}/games/${encodeURIComponent(gameId)}`, payload);
  }

  const changedAssignments = lineupModule.countLineupChanges(
    previousGamePlan?.publishedLineups,
    nextGamePlan.publishedLineups
  );

  let notificationError: string | null = null;
  try {
    const { sendTeamChatMessage } = await import('./chatService');
    await sendTeamChatMessage({
      teamId: event.teamId,
      user,
      profile: {
        fullName: user.displayName || null,
        photoUrl: user.photoUrl || null
      },
      text: lineupModule.buildLineupPublishMessage({
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
    logScheduleError('Failed to send lineup published chat message.', 'lineup-publish-chat-notification', error, { teamId: event.teamId, gameId: event.id });
    notificationError = error?.message || 'Unknown chat notification error';
  }

  return { gamePlan: nextGamePlan, notificationError };
}


export type PublishScheduledGameLineupResult = {
  gamePlan: Record<string, unknown>;
  changedAssignments: number;
  notificationError: string | null;
};

function getTimerScope() {
  if (typeof window !== 'undefined' && typeof window.setTimeout === 'function' && typeof window.clearTimeout === 'function') {
    return window;
  }
  return globalThis;
}

function withTimeout<T>(promise: Promise<T>, label: string, timeoutMs = primaryDataTimeoutMs): Promise<T> {
  const timers = getTimerScope();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timeoutId = timers.setTimeout(() => reject(new Error(`${label} timed out.`)), timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId !== undefined) timers.clearTimeout(timeoutId);
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
  const url = `${getFirestoreBaseUrl()}${path}`;
  const runRequest = async () => {
    const response = await withTimeout(fetch(url, {
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
  };
  return shouldDedupNativeRestRequest(path, init)
    ? loadDedupedNativeRestRequest(getNativeRestDedupKey(url, init), runRequest)
    : runRequest();
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

async function nativeGetDocument(path: string) {
  try {
    return mapFirestoreDocument(await nativeFirestoreRequest(`/${path}`) as NativeFirestoreDocument);
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
  return ((payload.documents || []) as NativeFirestoreDocument[])
    .map((document) => mapFirestoreDocument(document))
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
    ? payload.map((entry) => mapFirestoreDocument(entry.document as NativeFirestoreDocument)).filter(Boolean) as FirestoreDocument[]
    : [];
}

async function nativeGetScheduleEventDocument(path: string): Promise<ScheduleEventFirestoreRecord | null> {
  try {
    return mapScheduleEventDocument(await nativeFirestoreRequest(`/${path}`) as NativeFirestoreDocument);
  } catch (error: any) {
    const message = String(error?.message || '').toLowerCase();
    if (error?.status === 404 || message.includes('not_found') || message.includes('not found')) {
      return null;
    }
    throw error;
  }
}

async function nativeListScheduleEventDocuments(path: string): Promise<ScheduleEventFirestoreRecord[]> {
  const payload = await nativeFirestoreRequest(`/${path}`);
  return mapScheduleEventDocuments((payload.documents || []) as NativeFirestoreDocument[]);
}

async function nativeQueryScheduleEventDocuments(teamId: string, range: ScheduleDateRange): Promise<ScheduleEventFirestoreRecord[]> {
  const filters = [
    range.startDate
      ? {
          fieldFilter: {
            field: { fieldPath: 'date' },
            op: 'GREATER_THAN_OR_EQUAL',
            value: encodeFirestoreValue(range.startDate)
          }
        }
      : null,
    range.endDate
      ? {
          fieldFilter: {
            field: { fieldPath: 'date' },
            op: 'LESS_THAN_OR_EQUAL',
            value: encodeFirestoreValue(range.endDate)
          }
        }
      : null
  ].filter(Boolean) as Array<Record<string, unknown>>;
  const where = {
    compositeFilter: {
      op: 'AND',
      filters
    }
  };
  const payload = await nativeFirestoreRequest(`/teams/${encodeURIComponent(teamId)}:runQuery`, {
    method: 'POST',
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'games' }],
        where,
        orderBy: [{ field: { fieldPath: 'date' }, direction: 'ASCENDING' }]
      }
    })
  });

  return Array.isArray(payload)
    ? mapScheduleEventDocuments(payload.map((entry) => entry?.document).filter(Boolean) as NativeFirestoreDocument[])
    : [];
}

async function nativeQueryTournamentScheduleGroupDocuments(
  teamId: string,
  group: TournamentScheduleGroupQuery
): Promise<ScheduleEventFirestoreRecord[]> {
  const fieldQueries = group.poolName
    ? [{ fieldPath: 'tournament.poolName', value: group.poolName }]
    : [
        { fieldPath: 'tournament.divisionName', value: group.divisionName },
        { fieldPath: 'tournament.division', value: group.divisionName }
      ];
  const payloads = await Promise.all(fieldQueries.map(({ fieldPath, value }) => (
    nativeFirestoreRequest(`/teams/${encodeURIComponent(teamId)}:runQuery`, {
      method: 'POST',
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'games' }],
          where: {
            fieldFilter: {
              field: { fieldPath },
              op: 'EQUAL',
              value: encodeFirestoreValue(value)
            }
          }
        }
      })
    })
  )));

  const gamesById = new Map<string, ScheduleEventFirestoreRecord>();
  payloads.forEach((payload) => {
    const games = Array.isArray(payload)
      ? mapScheduleEventDocuments(payload.map((entry) => entry?.document).filter(Boolean) as NativeFirestoreDocument[])
      : [];
    games.forEach((game) => {
      const gameId = compactString(game.id || game.gameId);
      if (gameId && !gamesById.has(gameId)) gamesById.set(gameId, game);
    });
  });
  return Array.from(gamesById.values()).filter((game) => matchesTournamentScheduleGroup(game, group));
}

const nativeDeleteFieldSentinel = { __deleteField: true };

function escapeFirestoreFieldPathSegment(segment: string) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(segment)
    ? segment
    : `\`${segment.replace(/`/g, '\\`')}\``;
}

function buildFirestoreUpdateMaskPath(path: string) {
  return path
    .split('.')
    .filter(Boolean)
    .map((segment) => escapeFirestoreFieldPathSegment(segment))
    .join('.');
}

function assignNestedFirestoreValue(target: Record<string, unknown>, path: string, value: unknown) {
  const segments = path.split('.').filter(Boolean);
  if (!segments.length) return;
  let cursor: Record<string, unknown> = target;
  segments.forEach((segment, index) => {
    if (index === segments.length - 1) {
      cursor[segment] = value;
      return;
    }
    const next = cursor[segment];
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      cursor[segment] = {};
    }
    cursor = cursor[segment] as Record<string, unknown>;
  });
}

async function nativePatchDocument(path: string, data: Record<string, unknown>) {
  const nestedData = Object.keys(data).reduce<Record<string, unknown>>((acc, key) => {
    if (data[key] === nativeDeleteFieldSentinel) {
      return acc;
    }
    assignNestedFirestoreValue(acc, key, data[key]);
    return acc;
  }, {});
  const fields = Object.keys(nestedData).reduce<Record<string, Record<string, unknown>>>((acc, key) => {
    acc[key] = encodeFirestoreValue(nestedData[key]);
    return acc;
  }, {});
  const params = new URLSearchParams();
  Object.keys(data).forEach((key) => params.append('updateMask.fieldPaths', buildFirestoreUpdateMaskPath(key)));
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
  return mapFirestoreDocument(await nativeFirestoreRequest(`/${path}`, {
    method: 'POST',
    body: JSON.stringify({ fields })
  }) as NativeFirestoreDocument);
}

async function nativeDeleteDocument(path: string) {
  await nativeFirestoreRequest(`/${path}`, {
    method: 'DELETE'
  });
}

type NativeDocumentSnapshot = {
  exists: boolean;
  updateTime: string | null;
  document: FirestoreDocument | null;
};

type PendingLivePublishOperation =
  | {
    id: string;
    kind: 'score_update';
    teamId: string;
    gameId: string;
    score: GameScoreSnapshot;
    previousScore?: Partial<GameScoreSnapshot> | null;
    user: Pick<AuthUser, 'uid' | 'displayName' | 'email'>;
    createdAt: string;
  }
  | {
    id: string;
    kind: 'player_game_stat';
    teamId: string;
    gameId: string;
    playerId: string;
    stat: PlayerGameStatInput;
    user: Pick<AuthUser, 'uid' | 'displayName' | 'email'>;
    createdAt: string;
  };

const pendingLivePublishQueueStorageKey = 'allplays.pendingLivePublishQueue.v1';
const liveGameSnapshotStorageKey = 'allplays.liveGameSnapshots.v1';
const livePublishLocks = new Map<string, { active: boolean; waiters: Array<() => void> }>();
let livePublishQueueFlushPromise: Promise<void> | null = null;
let livePublishQueueListenerRegistered = false;

function getLivePublishLock(key: string) {
  if (!livePublishLocks.has(key)) {
    livePublishLocks.set(key, { active: false, waiters: [] });
  }
  return livePublishLocks.get(key)!;
}

async function withLivePublishLock<T>(key: string, work: () => Promise<T>) {
  const lock = getLivePublishLock(key);
  if (lock.active) {
    await new Promise<void>((resolve) => {
      lock.waiters.push(resolve);
    });
  }
  lock.active = true;
  try {
    return await work();
  } finally {
    const next = lock.waiters.shift();
    if (next) {
      next();
    } else {
      lock.active = false;
    }
  }
}

function getFirestoreDocumentName(path: string) {
  return `projects/${getProjectId()}/databases/(default)/documents/${path}`;
}

function buildFirestoreFields(data: Record<string, unknown>) {
  return Object.keys(data).reduce<Record<string, Record<string, unknown>>>((acc, key) => {
    acc[key] = encodeFirestoreValue(data[key]);
    return acc;
  }, {});
}

async function nativeCommitWrites(writes: Record<string, unknown>[]) {
  return nativeFirestoreRequest(':commit', {
    method: 'POST',
    body: JSON.stringify({ writes })
  });
}

async function nativeGetDocumentSnapshot(path: string): Promise<NativeDocumentSnapshot> {
  try {
    const payload = await nativeFirestoreRequest(`/${path}`) as NativeFirestoreDocument & { updateTime?: string };
    return {
      exists: true,
      updateTime: typeof payload?.updateTime === 'string' ? payload.updateTime : null,
      document: mapFirestoreDocument(payload)
    };
  } catch (error: any) {
    const message = String(error?.message || '').toLowerCase();
    if (error?.status === 404 || message.includes('not_found') || message.includes('not found')) {
      return {
        exists: false,
        updateTime: null,
        document: null
      };
    }
    throw error;
  }
}

function isNativeConflictError(error: any) {
  const message = String(error?.message || '').toLowerCase();
  return error?.status === 409 || error?.status === 412 || message.includes('failed_precondition') || message.includes('aborted');
}

function isNativeOfflineError(error: any) {
  const message = String(error?.message || '').toLowerCase();
  return !error?.status || message.includes('failed to fetch') || message.includes('network') || message.includes('offline') || message.includes('timed out');
}

function getSafeLocalStorage() {
  try {
    return typeof window !== 'undefined' ? window.localStorage : undefined;
  } catch {
    return undefined;
  }
}

function readPendingLivePublishQueue(): PendingLivePublishOperation[] {
  const storage = getSafeLocalStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(pendingLivePublishQueueStorageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writePendingLivePublishQueue(queue: PendingLivePublishOperation[]) {
  const storage = getSafeLocalStorage();
  if (!storage) return;
  if (!queue.length) {
    storage.removeItem(pendingLivePublishQueueStorageKey);
    return;
  }
  storage.setItem(pendingLivePublishQueueStorageKey, JSON.stringify(queue));
}

type LocalLiveGameSnapshot = {
  homeScore: number;
  awayScore: number;
  playerPoints: Record<string, number>;
};

function readLocalLiveGameSnapshots() {
  const storage = getSafeLocalStorage();
  if (!storage) return {} as Record<string, LocalLiveGameSnapshot>;
  try {
    const raw = storage.getItem(liveGameSnapshotStorageKey);
    if (!raw) return {} as Record<string, LocalLiveGameSnapshot>;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, LocalLiveGameSnapshot> : {};
  } catch {
    return {} as Record<string, LocalLiveGameSnapshot>;
  }
}

function writeLocalLiveGameSnapshots(snapshots: Record<string, LocalLiveGameSnapshot>) {
  const storage = getSafeLocalStorage();
  if (!storage) return;
  if (!Object.keys(snapshots).length) {
    storage.removeItem(liveGameSnapshotStorageKey);
    return;
  }
  storage.setItem(liveGameSnapshotStorageKey, JSON.stringify(snapshots));
}

function makeLiveGameSnapshotKey(teamId: string, gameId: string) {
  return `${compactString(teamId)}::${compactString(gameId)}`;
}

function readLocalLiveGameSnapshot(teamId: string, gameId: string): LocalLiveGameSnapshot {
  const snapshots = readLocalLiveGameSnapshots();
  return snapshots[makeLiveGameSnapshotKey(teamId, gameId)] || { homeScore: 0, awayScore: 0, playerPoints: {} };
}

function writeLocalLiveGameSnapshot(teamId: string, gameId: string, snapshot: LocalLiveGameSnapshot) {
  const snapshots = readLocalLiveGameSnapshots();
  snapshots[makeLiveGameSnapshotKey(teamId, gameId)] = snapshot;
  writeLocalLiveGameSnapshots(snapshots);
}

function updateLocalLiveGameSnapshot(teamId: string, gameId: string, updater: (snapshot: LocalLiveGameSnapshot) => LocalLiveGameSnapshot) {
  writeLocalLiveGameSnapshot(teamId, gameId, updater(readLocalLiveGameSnapshot(teamId, gameId)));
}

function buildPendingLivePublishId() {
  return `pending-live-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function enqueuePendingLivePublish(operation: PendingLivePublishOperation) {
  const queue = readPendingLivePublishQueue();
  queue.push(operation);
  queue.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  writePendingLivePublishQueue(queue);
}

function ensureLivePublishQueueFlushListener() {
  if (livePublishQueueListenerRegistered || typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
  window.addEventListener('online', () => {
    void flushPendingLivePublishQueue();
  });
  livePublishQueueListenerRegistered = true;
}

function isPointsLikeStatKey(statKey: unknown) {
  const key = String(statKey || '').trim().toLowerCase();
  return key === 'pts' || key === 'points' || key === 'goals' || key === 'r' || key === 'run' || key === 'runs';
}

function deriveScoreFromTrackerLog(log: Array<Record<string, any>>) {
  return log.reduce((totals, entry) => {
    const undoData = entry?.undoData;
    if (!undoData || undoData.type !== 'stat' || !isPointsLikeStatKey(undoData.statKey)) return totals;
    const value = Number(undoData.value) || 0;
    if (!value) return totals;
    if (undoData.isOpponent) totals.away += value;
    else totals.home += value;
    totals.count += 1;
    return totals;
  }, { home: 0, away: 0, count: 0 });
}

async function loadTrackerEventLog(teamId: string, gameId: string) {
  try {
    if (isNativeRuntime()) {
      return await nativeListCollection(`teams/${encodeURIComponent(teamId)}/games/${encodeURIComponent(gameId)}/events`);
    }
    const snapshot = await getDocs(collection(db, `teams/${teamId}/games/${gameId}/events`));
    return snapshot.docs.map((docSnap: any) => ({ id: docSnap.id, ...(docSnap.data() || {}) }));
  } catch {
    return [];
  }
}

async function loadLiveScoreIntegrityState(teamId: string, gameId: string) {
  const log = await loadTrackerEventLog(teamId, gameId);
  const derived = deriveScoreFromTrackerLog(log as Array<Record<string, any>>);
  return {
    hasScoringEvents: derived.count > 0,
    homeScore: derived.home,
    awayScore: derived.away
  };
}

function resolveScoreFromIntegrityState(game: Record<string, any> | null | undefined, integrityState: { hasScoringEvents: boolean; homeScore: number; awayScore: number } | null) {
  const liveHome = normalizeGameScoreValue(game?.homeScore);
  const liveAway = normalizeGameScoreValue(game?.awayScore);
  const hasPersistedLiveScore = game?.homeScore !== null && game?.homeScore !== undefined && game?.homeScore !== ''
    && game?.awayScore !== null && game?.awayScore !== undefined && game?.awayScore !== '';
  if (!integrityState?.hasScoringEvents || hasPersistedLiveScore) {
    return { homeScore: liveHome, awayScore: liveAway, reconciled: false };
  }
  return {
    homeScore: integrityState.homeScore,
    awayScore: integrityState.awayScore,
    reconciled: true
  };
}

async function readWithNativeFallback<T>(label: string, primary: () => Promise<T>, fallback: () => Promise<T>): Promise<T> {
  try {
    return await withTimeout(Promise.resolve(primary()), label);
  } catch (error) {
    if (!isNativeRuntime()) throw error;
    logScheduleWarning(`Falling back to REST for ${label}.`, 'native-read-fallback', error, { fallback: 'rest', label });
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
  importBatch?: {
    batchId: string;
    totalCount: number;
    rowNumber: number;
    importedAt?: string | null;
    importedBy?: string | null;
  } | null;
};

export type ScheduleGameFormInput = {
  opponent: string;
  startDate: Date;
  endDate?: Date | null;
  location?: string | null;
  arrivalTime?: Date | null;
  isHome?: boolean | null;
  notes?: string | null;
  statTrackerConfigId?: string | null;
  competitionType?: string | null;
  countsTowardSeasonRecord?: boolean;
  opponentTeamId?: string | null;
  opponentTeamName?: string | null;
  opponentTeamPhoto?: string | null;
};

export type ScheduleTournamentGameFormInput = ScheduleGameFormInput;

export type ScheduleTournamentCreateFormInput = {
  divisionName: string;
  bracketName: string;
  roundName: string;
  poolName?: string | null;
  games: ScheduleTournamentGameFormInput[];
};

export type ScheduleTournamentMetadataInput = Pick<ScheduleTournamentCreateFormInput, 'divisionName' | 'bracketName' | 'roundName' | 'poolName'>;

export class TournamentBlockPartialSaveError extends Error {
  readonly createdIds: string[];
  readonly totalGames: number;
  readonly failedGameNumber: number;
  readonly cause: unknown;

  constructor(createdIds: string[], totalGames: number, failedGameNumber: number, cause: unknown) {
    super(`Tournament block was only partially created: ${createdIds.length} of ${totalGames} games were saved. Refresh Schedule before retrying to avoid duplicate games.`);
    this.name = 'TournamentBlockPartialSaveError';
    this.createdIds = [...createdIds];
    this.totalGames = totalGames;
    this.failedGameNumber = failedGameNumber;
    this.cause = cause;
  }
}

export type ScheduleStatTrackerConfigOption = {
  id: string;
  name: string;
  baseType?: string | null;
  isBasketball?: boolean;
  columns?: string[];
  statDefinitions?: Array<{ id?: string; label?: string; acronym?: string; scope?: string; visibility?: string }>;
};

function normalizeScheduleImportBatch(input: ScheduleImportNormalizedRow['importBatch']) {
  const batchId = compactString(input?.batchId);
  const totalCount = Math.max(0, Number.parseInt(String(input?.totalCount ?? 0), 10) || 0);
  const rowNumber = Math.max(0, Number.parseInt(String(input?.rowNumber ?? 0), 10) || 0);
  if (!batchId || totalCount <= 0 || rowNumber <= 0) {
    return null;
  }
  return {
    batchId,
    totalCount,
    rowNumber,
    importedAt: compactString(input?.importedAt) || new Date().toISOString(),
    importedBy: compactString(input?.importedBy) || null
  };
}

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
  const importBatch = normalizeScheduleImportBatch(row.importBatch);
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
    createdBy: user.uid,
    ...(importBatch ? { importBatch } : {})
  };
}

function parseScheduleGameFormDate(value: Date | string | number | null | undefined, label: string) {
  const date = value instanceof Date ? new Date(value) : new Date(value || '');
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${label} is invalid.`);
  }
  return date;
}

function buildScheduledGamePayload(input: ScheduleGameFormInput, user: AuthUser) {
  const opponent = compactString(input.opponent);
  if (!opponent) throw new Error('Games require an opponent.');
  const startDate = parseScheduleGameFormDate(input.startDate, 'Game start time');
  const endDate = input.endDate ? parseScheduleGameFormDate(input.endDate, 'Game end time') : null;
  const arrivalTime = input.arrivalTime ? parseScheduleGameFormDate(input.arrivalTime, 'Arrival time') : null;
  if (endDate && endDate.getTime() <= startDate.getTime()) {
    throw new Error('Game end time must be after the start time.');
  }
  return {
    type: 'game',
    date: startDate,
    end: endDate,
    opponent,
    title: null,
    location: compactString(input.location),
    isHome: input.isHome === null || input.isHome === undefined ? null : input.isHome === true,
    arrivalTime,
    notes: compactString(input.notes),
    assignments: [],
    status: 'scheduled',
    homeScore: 0,
    awayScore: 0,
    competitionType: compactString(input.competitionType) || 'league',
    countsTowardSeasonRecord: input.countsTowardSeasonRecord === false ? false : true,
    statTrackerConfigId: compactString(input.statTrackerConfigId) || null,
    opponentTeamId: compactString(input.opponentTeamId) || null,
    opponentTeamName: compactString(input.opponentTeamName) || null,
    opponentTeamPhoto: compactString(input.opponentTeamPhoto) || null,
    createdBy: user.uid
  };
}

function buildScheduledTournamentMetadata(input: ScheduleTournamentMetadataInput) {
  const divisionName = compactString(input.divisionName);
  const bracketName = compactString(input.bracketName);
  const roundName = compactString(input.roundName);
  const poolName = compactString(input.poolName);
  if (!divisionName || !bracketName || !roundName) {
    throw new Error('Tournament blocks require division, bracket, and round names.');
  }
  return {
    divisionName,
    bracketName,
    roundName,
    ...(poolName ? { poolName } : {})
  };
}

export function buildSingleGameTournamentLegacySchedulePayload(
  game: ScheduleTournamentGameFormInput,
  tournamentMetadata: ScheduleTournamentMetadataInput,
  user: AuthUser
) {
  const tournament = buildScheduledTournamentMetadata(tournamentMetadata);
  const payload = buildScheduledGamePayload({
    ...game,
    competitionType: 'tournament'
  }, user);

  return buildSingleLegacyTournamentGameDocument([payload], tournament);
}

function buildScheduledGameUpdatePayload(input: ScheduleGameFormInput, user: AuthUser) {
  const { assignments, status, homeScore, awayScore, createdBy, ...payload } = buildScheduledGamePayload(input, user) as Record<string, unknown>;
  void assignments;
  void status;
  void homeScore;
  void awayScore;
  void createdBy;
  return {
    ...payload,
    updatedAt: new Date(),
    updatedBy: user.uid
  };
}

function buildScheduleImportPracticePayload(row: ScheduleImportNormalizedRow, user: AuthUser) {
  const startDate = parseScheduleImportDate(row.startsAt, 'Start time');
  const importBatch = normalizeScheduleImportBatch(row.importBatch);
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
    createdBy: user.uid,
    ...(importBatch ? { importBatch } : {})
  };
}

export type PracticeRecurrenceFormInput = {
  isRecurring: boolean;
  freq?: 'weekly' | 'daily';
  interval?: number;
  byDays?: string[];
  endType?: 'never' | 'until' | 'count';
  untilValue?: string;
  countValue?: number;
};

export type SchedulePracticeFormInput = {
  title: string;
  startDate: Date;
  endDate: Date;
  location?: string | null;
  notes?: string | null;
  scheduleNotifications?: Record<string, unknown> | null;
  recurrence?: PracticeRecurrenceFormInput | null;
};

export type SchedulePracticeEditScope = 'series' | 'occurrence';

export type UpdateScheduledPracticeOptions = {
  eventId: string;
  seriesId?: string | null;
  scope?: SchedulePracticeEditScope;
  instanceDate?: string | null;
};

async function readScheduleStatTrackerConfigOptions(normalizedTeamId: string): Promise<ScheduleStatTrackerConfigOption[]> {
  const configs = await readWithNativeFallback(
    `schedule stat tracker configs ${normalizedTeamId}`,
    () => Promise.resolve(getConfigs(normalizedTeamId)),
    () => nativeListCollection(`teams/${encodeURIComponent(normalizedTeamId)}/statTrackerConfigs`)
  ).catch(() => []);
  return (Array.isArray(configs) ? configs : [])
    .map((config: any) => ({
      id: compactString(config?.id),
      name: compactString(config?.name) || compactString(config?.label) || compactString(config?.baseType) || 'Tracker config',
      baseType: compactString(config?.baseType) || null,
      isBasketball: config?.isBasketball === true || compactString(config?.baseType).toLowerCase() === 'basketball',
      columns: (Array.isArray(config?.columns) ? config.columns : [])
        .map((column: unknown) => compactString(column))
        .filter(Boolean),
      statDefinitions: (Array.isArray(config?.statDefinitions) ? config.statDefinitions : [])
        .map((definition: any) => ({
          id: compactString(definition?.id),
          label: compactString(definition?.label),
          acronym: compactString(definition?.acronym),
          scope: compactString(definition?.scope),
          visibility: compactString(definition?.visibility)
        }))
        .filter((definition: { id: string; label: string; acronym: string }) => definition.id || definition.label || definition.acronym)
    }))
    .filter((config) => config.id)
    .sort((first, second) => first.name.localeCompare(second.name));
}

export async function loadScheduleStatTrackerConfigsForApp(teamId: string, user: AuthUser | null): Promise<ScheduleStatTrackerConfigOption[]> {
  const normalizedTeamId = compactString(teamId);
  if (!normalizedTeamId) throw new Error('Team is required.');
  await requireScheduleImportStaff(normalizedTeamId, user);
  return readScheduleStatTrackerConfigOptions(normalizedTeamId);
}

export async function loadScorekeeperStatTrackerConfigsForApp(
  teamId: string,
  user: AuthUser | null,
  event: Pick<ParentScheduleEvent, 'teamId' | 'type' | 'isDbGame' | 'isCancelled' | 'canUpdateScore'> | null | undefined
): Promise<ScheduleStatTrackerConfigOption[]> {
  const normalizedTeamId = compactString(teamId);
  if (!normalizedTeamId) throw new Error('Team is required.');
  if (!user?.uid) throw new Error('You need to sign in before loading tracker setup.');
  const eventTeamId = compactString(event?.teamId);
  const canLoadForScorekeeping = Boolean(
    eventTeamId === normalizedTeamId
    && event?.type === 'game'
    && event.isDbGame
    && !event.isCancelled
    && event.canUpdateScore
  );
  if (!canLoadForScorekeeping) {
    throw new Error('You do not have permission to load tracker setup for this game.');
  }
  return readScheduleStatTrackerConfigOptions(normalizedTeamId);
}

type ScheduledGameSaveOptions = {
  legacyPayload?: Record<string, unknown>;
  requireCreatedId?: boolean;
  timeoutLabel?: string;
};

export async function createScheduledGameForApp(
  teamId: string,
  input: ScheduleGameFormInput,
  user: AuthUser | null,
  options: ScheduledGameSaveOptions = {}
) {
  const normalizedTeamId = compactString(teamId);
  if (!normalizedTeamId) throw new Error('Team is required.');
  await requireScheduleImportStaff(normalizedTeamId, user);
  const payload = options.legacyPayload || buildScheduledGamePayload(input, user as AuthUser);

  let createdId = '';
  try {
    createdId = compactString(await withTimeout(Promise.resolve(addGame(normalizedTeamId, payload)), options.timeoutLabel || 'Scheduled game create'));
  } catch (error) {
    if (!isNativeRuntime()) throw error;
    logScheduleWarning('Falling back to REST scheduled game create.', 'scheduled-game-create', error, { fallback: 'rest', teamId: normalizedTeamId });
    const doc = await nativeCreateDocument(`teams/${encodeURIComponent(normalizedTeamId)}/games`, {
      ...payload,
      createdAt: new Date()
    });
    createdId = compactString(doc?.id);
  }
  if (options.requireCreatedId && !createdId) {
    throw new Error('Tournament game save failed because no game id was returned.');
  }
  return createdId;
}

export async function createScheduledTournamentBlockForApp(teamId: string, input: ScheduleTournamentCreateFormInput, user: AuthUser | null) {
  const normalizedTeamId = compactString(teamId);
  if (!normalizedTeamId) throw new Error('Team is required.');
  await requireScheduleImportStaff(normalizedTeamId, user);

  const tournament = buildScheduledTournamentMetadata(input);
  const games = Array.isArray(input.games) ? input.games : [];
  if (!games.length) {
    throw new Error('Tournament blocks require at least one game.');
  }

  if (games.length === 1) {
    const legacyPayload = buildSingleGameTournamentLegacySchedulePayload(games[0], tournament, user as AuthUser);
    const createdId = await createScheduledGameForApp(normalizedTeamId, games[0], user, {
      legacyPayload,
      requireCreatedId: true,
      timeoutLabel: 'Scheduled tournament game create'
    });
    return [createdId];
  }

  // Normalize and validate every row before the first write. This prevents a
  // malformed later row from leaving a partially-created tournament block.
  const legacyPayloads = buildLegacyTournamentGameDocuments(games.map((game) => buildScheduledGamePayload({
    ...game,
    competitionType: 'tournament'
  }, user as AuthUser)), tournament);
  const createdIds: string[] = [];

  for (let index = 0; index < games.length; index += 1) {
    try {
      const createdId = await createScheduledGameForApp(normalizedTeamId, games[index], user, {
        legacyPayload: legacyPayloads[index],
        requireCreatedId: true,
        timeoutLabel: `Scheduled tournament game ${index + 1} create`
      });
      createdIds.push(createdId);
    } catch (error) {
      if (!createdIds.length) throw error;
      throw new TournamentBlockPartialSaveError(createdIds, games.length, index + 1, error);
    }
  }

  return createdIds;
}

export async function updateScheduledGameForApp(teamId: string, gameId: string, input: ScheduleGameFormInput, user: AuthUser | null) {
  const normalizedTeamId = compactString(teamId);
  const normalizedGameId = compactString(gameId);
  if (!normalizedTeamId) throw new Error('Team is required.');
  if (!normalizedGameId) throw new Error('Game is required.');
  await requireScheduleImportStaff(normalizedTeamId, user);
  const payload = buildScheduledGameUpdatePayload(input, user as AuthUser);

  try {
    await withTimeout(Promise.resolve(updateGame(normalizedTeamId, normalizedGameId, payload)), 'Scheduled game update');
  } catch (error) {
    if (!isNativeRuntime()) throw error;
    logScheduleWarning('Falling back to REST scheduled game update.', 'scheduled-game-update', error, { fallback: 'rest', teamId: normalizedTeamId, gameId: normalizedGameId });
    await nativePatchDocument(`teams/${encodeURIComponent(normalizedTeamId)}/games/${encodeURIComponent(normalizedGameId)}`, payload);
  }
  return { updated: true, eventId: normalizedGameId };
}

function sanitizePracticeRecurrenceInput(input?: PracticeRecurrenceFormInput | null) {
  const byDays = Array.isArray(input?.byDays) ? input?.byDays.map((value) => compactString(value).toUpperCase()).filter(Boolean) : [];
  return {
    isRecurring: input?.isRecurring === true,
    freq: input?.freq === 'daily' ? 'daily' : 'weekly',
    interval: Math.max(1, Number(input?.interval || 1)),
    byDays,
    endType: input?.endType === 'until' || input?.endType === 'count' ? input.endType : 'never',
    untilValue: compactString(input?.untilValue),
    countValue: Math.max(1, Number(input?.countValue || 10))
  };
}

function buildScheduledPracticePayload(input: SchedulePracticeFormInput, user: AuthUser, options?: {
  editingPracticeId?: string | null;
  editingSeriesId?: string | null;
}) {
  const title = compactString(input.title) || 'Practice';
  const startDate = new Date(input.startDate);
  const endDate = new Date(input.endDate);
  if (Number.isNaN(startDate.getTime())) throw new Error('Practice start time is invalid.');
  if (Number.isNaN(endDate.getTime())) throw new Error('Practice end time is invalid.');
  if (endDate.getTime() <= startDate.getTime()) throw new Error('Practice end time must be after the start time.');

  const practiceData: Record<string, unknown> = {
    type: 'practice',
    title,
    date: startDate,
    end: endDate,
    opponent: null,
    location: compactString(input.location),
    notes: compactString(input.notes),
    scheduleNotifications: input.scheduleNotifications || {},
    status: 'scheduled',
    homeScore: 0,
    awayScore: 0,
    statTrackerConfigId: null,
    createdBy: user.uid
  };

  const recurrence = sanitizePracticeRecurrenceInput(input.recurrence);
  applyPracticeRecurrenceFields({
    practiceData,
    isRecurring: recurrence.isRecurring,
    editingPracticeId: options?.editingPracticeId || null,
    editingSeriesId: options?.editingSeriesId || null,
    recurrenceConfig: recurrence,
    startDate,
    endDate,
    Timestamp,
    deleteField,
    generateSeriesId
  });

  return practiceData;
}

function buildNativePracticePatchPayload(input: SchedulePracticeFormInput, user: AuthUser, options?: { editingPracticeId?: string | null; editingSeriesId?: string | null }) {
  const payload = buildScheduledPracticePayload(input, user, options) as Record<string, unknown>;
  const recurrence = sanitizePracticeRecurrenceInput(input.recurrence);
  const recurrenceFieldNames = ['isSeriesMaster', 'recurrence', 'seriesId', 'startTime', 'endTime', 'endDayOffset', 'exDates', 'overrides'];
  Object.keys(payload).forEach((key) => {
    if (payload[key] === undefined || (options?.editingPracticeId && !recurrence.isRecurring && recurrenceFieldNames.includes(key))) {
      payload[key] = nativeDeleteFieldSentinel;
    }
  });
  return payload;
}

function buildOccurrenceOverridePayload(input: SchedulePracticeFormInput) {
  const title = compactString(input.title) || 'Practice';
  const startDate = new Date(input.startDate);
  const endDate = new Date(input.endDate);
  if (Number.isNaN(startDate.getTime())) throw new Error('Practice start time is invalid.');
  if (Number.isNaN(endDate.getTime())) throw new Error('Practice end time is invalid.');
  if (endDate.getTime() <= startDate.getTime()) throw new Error('Practice end time must be after the start time.');
  return {
    title,
    startTime: startDate.toTimeString().slice(0, 5),
    endTime: endDate.toTimeString().slice(0, 5),
    location: compactString(input.location),
    notes: compactString(input.notes)
  };
}

export async function createScheduledPracticeForApp(teamId: string, input: SchedulePracticeFormInput, user: AuthUser | null) {
  const normalizedTeamId = compactString(teamId);
  if (!normalizedTeamId) throw new Error('Team is required.');
  await requireScheduleImportStaff(normalizedTeamId, user);
  const payload = buildScheduledPracticePayload(input, user as AuthUser);

  try {
    return await withTimeout(Promise.resolve(addPractice(normalizedTeamId, payload)), 'Scheduled practice create');
  } catch (error) {
    if (!isNativeRuntime()) throw error;
    logScheduleWarning('Falling back to REST scheduled practice create.', 'scheduled-practice-create', error, { fallback: 'rest', teamId: normalizedTeamId });
    const doc = await nativeCreateDocument(`teams/${encodeURIComponent(normalizedTeamId)}/games`, {
      ...buildNativePracticePatchPayload(input, user as AuthUser),
      createdAt: new Date()
    });
    return doc?.id || '';
  }
}

export async function updateScheduledPracticeForApp(teamId: string, input: SchedulePracticeFormInput, user: AuthUser | null, options: UpdateScheduledPracticeOptions) {
  const normalizedTeamId = compactString(teamId);
  const normalizedEventId = compactString(options?.eventId);
  if (!normalizedTeamId) throw new Error('Team is required.');
  if (!normalizedEventId) throw new Error('Practice is required.');
  await requireScheduleImportStaff(normalizedTeamId, user);
  const scope = options?.scope === 'occurrence' ? 'occurrence' : 'series';
  const occurrence = scope === 'occurrence'
    ? (options?.instanceDate ? { masterId: normalizedEventId, instanceDate: compactString(options.instanceDate) } : parseRecurringPracticeOccurrenceId(normalizedEventId))
    : null;

  if (scope === 'occurrence') {
    if (!occurrence?.masterId || !occurrence?.instanceDate) throw new Error('A recurring practice occurrence is required.');
    const payload = buildOccurrenceOverridePayload(input);
    try {
      await withTimeout(Promise.resolve(updateOccurrence(normalizedTeamId, occurrence.masterId, occurrence.instanceDate, payload)), 'Scheduled practice occurrence update');
    } catch (error) {
      if (!isNativeRuntime()) throw error;
      logScheduleWarning('Falling back to REST scheduled practice occurrence update.', 'scheduled-practice-occurrence-update', error, { fallback: 'rest', teamId: normalizedTeamId, masterId: occurrence.masterId, instanceDate: occurrence.instanceDate });
      const dotPayload = Object.keys(payload).reduce<Record<string, unknown>>((acc, key) => {
        acc[`overrides.${occurrence.instanceDate}.${key}`] = payload[key as keyof typeof payload];
        return acc;
      }, {});
      await nativePatchDocument(`teams/${encodeURIComponent(normalizedTeamId)}/games/${encodeURIComponent(occurrence.masterId)}`, {
        ...dotPayload,
        updatedAt: new Date(),
        updatedBy: (user as AuthUser).uid
      });
    }
    return { updated: true, scope, eventId: occurrence.masterId, instanceDate: occurrence.instanceDate };
  }

  const payload = buildScheduledPracticePayload(input, user as AuthUser, {
    editingPracticeId: normalizedEventId,
    editingSeriesId: options?.seriesId || null
  });
  try {
    await withTimeout(Promise.resolve(updateEvent(normalizedTeamId, normalizedEventId, payload)), 'Scheduled practice series update');
  } catch (error) {
    if (!isNativeRuntime()) throw error;
    logScheduleWarning('Falling back to REST scheduled practice series update.', 'scheduled-practice-series-update', error, { fallback: 'rest', teamId: normalizedTeamId, eventId: normalizedEventId });
    await nativePatchDocument(`teams/${encodeURIComponent(normalizedTeamId)}/games/${encodeURIComponent(normalizedEventId)}`, {
      ...buildNativePracticePatchPayload(input, user as AuthUser, {
        editingPracticeId: normalizedEventId,
        editingSeriesId: options?.seriesId || null
      }),
      updatedAt: new Date(),
      updatedBy: (user as AuthUser).uid
    });
  }
  return { updated: true, scope, eventId: normalizedEventId };
}

export async function revertScheduledPracticeOccurrenceForApp(teamId: string, eventId: string, user: AuthUser | null) {
  const normalizedTeamId = compactString(teamId);
  if (!normalizedTeamId) throw new Error('Team is required.');
  await requireScheduleImportStaff(normalizedTeamId, user);
  const occurrence = parseRecurringPracticeOccurrenceId(eventId);
  if (!occurrence) throw new Error('A recurring practice occurrence is required.');

  try {
    await withTimeout(Promise.resolve(clearOccurrenceOverride(normalizedTeamId, occurrence.masterId, occurrence.instanceDate)), 'Scheduled practice occurrence revert');
  } catch (error) {
    if (!isNativeRuntime()) throw error;
    logScheduleWarning('Falling back to REST scheduled practice occurrence revert.', 'scheduled-practice-occurrence-revert', error, { fallback: 'rest', teamId: normalizedTeamId, masterId: occurrence.masterId, instanceDate: occurrence.instanceDate });
    await nativePatchDocument(`teams/${encodeURIComponent(normalizedTeamId)}/games/${encodeURIComponent(occurrence.masterId)}`, {
      [`overrides.${occurrence.instanceDate}`]: nativeDeleteFieldSentinel,
      updatedAt: new Date(),
      updatedBy: (user as AuthUser).uid
    });
  }
  return { reverted: true, eventId: occurrence.masterId, instanceDate: occurrence.instanceDate };
}

export async function loadScheduledPracticeSeriesForEdit(teamId: string, eventId: string, user: AuthUser | null) {
  const normalizedTeamId = compactString(teamId);
  if (!normalizedTeamId) throw new Error('Team is required.');
  await requireScheduleImportStaff(normalizedTeamId, user);
  const occurrence = parseRecurringPracticeOccurrenceId(eventId);
  const sourceEventId = occurrence?.masterId || compactString(eventId);
  if (!sourceEventId) throw new Error('Practice is required.');

  const game = await readWithNativeFallback(
    `scheduled practice master ${sourceEventId}`,
    () => Promise.resolve(getGame(normalizedTeamId, sourceEventId)),
    () => nativeGetDocument(`teams/${encodeURIComponent(normalizedTeamId)}/games/${encodeURIComponent(sourceEventId)}`)
  );
  if (!game || game.type !== 'practice') throw new Error('Practice series not found.');

  const startDate = toEventDate(game.date) || new Date();
  const endDate = toEventDate(game.end) || new Date(startDate.getTime() + 90 * 60000);
  const recurrence = sanitizePracticeRecurrenceInput({
    isRecurring: Boolean(game.isSeriesMaster && game.recurrence),
    freq: game.recurrence?.freq,
    interval: game.recurrence?.interval,
    byDays: Array.isArray(game.recurrence?.byDays) ? game.recurrence.byDays : [],
    endType: game.recurrence?.until ? 'until' : (game.recurrence?.count ? 'count' : 'never'),
    untilValue: game.recurrence?.until ? (normalizeScheduleDate(game.recurrence.until)?.toISOString().slice(0, 10) || '') : '',
    countValue: Number(game.recurrence?.count || 10)
  });

  return {
    eventId: sourceEventId,
    seriesId: compactString(game.seriesId) || null,
    input: {
      title: compactString(game.title) || 'Practice',
      startDate,
      endDate,
      location: compactString(game.location),
      notes: compactString(game.notes),
      scheduleNotifications: game.scheduleNotifications && typeof game.scheduleNotifications === 'object' ? game.scheduleNotifications : {},
      recurrence
    } as SchedulePracticeFormInput
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
    logScheduleWarning('Falling back to REST schedule import game create.', 'schedule-import-game-create', error, { fallback: 'rest', teamId: normalizedTeamId });
    const doc = await nativeCreateDocument(`teams/${encodeURIComponent(normalizedTeamId)}/games`, {
      ...payload,
      createdAt: new Date()
    });
    return doc?.id || '';
  }
}

export async function finalizeScheduleImportBatch(teamId: string, batchId: string, totalCount: number, user: AuthUser | null) {
  const normalizedTeamId = compactString(teamId);
  const normalizedBatchId = compactString(batchId);
  const safeTotalCount = Math.max(0, Number.parseInt(String(totalCount || 0), 10) || 0);
  if (!normalizedTeamId) throw new Error('Team is required.');
  if (!normalizedBatchId || safeTotalCount <= 0) return;
  await requireScheduleImportStaff(normalizedTeamId, user);

  await withTimeout(runTransaction(db, async (transaction: any) => {
    transaction.set(doc(db, `teams/${normalizedTeamId}/scheduleImportNotificationBatches/${normalizedBatchId}`), {
      batchId: normalizedBatchId,
      totalCount: safeTotalCount,
      importCompletedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      finalizedBy: user?.uid || null
    }, { merge: true });
  }), 'Schedule import batch finalize');
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
    logScheduleWarning('Falling back to REST schedule import practice create.', 'schedule-import-practice-create', error, { fallback: 'rest', teamId: normalizedTeamId });
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

async function loadPlayer(teamId: string, playerId: string) {
  return readWithNativeFallback(
    `player ${teamId}/${playerId}`,
    async () => {
      const snapshot = await getDoc(doc(db, 'teams', teamId, 'players', playerId));
      if (!snapshot.exists()) return null;
      return { id: snapshot.id || playerId, ...(snapshot.data() || {}) };
    },
    () => nativeGetDocument(`teams/${encodeURIComponent(teamId)}/players/${encodeURIComponent(playerId)}`)
  );
}

function normalizePlayerName(player: any) {
  return compactString(player?.name || player?.displayName || player?.playerName) || 'Player';
}

function normalizePlayerNumber(player: any) {
  return compactString(player?.number ?? player?.num ?? player?.jerseyNumber ?? player?.playerNumber ?? '');
}

function normalizePlayerPhotoUrl(player: any) {
  return compactString(player?.photoUrl || player?.photo);
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

function normalizeAggregatedStatTotals(stats: Record<string, unknown> = {}) {
  return Object.entries(stats).reduce<Record<string, number>>((totals, [key, value]) => {
    const normalizedKey = compactString(key).toLowerCase();
    if (!normalizedKey) return totals;
    totals[normalizedKey] = normalizeGameScoreValue(value);
    return totals;
  }, {});
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
      const stats = normalizeAggregatedStatTotals((statsByPlayerId.get(id) || {}) as Record<string, unknown>);
      return {
        id,
        name: normalizePlayerName(player),
        number: normalizePlayerNumber(player),
        photoUrl: normalizePlayerPhotoUrl(player),
        points: normalizeGameScoreValue(stats.pts),
        fouls: normalizeGameScoreValue(stats.fouls),
        stats
      };
    })
    .filter(Boolean) as ScheduleHomeScoringPlayer[];
}

export async function loadOpponentScoringPlayers(teamId: string): Promise<ScheduleHomeScoringPlayer[]> {
  if (!teamId) return [];
  const players = await loadPlayers(teamId);
  return (Array.isArray(players) ? players : [])
    .filter(isActiveRosterPlayer)
    .map((player: any) => {
      const id = compactString(player?.id);
      if (!id) return null;
      return {
        id,
        name: normalizePlayerName(player),
        number: normalizePlayerNumber(player),
        photoUrl: normalizePlayerPhotoUrl(player),
        points: 0,
        fouls: 0,
        stats: {}
      };
    })
    .filter(Boolean) as ScheduleHomeScoringPlayer[];
}

export async function loadOpponentStatsForGame(teamId: string, gameId: string): Promise<Record<string, ScheduleOpponentStatsEntry>> {
  const normalizedTeamId = compactString(teamId);
  const normalizedGameId = compactString(gameId);
  if (!normalizedTeamId || !normalizedGameId) return {};

  const game = await readWithNativeFallback(
    `game opponent stats ${normalizedTeamId}/${normalizedGameId}`,
    () => Promise.resolve(getGame(normalizedTeamId, normalizedGameId)),
    () => nativeGetDocument(`teams/${encodeURIComponent(normalizedTeamId)}/games/${encodeURIComponent(normalizedGameId)}`)
  ).catch(() => null);
  const opponentStats = game && typeof game === 'object' ? (game as Record<string, unknown>).opponentStats : null;
  if (!opponentStats || typeof opponentStats !== 'object' || Array.isArray(opponentStats)) {
    return {};
  }

  return Object.entries(opponentStats).reduce<Record<string, ScheduleOpponentStatsEntry>>((acc, [entryId, entry]) => {
    const normalizedEntryId = compactString(entryId);
    if (!normalizedEntryId || !entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return acc;
    }
    acc[normalizedEntryId] = { ...(entry as Record<string, unknown>) };
    return acc;
  }, {});
}

function getProfileArray(profile: Record<string, unknown>, key: string) {
  const value = profile[key];
  return Array.isArray(value) ? value : [];
}

function getUserArray(user: AuthUser, key: keyof AuthUser | 'parentTeamIds' | 'parentPlayerKeys') {
  const value = (user as any)[key];
  return Array.isArray(value) ? value : [];
}

function parseParentPlayerKey(value: unknown) {
  const raw = compactString(value);
  const separatorIndex = raw.indexOf('::');
  if (separatorIndex <= 0 || separatorIndex >= raw.length - 2) return null;
  const teamId = compactString(raw.slice(0, separatorIndex));
  const playerId = compactString(raw.slice(separatorIndex + 2));
  if (!teamId || !playerId) return null;
  return { teamId, playerId };
}

function collectParentScopeLinks(user: AuthUser, profile: Record<string, unknown>): ParentScopeLink[] {
  const linksByKey = new Map<string, ParentScopeLink>();

  const addLink = (link: ParentScopeLink) => {
    const key = `${link.teamId}::${link.playerId}`;
    const existing = linksByKey.get(key);
    if (!existing) {
      linksByKey.set(key, link);
      return;
    }
    linksByKey.set(key, {
      ...existing,
      teamName: existing.teamName || link.teamName,
      playerName: existing.playerName === 'Player' ? link.playerName : existing.playerName,
      playerNumber: existing.playerNumber || link.playerNumber,
      playerPhotoUrl: existing.playerPhotoUrl || link.playerPhotoUrl,
      hasMetadata: existing.hasMetadata || link.hasMetadata
    });
  };

  const addParentOfEntry = (entry: any) => {
    const teamId = compactString(entry?.teamId);
    const playerId = compactString(entry?.playerId || entry?.childId);
    if (!teamId || !playerId) return;
    const teamName = compactString(entry?.teamName);
    const playerName = compactString(entry?.playerName || entry?.childName || entry?.name);
    const playerNumber = compactString(entry?.playerNumber || entry?.number);
    const playerPhotoUrl = compactString(entry?.playerPhotoUrl || entry?.photoUrl) || null;
    addLink({
      teamId,
      teamName,
      playerId,
      playerName: playerName || 'Player',
      playerNumber,
      playerPhotoUrl,
      hasMetadata: Boolean(teamName || playerName || playerNumber || playerPhotoUrl)
    });
  };

  const profileParentOf = getProfileArray(profile, 'parentOf');
  const profileParentPlayerKeys = getProfileArray(profile, 'parentPlayerKeys');
  const hasProfileScope = profileParentOf.length > 0 || profileParentPlayerKeys.length > 0;
  const parentOf = hasProfileScope ? profileParentOf : getUserArray(user, 'parentOf');
  const parentPlayerKeys = profileParentPlayerKeys.length > 0 ? profileParentPlayerKeys : getUserArray(user, 'parentPlayerKeys');

  parentOf.forEach(addParentOfEntry);
  parentPlayerKeys
    .map(parseParentPlayerKey)
    .filter(Boolean)
    .forEach((parsed) => {
      addLink({
        teamId: parsed!.teamId,
        teamName: '',
        playerId: parsed!.playerId,
        playerName: 'Player',
        hasMetadata: false
      });
    });

  return [...linksByKey.values()];
}

async function resolveParentScheduleChildren(user: AuthUser, profile: Record<string, unknown>): Promise<ParentScheduleChild[]> {
  const links = collectParentScopeLinks(user, profile);
  if (!links.length) return [];

  const linksByTeam = new Map<string, ParentScopeLink[]>();
  links.forEach((link) => {
    if (!linksByTeam.has(link.teamId)) linksByTeam.set(link.teamId, []);
    linksByTeam.get(link.teamId)?.push(link);
  });

  const batches = await mapWithConcurrency([...linksByTeam.entries()], parentScheduleTeamConcurrency, async ([teamId, teamLinks]) => {
    const rawTeam = await loadRawTeam(teamId).catch((error) => {
      logScheduleWarning('Unable to validate parent-linked team.', 'parent-team-scope-load', error, { teamId });
      return undefined;
    });
    if (rawTeam === null) return [];
    if (rawTeam && !isTeamActive(rawTeam as Record<string, any>)) return [];

    const linkedPlayers = await mapWithConcurrency(teamLinks, parentSchedulePlayerConcurrency, async (link) => {
      const player = await loadPlayer(teamId, link.playerId).catch((error) => {
        logScheduleWarning('Unable to validate parent-linked player.', 'parent-player-scope-load', error, {
          teamId,
          playerId: link.playerId
        });
        return null;
      });
      return { playerId: link.playerId, player };
    });
    const playersById = new Map<string, any>();
    linkedPlayers.forEach(({ playerId, player }) => {
      if (player) {
        const id = compactString(player?.id || player?.playerId);
        playersById.set(id || playerId, player);
      }
    });

    const teamName = compactString((rawTeam as any)?.name) || compactString((rawTeam as any)?.teamName) || '';
    return teamLinks
      .map((link) => {
        const player = playersById.get(link.playerId) || null;
        if (!player || !isActiveRosterPlayer(player)) return null;
        return {
          teamId: link.teamId,
          teamName: teamName || link.teamName,
          playerId: link.playerId,
          playerName: player ? normalizePlayerName(player) : link.playerName || 'Player'
        };
      })
      .filter(Boolean) as ParentScheduleChild[];
  });

  return batches.flat();
}

export async function loadParentScheduleChildren(user: AuthUser | null, options: { profile?: Record<string, unknown> } = {}): Promise<ParentScheduleChild[]> {
  if (!user?.uid) return [];
  const profile = options.profile || await loadProfileDocument(user.uid).catch(() => ({}));
  return resolveParentScheduleChildren(user, profile as Record<string, unknown>);
}

export async function loadParentScheduleScope(user: AuthUser | null): Promise<ParentScheduleScope> {
  if (!user?.uid) {
    return {
      profile: {},
      children: []
    };
  }
  const profile = await loadProfileDocument(user.uid).catch(() => ({}));
  const children = await resolveParentScheduleChildren(user, profile as Record<string, unknown>);
  return {
    profile: profile as Record<string, unknown>,
    children
  };
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

function mergeLoadedGameWithStandingsPool(loadedGame: ScheduleEventFirestoreRecord, standingsGames: ScheduleEventFirestoreRecord[]) {
  const loadedGameId = compactString(loadedGame.id || loadedGame.gameId);
  return [
    loadedGame,
    ...(Array.isArray(standingsGames) ? standingsGames : []).filter((game) => {
      const gameId = compactString(game?.id || game?.gameId);
      return !loadedGameId || gameId !== loadedGameId;
    })
  ];
}

function mergeScheduleStandingsGames(
  scheduleGames: ScheduleEventFirestoreRecord[],
  standingsGroups: ScheduleEventFirestoreRecord[][]
) {
  const merged = [...scheduleGames];
  const seenIds = new Set(scheduleGames.map((game) => compactString(game.id || game.gameId)).filter(Boolean));
  standingsGroups.flat().forEach((game) => {
    const gameId = compactString(game?.id || game?.gameId);
    if (gameId && seenIds.has(gameId)) return;
    if (gameId) seenIds.add(gameId);
    merged.push(game);
  });
  return merged;
}

async function loadTournamentScheduleStandingsGames(
  teamId: string,
  scheduleGames: ScheduleEventFirestoreRecord[]
) {
  const groups = new Map<string, TournamentScheduleGroupQuery>();
  scheduleGames.forEach((game) => {
    const group = getTournamentScheduleGroupQuery(game);
    if (!group || compactString(game.competitionType).toLowerCase() !== 'tournament') return;
    groups.set(`${group.divisionName}\u0000${group.poolName}`, group);
  });
  if (!groups.size) return scheduleGames;

  const standingsGroups = await Promise.all(
    [...groups.values()].map((tournamentGroup) => loadGames(teamId, { tournamentGroup }).catch(() => []))
  );
  return mergeScheduleStandingsGames(scheduleGames, standingsGroups);
}

async function loadRawTeam(teamId: string) {
  return readWithNativeFallback(
    `team ${teamId}`,
    () => Promise.resolve(getTeam(teamId)),
    () => nativeGetDocument(`teams/${encodeURIComponent(teamId)}`)
  );
}

async function loadTeam(teamId: string) {
  const team = await loadRawTeam(teamId);
  return team && isTeamActive(team as Record<string, any>) ? team : null;
}

type ScheduleDateRange = { startDate?: Date | null; endDate?: Date | null };
type ScheduleGamesQuery = ScheduleDateRange & { tournamentGroup?: TournamentScheduleGroupQuery | null };
type ScheduleDateRangeByTeam = Record<string, ScheduleDateRange | undefined>;

function isEventWithinRange(game: any, range: ScheduleDateRange) {
  if (!range.startDate && !range.endDate) return true;
  const date = toEventDate(game?.date);
  if (Number.isNaN(date.getTime())) return true;
  if (range.startDate && date < range.startDate) return false;
  if (range.endDate && date > range.endDate) return false;
  return true;
}

async function loadGames(teamId: string, range: ScheduleGamesQuery = {}): Promise<ScheduleEventFirestoreRecord[]> {
  return readWithNativeFallback(
    `games ${teamId}`,
    async () => mapScheduleEventRecords(await getGames(teamId, range)),
    async () => {
      const docs = range.tournamentGroup
        ? await nativeQueryTournamentScheduleGroupDocuments(teamId, range.tournamentGroup)
        : (range.startDate || range.endDate)
          ? await nativeQueryScheduleEventDocuments(teamId, range)
          : await nativeListScheduleEventDocuments(`teams/${encodeURIComponent(teamId)}/games`);
      const windowed = range.tournamentGroup
        ? docs.filter((doc) => matchesTournamentScheduleGroup(doc, range.tournamentGroup!))
        : (range.startDate || range.endDate)
          ? docs.filter((doc) => isEventWithinRange(doc, range))
          : docs;
      return windowed.sort((a, b) => toEventDate(a.date).getTime() - toEventDate(b.date).getTime());
    }
  );
}

async function loadGameById(teamId: string, gameId: string): Promise<ScheduleEventFirestoreRecord | null> {
  return readWithNativeFallback(
    `game ${teamId}/${gameId}`,
    async () => mapScheduleEventRecord(await getGame(teamId, gameId), gameId),
    () => nativeGetScheduleEventDocument(`teams/${encodeURIComponent(teamId)}/games/${encodeURIComponent(gameId)}`)
  );
}

async function loadPracticeSessions(teamId: string, range: ScheduleDateRange = {}) {
  return readWithNativeFallback(
    `practice sessions ${teamId}`,
    () => Promise.resolve(getPracticeSessions(teamId, range)),
    async () => {
      const docs = await nativeListCollection(`teams/${encodeURIComponent(teamId)}/practiceSessions`);
      const windowed = (range.startDate || range.endDate)
        ? docs.filter((doc) => isEventWithinRange(doc, range))
        : docs;
      return windowed.sort((a, b) => toEventDate(b.date).getTime() - toEventDate(a.date).getTime());
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
    async () => {
      const basePath = `teams/${encodeURIComponent(teamId)}/games/${encodeURIComponent(gameId)}`;
      const rsvps = await nativeListCollection(`${basePath}/rsvps`);
      const notes = await nativeListCollection(`${basePath}/rsvpNotes`).catch(() => []);
      return mergeRsvpNotesIntoRsvps(rsvps.map(stripRsvpPrivateNoteFields), notes);
    }
  );
}

const rsvpPrivateNoteFields = [
  'note',
  'notes',
  'adminNote',
  'adminOnlyNote',
  'privateNote',
  'availabilityNote',
  'privateAvailabilityNote'
];

function stripRsvpPrivateNoteFields(rsvp: any) {
  const sanitized = { ...(rsvp || {}) };
  rsvpPrivateNoteFields.forEach((fieldName) => {
    delete sanitized[fieldName];
  });
  return sanitized;
}

function mergeRsvpNotesIntoRsvps(rsvps: any[] = [], notes: any[] = []) {
  const notesById = new Map(
    (Array.isArray(notes) ? notes : [])
      .filter((note) => note?.id)
      .map((note) => [compactString(note.id), note])
  );
  return (Array.isArray(rsvps) ? rsvps : []).map((rsvp) => {
    const note = notesById.get(compactString(rsvp?.id));
    if (!note) return rsvp;
    return {
      ...rsvp,
      note: compactString(note.note) || null
    };
  });
}

async function loadRsvpNoteById(teamId: string, gameId: string, rsvpId: string) {
  const encodedPath = `teams/${encodeURIComponent(teamId)}/games/${encodeURIComponent(gameId)}/rsvpNotes/${encodeURIComponent(rsvpId)}`;
  return readWithNativeFallback(
    `rsvp note ${teamId}/${gameId}/${rsvpId}`,
    async () => {
      const snap = await getDoc(doc(db, `teams/${teamId}/games/${gameId}/rsvpNotes`, rsvpId));
      return snap.exists() ? { id: snap.id, ...snap.data() } : null;
    },
    () => nativeGetDocument(encodedPath)
  );
}

async function mergeOwnRsvpNotes(teamId: string, gameId: string, rsvps: any[], userId: string) {
  const ownRsvpIds = [...new Set((Array.isArray(rsvps) ? rsvps : [])
    .filter((rsvp) => compactString(rsvp?.userId) === userId)
    .map((rsvp) => compactString(rsvp?.id))
    .filter(Boolean))];
  if (ownRsvpIds.length === 0) return rsvps;

  const results = await Promise.allSettled(ownRsvpIds.map((rsvpId) => loadRsvpNoteById(teamId, gameId, rsvpId)));
  const notes = results
    .filter((result) => result.status === 'fulfilled' && result.value)
    .map((result) => (result as PromiseFulfilledResult<any>).value);
  return mergeRsvpNotesIntoRsvps(rsvps, notes);
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
  teamNotificationEmail?: string | null;
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
  postGameNotes?: string | null;
  summary?: string | null;
  practiceFeedItems?: any[];
  isHome?: boolean | null;
  kitColor?: string | null;
  arrivalTime?: unknown;
  notes?: string | null;
  seasonLabel?: string | null;
  competitionType?: string | null;
  countsTowardSeasonRecord?: boolean | null;
  tournament?: Record<string, any> | null;
  statTrackerConfigId?: string | null;
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
  rotationPlan?: Record<string, any> | null;
  rotationActual?: Record<string, any> | null;
  coachingNotes?: any[];
  liveEvents?: any[];
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
    teamNotificationEmail: compactString(input.teamNotificationEmail) || null,
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
    postGameNotes: input.postGameNotes || null,
    summary: input.summary || null,
    practiceFeedItems: Array.isArray(input.practiceFeedItems) ? input.practiceFeedItems : [],
    canUpdateScore: input.canUpdateScore === true,
    isHome: input.isHome ?? null,
    kitColor: input.kitColor || null,
    arrivalTime,
    notes: input.notes || null,
    seasonLabel: input.seasonLabel || null,
    competitionType: input.competitionType || null,
    countsTowardSeasonRecord: input.countsTowardSeasonRecord ?? null,
    tournament: input.tournament && typeof input.tournament === 'object' ? input.tournament : null,
    statTrackerConfigId: input.statTrackerConfigId || null,
    sourceType: input.sourceType || (input.isDbGame ? 'db' : 'calendar'),
    sourceLabel: input.sourceLabel || (input.isDbGame ? 'ALL PLAYS schedule' : 'Team calendar'),
    isImported: input.isImported === true || !input.isDbGame,
    visibility: input.visibility || null,
    myRsvp: 'not_responded',
    myRsvpNote: null,
    rsvpSummary: input.rsvpSummary || null,
    rideshareSummary: null,
    assignments: Array.isArray(input.assignments) ? input.assignments : [],
    openAssignmentCount: countOpenScheduleAssignments(Array.isArray(input.assignments) ? input.assignments : []),
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
    gamePlan: input.gamePlan || null,
    rotationPlan: input.rotationPlan || null,
    rotationActual: input.rotationActual || null,
    coachingNotes: Array.isArray(input.coachingNotes) ? input.coachingNotes : [],
    liveEvents: Array.isArray(input.liveEvents) ? input.liveEvents : []
  };
}

async function buildTeamSchedule(teamId: string, teamChildren: ParentScheduleChild[], user: AuthUser, options: { includePastGames?: boolean; range?: ScheduleDateRange } = {}) {
  const events: ParentScheduleEvent[] = [];
  // Default schedule views only need upcoming + recent games; window the games
  // query so teams with several seasons of history don't read hundreds of docs
  // on every load (#2034). Explicit history views pass includePastGames.
  const gamesRange: ScheduleDateRange = options.range || (options.includePastGames
    ? {}
    : { startDate: new Date(Date.now() - defaultScheduleHistoryWindowMs) });
  const [team, dbGames, practiceSessions] = await Promise.all([
    loadTeam(teamId),
    loadGames(teamId, gamesRange),
    loadPracticeSessions(teamId, gamesRange)
  ]);
  if (!team) return events;
  const loadedScheduleGames = dbGames || [];
  const standingsGames = (gamesRange.startDate || gamesRange.endDate) && hasTournamentScheduleGames(loadedScheduleGames)
    ? await loadTournamentScheduleStandingsGames(teamId, loadedScheduleGames)
    : loadedScheduleGames;
  const scheduleGames = enrichTournamentScheduleStandings(loadedScheduleGames, team, standingsGames);
  const trackedUids = getTrackedCalendarEventUidsFromLoadedGames(scheduleGames);

  const teamName = compactString(team.name) || teamId;
  const teamWithId = { ...team, id: team.id || teamId };
  const calendarUrls = Array.isArray(team.calendarUrls) ? team.calendarUrls.map(compactString).filter(Boolean) : [];
  const isStaff = isTeamStaff(teamWithId, user);
  const isRsvpReminderManager = isPublicRsvpReminderManager(teamWithId, user);
  teamChildren.forEach((child) => {
    child.teamName = child.teamName || teamName;
  });
  const availabilityPreferences = normalizeAvailabilityPreferences(team.availabilityPreferences);
  const visibleSessions = filterVisiblePracticeSessions(practiceSessions || [], scheduleGames);
  const sessionsByEventId = new Map<string, any>();
  const sessions: any[] = [];
  const matchedSessionIds = new Set<string>();

  visibleSessions.forEach((session: any) => {
    if (session?.eventId) sessionsByEventId.set(session.eventId, session);
    sessions.push({ ...session, _parsedDate: normalizeScheduleDate(session.date) });
  });

  for (const game of scheduleGames) {
    const isPractice = game.type === 'practice';
    const type = isPractice ? 'practice' : 'game';
    const isCancelled = game.status === 'cancelled';

    if (isPractice && game.isSeriesMaster && game.recurrence) {
      for (const occurrence of expandRecurrence(game)) {
        const date = normalizeScheduleDate(occurrence.date) || (occurrence.date ? new Date(occurrence.date) : null);
        if (!date) continue;
        const id = `${occurrence.masterId}__${occurrence.instanceDate}`;
        const session = resolvePracticeSessionForEvent({ id }, date, sessionsByEventId, sessions, matchedSessionIds);
        teamChildren.forEach((child) => {
          events.push(createScheduleEvent({
            teamId,
            teamName,
            teamNotificationEmail: team.notificationEmail || null,
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
            notes: compactString(occurrence.notes) || null,
            seasonLabel: game.seasonLabel || null,
            competitionType: game.competitionType || null,
            countsTowardSeasonRecord: game.countsTowardSeasonRecord ?? null,
            tournament: game.tournament || null,
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
            gamePlan: game.gamePlan || null,
            rotationPlan: game.rotationPlan || null,
            rotationActual: game.rotationActual || null,
            coachingNotes: Array.isArray(game.coachingNotes) ? game.coachingNotes : []
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
          teamNotificationEmail: team.notificationEmail || null,
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
          postGameNotes: game.postGameNotes || null,
          summary: game.summary || null,
          practiceFeedItems: Array.isArray(game.practiceFeedItems) ? game.practiceFeedItems : [],
          canUpdateScore: type === 'game' && hasScorekeepingTeamAccess(user, teamWithId, game, null),
          isHome: game.isHome ?? null,
          kitColor: game.kitColor || null,
          arrivalTime: game.arrivalTime || null,
          notes: game.notes || null,
          seasonLabel: game.seasonLabel || null,
          competitionType: game.competitionType || null,
          countsTowardSeasonRecord: game.countsTowardSeasonRecord ?? null,
          tournament: game.tournament || null,
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
          gamePlan: game.gamePlan || null,
          rotationPlan: game.rotationPlan || null,
          rotationActual: game.rotationActual || null,
          coachingNotes: Array.isArray(game.coachingNotes) ? game.coachingNotes : []
        }));
      });
    }
  }

  if (calendarUrls.length > 0) {
    const calendarResults = await Promise.all(calendarUrls.map(async (calendarUrl: string) => {
      try {
        return await fetchAndParseCalendar(calendarUrl);
      } catch (error) {
        logScheduleWarning('Unable to load team calendar.', 'team-calendar-load', error, { teamId, calendarUrl });
        return [];
      }
    }));

    calendarResults.flat().forEach((calendarEvent: any) => {
      if (isTrackedCalendarEvent(calendarEvent, trackedUids)) return;
      const date = normalizeScheduleDate(calendarEvent.dtstart);
      if (!date) return;
      const hasConflict = scheduleGames.some((dbGame: any) => Math.abs(toEventDate(dbGame.date).getTime() - date.getTime()) < 60000);
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
          teamNotificationEmail: team.notificationEmail || null,
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
          teamNotificationEmail: team.notificationEmail || null,
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
  const occurrenceMatch = eventId.match(/^(.*)__([0-9]{4}-[0-9]{2}-[0-9]{2})$/);
  const [team, initialGame] = await Promise.all([
    loadTeam(teamId),
    loadGameById(teamId, eventId)
  ]);
  if (!team) return [];

  const loadedGame = initialGame || (occurrenceMatch?.[1]
    ? await loadGameById(teamId, occurrenceMatch[1]).catch(() => null)
    : null);
  if (!loadedGame) return [];

  const tournamentGroup = hasTournamentScheduleGames([loadedGame])
    ? getTournamentScheduleGroupQuery(loadedGame)
    : null;
  const standingsGames = tournamentGroup
    ? mergeLoadedGameWithStandingsPool(loadedGame, await loadGames(teamId, { tournamentGroup }).catch(() => []))
    : [loadedGame];
  const game = enrichTournamentScheduleStandings([loadedGame], team, standingsGames)[0];

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

  if (isPractice && game.isSeriesMaster && game.recurrence) {
    const occurrenceDateKey = occurrenceMatch?.[2] || null;
    if (!occurrenceDateKey) return [];
    const occurrence = expandRecurrence(game).find((candidate) => (
      compactString(candidate?.instanceDate) === occurrenceDateKey ||
      compactString(`${candidate?.masterId || normalizedId}__${candidate?.instanceDate || ''}`) === eventId
    ));
    if (!occurrence) return [];

    const occurrenceDate = normalizeScheduleDate(occurrence.date) || (occurrence.date ? new Date(occurrence.date) : null);
    if (!occurrenceDate) return [];
    return teamChildren.map((child) => createScheduleEvent({
      teamId,
      teamName,
      teamNotificationEmail: team.notificationEmail || null,
      child,
      id: eventId,
      type: 'practice',
      date: occurrenceDate,
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
      notes: game.notes || null,
      seasonLabel: game.seasonLabel || null,
      competitionType: game.competitionType || null,
      countsTowardSeasonRecord: game.countsTowardSeasonRecord ?? null,
      tournament: game.tournament || null,
      statTrackerConfigId: game.statTrackerConfigId || null,
      sourceType: game.sourceMetadata?.sourceType || game.source || 'db',
      sourceLabel: getScheduleSourceLabel(game),
      isImported: Boolean(game.sourceMetadata || game.source === 'calendar' || game.source === 'registration'),
      visibility: game.visibility || null,
      assignments: Array.isArray(game.assignments) ? game.assignments : [],
      rsvpSummary: game.rsvpSummary || null,
      practiceAttendance: hasRecordedAttendance(session?.attendance) ? session?.attendance : null,
      practiceHomePacket: hasHomePacket(session) ? session?.homePacketContent : null,
      practiceSessionId: compactString(session?.id) || null,
      availabilityPreferences,
      isTeamAdmin: isRsvpReminderManager,
      isTeamStaff: isStaff,
      isTeamRsvpReminderManager: isRsvpReminderManager,
      gamePlan: game.gamePlan || null,
      rotationPlan: game.rotationPlan || null,
      rotationActual: game.rotationActual || null,
      coachingNotes: Array.isArray(game.coachingNotes) ? game.coachingNotes : []
    }));
  }

  teamChildren.forEach((child) => {
    child.teamName = child.teamName || teamName;
  });

  return teamChildren.map((child) => createScheduleEvent({
    teamId,
    teamName,
    teamNotificationEmail: team.notificationEmail || null,
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
    tournament: game.tournament || null,
    statTrackerConfigId: game.statTrackerConfigId || null,
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
    gamePlan: game.gamePlan || null,
    rotationPlan: game.rotationPlan || null,
    rotationActual: game.rotationActual || null,
    coachingNotes: Array.isArray(game.coachingNotes) ? game.coachingNotes : []
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

  await Promise.all(uniqueEventKeys.map(async (key) => {
    const [teamId, gameId] = key.split('::');
    const matchingEvents = events.filter((event) => event.teamId === teamId && event.id === gameId);
    const firstEvent = matchingEvents[0];
    if (!firstEvent) return;

    const { rsvps: loadedRsvps, offers, claims } = await loadCachedEventHydrationDetails(teamId, gameId);
    const rsvps = await mergeOwnRsvpNotes(teamId, gameId, loadedRsvps, user.uid);
    const myRsvpByChild = resolveMyRsvpByChildForGame(events, teamId, gameId, rsvps, user.uid);
    const myRsvpNotesByChild = resolveMyRsvpNotesByChildForGame(events, teamId, gameId, rsvps, user.uid);
    const summary = firstEvent.rsvpSummary || summarizeRsvps(rsvps);
    const rideshareSummary = getEventRideshareSummary(offers) as ScheduleRideSummary;
    const assignments = mergeAssignmentsWithClaims(firstEvent.assignments, claims) as ScheduleAssignment[];
    const openAssignmentCount = countOpenScheduleAssignments(assignments);
    const preferences = firstEvent.availabilityPreferences || {};
    const isTeamAdmin = matchingEvents.some((event) => event.isTeamAdmin === true);
    const availabilityNotesVisible = canViewAvailabilityNotes(preferences, isTeamAdmin);
    const availabilityNotes = buildAvailabilityNoteRows(rsvps, preferences, isTeamAdmin);

    matchingEvents.forEach((event) => {
      event.myRsvp = normalizeRsvpResponse(myRsvpByChild[event.childId]);
      event.myRsvpNote = myRsvpNotesByChild[event.childId] || null;
      event.rsvpSummary = summary;
      event.rideshareSummary = rideshareSummary;
      event.assignments = assignments;
      event.openAssignmentCount = openAssignmentCount;
      event.availabilityNotesVisible = availabilityNotesVisible;
      event.availabilityNotes = availabilityNotes;
    });
  }));

  return events;
}

function shouldEagerlyHydrateParentHomeEvent(event: ParentScheduleEvent, nowMs = Date.now()) {
  const eventTime = event.date?.getTime?.();
  if (!Number.isFinite(eventTime)) return false;
  return eventTime >= nowMs - parentHomeHydrationLookBehindMs
    && eventTime <= nowMs + parentHomeHydrationLookAheadMs;
}

function loadCachedEventHydrationDetails(teamId: string, gameId: string) {
  return loadCachedAppData(
    `event-details:${teamId}:${gameId}`,
    async () => {
      const results = await Promise.allSettled([
        loadRsvps(teamId, gameId),
        loadRideOffers(teamId, gameId),
        loadAssignmentClaims(teamId, gameId)
      ]);
      const firstRejected = results.find((result) => result.status === 'rejected');
      if (firstRejected && results.every((result) => result.status === 'rejected')) {
        throw firstRejected.reason;
      }
      const [rsvpsResult, offersResult, claimsResult] = results;
      return {
        rsvps: rsvpsResult.status === 'fulfilled' ? rsvpsResult.value : [],
        offers: offersResult.status === 'fulfilled' ? offersResult.value : [],
        claims: claimsResult.status === 'fulfilled' ? claimsResult.value : {}
      };
    },
    {
      ttlMs: scheduleHydrationCacheTtlMs,
      persist: false
    }
  );
}

export async function hydrateParentScheduleDetails(schedule: ParentScheduleLoadResult, user: AuthUser | null): Promise<ParentScheduleLoadResult> {
  if (!user?.uid || !schedule.events.length) {
    return schedule;
  }
  await hydrateEventDetails(schedule.events.filter((event) => shouldEagerlyHydrateParentHomeEvent(event)), user);
  return schedule;
}

async function buildParentScheduleTeamChildren(user: AuthUser, profile: Record<string, unknown>, options: ParentScheduleLoadOptions = {}) {
  const expandStaffPlayers = options.expandStaffPlayers !== false;
  const children = options.parentScope?.children || await resolveParentScheduleChildren(user, profile as Record<string, unknown>);
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

/**
 * Resolve already-cached schedule events for a route target from the parent
 * schedule summary cache, so ScheduleEventDetail can warm-start from known data
 * instead of showing a cold full-page skeleton (#2649). Returns every matching
 * child-event row for the event.
 */
export function resolveCachedParentScheduleEvents(
  userId: string,
  teamId: string,
  eventId: string
): ParentScheduleEvent[] {
  const normalizedTeamId = compactString(teamId);
  const normalizedEventId = compactString(eventId);
  if (!userId || !normalizedTeamId || !normalizedEventId) {
    return [];
  }
  const cached = getCachedAppData<ParentScheduleLoadResult>(getParentScheduleSummaryCacheKey(userId));
  if (!cached?.events?.length) {
    return [];
  }
  return cached.events.filter(
    (event) => event.teamId === normalizedTeamId && event.id === normalizedEventId
  );
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
      // Full history here so a deep-linked past event outside the default window is still found.
      const teamEvents = await buildTeamSchedule(requestedTeamId, teamChildren, user, { includePastGames: true });
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
    const children = await resolveParentScheduleChildren(user, profile as Record<string, unknown>);
    let child = (requestedTeamId && requestedPlayerId)
      ? children.find((entry) => entry.teamId === requestedTeamId && entry.playerId === requestedPlayerId)
      : children.find((entry) => entry.playerId === requestedPlayerId);

    if (!child && requestedTeamId) {
      const team = await loadTeam(requestedTeamId).catch(() => null);
      const teamWithId = team ? { ...team, id: team.id || requestedTeamId } : null;
      if (teamWithId && isTeamStaff(teamWithId, user)) {
        const player = (await loadPlayers(requestedTeamId).catch(() => []))
          .find((entry: any) => compactString(entry?.id) === requestedPlayerId && isActiveRosterPlayer(entry));
        if (player) {
          child = {
            teamId: requestedTeamId,
            teamName: compactString(teamWithId.name) || requestedTeamId,
            playerId: requestedPlayerId,
            playerName: normalizePlayerName(player)
          };
          children.push(child);
        }
      }
    }

    if (!child) {
      timer.end({ hydrateDetails, teamId: requestedTeamId || null, playerId: requestedPlayerId, childLinks: children.length, eventRows: 0 });
      return { children, events: [] };
    }

    // Single-player view: keep full history so past games still appear.
    const events = await buildTeamSchedule(child.teamId, [child], user, { includePastGames: true });
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
  const cachedSchedule = getCachedAppData<ParentScheduleLoadResult>(getParentScheduleSummaryCacheKey(user.uid));
  const cachedMatch = (cachedSchedule?.events || []).find((event) => (
    compactString(event?.id) === requestedGameId
    && event?.type === 'game'
    && compactString(event?.teamId)
  ));

  if (cachedMatch) {
    const childId = compactString(cachedMatch.childId);
    const resolution = {
      teamId: compactString(cachedMatch.teamId),
      eventId: requestedGameId,
      childId: childId && !childId.startsWith(`staff-team-${compactString(cachedMatch.teamId)}`) ? childId : null,
      cachedEvent: cachedMatch
    };
    timer.end({ gameId: requestedGameId, expandStaffPlayers, cacheHit: true, matched: true });
    return resolution;
  }

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
        logScheduleWarning('Failed to resolve game route for team.', 'parent-game-route-resolve', error, { teamId, gameId: requestedGameId });
        return null;
      }
    });

    const resolution = matches.find(Boolean) || null;
    timer.end({ gameId: requestedGameId, expandStaffPlayers, cacheHit: false, childLinks: children.length, teams: byTeam.size, staffTeams: staffTeams.length, matched: Boolean(resolution) });
    return resolution;
  } catch (error: any) {
    timer.end({ gameId: requestedGameId, expandStaffPlayers, cacheHit: false, error: error?.message || 'Unable to resolve game route.' });
    throw error;
  }
}

export async function loadParentSchedule(user: AuthUser | null, options: ParentScheduleLoadOptions = {}): Promise<ParentScheduleLoadResult> {
  if (!user?.uid) {
    return { children: [], events: [] };
  }
  const timer = startUxTimer('parent schedule service load', {
    category: 'service_load',
    service: 'schedule',
    operation: 'parent-schedule-load'
  });
  const hydrateDetails = options.hydrateDetails !== false;
  const expandStaffPlayers = options.expandStaffPlayers !== false;
  const includePastGames = options.includePastGames === true;
  const scheduleRangeByTeam = options.scheduleRangeByTeam || null;

  try {
    const canReuseParentScope = hasResolvedParentProfile(options.parentScope?.profile);
    const profile = canReuseParentScope
      ? options.parentScope!.profile
      : await loadProfileDocument(user.uid);
    const { children, byTeam, staffTeams } = await buildParentScheduleTeamChildren(user, profile as Record<string, unknown>, {
      ...options,
      expandStaffPlayers,
      parentScope: canReuseParentScope ? options.parentScope : undefined
    });

    const teamEntries = [...byTeam.entries()];
    const teamResults = await mapWithConcurrency(teamEntries, parentScheduleTeamConcurrency, async ([teamId, teamChildren]) => {
      try {
        return {
          teamId,
          events: await buildTeamSchedule(teamId, teamChildren, user, {
            includePastGames,
            range: scheduleRangeByTeam?.[teamId]
          }),
          error: null
        };
      } catch (error) {
        const appError = toAppServiceError(error, 'Unable to load schedule.');
        logScheduleWarning('Failed to load team schedule.', 'team-schedule-load', error, { teamId });
        return {
          teamId,
          events: [] as ParentScheduleEvent[],
          error: appError
        };
      }
    });

    const failedTeamLoads = teamResults.filter((result) => result.error);
    if (failedTeamLoads.length === teamResults.length && failedTeamLoads.length > 0) {
      rethrowScheduleLoadError(failedTeamLoads[0].error);
    }
    if (failedTeamLoads.length > 0) {
      logScheduleWarning('Continuing with partial team schedule data.', 'parent-schedule-partial-load', failedTeamLoads[0].error, {
        failedTeamIds: failedTeamLoads.map((result) => result.teamId),
        failedTeams: failedTeamLoads.length,
        totalTeams: teamResults.length
      });
    }

    const events = teamResults.flatMap((result) => result.events).sort((a, b) => a.date.getTime() - b.date.getTime());
    if (hydrateDetails) {
      await hydrateEventDetails(events, user);
    }
    const isPartial = failedTeamLoads.length > 0;
    timer.end({
      hydrateDetails,
      expandStaffPlayers,
      childLinks: children.length,
      teams: byTeam.size,
      staffTeams: staffTeams.length,
      eventRows: events.length,
      isPartial
    });
    return { children, events, isPartial };
  } catch (error: any) {
    timer.end({ hydrateDetails, expandStaffPlayers, error: error?.message || 'Unable to load parent schedule.' });
    throw error;
  }
}

async function nativeSubmitRsvpForPlayer(teamId: string, gameId: string, user: AuthUser, childId: string, response: RsvpResponse, note = '', visibility: 'admins' | 'team' = 'admins') {
  const docId = `${user.uid}__${childId}`;
  const respondedAt = new Date();
  await nativePatchDocument(`teams/${encodeURIComponent(teamId)}/games/${encodeURIComponent(gameId)}/rsvps/${encodeURIComponent(docId)}`, {
    userId: user.uid,
    displayName: user.displayName || user.email || null,
    playerIds: [childId],
    playerId: childId,
    childId,
    response,
    respondedAt
  });
  await nativePatchDocument(`teams/${encodeURIComponent(teamId)}/games/${encodeURIComponent(gameId)}/rsvpNotes/${encodeURIComponent(docId)}`, {
    userId: user.uid,
    displayName: user.displayName || user.email || null,
    playerIds: [childId],
    playerId: childId,
    childId,
    response,
    respondedAt,
    note: compactString(note) || null,
    visibility,
    updatedAt: new Date()
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

async function loadStaffRsvpEventData(event: ParentScheduleEvent): Promise<StaffRsvpEventData> {
  try {
    // The breakdown fans out across every roster player + their RSVPs, so it
    // needs more headroom than the default primary-data timeout.
    const source = await withTimeout(Promise.resolve(getRsvpBreakdownByPlayer(event.teamId, event.id)), 'Staff RSVP event data', 15000);
    return {
      breakdown: normalizeStaffScheduleRsvpBreakdown(source),
      reminderPreview: buildStaffRsvpReminderPreview(source?.players, source?.rsvps)
    };
  } catch (error) {
    if (!isNativeRuntime()) throw error;
    logScheduleWarning('Falling back to REST staff RSVP event data load.', 'staff-rsvp-event-data-load', error, { fallback: 'rest', teamId: event.teamId, gameId: event.id });
    const [players, rsvps] = await Promise.all([
      loadPlayers(event.teamId),
      loadRsvps(event.teamId, event.id)
    ]);
    return {
      breakdown: normalizeStaffScheduleRsvpBreakdown(buildGameDayRsvpBreakdown({ players, rsvps })),
      reminderPreview: buildStaffRsvpReminderPreview(players, rsvps)
    };
  }
}

export async function loadStaffScheduleRsvpBreakdown(event: ParentScheduleEvent, user: AuthUser | null): Promise<StaffScheduleRsvpBreakdown> {
  assertStaffRsvpManagementEvent(event, user);
  return (await loadStaffRsvpEventData(event)).breakdown;
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
    logScheduleWarning('Falling back to REST staff RSVP override.', 'staff-rsvp-override', error, { fallback: 'rest', teamId: event.teamId, gameId: event.id, playerId: normalizedPlayerId });
    await nativeSubmitRsvpForPlayer(event.teamId, event.id, user!, normalizedPlayerId, response, '', event.availabilityNoteVisibility === 'team' ? 'team' : 'admins');
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
    if (!isNativeRuntime()) {
      throw error;
    }
    logScheduleWarning('Falling back to REST RSVP submit.', 'parent-rsvp-submit', error, { fallback: 'rest', teamId: event.teamId, gameId: event.id, childId: event.childId });
    return nativeSubmitRsvpForPlayer(event.teamId, event.id, user, event.childId, response, note, event.availabilityNoteVisibility === 'team' ? 'team' : 'admins');
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
    logScheduleWarning('Falling back to REST score update.', 'game-score-update', error, { fallback: 'rest', teamId, gameId });
    await nativePatchDocument(`teams/${encodeURIComponent(teamId)}/games/${encodeURIComponent(gameId)}`, payload);
  }

  return payload;
}

/**
 * Atomically apply a score delta to a live game (#3419).
 *
 * The live stat tracker used to compute the new score from client-local state and
 * write it as an absolute value, so two devices tracking the same game clobbered
 * each other's score (while the increment()-based aggregate stats stayed correct).
 * This reads-modifies-writes the game score inside a Firestore transaction, so
 * concurrent writers each add their delta to the authoritative server value.
 *
 * `updateGameScore` remains the absolute setter for manual score edits.
 */
export async function adjustGameScore(
  teamId: string,
  gameId: string,
  scoreDelta: GameScoreInput,
  user: AuthUser
) {
  if (!teamId || !gameId) {
    throw new Error('A scheduled game is required before updating the score.');
  }
  if (!user?.uid) {
    throw new Error('Sign in before updating the score.');
  }

  const homeDelta = Math.trunc(Number(scoreDelta.homeScore) || 0);
  const awayDelta = Math.trunc(Number(scoreDelta.awayScore) || 0);
  const scoreStreamSessionId = compactString(scoreDelta.scoreStreamSessionId);
  if (homeDelta === 0 && awayDelta === 0) {
    return { homeScore: null, awayScore: null, shared: false };
  }

  const gameRef = doc(db, `teams/${teamId}/games/${gameId}`);

  const buildPayload = (current: Record<string, any>) => {
    const payload: Record<string, unknown> = {
      homeScore: normalizeGameScoreValue(normalizeGameScoreValue(current?.homeScore) + homeDelta),
      awayScore: normalizeGameScoreValue(normalizeGameScoreValue(current?.awayScore) + awayDelta),
      scoreUpdatedAt: new Date(),
      scoreUpdatedBy: user.uid
    };
    if (scoreStreamSessionId) {
      payload.scoreStreamSessionId = scoreStreamSessionId;
    }
    return payload;
  };

  let resolved: Record<string, unknown> & { homeScore: number; awayScore: number };
  let shared = false;
  try {
    resolved = await runTransaction(db, async (transaction: any) => {
      const snapshot = await transaction.get(gameRef);
      const exists = typeof snapshot.exists === 'function' ? snapshot.exists() : snapshot.exists === true;
      if (!exists) {
        throw new Error('Scheduled game not found.');
      }
      const current = snapshot.data?.() || {};
      shared = Boolean(current.sharedScheduleId);
      const counterpartTeamId = shared ? compactString(current.sharedScheduleOpponentTeamId) : '';
      const counterpartGameId = shared ? compactString(current.sharedScheduleOpponentGameId) : '';
      const counterpartRef = counterpartTeamId && counterpartGameId
        ? doc(db, `teams/${counterpartTeamId}/games/${counterpartGameId}`)
        : null;
      if (counterpartRef) {
        const counterpartSnapshot = await transaction.get(counterpartRef);
        const counterpartExists = typeof counterpartSnapshot.exists === 'function'
          ? counterpartSnapshot.exists()
          : counterpartSnapshot.exists === true;
        if (!counterpartExists) {
          throw new Error('Shared scheduled game counterpart not found.');
        }
      }
      const payload = buildPayload(current);
      transaction.set(gameRef, payload, { merge: true });
      if (counterpartRef) {
        transaction.set(counterpartRef, {
          homeScore: payload.awayScore,
          awayScore: payload.homeScore,
          scoreUpdatedAt: payload.scoreUpdatedAt,
          scoreUpdatedBy: payload.scoreUpdatedBy,
          ...(scoreStreamSessionId ? { scoreStreamSessionId } : {})
        }, { merge: true });
      }
      return payload as Record<string, unknown> & { homeScore: number; awayScore: number };
    });
  } catch (error) {
    if (!isNativeRuntime()) throw error;
    logScheduleWarning('Falling back to REST score adjust.', 'game-score-adjust', error, { fallback: 'rest', teamId, gameId });
    const current = await nativeGetDocument(`teams/${encodeURIComponent(teamId)}/games/${encodeURIComponent(gameId)}`);
    if (!current) {
      throw new Error('Scheduled game not found.');
    }
    shared = Boolean((current as Record<string, any>).sharedScheduleId);
    resolved = buildPayload(current as Record<string, any>) as Record<string, unknown> & { homeScore: number; awayScore: number };
    const counterpartTeamId = shared ? compactString((current as Record<string, any>).sharedScheduleOpponentTeamId) : '';
    const counterpartGameId = shared ? compactString((current as Record<string, any>).sharedScheduleOpponentGameId) : '';
    let counterpartPath = '';
    if (counterpartTeamId && counterpartGameId) {
      counterpartPath = `teams/${encodeURIComponent(counterpartTeamId)}/games/${encodeURIComponent(counterpartGameId)}`;
      const counterpart = await nativeGetDocument(counterpartPath);
      if (!counterpart) {
        throw new Error('Shared scheduled game counterpart not found.');
      }
    }
    await nativePatchDocument(`teams/${encodeURIComponent(teamId)}/games/${encodeURIComponent(gameId)}`, resolved);
    if (counterpartPath) {
      await nativePatchDocument(counterpartPath, {
        homeScore: resolved.awayScore,
        awayScore: resolved.homeScore,
        scoreUpdatedAt: resolved.scoreUpdatedAt,
        scoreUpdatedBy: resolved.scoreUpdatedBy,
        ...(scoreStreamSessionId ? { scoreStreamSessionId } : {})
      });
    }
  }

  return { ...resolved, shared };
}

export async function completeGameWrapupForApp(teamId: string, gameId: string, payload: Record<string, unknown>, user: AuthUser) {
  if (!teamId || !gameId) {
    throw new Error('A scheduled game is required before completing wrap-up.');
  }
  if (!user?.uid) {
    throw new Error('Sign in before completing wrap-up.');
  }

  const wrappedPayload = {
    ...payload,
    wrapupUpdatedAt: new Date(),
    wrapupUpdatedBy: user.uid
  };

  try {
    await withTimeout(Promise.resolve(updateGame(teamId, gameId, wrappedPayload)), 'Wrap-up save');
  } catch (error) {
    if (!isNativeRuntime()) throw error;
    logScheduleWarning('Falling back to REST wrap-up save.', 'game-wrapup-save', error, { fallback: 'rest', teamId, gameId });
    await nativePatchDocument(`teams/${encodeURIComponent(teamId)}/games/${encodeURIComponent(gameId)}`, wrappedPayload);
  }

  return wrappedPayload;
}

function buildLiveScoreUpdateDescription(score: GameScoreSnapshot) {
  return `Score update: Home ${normalizeGameScoreValue(score.homeScore)}, Away ${normalizeGameScoreValue(score.awayScore)}.`;
}

function createAppLiveEventId() {
  return `app-live-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export type LiveGameClockSnapshot = {
  persistedClockMs: number;
  effectiveClockMs: number;
  running: boolean;
  period: string;
  updatedAt: Date;
};

function toClockDate(value: unknown, fallback = new Date()) {
  const normalized = normalizeScheduleDate(value);
  return normalized || fallback;
}

function normalizeClockMs(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

export function buildLiveGameClockPeriods(game: Record<string, any> | null | undefined) {
  const formation = game?.gamePlan || game?.rotationPlan || game || {};
  const periods = getPeriodsForFormation(formation).map((period: unknown) => compactString(period)).filter(Boolean);
  const activePeriod = compactString(game?.liveClockPeriod) || compactString(game?.period);
  if (activePeriod && !periods.includes(activePeriod)) {
    periods.unshift(activePeriod);
  }
  return periods.length ? periods : ['H1', 'H2'];
}

export function resolveLiveGameClockSnapshot(game: Record<string, any> | null | undefined, now = new Date()): LiveGameClockSnapshot {
  const persistedClockMs = normalizeClockMs(game?.liveClockMs ?? game?.gameClockMs);
  const running = game?.liveClockRunning === true;
  const updatedAt = toClockDate(game?.liveClockUpdatedAt ?? game?.clockUpdatedAt, now);
  const elapsedSinceUpdateMs = running ? Math.max(0, now.getTime() - updatedAt.getTime()) : 0;
  const periods = buildLiveGameClockPeriods(game);
  const requestedPeriod = compactString(game?.liveClockPeriod) || compactString(game?.period) || periods[0] || 'H1';
  const period = periods.includes(requestedPeriod) ? requestedPeriod : periods[0] || requestedPeriod;

  return {
    persistedClockMs,
    effectiveClockMs: persistedClockMs + elapsedSinceUpdateMs,
    running,
    period,
    updatedAt
  };
}

export async function updateLiveGameClockState(teamId: string, gameId: string, clock: {
  liveClockMs?: unknown;
  liveClockRunning?: boolean;
  liveClockPeriod?: string | null;
  currentGame?: Record<string, any> | null;
}, user: AuthUser) {
  if (!teamId || !gameId) {
    throw new Error('A scheduled game is required before updating the live clock.');
  }
  if (!user?.uid) {
    throw new Error('Sign in before updating the live clock.');
  }

  assertGameAllowsLivePublishing(clock.currentGame);
  const now = new Date();
  const periods = buildLiveGameClockPeriods({ ...(clock.currentGame || {}), liveClockPeriod: clock.liveClockPeriod });
  const requestedPeriod = compactString(clock.liveClockPeriod) || compactString(clock.currentGame?.liveClockPeriod) || compactString(clock.currentGame?.period) || periods[0] || 'H1';
  const period = periods.includes(requestedPeriod) ? requestedPeriod : periods[0] || requestedPeriod;
  const payload: Record<string, unknown> = {
    liveClockMs: normalizeClockMs(clock.liveClockMs),
    liveClockRunning: clock.liveClockRunning === true,
    liveClockPeriod: period,
    liveClockUpdatedAt: now,
    liveClockUpdatedBy: user.uid,
    period,
    ...buildLiveTrackingGamePatch(clock.currentGame, user, now)
  };

  try {
    await withTimeout(Promise.resolve(updateGame(teamId, gameId, payload)), 'Live clock update');
  } catch (error) {
    if (!isNativeRuntime()) throw error;
    logScheduleWarning('Falling back to REST live clock update.', 'live-clock-update', error, { fallback: 'rest', teamId, gameId });
    await nativePatchDocument(`teams/${encodeURIComponent(teamId)}/games/${encodeURIComponent(gameId)}`, payload);
  }

  return payload;
}

function getLiveEventPeriod(game: Record<string, any> | null | undefined) {
  if (!compactString(game?.liveClockPeriod) && !compactString(game?.period)) return null;
  return resolveLiveGameClockSnapshot(game).period || compactString(game?.liveClockPeriod) || compactString(game?.period) || null;
}

function getLiveEventClockMs(game: Record<string, any> | null | undefined) {
  return resolveLiveGameClockSnapshot(game).effectiveClockMs;
}

function isFinalLiveTrackingStatus(value: unknown) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'completed' || normalized === 'final';
}

// Games are only ever live for a few hours; reject live publishing once a game's
// scheduled date is well past so a stray late score update can't flip a stale game
// to liveStatus: 'live' and leave it stuck there (#2022). Finalizing still happens
// through Game Wrapup (completeGameWrapupForApp writes liveStatus: 'completed').
const liveTrackingMaxStalenessMs = 3 * 24 * 60 * 60 * 1000;

function assertGameAllowsLivePublishing(game: Record<string, any> | null | undefined) {
  if (isFinalLiveTrackingStatus(game?.status) || isFinalLiveTrackingStatus(game?.liveStatus)) {
    throw new Error('Live play-by-play is unavailable after the game is final.');
  }
  if (game?.date) {
    const scheduledDate = toEventDate(game.date);
    if (!Number.isNaN(scheduledDate.getTime()) && Date.now() - scheduledDate.getTime() > liveTrackingMaxStalenessMs) {
      throw new Error('Live play-by-play is unavailable for past games. Use Game Wrapup to set the final score.');
    }
  }
}

function buildLiveTrackingGamePatch(game: Record<string, any> | null | undefined, _user: AuthUser, now: Date) {
  const payload: Record<string, unknown> = {};
  if (String(game?.liveStatus || '').trim().toLowerCase() !== 'live') {
    payload.liveStatus = 'live';
  }
  if (game?.liveHasData !== true) {
    payload.liveHasData = true;
  }
  if (!game?.liveStartedAt) {
    payload.liveStartedAt = now;
  }
  return payload;
}

async function runNativeScoreUpdatePublish(
  teamId: string,
  gameId: string,
  score: GameScoreSnapshot,
  user: AuthUser,
  previousScore?: Partial<GameScoreSnapshot> | null,
  createdAt = new Date()
) {
  const gamePath = `teams/${encodeURIComponent(teamId)}/games/${encodeURIComponent(gameId)}`;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const snapshot = await nativeGetDocumentSnapshot(gamePath);
      const currentGame = (snapshot.document || {}) as Record<string, unknown>;
      assertGameAllowsLivePublishing(currentGame);
      const liveGamePatch = buildLiveTrackingGamePatch(currentGame, user, createdAt);
      const payload = {
        eventId: createAppLiveEventId(),
        type: 'score_update',
        period: getLiveEventPeriod(currentGame),
        gameClockMs: getLiveEventClockMs(currentGame),
        description: buildLiveScoreUpdateDescription(score),
        homeScore: normalizeGameScoreValue(score.homeScore),
        awayScore: normalizeGameScoreValue(score.awayScore),
        previousHomeScore: previousScore?.homeScore !== undefined ? normalizeGameScoreValue(previousScore.homeScore) : normalizeGameScoreValue(currentGame?.homeScore),
        previousAwayScore: previousScore?.awayScore !== undefined ? normalizeGameScoreValue(previousScore.awayScore) : normalizeGameScoreValue(currentGame?.awayScore),
        createdBy: user.uid,
        createdByName: user.displayName || user.email || 'Staff',
        createdAt
      };
      await nativeCommitWrites([
        {
          update: {
            name: getFirestoreDocumentName(`teams/${teamId}/games/${gameId}`),
            fields: buildFirestoreFields({
              homeScore: payload.homeScore,
              awayScore: payload.awayScore,
              scoreUpdatedAt: createdAt,
              scoreUpdatedBy: user.uid,
              ...liveGamePatch
            })
          },
          updateMask: {
            fieldPaths: ['homeScore', 'awayScore', 'scoreUpdatedAt', 'scoreUpdatedBy', ...Object.keys(liveGamePatch)]
          },
          currentDocument: snapshot.exists
            ? { updateTime: snapshot.updateTime }
            : { exists: false }
        },
        {
          update: {
            name: getFirestoreDocumentName(`teams/${teamId}/games/${gameId}/liveEvents/${payload.eventId}`),
            fields: buildFirestoreFields(payload)
          },
          currentDocument: { exists: false }
        }
      ]);
      updateLocalLiveGameSnapshot(teamId, gameId, (local) => ({
        ...local,
        homeScore: payload.homeScore,
        awayScore: payload.awayScore
      }));
      return payload;
    } catch (error) {
      if (isNativeConflictError(error) && attempt < 2) continue;
      throw error;
    }
  }
  throw new Error('Unable to publish live score update.');
}

export async function flushPendingLivePublishOperations(
  queue: PendingLivePublishOperation[],
  processor: (operation: PendingLivePublishOperation) => Promise<void>
) {
  const remaining: PendingLivePublishOperation[] = [];
  for (let index = 0; index < queue.length; index += 1) {
    const operation = queue[index];
    try {
      await processor(operation);
    } catch (error) {
      remaining.push(operation);
      if (isNativeOfflineError(error)) {
        remaining.push(...queue.slice(index + 1));
        break;
      }
    }
  }
  return remaining;
}

async function flushPendingLivePublishQueue() {
  if (!isNativeRuntime()) return;
  if (livePublishQueueFlushPromise) return livePublishQueueFlushPromise;

  livePublishQueueFlushPromise = (async () => {
    const queue = readPendingLivePublishQueue();
    if (!queue.length) return;
    const remaining = await flushPendingLivePublishOperations(queue, async (operation) => {
      if (operation.kind === 'score_update') {
        await runNativeScoreUpdatePublish(
          operation.teamId,
          operation.gameId,
          operation.score,
          operation.user as AuthUser,
          operation.previousScore,
          new Date(operation.createdAt)
        );
        return;
      }
      await runNativePlayerGameStatWrite(
        operation.teamId,
        operation.gameId,
        operation.playerId,
        operation.stat,
        operation.user as AuthUser,
        new Date(operation.createdAt)
      );
    });
    writePendingLivePublishQueue(remaining);
  })().finally(() => {
    livePublishQueueFlushPromise = null;
  });
  return livePublishQueueFlushPromise;
}

export async function publishLiveScoreUpdateEvent(teamId: string, gameId: string, score: GameScoreSnapshot, user: AuthUser, previousScore?: Partial<GameScoreSnapshot> | null) {
  if (!teamId || !gameId) {
    throw new Error('A scheduled game is required before posting live play-by-play.');
  }
  if (!user?.uid) {
    throw new Error('Sign in before posting live play-by-play.');
  }

  ensureLivePublishQueueFlushListener();
  const lockKey = `score-update:${teamId}:${gameId}`;
  return withLivePublishLock(lockKey, async () => {
    if (isNativeRuntime()) {
      await flushPendingLivePublishQueue().catch(() => undefined);
    }

    const createdAt = new Date();
    try {
      if (isNativeRuntime()) {
        return await runNativeScoreUpdatePublish(teamId, gameId, score, user, previousScore, createdAt);
      }

      const gamePath = `teams/${teamId}/games/${gameId}`;
      const payload: LiveScoreUpdateResult = await withTimeout(runTransaction(db, async (transaction: any) => {
        const gameRef = doc(db, gamePath);
        const gameSnap = await transaction.get(gameRef);
        const gameData = (gameSnap.exists?.() ? gameSnap.data() || {} : {}) as Record<string, unknown>;
        assertGameAllowsLivePublishing(gameData);
        const liveGamePatch = buildLiveTrackingGamePatch(gameData, user, createdAt);
        const nextPayload = {
          eventId: createAppLiveEventId(),
          type: 'score_update',
          period: getLiveEventPeriod(gameData),
          gameClockMs: getLiveEventClockMs(gameData),
          description: buildLiveScoreUpdateDescription(score),
          homeScore: normalizeGameScoreValue(score.homeScore),
          awayScore: normalizeGameScoreValue(score.awayScore),
          previousHomeScore: previousScore?.homeScore !== undefined ? normalizeGameScoreValue(previousScore.homeScore) : normalizeGameScoreValue(gameData?.homeScore),
          previousAwayScore: previousScore?.awayScore !== undefined ? normalizeGameScoreValue(previousScore.awayScore) : normalizeGameScoreValue(gameData?.awayScore),
          createdBy: user.uid,
          createdByName: user.displayName || user.email || 'Staff',
          createdAt
        };
        transaction.set(gameRef, {
          homeScore: nextPayload.homeScore,
          awayScore: nextPayload.awayScore,
          scoreUpdatedAt: createdAt,
          scoreUpdatedBy: user.uid,
          ...liveGamePatch
        }, { merge: true });
        transaction.set(doc(db, `${gamePath}/liveEvents/${nextPayload.eventId}`), nextPayload);
        return nextPayload;
      }) as Promise<LiveScoreUpdateResult>, 'Live score event');
      updateLocalLiveGameSnapshot(teamId, gameId, (local) => ({
        ...local,
        homeScore: payload.homeScore,
        awayScore: payload.awayScore
      }));
      return payload;
    } catch (error) {
      if (!isNativeRuntime()) throw error;
      logScheduleWarning('Queueing native live score event publish.', 'live-score-publish-queue', error, { fallback: 'queue', teamId, gameId });
      if (!isNativeOfflineError(error)) throw error;
      const queuedOperation: PendingLivePublishOperation = {
        id: buildPendingLivePublishId(),
        kind: 'score_update',
        teamId,
        gameId,
        score: {
          homeScore: normalizeGameScoreValue(score.homeScore),
          awayScore: normalizeGameScoreValue(score.awayScore)
        },
        previousScore,
        user: {
          uid: user.uid,
          displayName: compactString(user.displayName),
          email: compactString(user.email)
        },
        createdAt: createdAt.toISOString()
      };
      enqueuePendingLivePublish(queuedOperation);
      updateLocalLiveGameSnapshot(teamId, gameId, (local) => ({
        ...local,
        homeScore: normalizeGameScoreValue(score.homeScore),
        awayScore: normalizeGameScoreValue(score.awayScore)
      }));
      return {
        eventId: createAppLiveEventId(),
        type: 'score_update',
        period: null,
        gameClockMs: 0,
        description: buildLiveScoreUpdateDescription(score),
        homeScore: normalizeGameScoreValue(score.homeScore),
        awayScore: normalizeGameScoreValue(score.awayScore),
        previousHomeScore: previousScore?.homeScore !== undefined ? normalizeGameScoreValue(previousScore.homeScore) : null,
        previousAwayScore: previousScore?.awayScore !== undefined ? normalizeGameScoreValue(previousScore.awayScore) : null,
        createdBy: user.uid,
        createdByName: user.displayName || user.email || 'Staff',
        createdAt
      };
    }
  });
}

export async function loadGameDayLiveEventsForApp(teamId: string, gameId: string) {
  if (!teamId || !gameId) return [];
  try {
    return await withTimeout(Promise.resolve(getLiveEvents(teamId, gameId)), 'Game day live events');
  } catch (error) {
    if (!isNativeRuntime()) throw error;
    logScheduleWarning('Falling back to REST game day live events.', 'game-day-live-events-load', error, { fallback: 'rest', teamId, gameId });
    const events = await nativeListCollection(`teams/${encodeURIComponent(teamId)}/games/${encodeURIComponent(gameId)}/liveEvents`);
    return Array.isArray(events) ? events : [];
  }
}

export async function saveGameDaySubstitutionForApp(
  teamId: string,
  gameId: string,
  user: AuthUser,
  payload: {
    rotationPlan: Record<string, any>;
    rotationActual: Record<string, any>;
    coachingNotes: any[];
  }
) {
  if (!teamId || !gameId) {
    throw new Error('A scheduled game is required before saving substitutions.');
  }
  if (!user?.uid) {
    throw new Error('Sign in before saving substitutions.');
  }

  const patch = {
    rotationPlan: payload.rotationPlan || {},
    rotationActual: payload.rotationActual || {},
    coachingNotes: Array.isArray(payload.coachingNotes) ? payload.coachingNotes : []
  };

  try {
    await withTimeout(Promise.resolve(updateGame(teamId, gameId, patch)), 'Game day substitution save');
  } catch (error) {
    if (!isNativeRuntime()) throw error;
    logScheduleWarning('Falling back to REST game day substitution save.', 'game-day-substitution-save', error, { fallback: 'rest', teamId, gameId });
    await nativePatchDocument(`teams/${encodeURIComponent(teamId)}/games/${encodeURIComponent(gameId)}`, patch);
  }

  return patch;
}

function formatTrackerClock(clockMs: unknown) {
  const totalSeconds = Math.max(0, Math.floor(normalizeClockMs(clockMs) / 1000));
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function buildPlayerGameStatDescription(playerName: string, playerNumber: string, statKey: 'pts' | 'fouls', value: number) {
  const identity = playerNumber ? `#${playerNumber} ${playerName}` : playerName;
  if (statKey === 'fouls') {
    return `${identity} FOULS +${value}`;
  }
  return `${identity} scored ${value} points.`;
}

function buildUndoPlayerGameStatDescription(playerName: string, playerNumber: string, statKey: 'pts' | 'fouls', value: number) {
  const identity = playerNumber ? `#${playerNumber} ${playerName}` : playerName;
  if (statKey === 'fouls') {
    return `Undo ${identity} FOULS +${value}`;
  }
  return `Undo ${identity} ${value} point${value === 1 ? '' : 's'}.`;
}

function buildPlayerGameStatTrackerText(playerName: string, playerNumber: string, statKey: 'pts' | 'fouls', value: number) {
  const identity = playerNumber ? `#${playerNumber} ${playerName}` : playerName;
  if (statKey === 'fouls') {
    return `${identity} FOULS ${value >= 0 ? '+' : ''}${value}`;
  }
  return `${identity} PTS ${value >= 0 ? '+' : ''}${value}`;
}

function buildPlayerGameStatLiveEvent({
  playerId,
  playerName,
  playerNumber,
  statKey,
  value,
  homeScore,
  awayScore,
  user,
  game = null,
  eventId = createAppLiveEventId(),
  description = buildPlayerGameStatDescription(playerName, playerNumber, statKey, value)
}: {
  playerId: string;
  playerName: string;
  playerNumber: string;
  statKey: 'pts' | 'fouls';
  value: number;
  homeScore: number;
  awayScore: number;
  user: AuthUser;
  game?: Record<string, any> | null;
  eventId?: string;
  description?: string;
}) {
  return {
    eventId,
    type: 'stat',
    period: getLiveEventPeriod(game),
    gameClockMs: getLiveEventClockMs(game),
    playerId,
    playerName,
    playerNumber,
    statKey,
    value,
    isOpponent: false,
    description,
    homeScore: normalizeGameScoreValue(homeScore),
    awayScore: normalizeGameScoreValue(awayScore),
    createdBy: user.uid,
    createdByName: user.displayName || user.email || 'Staff',
    createdAt: serverTimestamp()
  };
}

export function buildPlayerScoringLiveEvent({
  playerId,
  playerName,
  playerNumber,
  statKey,
  value,
  homeScore,
  awayScore,
  user,
  game = null,
  eventId = createAppLiveEventId()
}: {
  playerId: string;
  playerName: string;
  playerNumber: string;
  statKey: 'pts';
  value: 2;
  homeScore: number;
  awayScore: number;
  user: AuthUser;
  game?: Record<string, any> | null;
  eventId?: string;
}) {
  return buildPlayerGameStatLiveEvent({ playerId, playerName, playerNumber, statKey, value, homeScore, awayScore, user, game, eventId });
}

async function runNativePlayerGameStatWrite(
  teamId: string,
  gameId: string,
  playerId: string,
  stat: PlayerGameStatInput,
  user: AuthUser,
  scoreUpdatedAt = new Date()
): Promise<PlayerGameStatResult> {
  const playerName = compactString(stat.playerName) || 'Player';
  const playerNumber = compactString(stat.playerNumber);
  const teamSide = stat.teamSide === 'away' ? 'away' : 'home';
  const gamePath = `teams/${teamId}/games/${gameId}`;
  const encodedGamePath = `teams/${encodeURIComponent(teamId)}/games/${encodeURIComponent(gameId)}`;
  const statKey = stat.statKey;
  const value = Number(stat.value) as 1 | 2;
  const integrityState = await loadLiveScoreIntegrityState(teamId, gameId).catch(() => null);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const [gameSnapshot, statsSnapshot] = await Promise.all([
        nativeGetDocumentSnapshot(encodedGamePath),
        nativeGetDocumentSnapshot(`${encodedGamePath}/aggregatedStats/${encodeURIComponent(playerId)}`)
      ]);
      const gameDoc = (gameSnapshot.document || {}) as Record<string, unknown>;
      assertGameAllowsLivePublishing(gameDoc);
      const scoreBase = resolveScoreFromIntegrityState(gameDoc, integrityState);
      const statsDoc = (statsSnapshot.document || {}) as Record<string, unknown>;
      const awayScore = scoreBase.awayScore + (statKey === 'pts' && teamSide === 'away' ? value : 0);
      const homeScore = scoreBase.homeScore + (statKey === 'pts' && teamSide === 'home' ? value : 0);
      const existingStats = { ...((statsDoc?.stats || {}) as Record<string, unknown>) };
      const playerStatTotal = normalizeGameScoreValue(existingStats[statKey]) + value;
      existingStats[statKey] = playerStatTotal;
      const liveGamePatch = buildLiveTrackingGamePatch(gameDoc, user, scoreUpdatedAt);
      const liveEventId = createAppLiveEventId();
      const trackerEventId = createAppLiveEventId();
      const liveEvent = buildPlayerGameStatLiveEvent({ playerId, playerName, playerNumber, statKey, value, homeScore, awayScore, user, game: gameDoc, eventId: liveEventId });
      const trackerEvent = buildTrackerEventDocument({
        text: buildPlayerGameStatTrackerText(playerName, playerNumber, statKey, value),
        clock: formatTrackerClock(getLiveEventClockMs(gameDoc)),
        period: getLiveEventPeriod(gameDoc),
        timestamp: scoreUpdatedAt,
        playerName,
        playerNumber,
        teamSide,
        undoData: {
          type: 'stat',
          playerId,
          statKey,
          value,
          isOpponent: false
        }
      }, user);
      const gamePatch: Record<string, unknown> = {
        scoreUpdatedAt,
        scoreUpdatedBy: user.uid,
        ...liveGamePatch
      };
      if (statKey === 'pts') {
        gamePatch.homeScore = homeScore;
        gamePatch.awayScore = awayScore;
      }

      await nativeCommitWrites([
        {
          update: {
            name: getFirestoreDocumentName(gamePath),
            fields: buildFirestoreFields(gamePatch)
          },
          updateMask: {
            fieldPaths: Object.keys(gamePatch)
          },
          currentDocument: gameSnapshot.exists
            ? { updateTime: gameSnapshot.updateTime }
            : { exists: false }
        },
        {
          update: {
            name: getFirestoreDocumentName(`${gamePath}/aggregatedStats/${playerId}`),
            fields: buildFirestoreFields({
              playerName,
              playerNumber,
              stats: existingStats
            })
          },
          updateMask: {
            fieldPaths: ['playerName', 'playerNumber', 'stats']
          },
          currentDocument: statsSnapshot.exists
            ? { updateTime: statsSnapshot.updateTime }
            : { exists: false }
        },
        {
          update: {
            name: getFirestoreDocumentName(`${gamePath}/liveEvents/${liveEventId}`),
            fields: buildFirestoreFields({
              ...liveEvent,
              eventId: liveEventId,
              createdAt: scoreUpdatedAt
            })
          },
          currentDocument: { exists: false }
        },
        {
          update: {
            name: getFirestoreDocumentName(`${gamePath}/events/${trackerEventId}`),
            fields: buildFirestoreFields({
              ...trackerEvent,
              eventId: trackerEventId,
              timestamp: scoreUpdatedAt.getTime()
            })
          },
          currentDocument: { exists: false }
        }
      ]);

      updateLocalLiveGameSnapshot(teamId, gameId, (local) => ({
        ...local,
        homeScore,
        awayScore,
        playerPoints: {
          ...(local.playerPoints || {}),
          [playerId]: statKey === 'pts' ? playerStatTotal : normalizeGameScoreValue(local.playerPoints?.[playerId])
        }
      }));

      return {
        homeScore,
        awayScore,
        playerId,
        playerName,
        playerNumber,
        statKey,
        value,
        playerStatTotal,
        trackerEventId,
        liveEventId,
        liveEvent: {
          ...liveEvent,
          eventId: liveEventId,
          createdAt: scoreUpdatedAt
        }
      };
    } catch (error) {
      if (isNativeConflictError(error) && attempt < 2) continue;
      throw error;
    }
  }

  throw new Error('Unable to record player game stat.');
}

export async function recordPlayerGameStat(teamId: string, gameId: string, playerId: string, stat: PlayerGameStatInput, user: AuthUser): Promise<PlayerGameStatResult> {
  if (!teamId || !gameId) {
    throw new Error('A scheduled game is required before recording player stats.');
  }
  if (!playerId) {
    throw new Error('Select a player before recording player stats.');
  }
  if (!user?.uid) {
    throw new Error('Sign in before recording player stats.');
  }
  if ((stat?.statKey !== 'pts' && stat?.statKey !== 'fouls') || ![1, 2].includes(Number(stat?.value))) {
    throw new Error('Unsupported player stat action.');
  }

  const playerName = compactString(stat.playerName) || 'Player';
  const playerNumber = compactString(stat.playerNumber);
  const teamSide = stat.teamSide === 'away' ? 'away' : 'home';
  const gamePath = `teams/${teamId}/games/${gameId}`;
  const statsPath = `${gamePath}/aggregatedStats/${playerId}`;
  const liveEventsPath = `${gamePath}/liveEvents`;
  const eventsPath = `${gamePath}/events`;
  const integrityState = await loadLiveScoreIntegrityState(teamId, gameId).catch(() => null);
  ensureLivePublishQueueFlushListener();

  return withLivePublishLock(`player-stat:${teamId}:${gameId}`, async () => {
    if (isNativeRuntime()) {
      await flushPendingLivePublishQueue().catch(() => undefined);
    }

    try {
      const result: PlayerGameStatResult = await withTimeout(runTransaction(db, async (transaction: any) => {
      const gameRef = doc(db, gamePath);
      const statsRef = doc(db, statsPath);
      const [gameSnap, statsSnap] = await Promise.all([
        transaction.get(gameRef),
        transaction.get(statsRef)
      ]);
      const gameData = (gameSnap.exists?.() ? gameSnap.data() || {} : {}) as Record<string, unknown>;
      assertGameAllowsLivePublishing(gameData);
      const scoreBase = resolveScoreFromIntegrityState(gameData, integrityState);
      const statsData = (statsSnap.exists?.() ? statsSnap.data() || {} : {}) as Record<string, unknown>;
      const scoreUpdatedAt = new Date();
      const statKey = stat.statKey;
      const value = Number(stat.value) as 1 | 2;
      const awayScore = scoreBase.awayScore + (statKey === 'pts' && teamSide === 'away' ? value : 0);
      const homeScore = scoreBase.homeScore + (statKey === 'pts' && teamSide === 'home' ? value : 0);
      const playerStats = (statsData.stats && typeof statsData.stats === 'object' ? statsData.stats : {}) as Record<string, unknown>;
      const playerStatTotal = normalizeGameScoreValue(playerStats[statKey]) + value;
      const liveGamePatch = buildLiveTrackingGamePatch(gameData, user, scoreUpdatedAt);
      const liveEventId = createAppLiveEventId();
      const trackerEventId = createAppLiveEventId();
      const liveEvent = buildPlayerGameStatLiveEvent({ playerId, playerName, playerNumber, statKey, value, homeScore, awayScore, user, game: gameData, eventId: liveEventId });
      const trackerEvent = buildTrackerEventDocument({
        text: buildPlayerGameStatTrackerText(playerName, playerNumber, statKey, value),
        clock: formatTrackerClock(getLiveEventClockMs(gameData)),
        period: getLiveEventPeriod(gameData),
        timestamp: scoreUpdatedAt,
        playerName,
        playerNumber,
        teamSide,
        undoData: {
          type: 'stat',
          playerId,
          statKey,
          value,
          isOpponent: false
        }
      }, user);

      const gamePatch: Record<string, unknown> = {
        scoreUpdatedAt,
        scoreUpdatedBy: user.uid,
        ...liveGamePatch
      };
      if (statKey === 'pts') {
        gamePatch.homeScore = homeScore;
        gamePatch.awayScore = awayScore;
      }

      transaction.set(gameRef, gamePatch, { merge: true });
      transaction.set(statsRef, {
        playerName,
        playerNumber,
        stats: { [statKey]: increment(value) }
      }, { merge: true });
      transaction.set(doc(collection(db, liveEventsPath), liveEventId), liveEvent);
      transaction.set(doc(collection(db, eventsPath), trackerEventId), trackerEvent);

      return {
        homeScore,
        awayScore,
        playerId,
        playerName,
        playerNumber,
        statKey,
        value,
        playerStatTotal,
        trackerEventId,
        liveEventId,
        liveEvent
      };
    }) as Promise<PlayerGameStatResult>, 'Player game stat');

      updateLocalLiveGameSnapshot(teamId, gameId, (local) => ({
        ...local,
        homeScore: result.homeScore,
        awayScore: result.awayScore,
        playerPoints: {
          ...(local.playerPoints || {}),
          [playerId]: stat.statKey === 'pts' ? result.playerStatTotal : normalizeGameScoreValue(local.playerPoints?.[playerId])
        }
      }));
      return result;
    } catch (error) {
      if (!isNativeRuntime()) throw error;
      logScheduleWarning('Queueing native player stat write.', 'player-stat-write-queue', error, { fallback: 'queue', teamId, gameId, playerId });
      if (!isNativeOfflineError(error)) {
        return runNativePlayerGameStatWrite(teamId, gameId, playerId, stat, user);
      }

      const createdAt = new Date();
      enqueuePendingLivePublish({
        id: buildPendingLivePublishId(),
        kind: 'player_game_stat',
        teamId,
        gameId,
        playerId,
        stat,
        user: {
          uid: user.uid,
          displayName: compactString(user.displayName),
          email: compactString(user.email)
        },
        createdAt: createdAt.toISOString()
      });
      const localSnapshot = readLocalLiveGameSnapshot(teamId, gameId);
      const optimisticAwayScore = localSnapshot.awayScore + (stat.statKey === 'pts' && teamSide === 'away' ? Number(stat.value) : 0);
      const optimisticHomeScore = localSnapshot.homeScore + (stat.statKey === 'pts' && teamSide === 'home' ? Number(stat.value) : 0);
      const optimisticPlayerStatTotal = normalizeGameScoreValue(localSnapshot.playerPoints?.[playerId]) + (stat.statKey === 'pts' ? Number(stat.value) : 0);
      updateLocalLiveGameSnapshot(teamId, gameId, (local) => ({
        ...local,
        homeScore: optimisticHomeScore,
        awayScore: optimisticAwayScore,
        playerPoints: {
          ...(local.playerPoints || {}),
          [playerId]: optimisticPlayerStatTotal
        }
      }));

      const liveEventId = createAppLiveEventId();
      const trackerEventId = createAppLiveEventId();
      const liveEvent = {
        ...buildPlayerGameStatLiveEvent({
          playerId,
          playerName,
          playerNumber,
          statKey: stat.statKey,
          value: Number(stat.value),
          homeScore: optimisticHomeScore,
          awayScore: optimisticAwayScore,
          user,
          game: null,
          eventId: liveEventId
        }),
        eventId: liveEventId,
        createdAt
      };

      return {
        homeScore: optimisticHomeScore,
        awayScore: optimisticAwayScore,
        playerId,
        playerName,
        playerNumber,
        statKey: stat.statKey,
        value: Number(stat.value) as 1 | 2,
        playerStatTotal: optimisticPlayerStatTotal,
        trackerEventId,
        liveEventId,
        liveEvent
      };
    }
  });
}

export async function undoRecordedPlayerGameStat(teamId: string, gameId: string, stat: UndoPlayerGameStatInput, user: AuthUser): Promise<UndoPlayerGameStatResult> {
  if (!teamId || !gameId) {
    throw new Error('A scheduled game is required before undoing player stats.');
  }
  if (!user?.uid) {
    throw new Error('Sign in before undoing player stats.');
  }

  const playerName = compactString(stat.playerName) || 'Player';
  const playerNumber = compactString(stat.playerNumber);
  const teamSide = stat.teamSide === 'away' ? 'away' : 'home';
  const gamePath = `teams/${teamId}/games/${gameId}`;
  const statsPath = `${gamePath}/aggregatedStats/${stat.playerId}`;

  try {
    return await withTimeout(runTransaction(db, async (transaction: any) => {
      const gameRef = doc(db, gamePath);
      const statsRef = doc(db, statsPath);
      const [gameSnap, statsSnap] = await Promise.all([
        transaction.get(gameRef),
        transaction.get(statsRef)
      ]);
      const gameData = gameSnap.exists?.() ? gameSnap.data() || {} : {};
      const statsData = statsSnap.exists?.() ? statsSnap.data() || {} : {};
      const scoreUpdatedAt = new Date();
      const value = Number(stat.value) || 0;
      const nextHomeScore = normalizeGameScoreValue(gameData.homeScore) - (stat.statKey === 'pts' && teamSide === 'home' ? value : 0);
      const nextAwayScore = normalizeGameScoreValue(gameData.awayScore) - (stat.statKey === 'pts' && teamSide === 'away' ? value : 0);
      const playerStatTotal = Math.max(0, normalizeGameScoreValue(statsData?.stats?.[stat.statKey]) - value);
      const liveEventId = createAppLiveEventId();
      const trackerEventId = createAppLiveEventId();
      const liveEvent = buildPlayerGameStatLiveEvent({
        playerId: stat.playerId,
        playerName,
        playerNumber,
        statKey: stat.statKey,
        value: -value,
        homeScore: nextHomeScore,
        awayScore: nextAwayScore,
        user,
        game: gameData,
        eventId: liveEventId,
        description: buildUndoPlayerGameStatDescription(playerName, playerNumber, stat.statKey, value)
      });
      const trackerEvent = buildTrackerEventDocument({
        text: buildPlayerGameStatTrackerText(playerName, playerNumber, stat.statKey, -value),
        clock: formatTrackerClock(getLiveEventClockMs(gameData)),
        period: getLiveEventPeriod(gameData),
        timestamp: scoreUpdatedAt,
        playerName,
        playerNumber,
        teamSide,
        undoData: {
          type: 'stat',
          playerId: stat.playerId,
          statKey: stat.statKey,
          value: -value,
          isOpponent: false
        }
      }, user);

      transaction.set(gameRef, {
        ...(stat.statKey === 'pts' ? { homeScore: nextHomeScore, awayScore: nextAwayScore } : {}),
        scoreUpdatedAt,
        scoreUpdatedBy: user.uid
      }, { merge: true });
      transaction.set(statsRef, {
        playerName,
        playerNumber,
        stats: { [stat.statKey]: increment(-value) }
      }, { merge: true });
      transaction.set(doc(db, `${gamePath}/liveEvents/${liveEventId}`), liveEvent);
      transaction.set(doc(db, `${gamePath}/events/${trackerEventId}`), trackerEvent);

      return {
        homeScore: nextHomeScore,
        awayScore: nextAwayScore,
        playerId: stat.playerId,
        statKey: stat.statKey,
        playerStatTotal,
        trackerEventId,
        liveEventId,
        liveEvent
      };
    }), 'Undo player game stat');
  } catch (error) {
    if (!isNativeRuntime()) throw error;
    logScheduleWarning('Falling back to REST player stat undo.', 'player-stat-undo', error, { fallback: 'rest', teamId, gameId, playerId: stat.playerId });
    const [gameDoc, statsDoc] = await Promise.all([
      nativeGetDocument(`teams/${encodeURIComponent(teamId)}/games/${encodeURIComponent(gameId)}`),
      nativeGetDocument(`teams/${encodeURIComponent(teamId)}/games/${encodeURIComponent(gameId)}/aggregatedStats/${encodeURIComponent(stat.playerId)}`)
    ]);
    const value = Number(stat.value) || 0;
    const nextHomeScore = normalizeGameScoreValue(gameDoc?.homeScore) - (stat.statKey === 'pts' && teamSide === 'home' ? value : 0);
    const nextAwayScore = normalizeGameScoreValue(gameDoc?.awayScore) - (stat.statKey === 'pts' && teamSide === 'away' ? value : 0);
    const existingStats = { ...((statsDoc?.stats || {}) as Record<string, unknown>) };
    const playerStatTotal = Math.max(0, normalizeGameScoreValue(existingStats[stat.statKey]) - value);
    existingStats[stat.statKey] = playerStatTotal;
    const scoreUpdatedAt = new Date();
    const liveEventId = createAppLiveEventId();
    const trackerEventId = createAppLiveEventId();
    const liveEvent = buildPlayerGameStatLiveEvent({
      playerId: stat.playerId,
      playerName,
      playerNumber,
      statKey: stat.statKey,
      value: -value,
      homeScore: nextHomeScore,
      awayScore: nextAwayScore,
      user,
      game: gameDoc,
      eventId: liveEventId,
      description: buildUndoPlayerGameStatDescription(playerName, playerNumber, stat.statKey, value)
    });
    const trackerEvent = buildTrackerEventDocument({
      text: buildPlayerGameStatTrackerText(playerName, playerNumber, stat.statKey, -value),
      clock: formatTrackerClock(getLiveEventClockMs(gameDoc)),
      period: getLiveEventPeriod(gameDoc),
      timestamp: scoreUpdatedAt,
      playerName,
      playerNumber,
      teamSide,
      undoData: {
        type: 'stat',
        playerId: stat.playerId,
        statKey: stat.statKey,
        value: -value,
        isOpponent: false
      }
    }, user);

    await nativePatchDocument(`teams/${encodeURIComponent(teamId)}/games/${encodeURIComponent(gameId)}`, {
      ...(stat.statKey === 'pts' ? { homeScore: nextHomeScore, awayScore: nextAwayScore } : {}),
      scoreUpdatedAt,
      scoreUpdatedBy: user.uid
    });
    await nativePatchDocument(`teams/${encodeURIComponent(teamId)}/games/${encodeURIComponent(gameId)}/aggregatedStats/${encodeURIComponent(stat.playerId)}`, {
      playerName,
      playerNumber,
      stats: existingStats
    });
    await nativePatchDocument(`teams/${encodeURIComponent(teamId)}/games/${encodeURIComponent(gameId)}/liveEvents/${encodeURIComponent(liveEventId)}`, {
      ...liveEvent,
      eventId: liveEventId,
      createdAt: scoreUpdatedAt
    });
    await nativePatchDocument(`teams/${encodeURIComponent(teamId)}/games/${encodeURIComponent(gameId)}/events/${encodeURIComponent(trackerEventId)}`, {
      ...trackerEvent,
      eventId: trackerEventId,
      timestamp: scoreUpdatedAt.getTime()
    });

    return {
      homeScore: nextHomeScore,
      awayScore: nextAwayScore,
      playerId: stat.playerId,
      statKey: stat.statKey,
      playerStatTotal,
      trackerEventId,
      liveEventId,
      liveEvent: {
        ...liveEvent,
        eventId: liveEventId,
        createdAt: scoreUpdatedAt
      }
    };
  }
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

  const result = await recordPlayerGameStat(teamId, gameId, playerId, stat, user);
  return {
    homeScore: result.homeScore,
    awayScore: result.awayScore,
    playerId: result.playerId,
    playerName: result.playerName,
    playerNumber: result.playerNumber,
    statKey: 'pts',
    value: 2,
    playerPoints: result.playerStatTotal,
    liveEvent: result.liveEvent
  };
}

function assertStaffRsvpReminderEvent(event: ParentScheduleEvent, user: AuthUser | null) {
  if (!user?.uid) throw new Error('Sign in before sending RSVP reminders.');
  if (!event.isTeamRsvpReminderManager) throw new Error('Only team owners and admins can send RSVP reminders.');
  if (!event.isDbGame) throw new Error('RSVP reminders are available only for schedule events.');
  if (event.isCancelled) throw new Error('RSVP reminders are unavailable for cancelled events.');
}

export async function loadStaffRsvpReminderPreview(event: ParentScheduleEvent, user: AuthUser | null): Promise<StaffRsvpReminderPreview> {
  assertStaffRsvpReminderEvent(event, user);
  return (await loadStaffRsvpEventData(event)).reminderPreview;
}

function getStaffRsvpEventDataCacheKey(event: ParentScheduleEvent) {
  return `${compactString(event.teamId)}:${compactString(event.id)}`;
}

export function createStaffRsvpAvailabilityLoader() {
  const eventDataByEventKey = new Map<string, Promise<StaffRsvpEventData>>();

  const getEventData = (event: ParentScheduleEvent) => {
    const eventKey = getStaffRsvpEventDataCacheKey(event);
    const existing = eventDataByEventKey.get(eventKey);
    if (existing) return existing;
    const nextLoad = loadStaffRsvpEventData(event).catch((error) => {
      eventDataByEventKey.delete(eventKey);
      throw error;
    });
    eventDataByEventKey.set(eventKey, nextLoad);
    return nextLoad;
  };

  return {
    async loadBreakdown(event: ParentScheduleEvent, user: AuthUser | null): Promise<StaffScheduleRsvpBreakdown> {
      assertStaffRsvpManagementEvent(event, user);
      return (await getEventData(event)).breakdown;
    },
    async loadReminderPreview(event: ParentScheduleEvent, user: AuthUser | null): Promise<StaffRsvpReminderPreview> {
      assertStaffRsvpReminderEvent(event, user);
      return (await getEventData(event)).reminderPreview;
    },
    invalidateEvent(event: ParentScheduleEvent) {
      eventDataByEventKey.delete(getStaffRsvpEventDataCacheKey(event));
    }
  };
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

function normalizeStaffRsvpReminderPushMetrics(source: Record<string, any> | null | undefined) {
  const normalizeCount = (value: unknown) => Math.max(0, Number.parseInt(String(value || 0), 10) || 0);
  return {
    rsvpPushSuccessCount: normalizeCount(source?.rsvpPushSuccessCount),
    rsvpPushFailureCount: normalizeCount(source?.rsvpPushFailureCount),
    rsvpPushTargetCount: normalizeCount(source?.rsvpPushTargetCount),
    rsvpPushError: compactString(source?.rsvpPushError) || null
  };
}

async function updateRsvpReminderMetadata(
  event: ParentScheduleEvent,
  user: AuthUser,
  missingCount: number,
  emailCount: number,
  pushMetrics = normalizeStaffRsvpReminderPushMetrics(null)
) {
  const sentAt = new Date().toISOString();
  const metadata = buildStaffRsvpReminderMetadata(user.uid, missingCount, emailCount, sentAt, pushMetrics);
  const { persistedEventId, occurrenceKey } = getStaffRsvpReminderMetadataTarget(event.id);

  if (isNativeRuntime()) {
    const existing = await nativeGetDocument(`teams/${encodeURIComponent(event.teamId)}/games/${encodeURIComponent(persistedEventId)}`).catch(() => null);
    const existingNotifications = (existing?.scheduleNotifications && typeof existing.scheduleNotifications === 'object' && !Array.isArray(existing.scheduleNotifications)
      ? existing.scheduleNotifications
      : {}) as Record<string, any>;
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
    'scheduleNotifications.lastRsvpEmailCount': emailCount,
    'scheduleNotifications.lastRsvpPushSuccessCount': metadata.lastRsvpPushSuccessCount,
    'scheduleNotifications.lastRsvpPushFailureCount': metadata.lastRsvpPushFailureCount,
    'scheduleNotifications.lastRsvpPushTargetCount': metadata.lastRsvpPushTargetCount,
    'scheduleNotifications.lastRsvpPushError': metadata.lastRsvpPushError
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
  const { sendTeamChatMessage } = await import('./chatService');
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
  const rsvpPushMetrics = normalizeStaffRsvpReminderPushMetrics(emailResult);
  await updateRsvpReminderMetadata(event, user, preview.missingPlayerCount, emailSentCount, rsvpPushMetrics);
  return {
    ...preview,
    emailSentCount,
    ...rsvpPushMetrics
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
    logScheduleWarning('Falling back to REST game cancellation.', 'game-cancel', error, { fallback: 'rest', teamId: event.teamId, gameId: event.id });
    await nativePatchDocument(`teams/${encodeURIComponent(event.teamId)}/games/${encodeURIComponent(event.id)}`, payload);
  }

  const notificationFailures: string[] = [];
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
    logScheduleWarning('Falling back to REST practice occurrence cancellation.', 'practice-occurrence-cancel', error, { fallback: 'rest', teamId: event.teamId, eventId: event.id });
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

function extractTeamIdFromOfficialRefPath(path: string) {
  const parts = String(path || '').split('/').filter(Boolean);
  const teamIndex = parts.indexOf('teams');
  return teamIndex >= 0 ? compactString(parts[teamIndex + 1]) : '';
}

// Look-behind buffer for the officials game query so same-day / in-progress games stay
// in range while still bounding the read (avoids scanning a team's full game history).
const officialAssignmentsLookBehindMs = 24 * 60 * 60 * 1000;

function isUpcomingOfficialGame(game: any, now = new Date()) {
  const date = normalizeScheduleDate(game?.date);
  const status = compactString(game?.status).toLowerCase();
  return Boolean(date && date.getTime() >= now.getTime() && status !== 'cancelled' && status !== 'canceled');
}

function isEligibleOpenOfficiatingSlotParticipant(team: any = {}, userProfile: Record<string, any> = {}, user: AuthUser) {
  const uid = compactString(user?.uid);
  const email = normalizeOfficialLinkEmail(user?.email || '');
  if (!uid) return false;
  if (team?.ownerId === uid) return true;
  if (email && Array.isArray(team?.adminEmails) && team.adminEmails.map((value: unknown) => normalizeOfficialLinkEmail(value)).includes(email)) return true;
  if (userProfile?.isAdmin === true) return true;
  if (Array.isArray(userProfile?.parentTeamIds) && userProfile.parentTeamIds.includes(team?.id)) return true;
  return false;
}

async function loadOfficialLinkedTeamIds(user: AuthUser, userProfile?: Record<string, any> | null) {
  const email = normalizeOfficialLinkEmail(user?.email || '');
  const phone = normalizeOfficialLinkPhone(userProfile?.phone || '');
  const officialsRef = collectionGroup(db, 'officials');
  const requests: Promise<any>[] = [];

  if (email) {
    requests.push(getDocs(query(officialsRef, where('email', '==', email))));
  }
  if (phone) {
    requests.push(getDocs(query(officialsRef, where('phone', '==', phone))));
  }

  if (!requests.length) {
    return [];
  }

  const teamIds = new Set<string>();
  const results = await Promise.allSettled(requests);
  results.forEach((result) => {
    if (result.status !== 'fulfilled') return;
    result.value.docs.forEach((docSnap: any) => {
      const teamId = extractTeamIdFromOfficialRefPath(docSnap?.ref?.path || '');
      if (teamId) teamIds.add(teamId);
    });
  });
  return Array.from(teamIds);
}

export async function loadOfficialAssignmentsAccess(user: AuthUser): Promise<OfficialAssignmentsAccess> {
  const userProfile = await loadProfileDocument(user.uid).catch(() => ({}));
  const teamIds = await loadOfficialLinkedTeamIds(user, userProfile as Record<string, any>);
  return {
    hasAccess: teamIds.length > 0,
    teamIds,
    teamCount: teamIds.length
  };
}

export async function loadOfficialAssignments(user: AuthUser, options: { teamId?: string } = {}): Promise<OfficialAssignmentsResult> {
  const userProfile = await loadProfileDocument(user.uid).catch(() => ({}));
  const linkedTeamIds = await loadOfficialLinkedTeamIds(user, userProfile as Record<string, any>);
  const requestedTeamId = compactString(options.teamId);
  const linkedRequestedTeamIds = requestedTeamId ? linkedTeamIds.filter((teamId) => teamId === requestedTeamId) : linkedTeamIds;
  const teamIds = linkedRequestedTeamIds.length
    ? linkedRequestedTeamIds
    : (requestedTeamId ? [requestedTeamId] : linkedTeamIds);

  if (!teamIds.length) {
    return {
      hasAccess: false,
      teamIds: [],
      teamCount: 0,
      assignments: []
    };
  }

  const now = new Date();
  // Only upcoming games are ever surfaced (isUpcomingOfficialGame requires date >= now),
  // so bound the read to a small look-behind window instead of scanning the team's entire
  // game history on every officials load. The look-behind keeps in-progress / same-day games
  // (whose stored date is the start time) in range; the filter below still trims to upcoming.
  const officialGamesSince = new Date(now.getTime() - officialAssignmentsLookBehindMs);
  const teamResults = await Promise.all(teamIds.map(async (teamId) => {
    const [team, games] = await Promise.all([
      getTeam(teamId, { includeInactive: true }).catch(() => null),
      getGames(teamId, { startDate: officialGamesSince }).catch(() => [])
    ]);
    const canClaim = isEligibleOpenOfficiatingSlotParticipant(team || {}, userProfile as Record<string, any>, user);
    const teamName = compactString(team?.name) || 'Team';

    const assignments = (Array.isArray(games) ? games : [])
      .filter((game) => isUpcomingOfficialGame(game, now))
      .flatMap((game) => {
        const eventDate = normalizeScheduleDate(game?.date);
        if (!eventDate) return [] as OfficialAssignmentItem[];

        const assigned = getAssignedOfficiatingSlots(game, user).map((slot: any) => ({
          kind: 'assigned' as const,
          teamId,
          teamName,
          gameId: compactString(game?.id),
          slotId: compactString(slot?.id),
          position: compactString(slot?.position) || 'Official',
          status: compactString(slot?.status) || 'pending',
          opponent: compactString(game?.opponent) || 'TBD',
          location: compactString(game?.location) || 'Location TBD',
          date: eventDate,
          canClaim: false,
          scheduleReviewRequired: slot?.scheduleReviewRequired === true
        }));

        const open = canClaim
          ? getOpenOfficiatingSlots(game).map((slot: any) => ({
            kind: 'open' as const,
            teamId,
            teamName,
            gameId: compactString(game?.id),
            slotId: compactString(slot?.id),
            position: compactString(slot?.position) || 'Official',
            status: 'open',
            opponent: compactString(game?.opponent) || 'TBD',
            location: compactString(game?.location) || 'Location TBD',
            date: eventDate,
            canClaim: true,
            scheduleReviewRequired: false
          }))
          : [];

        return [...assigned, ...open];
      });

    return {
      teamId,
      hasAccess: linkedTeamIds.includes(teamId) || (requestedTeamId === teamId && assignments.some((item) => item.kind === 'assigned')),
      assignments
    };
  }));

  const accessibleTeamIds = teamResults
    .filter((result) => result.hasAccess)
    .map((result) => result.teamId);

  if (!accessibleTeamIds.length) {
    return {
      hasAccess: false,
      teamIds: [],
      teamCount: 0,
      assignments: []
    };
  }

  return {
    hasAccess: true,
    teamIds: accessibleTeamIds,
    teamCount: accessibleTeamIds.length,
    assignments: teamResults
      .filter((result) => result.hasAccess)
      .flatMap((result) => result.assignments)
      .sort((left, right) => left.date.getTime() - right.date.getTime() || left.teamName.localeCompare(right.teamName) || left.position.localeCompare(right.position))
  };
}

export async function respondToOfficialAssignmentItem(item: OfficialAssignmentItem, status: 'accepted' | 'declined') {
  await withTimeout(Promise.resolve(respondToOfficiatingAssignment(item.teamId, item.gameId, item.slotId, status)), 'Officiating response');
}

export async function claimOfficialAssignmentItem(item: OfficialAssignmentItem, user: AuthUser) {
  await withTimeout(Promise.resolve(claimOpenOfficiatingSlot(item.teamId, item.gameId, item.slotId, user)), 'Officiating claim');
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
    logScheduleWarning('Falling back to REST assignment claim.', 'assignment-claim', error, { fallback: 'rest', teamId: event.teamId, gameId: event.id, role });
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
    logScheduleWarning('Falling back to REST assignment release.', 'assignment-release', error, { fallback: 'rest', teamId: event.teamId, gameId: event.id, role });
    await nativeReleaseAssignment(event, trimmedRole);
  }
}

function getPracticePacketSessionId(event: ParentScheduleEvent) {
  return compactString(event.practiceSessionId) || compactString(event.id);
}

function normalizePracticeAttendanceStatus(value: unknown): PracticeAttendanceStatus {
  return value === 'present' || value === 'late' ? value : 'absent';
}

function assertPracticeAttendanceManagementEvent(event: ParentScheduleEvent, user: AuthUser | null) {
  if (event.type !== 'practice') {
    throw new Error('Practice attendance is only available for practice sessions.');
  }
  if (!event.isDbGame) {
    throw new Error('Practice attendance opens after this event is tracked in the schedule.');
  }
  if (!user?.uid) {
    throw new Error('Sign in before managing practice attendance.');
  }
  if (!event.isTeamAdmin) {
    throw new Error('Only team owners and admins can manage practice attendance.');
  }
}

async function loadPracticeSessionForAttendance(event: ParentScheduleEvent) {
  const sessionId = compactString(event.practiceSessionId);
  if (sessionId) {
    return readWithNativeFallback(
      `practice session ${event.teamId}/${sessionId}`,
      () => Promise.resolve(getPracticeSession(event.teamId, sessionId)),
      () => nativeGetDocument(`teams/${encodeURIComponent(event.teamId)}/practiceSessions/${encodeURIComponent(sessionId)}`)
    );
  }
  return readWithNativeFallback(
    `practice session by event ${event.teamId}/${event.id}`,
    () => Promise.resolve(getPracticeSessionByEvent(event.teamId, event.id)),
    async () => {
      const sessions = await nativeListCollection(`teams/${encodeURIComponent(event.teamId)}/practiceSessions`);
      return sessions.find((session) => compactString(session?.eventId) === event.id) || null;
    }
  );
}

function buildStaffPracticeAttendance(session: any, players: any[], event: ParentScheduleEvent): StaffPracticeAttendance {
  const attendancePlayers = Array.isArray(session?.attendance?.players) ? session.attendance.players : [];
  const attendanceByPlayerId = new Map(attendancePlayers
    .map((player: any) => {
      const playerId = compactString(player?.playerId);
      return playerId ? [playerId, player] : null;
    })
    .filter(Boolean) as Array<[string, any]>);

  const rosterPlayers = (Array.isArray(players) ? players : [])
    .filter(isActiveRosterPlayer)
    .map((player: any) => {
      const playerId = compactString(player?.id);
      if (!playerId) return null;
      const saved = attendanceByPlayerId.get(playerId);
      return {
        playerId,
        displayName: normalizePlayerName(player),
        playerNumber: normalizePlayerNumber(player),
        status: normalizePracticeAttendanceStatus(saved?.status),
        checkedInAt: saved?.checkedInAt || null,
        note: compactString(saved?.note) || null
      };
    })
    .filter(Boolean) as PracticeAttendancePlayer[];

  rosterPlayers.sort((left, right) => {
    const leftNumber = compactString(left.playerNumber);
    const rightNumber = compactString(right.playerNumber);
    if (leftNumber && rightNumber && leftNumber !== rightNumber) {
      return leftNumber.localeCompare(rightNumber, undefined, { numeric: true, sensitivity: 'base' });
    }
    if (leftNumber && !rightNumber) return -1;
    if (!leftNumber && rightNumber) return 1;
    return left.displayName.localeCompare(right.displayName, undefined, { sensitivity: 'base' });
  });

  const checkedInCount = rosterPlayers.filter((player) => player.status === 'present' || player.status === 'late').length;

  return {
    sessionId: compactString(session?.id) || getPracticePacketSessionId(event) || event.id,
    teamId: event.teamId,
    eventId: event.id,
    rosterSize: rosterPlayers.length,
    checkedInCount,
    players: rosterPlayers
  };
}

export async function loadStaffPracticeAttendance(event: ParentScheduleEvent, user: AuthUser | null): Promise<StaffPracticeAttendance> {
  assertPracticeAttendanceManagementEvent(event, user);
  const [session, players] = await Promise.all([
    loadPracticeSessionForAttendance(event),
    loadPlayers(event.teamId)
  ]);
  if (!session?.id) {
    throw new Error('Practice attendance is not linked to a session yet.');
  }
  return buildStaffPracticeAttendance(session, players, event);
}

export async function saveStaffPracticeAttendance(event: ParentScheduleEvent, user: AuthUser | null, attendance: StaffPracticeAttendance): Promise<StaffPracticeAttendance> {
  assertPracticeAttendanceManagementEvent(event, user);
  const sessionId = compactString(attendance?.sessionId) || getPracticePacketSessionId(event);
  if (!sessionId) {
    throw new Error('Practice attendance is not linked to a session yet.');
  }

  const players = (Array.isArray(attendance?.players) ? attendance.players : [])
    .map((player) => ({
      playerId: compactString(player?.playerId),
      displayName: compactString(player?.displayName) || 'Player',
      playerNumber: compactString(player?.playerNumber ?? '') || null,
      status: normalizePracticeAttendanceStatus(player?.status),
      checkedInAt: player?.status === 'present' || player?.status === 'late'
        ? (player?.checkedInAt || new Date())
        : null,
      note: compactString(player?.note) || null
    }))
    .filter((player) => player.playerId);

  const payload = {
    rosterSize: players.length,
    checkedInCount: players.filter((player) => player.status === 'present' || player.status === 'late').length,
    editedAt: new Date(),
    players
  };

  try {
    await withTimeout(Promise.resolve(updatePracticeAttendance(event.teamId, sessionId, payload)), 'Practice attendance save');
  } catch (error) {
    if (!isNativeRuntime()) throw error;
    logScheduleWarning('Falling back to REST practice attendance save.', 'practice-attendance-save', error, { fallback: 'rest', teamId: event.teamId, sessionId });
    await nativePatchDocument(`teams/${encodeURIComponent(event.teamId)}/practiceSessions/${encodeURIComponent(sessionId)}`, {
      attendance: {
        rosterSize: payload.rosterSize,
        checkedInCount: payload.checkedInCount,
        updatedAt: new Date(),
        editedAt: payload.editedAt,
        players: payload.players.map((player) => ({
          playerId: player.playerId,
          displayName: player.displayName,
          status: player.status,
          checkedInAt: player.checkedInAt,
          note: player.note || null
        }))
      },
      attendancePlayers: payload.checkedInCount,
      aiContext: {
        presentPlayerIds: payload.players.filter((player) => player.status === 'present' || player.status === 'late').map((player) => player.playerId),
        attendanceSummary: {
          present: payload.players.filter((player) => player.status === 'present').length,
          late: payload.players.filter((player) => player.status === 'late').length,
          absent: payload.players.filter((player) => player.status === 'absent').length
        }
      },
      updatedAt: new Date()
    });
  }

  return {
    sessionId,
    teamId: event.teamId,
    eventId: event.id,
    rosterSize: payload.rosterSize,
    checkedInCount: payload.checkedInCount,
    players
  };
}

function assertPracticePacketManagementEvent(event: ParentScheduleEvent, user: AuthUser | null) {
  if (event.type !== 'practice') {
    throw new Error('Home packets are only available for practice sessions.');
  }
  if (!event.isDbGame) {
    throw new Error('Home packets open after this practice is tracked in the schedule.');
  }
  if (!user?.uid) {
    throw new Error('Sign in before managing practice packets.');
  }
  if (!event.isTeamAdmin) {
    throw new Error('Only team owners and admins can manage practice packets.');
  }
}

function normalizeStaffPracticePacketBlocks(blocks: StaffPracticePacketBlock[]): StaffPracticePacketBlock[] {
  return (Array.isArray(blocks) ? blocks : [])
    .map((block, index) => ({
      drillId: compactString(block?.drillId) || null,
      drillTitle: compactString(block?.drillTitle) || `Home Drill ${index + 1}`,
      type: compactString(block?.type) || 'Technical',
      duration: Math.max(1, Number.parseInt(String(block?.duration || 10), 10) || 10),
      description: compactString(block?.description),
      notes: compactString(block?.notes)
    }))
    .filter((block) => block.drillTitle);
}

function normalizeStaffPracticePacketDueDate(value: StaffPracticePacketInput['dueDate']) {
  if (!value) return null;
  const parsed = normalizeScheduleDate(value);
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
}

function buildStaffPracticePacketContent(input: StaffPracticePacketInput, event: ParentScheduleEvent, user: AuthUser) {
  const blocks = normalizeStaffPracticePacketBlocks(input.blocks);
  if (!blocks.length) {
    throw new Error('Add at least one home drill before saving the packet.');
  }
  const totalMinutes = blocks.reduce((sum, block) => sum + block.duration, 0);
  const dueAt = normalizeStaffPracticePacketDueDate(input.dueDate);
  const packetTitle = compactString(input.packetTitle) || `${event.title || 'Practice'} home packet`;
  return {
    packetTitle,
    blocks,
    totalMinutes,
    dueDate: dueAt ? dueAt.toISOString() : null,
    dueAt,
    updatedAt: new Date(),
    updatedBy: user.uid
  };
}

function getStaffPracticePacketTitle(homePacket: any, event: ParentScheduleEvent) {
  return compactString(homePacket?.packetTitle) || `${event.title || 'Practice'} home packet`;
}

function getStaffPracticePacketDueDate(homePacket: any) {
  const dueDate = normalizeScheduleDate(homePacket?.dueDate || homePacket?.dueAt);
  return dueDate ? dueDate.toISOString() : null;
}

function buildStaffPracticePacketResult(event: ParentScheduleEvent, sessionId: string, homePacket: PracticeHomePacket, completions: PracticePacketCompletion[], childEvents: ParentScheduleEvent[]): StaffPracticePacket {
  return {
    sessionId,
    teamId: event.teamId,
    eventId: event.id,
    title: event.title || 'Practice',
    date: event.date,
    location: event.location || 'TBD',
    homePacket,
    completions,
    children: getPracticePacketChildren(childEvents, event),
    packetTitle: getStaffPracticePacketTitle(homePacket, event),
    dueDate: getStaffPracticePacketDueDate(homePacket),
    totalMinutes: homePacket.totalMinutes || (Array.isArray(homePacket.blocks) ? homePacket.blocks.reduce((sum, block) => sum + (Number.parseInt(String(block?.duration || 0), 10) || 0), 0) : 0)
  };
}

export async function loadStaffPracticePacket(event: ParentScheduleEvent, childEvents: ParentScheduleEvent[] = [], user: AuthUser | null): Promise<StaffPracticePacket> {
  assertPracticePacketManagementEvent(event, user);
  const session = await loadPracticeSessionForAttendance(event).catch(() => null);
  const sessionId = compactString(session?.id) || getPracticePacketSessionId(event) || event.id;
  const homePacket = (hasHomePacket(session) ? session.homePacketContent : event.practiceHomePacket) || { blocks: [], totalMinutes: 0 };
  const completions = sessionId ? normalizePracticePacketCompletions(await loadPracticePacketCompletions(event.teamId, sessionId).catch(() => [])) : [];
  return buildStaffPracticePacketResult(event, sessionId, homePacket, completions, childEvents);
}

export async function saveStaffPracticePacket(event: ParentScheduleEvent, user: AuthUser | null, input: StaffPracticePacketInput, childEvents: ParentScheduleEvent[] = []): Promise<StaffPracticePacket> {
  assertPracticePacketManagementEvent(event, user);
  const authUser = user as AuthUser;
  const homePacketContent = buildStaffPracticePacketContent(input, event, authUser);
  const sessionPayload = {
    eventId: event.id,
    eventType: 'practice',
    sourcePage: 'app-schedule',
    title: event.title || 'Practice',
    date: event.date,
    location: event.location || '',
    duration: homePacketContent.totalMinutes,
    status: 'draft',
    homePacketGenerated: true,
    homePacketContent,
    updatedBy: authUser.uid
  };

  let sessionId = compactString(event.practiceSessionId);
  try {
    if (sessionId) {
      await withTimeout(Promise.resolve(updatePracticeSession(event.teamId, sessionId, sessionPayload)), 'Practice packet save');
    } else {
      sessionId = await withTimeout(Promise.resolve(upsertPracticeSessionForEvent(event.teamId, event.id, sessionPayload)), 'Practice packet save');
    }
  } catch (error) {
    if (!isNativeRuntime()) throw error;
    sessionId = sessionId || event.id;
    logScheduleWarning('Falling back to REST practice packet save.', 'practice-packet-save', error, { fallback: 'rest', teamId: event.teamId, sessionId });
    await nativePatchDocument(`teams/${encodeURIComponent(event.teamId)}/practiceSessions/${encodeURIComponent(sessionId)}`, {
      ...sessionPayload,
      updatedAt: new Date()
    });
  }

  const completions = normalizePracticePacketCompletions(await loadPracticePacketCompletions(event.teamId, sessionId).catch(() => []));
  return buildStaffPracticePacketResult(event, sessionId, homePacketContent, completions, childEvents);
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
    logScheduleWarning('Falling back to REST packet completion.', 'practice-packet-completion-save', error, { fallback: 'rest', teamId: packet.teamId, sessionId: packet.sessionId, childId: child.id });
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

  const nextSeatCount = getNextRideConfirmedSeatCount(
    Number.parseInt(String(offerDoc.seatCountConfirmed || 0), 10) || 0,
    requestDoc.status,
    status
  );
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
  const nextSeatCount = getNextRideConfirmedSeatCount(
    Number.parseInt(String(offerDoc.seatCountConfirmed || 0), 10) || 0,
    requestDoc.status,
    'declined'
  );
  await nativePatchDocument(offerPath, {
    seatCountConfirmed: nextSeatCount,
    updatedAt: new Date()
  });
}

export async function loadParentScheduleRideOffers(event: ParentScheduleEvent) {
  if (!event.isDbGame || event.isCancelled) return [];
  return normalizeRideOffers(await loadRideOffers(event.teamId, event.id));
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
    logScheduleWarning('Falling back to REST ride offer create.', 'ride-offer-create', error, { fallback: 'rest', teamId: event.teamId, gameId: event.id });
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
    logScheduleWarning('Falling back to REST ride request create.', 'ride-request-create', error, { fallback: 'rest', teamId: event.teamId, gameId: event.id, offerId: offer.id });
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
    logScheduleWarning('Falling back to REST ride request update.', 'ride-request-update', error, { fallback: 'rest', teamId: event.teamId, gameId, offerId: offer.id, requestId });
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
    logScheduleWarning('Falling back to REST ride offer status update.', 'ride-offer-status-update', error, { fallback: 'rest', teamId: event.teamId, gameId, offerId: offer.id });
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
    logScheduleWarning('Falling back to REST ride request cancel.', 'ride-request-cancel', error, { fallback: 'rest', teamId: event.teamId, gameId, offerId: offer.id, requestId });
    await nativeCancelRideRequestForChild(event, offer, requestId);
  }
}

export function summarizeParentScheduleRideOffers(offers: ScheduleRideOffer[]) {
  return getScheduleRideshareSummary(offers);
}
