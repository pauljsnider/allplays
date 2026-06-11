import {
  addPlayer,
  getAggregatedStatsForGames,
  getAdSpaceSponsors,
  getConfigs,
  getGames,
  inviteParent,
  getLocalAttractionSponsors,
  getPlayers,
  getPlayerTrackingStatuses,
  getPublicTrackingItems,
  getRosterFieldDefinitions,
  getTeam,
  getAllUsers,
  updateTeam,
  grantScorekeeperAccess,
  grantVideographerAccess,
  inviteAdmin,
  addTeamAdminEmail,
  revokeScorekeeperAccess,
  revokeVideographerAccess,
  deactivatePlayer,
  reactivatePlayer,
  uploadPlayerPhoto
} from '../../../../js/db.js';
import { sendInviteEmail } from '../../../../js/auth.js';
import { inviteExistingTeamAdmin } from '../../../../js/edit-team-admin-invites.js';
import { collection, db, getDocs, query, where } from '../../../../js/firebase.js';
import { normalizeRosterFieldDefinitions, validateRosterProfileValues } from '../../../../js/roster-profile-fields.js';
import { describeScheduleReminderWindow, normalizeScheduleNotificationSettings } from '../../../../js/schedule-notifications.js';
import { calculateSeasonRecord, listSeasonLabels } from '../../../../js/season-record.js';
import { computeNativeStandings } from '../../../../js/native-standings.js';
import { buildPlayerLeaderboardSnapshot, normalizeStatTrackerConfig, selectAnalyticsConfig } from '../../../../js/stat-leaderboards.js';
import { getVisiblePlayerTrackingSummary } from '../../../../js/player-tracking-summary.js';
import { hasFullTeamAccess, normalizeAdminEmailList } from '../../../../js/team-access.js';
import { buildTeamStaffPermissionsViewModel } from '../../../../js/team-staff-permissions.js';
import { firebaseAuth, getNativeAuthIdToken } from './authService';
import { buildAppAcceptInviteUrl } from './inviteUrls';
import type { AuthUser } from './types';

const primaryDataTimeoutMs = 5000;

export type TeamDetailPlayer = {
  id: string;
  name: string;
  number: string;
  photoUrl: string | null;
  position: string;
  isLinked: boolean;
  active: boolean;
};

export type TeamScorekeeperGrantTarget = {
  userId: string;
  name: string;
  email: string;
  playerNames: string[];
  isGranted: boolean;
};

export type TeamRosterParentInviteSummary = {
  playerId: string;
  status: 'none' | 'pending' | 'accepted';
  acceptedParentCount: number;
  pendingInviteCount: number;
  latestPendingCode: string;
};

export type TeamRosterFieldDefinition = {
  key: string;
  label: string;
  type: 'text' | 'menu' | 'checkbox' | 'date';
  section: string;
  required: boolean;
  options: Array<{ value: string; label: string }>;
  description: string;
  visibility: string;
  active: boolean;
  sortOrder: number;
};

export type CreateRosterPlayerForAppInput = {
  name: string;
  number?: string;
  photoFile?: File | null;
  rosterFieldValues?: Record<string, unknown>;
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
  statTrackerConfigId: string;
  statTrackerConfigLabel: string;
  statTrackerConfigBaseType: string;
  statTrackerConfigExists: boolean;
  statTrackerConfigIsBasketball: boolean;
};

export type TeamDetailStatTrackerConfig = {
  id: string;
  name: string;
  baseType: string;
  isBasketball: boolean;
  columnCount: number;
  columnNames: string[];
  assignedUpcomingGames: Array<{
    gameId: string;
    title: string;
    date: Date;
  }>;
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

export type CreateRosterParentInviteForAppResult = {
  code: string;
  inviteUrl: string;
  status: 'pending' | 'accepted';
  existingUser: boolean;
  autoLinked: boolean;
  teamName: string | null;
  playerName: string | null;
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
    ownerId: string;
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
  inactivePlayers: TeamDetailPlayer[];
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
  statTrackerConfigs: TeamDetailStatTrackerConfig[];
  canManageTeam: boolean;
  canManageAdmins: boolean;
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

function invalidateTeamDetailBaseSnapshotCache(teamId: string) {
  teamDetailBaseSnapshotCache.delete(cleanString(teamId));
}

function canManageTeamAdmins(user: AuthUser | null, team: any) {
  if (!user || !team) return false;
  return cleanString(team?.ownerId) === cleanString(user?.uid)
    || user?.isAdmin === true
    || user?.isPlatformAdmin === true
    || Array.isArray(user?.roles) && (user.roles.includes('admin') || user.roles.includes('platformAdmin'));
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

function isPendingParentInvite(invite: any) {
  if (invite?.type !== 'parent_invite') return false;
  if (invite.used === true || invite.revoked === true || invite.active === false) return false;
  const status = cleanString(invite.status).toLowerCase();
  if (status && !['active', 'pending'].includes(status)) return false;
  const expiresAtMs = getExpirationTime(invite.expiresAt);
  return expiresAtMs == null || Date.now() < expiresAtMs;
}

async function loadPendingParentInvites(teamId: string) {
  return readWithNativeFallback(
    `pending parent invites ${teamId}`,
    async () => {
      const snapshot = await getDocs(query(collection(db, 'accessCodes'), where('teamId', '==', teamId)));
      return snapshot.docs.map((docSnap: any) => ({ id: docSnap.id, ...(docSnap.data() || {}) }));
    },
    async () => nativeRunQuery('accessCodes', 'teamId', 'EQUAL', teamId)
  ).then((invites: any[]) => (Array.isArray(invites) ? invites : [])
    .filter(isPendingParentInvite));
}


export async function inviteTeamAdminForApp(teamId: string, email: string, user: AuthUser | null = null): Promise<InviteTeamAdminForAppResult> {
  const normalizedTeamId = cleanString(teamId);
  const normalizedEmail = cleanString(email).toLowerCase();
  if (!normalizedTeamId) throw new Error('Team ID is required.');
  if (!normalizedEmail) throw new Error('Admin email is required.');

  const { team } = await loadTeamDetailBaseSnapshot(normalizedTeamId);
  if (!team || !canManageTeamAdmins(user, team)) {
    throw new Error('You do not have permission to manage admins for this team.');
  }

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

export async function revokeTeamAdminAccessForApp(teamId: string, email: string, user: AuthUser | null) {
  const normalizedTeamId = cleanString(teamId);
  const normalizedEmail = cleanString(email).toLowerCase();
  if (!normalizedTeamId) throw new Error('Team ID is required.');
  if (!normalizedEmail) throw new Error('Admin email is required.');

  const { team } = await loadTeamDetailBaseSnapshot(normalizedTeamId);
  if (!team || !canManageTeamAdmins(user, team)) {
    throw new Error('You do not have permission to manage admins for this team.');
  }

  const ownerEmail = cleanString(team?.ownerEmail).toLowerCase();
  if (ownerEmail && ownerEmail === normalizedEmail) {
    throw new Error('The team owner cannot be removed from staff access.');
  }

  const nextAdminEmails = normalizeAdminEmailList(team?.adminEmails).filter((value: string) => value !== normalizedEmail);
  await updateTeam(normalizedTeamId, {
    adminEmails: nextAdminEmails,
    updatedAt: new Date()
  });
  invalidateTeamDetailBaseSnapshotCache(normalizedTeamId);
}

export async function createRosterParentInviteForApp(teamId: string, user: AuthUser | null, player: Pick<TeamDetailPlayer, 'id' | 'number'>): Promise<CreateRosterParentInviteForAppResult> {
  const normalizedTeamId = cleanString(teamId);
  const normalizedPlayerId = cleanString(player?.id);
  if (!normalizedTeamId) throw new Error('Team ID is required.');
  if (!normalizedPlayerId) throw new Error('Player ID is required.');

  const { team } = await loadTeamDetailBaseSnapshot(normalizedTeamId);
  if (!team || !hasFullTeamAccess(user, team)) {
    throw new Error('You do not have permission to invite parents for this team.');
  }

  const inviteResult = await inviteParent(normalizedTeamId, normalizedPlayerId, cleanString(player?.number), '', 'Parent');
  const code = cleanString(inviteResult?.code).toUpperCase();
  if (!code) throw new Error('Invite code was not created.');

  return {
    code,
    inviteUrl: buildAppAcceptInviteUrl(code, 'parent'),
    status: inviteResult?.autoLinked ? 'accepted' : 'pending',
    existingUser: inviteResult?.existingUser === true,
    autoLinked: inviteResult?.autoLinked === true,
    teamName: inviteResult?.teamName || null,
    playerName: inviteResult?.playerName || null
  };
}

export async function loadRosterFieldDefinitionsForApp(teamId: string, user: AuthUser | null): Promise<TeamRosterFieldDefinition[]> {
  const normalizedTeamId = cleanString(teamId);
  if (!normalizedTeamId) throw new Error('Team ID is required.');

  const { team } = await loadTeamDetailBaseSnapshot(normalizedTeamId);
  if (!team || !hasFullTeamAccess(user, team)) {
    throw new Error('You do not have permission to manage roster players for this team.');
  }

  return normalizeRosterFieldDefinitions(await getRosterFieldDefinitions(normalizedTeamId, team)) as TeamRosterFieldDefinition[];
}

export async function addRosterPlayerForApp(teamId: string, user: AuthUser | null, input: CreateRosterPlayerForAppInput) {
  const normalizedTeamId = cleanString(teamId);
  if (!normalizedTeamId) throw new Error('Team ID is required.');

  const { team } = await loadTeamDetailBaseSnapshot(normalizedTeamId);
  if (!team || !hasFullTeamAccess(user, team)) {
    throw new Error('You do not have permission to manage roster players for this team.');
  }

  const name = cleanString(input?.name);
  if (!name) throw new Error('Player name is required.');

  const rosterFields = await loadRosterFieldDefinitionsForApp(normalizedTeamId, user);
  const rosterFieldValues = normalizeRosterFieldValuesForSave(rosterFields, input?.rosterFieldValues || {});
  const validationErrors = validateRosterProfileValues(rosterFields, rosterFieldValues);
  if (validationErrors.length) {
    throw new Error(validationErrors.join('\n'));
  }

  let photoUrl: string | null = null;
  if (input?.photoFile) {
    validateLegacyRosterPhotoFile(input.photoFile);
    photoUrl = await uploadPlayerPhoto(input.photoFile);
  }

  const player = {
    name,
    number: cleanString(input?.number),
    photoUrl,
    profile: {
      customFields: rosterFieldValues
    }
  };

  const playerId = await addPlayer(normalizedTeamId, player);
  invalidateTeamDetailBaseSnapshotCache(normalizedTeamId);

  return {
    playerId,
    player
  };
}

export async function grantScorekeeperAccessForApp(teamId: string, memberUserId: string) {
  const normalizedTeamId = cleanString(teamId);
  const normalizedUserId = cleanString(memberUserId);
  if (!normalizedTeamId) throw new Error('Team ID is required.');
  if (!normalizedUserId) throw new Error('Team member user ID is required.');
  await grantScorekeeperAccess(normalizedTeamId, normalizedUserId);
  invalidateTeamDetailBaseSnapshotCache(normalizedTeamId);
}

export async function deactivateRosterPlayerForApp(teamId: string, playerId: string) {
  const normalizedTeamId = cleanString(teamId);
  const normalizedPlayerId = cleanString(playerId);
  if (!normalizedTeamId) throw new Error('Team ID is required.');
  if (!normalizedPlayerId) throw new Error('Player ID is required.');
  await deactivatePlayer(normalizedTeamId, normalizedPlayerId);
  invalidateTeamDetailBaseSnapshotCache(normalizedTeamId);
}

export async function reactivateRosterPlayerForApp(teamId: string, playerId: string) {
  const normalizedTeamId = cleanString(teamId);
  const normalizedPlayerId = cleanString(playerId);
  if (!normalizedTeamId) throw new Error('Team ID is required.');
  if (!normalizedPlayerId) throw new Error('Player ID is required.');
  await reactivatePlayer(normalizedTeamId, normalizedPlayerId);
  invalidateTeamDetailBaseSnapshotCache(normalizedTeamId);
}

export async function revokeScorekeeperAccessForApp(teamId: string, memberUserId: string) {
  const normalizedTeamId = cleanString(teamId);
  const normalizedUserId = cleanString(memberUserId);
  if (!normalizedTeamId) throw new Error('Team ID is required.');
  if (!normalizedUserId) throw new Error('Team member user ID is required.');
  await revokeScorekeeperAccess(normalizedTeamId, normalizedUserId);
  invalidateTeamDetailBaseSnapshotCache(normalizedTeamId);
}

export async function grantVideographerAccessForApp(teamId: string, memberUserId: string) {
  const normalizedTeamId = cleanString(teamId);
  const normalizedUserId = cleanString(memberUserId);
  if (!normalizedTeamId) throw new Error('Team ID is required.');
  if (!normalizedUserId) throw new Error('Team member user ID is required.');
  await grantVideographerAccess(normalizedTeamId, normalizedUserId);
  invalidateTeamDetailBaseSnapshotCache(normalizedTeamId);
}

export async function revokeVideographerAccessForApp(teamId: string, memberUserId: string) {
  const normalizedTeamId = cleanString(teamId);
  const normalizedUserId = cleanString(memberUserId);
  if (!normalizedTeamId) throw new Error('Team ID is required.');
  if (!normalizedUserId) throw new Error('Team member user ID is required.');
  await revokeVideographerAccess(normalizedTeamId, normalizedUserId);
  invalidateTeamDetailBaseSnapshotCache(normalizedTeamId);
}

export async function saveTeamScheduleNotificationsForApp(teamId: string, settings: Partial<TeamScheduleNotificationSettings>) {
  const normalizedTeamId = cleanString(teamId);
  if (!normalizedTeamId) throw new Error('Team ID is required.');
  const normalizedSettings = normalizeTeamScheduleNotifications(settings);

  await updateTeam(normalizedTeamId, {
    scheduleNotifications: {
      enabled: normalizedSettings.enabled,
      reminderHours: normalizedSettings.reminderHours,
      delivery: normalizedSettings.delivery
    }
  });

  return normalizedSettings;
}

export function buildAdminAcceptInviteUrl(code: string, baseUrl = getPublicBaseUrl()) {
  return buildAppAcceptInviteUrl(code, 'admin', baseUrl) || null;
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

export async function loadTeamRosterParentInvites(teamId: string, user: AuthUser | null): Promise<TeamRosterParentInviteSummary[]> {
  const { team, players } = await loadTeamDetailBaseSnapshot(teamId);

  if (!team || !hasFullTeamAccess(user, team)) return [];

  const [pendingParentInvites, confirmedTeamMembers] = await Promise.all([
    loadPendingParentInvites(teamId).catch(() => []),
    Promise.resolve(getAllUsers()).catch(() => [])
  ]);

  return buildRosterParentInviteSummaries({
    teamId,
    players,
    pendingParentInvites,
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
  const normalizedInactivePlayers = normalizePlayers(players, linkedPlayerIds, { inactiveOnly: true });
  const normalizedStatTrackerConfigs = buildTeamStatTrackerConfigs(configs, games);
  const normalizedEvents = normalizeEvents(games, normalizedStatTrackerConfigs.byId);
  const seasonLabels = listSeasonLabels(games);
  const currentYearLabel = String(new Date().getFullYear());
  const seasonLabel = seasonLabels.includes(currentYearLabel) ? currentYearLabel : (seasonLabels[0] || currentYearLabel);
  const record = calculateSeasonRecord(games, { seasonLabel });
  const completedGames = games.filter(isCompletedGame);
  const standings = buildStandings(team, games);
  const leaderboards = buildLeaderboards(configs, normalizedPlayers, seasonStatsByPlayerId, team?.sport);
  const trackingSummaries = buildTrackingSummaries(normalizedPlayers, linkedPlayerIds, trackingItems, trackingStatuses);
  const canManageTeam = hasFullTeamAccess(user, team);
  const canManageAdmins = canManageTeamAdmins(user, team);
  const staffPermissions = canManageTeam && includeStaffPermissions
    ? buildTeamStaffPermissionsSummary({ teamId, team, players, pendingAdminInvites, confirmedTeamMembers })
    : null;

  return {
    team: {
      id: teamId,
      ownerId: cleanString(team?.ownerId),
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
    inactivePlayers: normalizedInactivePlayers,
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
    statTrackerConfigs: normalizedStatTrackerConfigs.items,
    canManageTeam,
    canManageAdmins,
    staffPermissions,
    counts: {
      games: games.filter((game: any) => game?.type !== 'practice').length,
      practices: games.filter((game: any) => game?.type === 'practice').length,
      completedGames: completedGames.length
    }
  };
}

export function buildRosterParentInviteSummaries({
  teamId,
  players = [],
  pendingParentInvites = [],
  confirmedTeamMembers = []
}: {
  teamId: string;
  players?: any[];
  pendingParentInvites?: any[];
  confirmedTeamMembers?: any[];
}): TeamRosterParentInviteSummary[] {
  const normalizedTeamId = cleanString(teamId);
  const acceptedCounts = new Map<string, number>();

  (Array.isArray(confirmedTeamMembers) ? confirmedTeamMembers : []).forEach((member) => {
    const linkedPlayerIds = getAcceptedParentPlayerIds(member, normalizedTeamId);
    linkedPlayerIds.forEach((playerId) => {
      acceptedCounts.set(playerId, (acceptedCounts.get(playerId) || 0) + 1);
    });
  });

  const pendingInvitesByPlayerId = new Map<string, any[]>();
  (Array.isArray(pendingParentInvites) ? pendingParentInvites : []).forEach((invite) => {
    const playerId = cleanString(invite?.playerId);
    if (!playerId) return;
    const current = pendingInvitesByPlayerId.get(playerId) || [];
    current.push(invite);
    pendingInvitesByPlayerId.set(playerId, current);
  });

  return (Array.isArray(players) ? players : [])
    .filter((player) => cleanString(player?.id || player?.playerId))
    .map((player) => {
      const playerId = cleanString(player?.id || player?.playerId);
      const pendingInvites = (pendingInvitesByPlayerId.get(playerId) || []).slice().sort((a, b) => (
        (getExpirationTime(b?.createdAt) || 0) - (getExpirationTime(a?.createdAt) || 0)
      ));
      const acceptedParentCount = acceptedCounts.get(playerId) || 0;
      const pendingInviteCount = pendingInvites.length;

      return {
        playerId,
        status: acceptedParentCount > 0 ? 'accepted' : pendingInviteCount > 0 ? 'pending' : 'none',
        acceptedParentCount,
        pendingInviteCount,
        latestPendingCode: cleanString(pendingInvites[0]?.code).toUpperCase()
      };
    });
}

function getAcceptedParentPlayerIds(member: any, teamId: string) {
  const normalizedTeamId = cleanString(teamId);
  if (!normalizedTeamId) return [] as string[];

  const linkedPlayerIds = new Set<string>();
  (Array.isArray(member?.parentOf) ? member.parentOf : []).forEach((link: any) => {
    if (cleanString(link?.teamId) !== normalizedTeamId) return;
    const playerId = cleanString(link?.playerId);
    if (playerId) linkedPlayerIds.add(playerId);
  });

  const parentPlayerKeys = Array.isArray(member?.parentPlayerKeys) ? member.parentPlayerKeys : [];
  parentPlayerKeys.forEach((value: any) => {
    const [keyTeamId, keyPlayerId] = cleanString(value).split('::');
    if (keyTeamId === normalizedTeamId && keyPlayerId) {
      linkedPlayerIds.add(keyPlayerId);
    }
  });

  return [...linkedPlayerIds];
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

function normalizePlayers(players: any[], linkedPlayerIds: string[], options: { inactiveOnly?: boolean } = {}): TeamDetailPlayer[] {
  const linked = new Set(linkedPlayerIds);
  const inactiveOnly = options.inactiveOnly === true;
  return (Array.isArray(players) ? players : [])
    .filter((player) => inactiveOnly ? player?.active === false : player?.active !== false)
    .map((player) => normalizePlayer(player, linked))
    .filter((player) => player.id)
    .sort((a, b) => sortByNumberThenName(a, b));
}

function normalizePlayer(player: any, linked: Set<string>): TeamDetailPlayer {
  const id = cleanString(player?.id || player?.playerId);
  return {
    id,
    name: cleanString(player?.name || player?.playerName) || 'Player',
    number: cleanString(player?.number),
    photoUrl: getFirstUrl(player?.photoUrl, player?.imageUrl, player?.headshotUrl),
    position: cleanString(player?.position || player?.primaryPosition),
    isLinked: linked.has(id),
    active: player?.active !== false
  };
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

function buildTeamStatTrackerConfigs(configs: any[], games: any[]) {
  const byId = new Map<string, TeamDetailStatTrackerConfig>();

  const items = (Array.isArray(configs) ? configs : [])
    .map((config) => normalizeTeamStatTrackerConfig(config))
    .filter((config) => config.id)
    .sort((a, b) => a.name.localeCompare(b.name));

  items.forEach((config) => {
    byId.set(config.id, config);
  });

  (Array.isArray(games) ? games : []).forEach((game) => {
    const configId = cleanString(game?.statTrackerConfigId);
    if (!configId || !isUpcomingAssignedGame(game)) return;
    const config = byId.get(configId);
    if (!config) return;
    config.assignedUpcomingGames.push({
      gameId: cleanString(game?.id || game?.gameId),
      title: cleanString(game?.title) || `vs. ${cleanString(game?.opponent) || 'TBD'}`,
      date: toDate(game?.date)
    });
  });

  items.forEach((config) => {
    config.assignedUpcomingGames.sort((a, b) => a.date.getTime() - b.date.getTime());
  });

  return { items, byId };
}

function normalizeTeamStatTrackerConfig(config: any): TeamDetailStatTrackerConfig {
  const rawColumns = extractStatColumnNames(config?.columns);
  const normalized = normalizeStatTrackerConfig({
    ...config,
    columns: rawColumns,
    statDefinitions: Array.isArray(config?.statDefinitions) ? config.statDefinitions : []
  });
  const columnNames = dedupeStrings(
    normalized.columns.length
      ? normalized.columns
      : (normalized.statDefinitions || [])
        .filter((definition: any) => !definition?.formula)
        .map((definition: any) => cleanString(definition?.acronym || definition?.label || definition?.id))
  );
  const baseType = cleanString(config?.baseType) || 'Custom';

  return {
    id: cleanString(config?.id || config?.configId),
    name: cleanString(config?.name) || `${baseType} config`,
    baseType,
    isBasketball: baseType.toLowerCase() === 'basketball',
    columnCount: columnNames.length,
    columnNames,
    assignedUpcomingGames: []
  };
}

function extractStatColumnNames(columns: any) {
  return dedupeStrings((Array.isArray(columns) ? columns : [])
    .map((column) => {
      if (typeof column === 'string') return cleanString(column);
      if (column && typeof column === 'object') {
        return cleanString(column.acronym || column.key || column.id || column.label || column.name);
      }
      return '';
    }));
}

function dedupeStrings(values: string[]) {
  return Array.from(new Set((Array.isArray(values) ? values : []).map((value) => cleanString(value)).filter(Boolean)));
}

function isUpcomingAssignedGame(game: any) {
  if (!game || game?.type === 'practice') return false;
  if (isHistoricalGameStatus(game)) return false;
  return isInUpcomingWindow(game?.date);
}

function isHistoricalGameStatus(game: any) {
  const status = cleanString(game?.status).toLowerCase();
  const liveStatus = cleanString(game?.liveStatus).toLowerCase();
  return status === 'completed' || status === 'final' || status === 'cancelled' || liveStatus === 'completed';
}

function normalizeEvents(games: any[], configById: Map<string, TeamDetailStatTrackerConfig> = new Map()) {
  const events = (Array.isArray(games) ? games : [])
    .map((game) => {
      const date = toDate(game?.date);
      const type = game?.type === 'practice' ? 'practice' : 'game';
      const statTrackerConfigId = cleanString(game?.statTrackerConfigId);
      const matchedConfig = statTrackerConfigId ? configById.get(statTrackerConfigId) : null;
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
        isCancelled: cleanString(game?.status).toLowerCase() === 'cancelled',
        statTrackerConfigId,
        statTrackerConfigLabel: statTrackerConfigId
          ? (matchedConfig?.name || `Missing config (${statTrackerConfigId})`)
          : 'No config assigned',
        statTrackerConfigBaseType: matchedConfig?.baseType || '',
        statTrackerConfigExists: Boolean(matchedConfig),
        statTrackerConfigIsBasketball: matchedConfig?.isBasketball === true
      } as TeamDetailEvent;
    })
    .filter((event) => event.id && event.date);

  return {
    upcoming: events
      .filter((event) => !event.isCancelled && event.status.toLowerCase() !== 'completed' && isInUpcomingWindow(event.date))
      .sort((a, b) => a.date.getTime() - b.date.getTime()),
    recent: events
      .filter((event) => event.status.toLowerCase() === 'completed' || (event.homeScore !== null && event.awayScore !== null && event.date.getTime() < Date.now()))
      .sort((a, b) => b.date.getTime() - a.date.getTime())
  };
}

function isInUpcomingWindow(value: any) {
  return toDate(value).getTime() >= Date.now() - 3 * 60 * 60 * 1000;
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

function normalizeRosterFieldValuesForSave(fields: TeamRosterFieldDefinition[], values: Record<string, unknown>) {
  const normalizedValues: Record<string, unknown> = {};
  fields.forEach((field) => {
    const rawValue = values?.[field.key];
    if (field.type === 'checkbox') {
      normalizedValues[field.key] = rawValue === true;
      return;
    }
    normalizedValues[field.key] = cleanString(rawValue);
  });
  return normalizedValues;
}

function validateLegacyRosterPhotoFile(file: File) {
  if (!String(file?.type || '').startsWith('image/')) {
    throw new Error('Please select an image file.');
  }
  if (!Number.isFinite(file?.size) || file.size <= 0) {
    throw new Error('Please select an image file.');
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new Error('Image must be smaller than 5MB.');
  }
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
