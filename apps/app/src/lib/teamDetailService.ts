import {
  getAggregatedStatsForGames,
  getAdSpaceSponsors,
  getConfigs,
  getGames,
  getLocalAttractionSponsors,
  getPlayers,
  getPlayerTrackingStatuses,
  getPublicTrackingItems,
  getTeam,
  getAllUsers,
  updateTeam,
  getEvents,
  updateEvent,
  updateGame,
  grantScorekeeperAccess,
  grantVideographerAccess,
  inviteAdmin,
  addTeamAdminEmail,
  revokeScorekeeperAccess,
  revokeVideographerAccess
} from '../../../../js/db.js';
import { sendInviteEmail } from '../../../../js/auth.js';
import { inviteExistingTeamAdmin } from '../../../../js/edit-team-admin-invites.js';
import { collection, db, getDocs, query, where } from '../../../../js/firebase.js';
import { buildScheduleNotificationMetadata, describeScheduleReminderWindow, normalizeScheduleNotificationSettings } from '../../../../js/schedule-notifications.js';
import { calculateSeasonRecord, listSeasonLabels } from '../../../../js/season-record.js';
import { computeNativeStandings } from '../../../../js/native-standings.js';
import { buildPlayerLeaderboardSnapshot, selectAnalyticsConfig } from '../../../../js/stat-leaderboards.js';
import { getVisiblePlayerTrackingSummary } from '../../../../js/player-tracking-summary.js';
import { hasFullTeamAccess } from '../../../../js/team-access.js';
import { buildTeamStaffPermissionsViewModel } from '../../../../js/team-staff-permissions.js';
import { firebaseAuth, getNativeAuthIdToken } from './authService';
import type { AuthUser } from './types';

const primaryDataTimeoutMs = 5000;

export type TeamDetailPlayer = {
  id: string;
  name: string;
  number: string;
  photoUrl: string | null;
  position: string;
  isLinked: boolean;
};

export type TeamScorekeeperGrantTarget = {
  userId: string;
  name: string;
  email: string;
  playerNames: string[];
  isGranted: boolean;
};

export type TeamDetailEvent = {
  id: string;
  type: 'game' | 'practice';
  title: string;
  date: Date;
  location: string;
  opponent: string;
  status: string;
  liveStatus: string;
  visibility: string;
  isPrivate: boolean;
  isPublic: boolean;
  shareable: boolean;
  publicCalendar: boolean;
  homeScore: number | null;
  awayScore: number | null;
  isCancelled: boolean;
};

export type TeamDetailLeaderboard = {
  id: string;
  label: string;
  leaders: Array<{
    playerId: string;
    playerName: string;
    playerNumber: string;
    photoUrl: string | null;
    rank: number;
    formattedValue: string;
  }>;
};

export type TeamDetailTrackingSummary = {
  playerId: string;
  playerName: string;
  photoUrl: string | null;
  items: Array<{
    id: string;
    title: string;
    description: string;
    isComplete: boolean;
  }>;
};

export type TeamDetailSponsor = {
  id: string;
  name: string;
  description: string;
  imageUrl: string | null;
  websiteUrl: string | null;
};

export type TeamStaffPermissionsSummary = {
  staff: Array<{ label: string; role: string }>;
  pendingInvites: string[];
  helperPermissions: Array<{
    key: string;
    title: string;
    grants: string[];
    emptyText: string;
  }>;
  scorekeepingMode: string;
  scorekeeperGrantTargets: TeamScorekeeperGrantTarget[];
  videographerGrantTargets: TeamScorekeeperGrantTarget[];
  hasAnyStaff: boolean;
};


export type InviteTeamAdminForAppResult = {
  email: string;
  status: 'sent' | 'existing_user' | 'fallback_code';
  code: string | null;
  teamName: string | null;
  acceptInviteUrl: string | null;
  reason?: string;
};

export type TeamScheduleNotificationSettings = {
  enabled: boolean;
  reminderHours: 24 | 48 | 72;
  delivery: 'team_chat';
  hasExplicitReminderHours: boolean;
  summary: string;
};

export type TeamDetailModel = {
  team: {
    id: string;
    name: string;
    sport: string;
    photoUrl: string | null;
    description: string;
    zip: string;
    isPublic: boolean;
    active: boolean;
    leagueUrl: string | null;
    bracketUrl: string | null;
    streamUrl: string | null;
    websiteUrl: string;
    editTeamUrl: string;
    mediaUrl: string;
    registrationProvider: Array<{ label: string; value: string }>;
    scheduleNotifications: TeamScheduleNotificationSettings;
  };
  players: TeamDetailPlayer[];
  linkedPlayers: TeamDetailPlayer[];
  upcomingEvents: TeamDetailEvent[];
  recentResults: TeamDetailEvent[];
  nextEvent: TeamDetailEvent | null;
  record: {
    label: string;
    wins: number;
    losses: number;
    ties: number;
    gamesPlayed: number;
    winPercentage: number | null;
  };
  standings: {
    enabled: boolean;
    label: string;
    rows: Array<Record<string, any>>;
    currentRow: Record<string, any> | null;
  };
  leaderboards: TeamDetailLeaderboard[];
  trackingSummaries: TeamDetailTrackingSummary[];
  sponsors: TeamDetailSponsor[];
  canManageTeam: boolean;
  staffPermissions: TeamStaffPermissionsSummary | null;
  counts: {
    games: number;
    practices: number;
    completedGames: number;
  };
};

export type TeamDetailInsightsPayload = {
  leaderboards: TeamDetailLeaderboard[];
  trackingSummaries: TeamDetailTrackingSummary[];
};

export type TeamDetailSponsorsPayload = {
  sponsors: TeamDetailSponsor[];
};

type TeamDetailBaseSnapshot = {
  teamId: string;
  team: any;
  players: any[];
  games: any[];
  configs: any[];
};

type FirestoreDocument = Record<string, any> & { id: string };

const teamDetailBaseSnapshotCache = new Map<string, TeamDetailBaseSnapshot>();

export function __resetTeamDetailBaseSnapshotCacheForTests() {
  teamDetailBaseSnapshotCache.clear();
}

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
  if (!projectId) throw new Error('Firebase project ID is missing.');
  return projectId;
}

function cacheTeamDetailBaseSnapshot(snapshot: TeamDetailBaseSnapshot) {
  teamDetailBaseSnapshotCache.set(cleanString(snapshot.teamId), {
    teamId: cleanString(snapshot.teamId),
    team: snapshot.team,
    players: Array.isArray(snapshot.players) ? snapshot.players : [],
    games: Array.isArray(snapshot.games) ? snapshot.games : [],
    configs: Array.isArray(snapshot.configs) ? snapshot.configs : []
  });
}

async function loadTeamDetailBaseSnapshot(teamId: string): Promise<TeamDetailBaseSnapshot> {
  const normalizedTeamId = cleanString(teamId);
  const cachedSnapshot = teamDetailBaseSnapshotCache.get(normalizedTeamId);
  if (cachedSnapshot?.team) return cachedSnapshot;

  const [team, players, games, configs] = await Promise.all([
    loadTeamDocument(normalizedTeamId),
    loadTeamPlayers(normalizedTeamId),
    loadTeamGames(normalizedTeamId),
    loadTeamConfigs(normalizedTeamId)
  ]);

  const snapshot = {
    teamId: normalizedTeamId,
    team,
    players: Array.isArray(players) ? players : [],
    games: Array.isArray(games) ? games : [],
    configs: Array.isArray(configs) ? configs : []
  };
  cacheTeamDetailBaseSnapshot(snapshot);
  return snapshot;
}

function getFirestoreBaseUrl() {
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(getProjectId())}/databases/(default)/documents`;
}

async function getNativeHeaders() {
  const token = await getNativeAuthIdToken(true);
  if (!token) throw new Error('Native auth token is unavailable.');
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
    if (error?.status === 404) return null;
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
            value: { stringValue: value }
          }
        }
      }
    })
  });

  return Array.isArray(payload)
    ? payload.map((entry: any) => decodeFirestoreDocument(entry.document)).filter(Boolean) as FirestoreDocument[]
    : [];
}

async function readWithNativeFallback<T>(label: string, primary: () => Promise<T>, fallback: () => Promise<T>): Promise<T> {
  try {
    return await withTimeout(Promise.resolve(primary()), label);
  } catch (error) {
    if (!isNativeRuntime()) throw error;
    console.warn(`[team-detail-service] Falling back to REST for ${label}:`, error);
    return fallback();
  }
}

async function loadTeamDocument(teamId: string) {
  return readWithNativeFallback(
    `team ${teamId}`,
    () => Promise.resolve(getTeam(teamId, { includeInactive: true })),
    () => nativeGetDocument(`teams/${encodeURIComponent(teamId)}`)
  );
}

async function loadTeamPlayers(teamId: string) {
  return readWithNativeFallback(
    `team players ${teamId}`,
    () => Promise.resolve(getPlayers(teamId, { includeInactive: true })),
    async () => nativeListCollection(`teams/${encodeURIComponent(teamId)}/players`)
  );
}

async function loadTeamGames(teamId: string) {
  return readWithNativeFallback(
    `team games ${teamId}`,
    () => Promise.resolve(getGames(teamId)),
    async () => nativeListCollection(`teams/${encodeURIComponent(teamId)}/games`)
  );
}

async function loadTeamConfigs(teamId: string) {
  return readWithNativeFallback(
    `team configs ${teamId}`,
    () => Promise.resolve(getConfigs(teamId)),
    async () => nativeListCollection(`teams/${encodeURIComponent(teamId)}/statTrackerConfigs`)
  ).catch(() => []);
}

function getExpirationTime(expiresAt: any): number | null {
  if (expiresAt == null) return null;
  if (typeof expiresAt?.toMillis === 'function') return expiresAt.toMillis();
  if (expiresAt instanceof Date) return expiresAt.getTime();
  const expiresAtMs = Number(expiresAt);
  return Number.isFinite(expiresAtMs) ? expiresAtMs : null;
}

function isPendingAdminInvite(invite: any) {
  if (invite?.type !== 'admin_invite') return false;
  if (invite.used === true || invite.revoked === true || invite.active === false) return false;
  const status = cleanString(invite.status).toLowerCase();
  if (status && !['active', 'pending'].includes(status)) return false;
  const expiresAtMs = getExpirationTime(invite.expiresAt);
  return expiresAtMs == null || Date.now() < expiresAtMs;
}

async function loadPendingAdminInvites(teamId: string) {
  return readWithNativeFallback(
    `pending admin invites ${teamId}`,
    async () => {
      const snapshot = await getDocs(query(collection(db, 'accessCodes'), where('teamId', '==', teamId)));
      return snapshot.docs.map((docSnap: any) => ({ id: docSnap.id, ...(docSnap.data() || {}) }));
    },
    async () => nativeRunQuery('accessCodes', 'teamId', 'EQUAL', teamId)
  ).then((invites: any[]) => (Array.isArray(invites) ? invites : [])
    .filter(isPendingAdminInvite));
}


export async function inviteTeamAdminForApp(teamId: string, email: string): Promise<InviteTeamAdminForAppResult> {
  const normalizedTeamId = cleanString(teamId);
  const normalizedEmail = cleanString(email).toLowerCase();
  if (!normalizedTeamId) throw new Error('Team ID is required.');
  if (!normalizedEmail) throw new Error('Admin email is required.');

  const result = await inviteExistingTeamAdmin({
    teamId: normalizedTeamId,
    email: normalizedEmail,
    inviteAdmin,
    addTeamAdminEmail,
    sendInviteEmail
  });
  const code = cleanString(result?.code) || null;
  return {
    email: normalizedEmail,
    status: result?.status || 'fallback_code',
    code,
    teamName: result?.teamName || null,
    acceptInviteUrl: code ? buildAdminAcceptInviteUrl(code) : null,
    ...(result?.reason ? { reason: result.reason } : {})
  };
}

export async function grantScorekeeperAccessForApp(teamId: string, memberUserId: string) {
  const normalizedTeamId = cleanString(teamId);
  const normalizedUserId = cleanString(memberUserId);
  if (!normalizedTeamId) throw new Error('Team ID is required.');
  if (!normalizedUserId) throw new Error('Team member user ID is required.');
  await grantScorekeeperAccess(normalizedTeamId, normalizedUserId);
}

export async function revokeScorekeeperAccessForApp(teamId: string, memberUserId: string) {
  const normalizedTeamId = cleanString(teamId);
  const normalizedUserId = cleanString(memberUserId);
  if (!normalizedTeamId) throw new Error('Team ID is required.');
  if (!normalizedUserId) throw new Error('Team member user ID is required.');
  await revokeScorekeeperAccess(normalizedTeamId, normalizedUserId);
}

export async function grantVideographerAccessForApp(teamId: string, memberUserId: string) {
  const normalizedTeamId = cleanString(teamId);
  const normalizedUserId = cleanString(memberUserId);
  if (!normalizedTeamId) throw new Error('Team ID is required.');
  if (!normalizedUserId) throw new Error('Team member user ID is required.');
  await grantVideographerAccess(normalizedTeamId, normalizedUserId);
}

export async function revokeVideographerAccessForApp(teamId: string, memberUserId: string) {
  const normalizedTeamId = cleanString(teamId);
  const normalizedUserId = cleanString(memberUserId);
  if (!normalizedTeamId) throw new Error('Team ID is required.');
  if (!normalizedUserId) throw new Error('Team member user ID is required.');
  await revokeVideographerAccess(normalizedTeamId, normalizedUserId);
}

export async function saveTeamScheduleNotificationsForApp(teamId: string, settings: Partial<TeamScheduleNotificationSettings>) {
  const normalizedTeamId = cleanString(teamId);
  if (!normalizedTeamId) throw new Error('Team ID is required.');
  const normalizedSettings = normalizeTeamScheduleNotifications(settings);
  const teamScheduleNotifications = {
    enabled: normalizedSettings.enabled,
    reminderHours: normalizedSettings.reminderHours,
    delivery: normalizedSettings.delivery
  };

  await updateTeam(normalizedTeamId, {
    scheduleNotifications: teamScheduleNotifications
  });

  const events = await Promise.resolve(getEvents(normalizedTeamId)).catch(() => []);
  for (const event of Array.isArray(events) ? events : []) {
    const eventId = cleanString(event?.id || event?.gameId);
    if (!eventId) continue;
    const eventType = cleanString(event?.type).toLowerCase() === 'practice' ? 'practice' : 'game';
    const isCanceled = ['cancelled', 'canceled'].includes(cleanString(event?.status).toLowerCase()) || event?.deleted === true;
    const payload = {
      scheduleNotifications: buildScheduleNotificationMetadata({
        settings: teamScheduleNotifications,
        action: isCanceled ? 'cancelled' : 'updated',
        eventDate: event?.date,
        canceled: isCanceled
      })
    };

    if (eventType === 'practice') {
      await updateEvent(normalizedTeamId, eventId, payload);
    } else {
      await updateGame(normalizedTeamId, eventId, payload);
    }
  }

  return normalizedSettings;
}

export function buildAdminAcceptInviteUrl(code: string, baseUrl = getPublicBaseUrl()) {
  const inviteCode = cleanString(code);
  if (!inviteCode) return null;
  const url = new URL('/app', baseUrl);
  const searchParams = new URLSearchParams();
  searchParams.set('code', inviteCode);
  searchParams.set('type', 'admin');
  url.hash = `/accept-invite?${searchParams.toString()}`;
  return url.toString();
}

export function buildPublicTeamGamesIcsUrl(teamId: string) {
  const normalizedTeamId = cleanString(teamId);
  if (!normalizedTeamId) return '';
  const configured = (window as any).__ALLPLAYS_CONFIG__?.publicTeamGamesIcsFunctionUrl || (window as any).ALLPLAYS_PUBLIC_GAMES_ICS_URL;
  const fallback = (window as any).__ALLPLAYS_CONFIG__?.calendarFetchFunctionUrl || (window as any).ALLPLAYS_CALENDAR_FUNCTION_URL;
  const baseUrl = typeof configured === 'string' && configured.trim()
    ? configured.trim()
    : typeof fallback === 'string' && fallback.includes('fetchCalendarIcs')
      ? fallback.replace('fetchCalendarIcs', 'publicTeamGamesIcs')
      : 'https://us-central1-all-plays-prod.cloudfunctions.net/publicTeamGamesIcs';
  const separator = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${separator}teamId=${encodeURIComponent(normalizedTeamId)}`;
}

export function isShareableFanFeedEvent(event: Partial<TeamDetailEvent> = {}) {
  const visibility = cleanString(event.visibility).toLowerCase();
  if (visibility === 'private' || event.isPrivate === true) return false;
  return visibility === 'public'
    || event.isPublic === true
    || event.shareable === true
    || event.publicCalendar === true;
}

export function canExposePublicFanFeed(team: Partial<TeamDetailModel['team']> = {}, events: Array<Partial<TeamDetailEvent>> = []) {
  return (events || []).some((event) => {
    if (cleanString(event.type || 'game').toLowerCase() !== 'game') return false;
    if (cleanString(event.visibility).toLowerCase() === 'private') return false;
    if (event.isPrivate === true) return false;
    if (cleanString(event.status).toLowerCase() === 'deleted') return false;
    if (cleanString(event.liveStatus).toLowerCase() === 'deleted') return false;
    return (team.isPublic === true && team.active !== false) || isShareableFanFeedEvent(event);
  });
}

function getPublicBaseUrl() {
  if (typeof window !== 'undefined' && /^https?:$/i.test(window.location.protocol)) {
    return window.location.origin;
  }
  return 'https://allplays.ai';
}

export async function loadParentTeamDetail(
  teamId: string,
  user: AuthUser | null,
  options: { includeDeferredData?: boolean } = {}
): Promise<TeamDetailModel> {
  const includeDeferredData = options.includeDeferredData === true;
  const { team, players, games, configs } = await loadTeamDetailBaseSnapshot(teamId);

  if (!team) throw new Error('Team not found.');

  const linkedPlayerIds = getLinkedPlayerIds(user, teamId, players);
  const completedGameIds = (Array.isArray(games) ? games : [])
    .filter(isCompletedGame)
    .map((game: any) => cleanString(game.id || game.gameId))
    .filter(Boolean);

  const [seasonStatsByPlayerId, trackingItems, trackingStatuses, localSponsors, adSponsors] = includeDeferredData
    ? await Promise.all([
      completedGameIds.length ? Promise.resolve(getAggregatedStatsForGames(teamId, completedGameIds)).catch(() => ({})) : Promise.resolve({}),
      linkedPlayerIds.length ? Promise.resolve(getPublicTrackingItems(teamId)).catch(() => []) : Promise.resolve([]),
      linkedPlayerIds.length ? Promise.resolve(getPlayerTrackingStatuses(teamId, linkedPlayerIds)).catch(() => []) : Promise.resolve([]),
      Promise.resolve(getLocalAttractionSponsors(teamId)).catch(() => []),
      Promise.resolve(getAdSpaceSponsors(teamId)).catch(() => [])
    ])
    : await Promise.all([
      Promise.resolve({}),
      Promise.resolve([]),
      Promise.resolve([]),
      Promise.resolve([]),
      Promise.resolve([])
    ]);

  return buildTeamDetailModel({
    teamId,
    team,
    players,
    games,
    configs,
    user,
    linkedPlayerIds,
    seasonStatsByPlayerId,
    trackingItems,
    trackingStatuses,
    sponsors: [...normalizeSponsorList(adSponsors), ...normalizeSponsorList(localSponsors)],
    includeStaffPermissions: false
  });
}

export async function loadTeamDetailInsights(teamId: string, user: AuthUser | null): Promise<TeamDetailInsightsPayload> {
  const { team, players, games, configs } = await loadTeamDetailBaseSnapshot(teamId);

  if (!team) throw new Error('Team not found.');

  const linkedPlayerIds = getLinkedPlayerIds(user, teamId, players);
  const completedGameIds = (Array.isArray(games) ? games : [])
    .filter(isCompletedGame)
    .map((game: any) => cleanString(game.id || game.gameId))
    .filter(Boolean);

  const [seasonStatsByPlayerId, trackingItems, trackingStatuses] = await Promise.all([
    completedGameIds.length ? Promise.resolve(getAggregatedStatsForGames(teamId, completedGameIds)).catch(() => ({})) : Promise.resolve({}),
    linkedPlayerIds.length ? Promise.resolve(getPublicTrackingItems(teamId)).catch(() => []) : Promise.resolve([]),
    linkedPlayerIds.length ? Promise.resolve(getPlayerTrackingStatuses(teamId, linkedPlayerIds)).catch(() => []) : Promise.resolve([])
  ]);

  const normalizedPlayers = normalizePlayers(players, linkedPlayerIds);
  return {
    leaderboards: buildLeaderboards(configs, normalizedPlayers, seasonStatsByPlayerId, team?.sport),
    trackingSummaries: buildTrackingSummaries(normalizedPlayers, linkedPlayerIds, trackingItems, trackingStatuses)
  };
}

export async function loadTeamDetailSponsors(teamId: string): Promise<TeamDetailSponsorsPayload> {
  const [localSponsors, adSponsors] = await Promise.all([
    Promise.resolve(getLocalAttractionSponsors(teamId)).catch(() => []),
    Promise.resolve(getAdSpaceSponsors(teamId)).catch(() => [])
  ]);

  return {
    sponsors: [...normalizeSponsorList(adSponsors), ...normalizeSponsorList(localSponsors)].slice(0, 4)
  };
}

export async function loadTeamStaffPermissions(teamId: string, user: AuthUser | null): Promise<TeamStaffPermissionsSummary | null> {
  const { team, players } = await loadTeamDetailBaseSnapshot(teamId);

  if (!team || !hasFullTeamAccess(user, team)) return null;

  const [pendingAdminInvites, confirmedTeamMembers] = await Promise.all([
    loadPendingAdminInvites(teamId).catch(() => []),
    Promise.resolve(getAllUsers()).catch(() => [])
  ]);

  return buildTeamStaffPermissionsSummary({
    teamId,
    team,
    players,
    pendingAdminInvites,
    confirmedTeamMembers
  });
}

export function buildTeamDetailModel({
  teamId,
  team,
  players = [],
  games = [],
  configs = [],
  user = null,
  linkedPlayerIds = getLinkedPlayerIds(user, teamId, players),
  seasonStatsByPlayerId = {},
  trackingItems = [],
  trackingStatuses = [],
  sponsors = [],
  pendingAdminInvites = [],
  confirmedTeamMembers = [],
  includeStaffPermissions = true
}: {
  teamId: string;
  team: Record<string, any>;
  players?: any[];
  games?: any[];
  configs?: any[];
  user?: AuthUser | null;
  linkedPlayerIds?: string[];
  seasonStatsByPlayerId?: Record<string, Record<string, number>>;
  trackingItems?: any[];
  trackingStatuses?: any[];
  sponsors?: TeamDetailSponsor[];
  pendingAdminInvites?: any[];
  confirmedTeamMembers?: any[];
  includeStaffPermissions?: boolean;
}): TeamDetailModel {
  const normalizedPlayers = normalizePlayers(players, linkedPlayerIds);
  const normalizedEvents = normalizeEvents(games);
  const seasonLabels = listSeasonLabels(games);
  const currentYearLabel = String(new Date().getFullYear());
  const seasonLabel = seasonLabels.includes(currentYearLabel) ? currentYearLabel : (seasonLabels[0] || currentYearLabel);
  const record = calculateSeasonRecord(games, { seasonLabel });
  const completedGames = games.filter(isCompletedGame);
  const standings = buildStandings(team, games);
  const leaderboards = buildLeaderboards(configs, normalizedPlayers, seasonStatsByPlayerId, team?.sport);
  const trackingSummaries = buildTrackingSummaries(normalizedPlayers, linkedPlayerIds, trackingItems, trackingStatuses);
  const canManageTeam = hasFullTeamAccess(user, team);
  const staffPermissions = canManageTeam && includeStaffPermissions
    ? buildTeamStaffPermissionsSummary({ teamId, team, players, pendingAdminInvites, confirmedTeamMembers })
    : null;

  return {
    team: {
      id: teamId,
      name: cleanString(team?.name) || 'Team',
      sport: cleanString(team?.sport) || 'Sport not set',
      photoUrl: getFirstUrl(team?.photoUrl, team?.teamPhotoUrl, team?.logoUrl, team?.imageUrl),
      description: cleanString(team?.description),
      zip: cleanString(team?.zip),
      isPublic: team?.isPublic === true,
      active: team?.active !== false,
      leagueUrl: getFirstUrl(team?.leagueUrl),
      bracketUrl: getFirstUrl(team?.bracketUrl),
      streamUrl: getStreamUrl(team),
      websiteUrl: getPublicHashUrl('team.html', teamId),
      editTeamUrl: getPublicHashUrl('edit-team.html', teamId),
      mediaUrl: getPublicHashUrl('team-media.html', teamId),
      registrationProvider: getRegistrationProviderDetails(team, teamId),
      scheduleNotifications: normalizeTeamScheduleNotifications(team?.scheduleNotifications)
    },
    players: normalizedPlayers,
    linkedPlayers: normalizedPlayers.filter((player) => player.isLinked),
    upcomingEvents: normalizedEvents.upcoming,
    recentResults: normalizedEvents.recent,
    nextEvent: normalizedEvents.upcoming[0] || null,
    record: {
      label: seasonLabel,
      wins: record.wins,
      losses: record.losses,
      ties: record.ties,
      gamesPlayed: record.wins + record.losses + record.ties,
      winPercentage: getWinPercentage(record)
    },
    standings,
    leaderboards,
    trackingSummaries,
    sponsors: sponsors.slice(0, 4),
    canManageTeam,
    staffPermissions,
    counts: {
      games: games.filter((game: any) => game?.type !== 'practice').length,
      practices: games.filter((game: any) => game?.type === 'practice').length,
      completedGames: completedGames.length
    }
  };
}

function buildTeamStaffPermissionsSummary({
  teamId,
  team,
  players = [],
  pendingAdminInvites = [],
  confirmedTeamMembers = []
}: {
  teamId: string;
  team: Record<string, any>;
  players?: any[];
  pendingAdminInvites?: any[];
  confirmedTeamMembers?: any[];
}): TeamStaffPermissionsSummary {
  return {
    ...buildTeamStaffPermissionsViewModel({ ...team, id: teamId }, pendingAdminInvites),
    scorekeepingMode: cleanString(team?.teamPermissions?.scorekeeping?.mode),
    scorekeeperGrantTargets: buildPermissionGrantTargets(team, players, 'scorekeeping', confirmedTeamMembers, teamId),
    videographerGrantTargets: buildPermissionGrantTargets(team, players, 'videography', confirmedTeamMembers, teamId)
  };
}

function normalizeTeamScheduleNotifications(settings: any): TeamScheduleNotificationSettings {
  const normalized = normalizeScheduleNotificationSettings(settings || {});
  const reminderHours = normalized.reminderHours as 24 | 48 | 72;
  return {
    enabled: normalized.enabled,
    reminderHours,
    delivery: 'team_chat',
    hasExplicitReminderHours: Object.prototype.hasOwnProperty.call(settings || {}, 'reminderHours')
      && [24, 48, 72].includes(Number.parseInt(settings?.reminderHours, 10)),
    summary: describeScheduleReminderWindow(settings || {})
  };
}

function normalizePlayers(players: any[], linkedPlayerIds: string[]): TeamDetailPlayer[] {
  const linked = new Set(linkedPlayerIds);
  return (Array.isArray(players) ? players : [])
    .filter((player) => player?.active !== false)
    .map((player) => ({
      id: cleanString(player?.id || player?.playerId),
      name: cleanString(player?.name || player?.playerName) || 'Player',
      number: cleanString(player?.number),
      photoUrl: getFirstUrl(player?.photoUrl, player?.imageUrl, player?.headshotUrl),
      position: cleanString(player?.position || player?.primaryPosition),
      isLinked: linked.has(cleanString(player?.id || player?.playerId))
    }))
    .filter((player) => player.id)
    .sort((a, b) => sortByNumberThenName(a, b));
}

function buildPermissionGrantTargets(team: Record<string, any>, players: any[], permissionKey: string, confirmedTeamMembers: any[] = [], teamId = ''): TeamScorekeeperGrantTarget[] {
  const selectedPermissionIds = getSelectedPermissionIds(team, permissionKey);
  const targetsByUserId = new Map<string, Omit<TeamScorekeeperGrantTarget, 'isGranted'>>();

  const addTarget = (userId: any, player: any, source: Record<string, any> = {}) => {
    const normalizedUserId = cleanString(userId);
    if (!normalizedUserId) return;
    const playerName = cleanString(player?.name || player?.playerName);
    const sourceName = cleanString(source.name || source.displayName || source.fullName || source.email);
    const sourceEmail = cleanString(source.email).toLowerCase();
    const existing = targetsByUserId.get(normalizedUserId) || {
      userId: normalizedUserId,
      name: sourceName || playerName || 'Team member',
      email: sourceEmail,
      playerNames: []
    };
    if (playerName && !existing.playerNames.includes(playerName)) existing.playerNames.push(playerName);
    if (sourceName && (!existing.name || existing.name === playerName || existing.name === 'Team member')) existing.name = sourceName;
    if (!existing.email && sourceEmail) existing.email = sourceEmail;
    targetsByUserId.set(normalizedUserId, existing);
  };

  const activePlayers = (Array.isArray(players) ? players : []).filter((player) => player?.active !== false);
  const playersById = new Map(activePlayers.map((player) => [cleanString(player?.id || player?.playerId), player]));

  activePlayers.forEach((player) => {
    getPlayerLinkedUserIds(player).forEach((userId) => addTarget(userId, player));
    (Array.isArray(player?.parents) ? player.parents : []).forEach((parent: any) => {
      addTarget(parent?.userId || parent?.uid || parent?.authUid || parent?.accountUserId || parent?.memberUserId, player, parent);
    });
  });

  (Array.isArray(confirmedTeamMembers) ? confirmedTeamMembers : []).forEach((member) => {
    const parentLinks = (Array.isArray(member?.parentOf) ? member.parentOf : [])
      .filter((link: any) => cleanString(link?.teamId) === teamId);
    parentLinks.forEach((link: any) => {
      const player = playersById.get(cleanString(link?.playerId));
      if (player) addTarget(member?.id || member?.uid, player, member);
    });
  });

  return Array.from(targetsByUserId.values())
    .map((target) => ({ ...target, isGranted: selectedPermissionIds.has(target.userId) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function getPlayerLinkedUserIds(player: any) {
  const ids = new Set<string>();
  [player?.userId, player?.authUid, player?.accountUserId, player?.memberUserId]
    .map(cleanString)
    .filter(Boolean)
    .forEach((id) => ids.add(id));
  (Array.isArray(player?.parents) ? player.parents : []).forEach((parent: any) => {
    [parent?.userId, parent?.uid, parent?.authUid, parent?.accountUserId, parent?.memberUserId]
      .map(cleanString)
      .filter(Boolean)
      .forEach((id) => ids.add(id));
  });
  return Array.from(ids);
}

function getSelectedPermissionIds(team: Record<string, any>, kind: string) {
  const permission = team?.teamPermissions?.[kind] || {};
  if (permission.mode !== 'selected') return new Set<string>();
  return new Set((Array.isArray(permission.memberIds) ? permission.memberIds : [])
    .map(cleanString)
    .filter(Boolean));
}

function normalizeEvents(games: any[]) {
  const now = new Date();
  const events = (Array.isArray(games) ? games : [])
    .map((game) => {
      const date = toDate(game?.date);
      const type = game?.type === 'practice' ? 'practice' : 'game';
      return {
        id: cleanString(game?.id || game?.gameId),
        type,
        title: cleanString(game?.title) || (type === 'practice' ? 'Practice' : `vs. ${cleanString(game?.opponent) || 'TBD'}`),
        date,
        location: cleanString(game?.location) || 'TBD',
        opponent: cleanString(game?.opponent) || 'TBD',
        status: cleanString(game?.status || game?.liveStatus),
        liveStatus: cleanString(game?.liveStatus),
        visibility: cleanString(game?.visibility),
        isPrivate: game?.isPrivate === true || game?.private === true,
        isPublic: game?.isPublic === true || game?.public === true,
        shareable: game?.shareable === true || game?.isShareable === true,
        publicCalendar: game?.publicCalendar === true,
        homeScore: toNullableNumber(game?.homeScore),
        awayScore: toNullableNumber(game?.awayScore),
        isCancelled: cleanString(game?.status).toLowerCase() === 'cancelled'
      } as TeamDetailEvent;
    })
    .filter((event) => event.id && event.date);

  return {
    upcoming: events
      .filter((event) => !event.isCancelled && event.status.toLowerCase() !== 'completed' && event.date.getTime() >= now.getTime() - 3 * 60 * 60 * 1000)
      .sort((a, b) => a.date.getTime() - b.date.getTime()),
    recent: events
      .filter((event) => event.status.toLowerCase() === 'completed' || (event.homeScore !== null && event.awayScore !== null && event.date.getTime() < now.getTime()))
      .sort((a, b) => b.date.getTime() - a.date.getTime())
  };
}

function buildStandings(team: Record<string, any>, games: any[]) {
  const standingsConfig = team?.standingsConfig || {};
  const teamName = cleanString(team?.name);
  if (!standingsConfig.enabled || !teamName) {
    return { enabled: false, label: team?.leagueUrl ? 'League page configured' : 'No standings configured', rows: [], currentRow: null };
  }

  const leagueGames = (Array.isArray(games) ? games : [])
    .filter((game) => game?.type !== 'practice')
    .map((game) => {
      const opponent = cleanString(game?.opponent);
      const isHome = game?.isHome !== false;
      return {
        homeTeam: isHome ? teamName : opponent,
        awayTeam: isHome ? opponent : teamName,
        homeScore: isHome ? game?.homeScore : game?.awayScore,
        awayScore: isHome ? game?.awayScore : game?.homeScore,
        status: game?.status
      };
    });

  const rows = computeNativeStandings(leagueGames, standingsConfig);
  return {
    enabled: true,
    label: standingsConfig.rankingMode === 'win_pct' ? 'Win percentage' : 'Points table',
    rows,
    currentRow: rows.find((row: any) => row.team === teamName) || rows[0] || null
  };
}

function buildLeaderboards(configs: any[], players: TeamDetailPlayer[], seasonStatsByPlayerId: Record<string, Record<string, number>>, sport: string) {
  const analyticsConfig = selectAnalyticsConfig(configs, sport);
  if (!analyticsConfig) return [];
  const snapshot = buildPlayerLeaderboardSnapshot({
    config: analyticsConfig,
    players: players.map((player) => ({ id: player.id, name: player.name, number: player.number })),
    seasonStatsByPlayerId
  });
  const photosByPlayerId = new Map(players.map((player) => [player.id, player.photoUrl]));
  return (snapshot?.topStats || []).slice(0, 4).map((stat: any) => ({
    id: stat.id,
    label: stat.label,
    leaders: (stat.leaders || []).slice(0, 3).map((leader: any) => ({
      playerId: leader.playerId,
      playerName: leader.playerName,
      playerNumber: leader.playerNumber || '',
      photoUrl: photosByPlayerId.get(leader.playerId) || null,
      rank: leader.rank,
      formattedValue: leader.formattedValue
    }))
  }));
}

function buildTrackingSummaries(players: TeamDetailPlayer[], linkedPlayerIds: string[], items: any[], statuses: any[]): TeamDetailTrackingSummary[] {
  if (!linkedPlayerIds.length) return [];
  const playersById = new Map(players.map((player) => [player.id, player]));
  return getVisiblePlayerTrackingSummary({ items, statuses, playerIds: linkedPlayerIds })
    .filter((summary: any) => Array.isArray(summary.items) && summary.items.length > 0)
    .map((summary: any) => {
      const player = playersById.get(summary.playerId);
      return {
        playerId: summary.playerId,
        playerName: player?.name || 'Player',
        photoUrl: player?.photoUrl || null,
        items: summary.items.map((item: any) => ({
          id: item.id,
          title: item.title,
          description: item.description || '',
          isComplete: item.isComplete === true
        }))
      };
    });
}

function getLinkedPlayerIds(user: AuthUser | null, teamId: string, players: any[]) {
  const ids = new Set<string>();
  const addLink = (link: any) => {
    if (cleanString(link?.teamId) === teamId && cleanString(link?.playerId)) {
      ids.add(cleanString(link.playerId));
    }
  };
  (Array.isArray(user?.parentOf) ? user?.parentOf : []).forEach(addLink);
  (Array.isArray((user as any)?.playerOf) ? (user as any).playerOf : []).forEach(addLink);
  (Array.isArray((user as any)?.playerKeys) ? (user as any).playerKeys : [])
    .map((key: string) => String(key || '').split('::'))
    .filter(([linkedTeamId, playerId]: string[]) => linkedTeamId === teamId && playerId)
    .forEach(([, playerId]: string[]) => ids.add(playerId));
  (Array.isArray(players) ? players : [])
    .filter((player) => cleanString(player?.userId || player?.authUid || player?.accountUserId) === user?.uid)
    .forEach((player) => ids.add(cleanString(player.id || player.playerId)));
  return Array.from(ids);
}

function normalizeSponsorList(sponsors: any[]): TeamDetailSponsor[] {
  return (Array.isArray(sponsors) ? sponsors : [])
    .map((sponsor) => ({
      id: cleanString(sponsor?.id || sponsor?.name),
      name: cleanString(sponsor?.name) || 'Sponsor',
      description: cleanString(sponsor?.description),
      imageUrl: getFirstUrl(sponsor?.imageUrl, sponsor?.photoUrl),
      websiteUrl: getFirstUrl(sponsor?.websiteUrl, sponsor?.url)
    }))
    .filter((sponsor) => sponsor.id || sponsor.name);
}

function getRegistrationProviderDetails(team: Record<string, any>, teamId: string) {
  const source = team?.registrationSource || team?.registrationProvider || {};
  const rows = [
    { label: 'Provider', value: cleanString(source.provider || source.providerName) },
    { label: 'External Team ID', value: cleanString(source.externalTeamId) },
    { label: 'Team ID', value: cleanString(source.teamId || teamId) },
    { label: 'Last Sync', value: cleanString(source.lastSyncStatus || source.syncStatus) }
  ].filter((row) => row.value);
  return rows;
}

function getStreamUrl(team: Record<string, any>) {
  if (team?.twitchChannel) return `https://twitch.tv/${encodeURIComponent(cleanString(team.twitchChannel))}`;
  const embedUrl = cleanString(team?.streamEmbedUrl || team?.youtubeEmbedUrl);
  if (!embedUrl) return getFirstUrl(team?.streamUrl, team?.livestreamUrl);
  const channelMatch = embedUrl.match(/channel=(UC[a-zA-Z0-9_-]{22})/);
  const videoMatch = embedUrl.match(/\/embed\/([a-zA-Z0-9_-]{11})/);
  if (channelMatch) return `https://www.youtube.com/channel/${channelMatch[1]}`;
  if (videoMatch) return `https://www.youtube.com/watch?v=${videoMatch[1]}`;
  return getFirstUrl(embedUrl);
}

function isCompletedGame(game: any) {
  if (!game || game.type === 'practice') return false;
  const status = cleanString(game.status || game.liveStatus).toLowerCase();
  return (status === 'completed' || status === 'final') && toNullableNumber(game.homeScore) !== null && toNullableNumber(game.awayScore) !== null;
}

function getWinPercentage(record: { wins: number; losses: number; ties: number }) {
  const games = record.wins + record.losses + record.ties;
  if (!games) return null;
  return Math.round(((record.wins + (record.ties * 0.5)) / games) * 1000) / 10;
}

function sortByNumberThenName(a: TeamDetailPlayer, b: TeamDetailPlayer) {
  const aNumber = Number.parseInt(a.number, 10);
  const bNumber = Number.parseInt(b.number, 10);
  const aHasNumber = Number.isFinite(aNumber);
  const bHasNumber = Number.isFinite(bNumber);
  if (aHasNumber && bHasNumber && aNumber !== bNumber) return aNumber - bNumber;
  if (aHasNumber !== bHasNumber) return aHasNumber ? -1 : 1;
  return a.name.localeCompare(b.name);
}

function toDate(value: any) {
  if (value instanceof Date) return value;
  if (typeof value?.toDate === 'function') return value.toDate();
  if (typeof value?.seconds === 'number') return new Date(value.seconds * 1000);
  const date = new Date(value || Date.now());
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function toNullableNumber(value: any) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cleanString(value: unknown) {
  return String(value || '').trim();
}

function getFirstUrl(...values: unknown[]) {
  for (const value of values) {
    const url = cleanString(value);
    if (/^https?:\/\//i.test(url)) return url;
  }
  return null;
}

function getPublicHashUrl(path: string, teamId: string) {
  const url = new URL(path, 'https://allplays.ai');
  url.hash = new URLSearchParams({ teamId }).toString();
  return url.toString();
}
