import {
  addPlayer,
  addTeamAdminEmail,
  buildPlayerLeaderboardSnapshot,
  buildTeamStaffPermissionsViewModel,
  buildTrackingStatusPayload,
  calculateSeasonRecord,
  collectRosterParentContacts,
  collection,
  computeNativeStandings,
  createConfig,
  db,
  deactivatePlayer,
  describeScheduleReminderWindow,
  doc,
  getAdSpaceSponsors,
  getAggregatedStatsForGames,
  getConfigs,
  getDoc,
  getDocs,
  getGames,
  getLocalAttractionSponsors,
  getPlayerTrackingStatuses,
  getPlayers,
  getPlayersWithPrivateRosterContacts,
  getPublicTrackingItems,
  getRosterFieldDefinitions,
  getTeam,
  getVisiblePlayerTrackingSummary,
  grantScorekeeperAccess,
  grantVideographerAccess,
  hasFullTeamAccess,
  inviteAdmin,
  inviteExistingTeamAdmin,
  inviteParent,
  listSeasonLabels,
  mergeStandardRosterFieldDefinitions,
  normalizeAdminEmailList,
  normalizeScheduleNotificationSettings,
  normalizeStatTrackerConfig,
  normalizeTrackingStatus,
  query,
  queueInviteEmail,
  reactivatePlayer,
  revokeScorekeeperAccess,
  revokeVideographerAccess,
  selectAnalyticsConfig,
  sendInviteEmail,
  serverTimestamp,
  setDoc,
  setPlayerPrivateRosterProfileFields,
  setTeamTrackingStatus,
  splitRosterProfileValuesByVisibility,
  summarizeTrackingStatus,
  updateConfig,
  updateDoc,
  updateTeam,
  uploadPlayerPhoto,
  uploadTeamPhoto,
  validateRosterProfileValues,
  where
} from './adapters/legacyTeamDetail';
import { firebaseAuth, getNativeAuthIdToken } from './authService';
import { buildAppAcceptInviteUrl } from './inviteUrls';
import { createLogger } from './logger';
import { getNativeRestDedupKey, loadDedupedNativeRestRequest, shouldDedupNativeRestRequest } from './nativeRestDedup';
import { normalizeOptionalHttpUrl, parseTeamLivestreamInput } from './teamLinks';
import type { AuthUser } from './types';

const primaryDataTimeoutMs = 5000;
const logger = createLogger('team-detail-service');

export type TeamDetailPlayer = {
  id: string;
  name: string;
  number: string;
  photoUrl: string | null;
  position: string;
  isLinked: boolean;
  active: boolean;
  parentContacts?: TeamRosterParentContact[];
};

export type TeamRosterParentContact = {
  userId?: string;
  name?: string;
  email?: string;
  phone?: string;
  relation: string;
  status?: string;
  source?: string;
  storage?: string;
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
  columns: string[];
  statDefinitions: Array<Record<string, unknown>>;
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
  email: string | null;
  emailSent: boolean;
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

export type UpdateTeamSettingsForAppInput = {
  name: string;
  sport?: string;
  zip?: string;
  isPublic?: boolean;
  leagueUrl?: string;
  streamUrl?: string;
  photoFile?: File | null;
};

export type UpsertStatTrackerConfigForAppInput = {
  name: string;
  baseType: string;
  columns: string[];
  statDefinitions: Array<Record<string, unknown>>;
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
    registrationProvider: Array<{ label: string; value: string; copyable?: boolean }>;
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

export type TeamTrackingAdminPlayerStatus = {
  playerId: string;
  playerName: string;
  playerNumber: string;
  photoUrl: string | null;
  complete: boolean;
};

export type TeamTrackingAdminItem = {
  id: string;
  name: string;
  description: string;
  visibility: 'private' | 'public';
  status: 'active' | 'archived';
  active: boolean;
  archived: boolean;
  playerStatuses: TeamTrackingAdminPlayerStatus[];
  completionSummary: {
    total: number;
    complete: number;
    incomplete: number;
  };
};

export type TeamTrackingItemForAppInput = {
  name: string;
  description?: string;
  visibility?: 'private' | 'public';
  status?: 'active' | 'archived';
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
  gamesLoaded: boolean;
  configsLoaded: boolean;
};

type FirestoreDocument = Record<string, any> & { id: string };

const teamDetailBaseSnapshotCache = new Map<string, TeamDetailBaseSnapshot>();
const privilegedTeamPlayersCache = new Map<string, Promise<any[]>>();
type RelevantTeamMembersCacheEntry = {
  inviteStateKey: string;
  parentInviteStateKey: string;
  baseMembersPromise: Promise<any[]> | null;
  baseMembers: any[];
  membersById: Map<string, any>;
  membersByEmail: Map<string, any>;
  loadedInviteEmails: Set<string>;
  inviteEmailPromises: Map<string, Promise<void>>;
};

const relevantTeamMembersCache = new Map<string, RelevantTeamMembersCacheEntry>();

export function __resetTeamDetailBaseSnapshotCacheForTests() {
  teamDetailBaseSnapshotCache.clear();
  privilegedTeamPlayersCache.clear();
  relevantTeamMembersCache.clear();
}

function invalidateTeamDetailBaseSnapshotCache(teamId: string) {
  const normalizedTeamId = cleanString(teamId);
  teamDetailBaseSnapshotCache.delete(normalizedTeamId);
  for (const cacheKey of privilegedTeamPlayersCache.keys()) {
    if (cacheKey.startsWith(`${normalizedTeamId}::`)) {
      privilegedTeamPlayersCache.delete(cacheKey);
    }
  }
  for (const cacheKey of relevantTeamMembersCache.keys()) {
    if (cacheKey === normalizedTeamId || cacheKey.startsWith(`${normalizedTeamId}::`)) {
      relevantTeamMembersCache.delete(cacheKey);
    }
  }
}

function canManageTeamAdmins(user: AuthUser | null, team: any) {
  if (!user || !team) return false;
  // Delegates owner/adminEmails/isAdmin checks to the legacy source of truth
  // (js/team-access.js) so this stays in sync with the legacy site instead of drifting.
  return hasFullTeamAccess(user, team)
    || user?.isPlatformAdmin === true
    || (Array.isArray(user?.roles) && (user.roles.includes('admin') || user.roles.includes('platformAdmin')));
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
    configs: Array.isArray(snapshot.configs) ? snapshot.configs : [],
    gamesLoaded: snapshot.gamesLoaded === true,
    configsLoaded: snapshot.configsLoaded === true
  });
}

async function loadTeamDetailBaseSnapshot(teamId: string, options: { includeGamesAndConfigs?: boolean } = {}): Promise<TeamDetailBaseSnapshot> {
  const normalizedTeamId = cleanString(teamId);
  const includeGamesAndConfigs = options.includeGamesAndConfigs !== false;
  const cachedSnapshot = teamDetailBaseSnapshotCache.get(normalizedTeamId);
  if (
    cachedSnapshot?.team
    && (!includeGamesAndConfigs || (cachedSnapshot.gamesLoaded === true && cachedSnapshot.configsLoaded === true))
  ) {
    return cachedSnapshot;
  }

  const [team, players, games, configs] = await Promise.all([
    cachedSnapshot?.team ? Promise.resolve(cachedSnapshot.team) : loadTeamDocument(normalizedTeamId),
    cachedSnapshot?.players ? Promise.resolve(cachedSnapshot.players) : loadTeamPlayers(normalizedTeamId),
    includeGamesAndConfigs
      ? (cachedSnapshot?.gamesLoaded ? Promise.resolve(cachedSnapshot.games) : loadTeamGames(normalizedTeamId))
      : Promise.resolve(cachedSnapshot?.games || []),
    includeGamesAndConfigs
      ? (cachedSnapshot?.configsLoaded ? Promise.resolve(cachedSnapshot.configs) : loadTeamConfigs(normalizedTeamId))
      : Promise.resolve(cachedSnapshot?.configs || [])
  ]);

  const snapshot = {
    teamId: normalizedTeamId,
    team,
    players: Array.isArray(players) ? players : [],
    games: Array.isArray(games) ? games : [],
    configs: Array.isArray(configs) ? configs : [],
    gamesLoaded: includeGamesAndConfigs ? true : cachedSnapshot?.gamesLoaded === true,
    configsLoaded: includeGamesAndConfigs ? true : cachedSnapshot?.configsLoaded === true
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
    logger.warn('Falling back to REST.', { label, error });
    return fallback();
  }
}

async function writeWithNativeFallback<T>(label: string, primary: () => Promise<T>, fallback: () => Promise<T>): Promise<T> {
  try {
    return await withTimeout(Promise.resolve(primary()), label);
  } catch (error) {
    if (!isNativeRuntime()) throw error;
    logger.warn('Falling back to REST.', { label, error });
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

async function loadPrivilegedTeamPlayers(teamId: string, user: AuthUser | null, team: any, publicPlayers: any[]) {
  if (!hasFullTeamAccess(user, team)) return publicPlayers;

  const normalizedTeamId = cleanString(teamId);
  const actorId = cleanString(user?.uid);
  if (!normalizedTeamId || !actorId) return publicPlayers;

  const cacheKey = `${normalizedTeamId}::${actorId}`;
  const cachedPlayers = privilegedTeamPlayersCache.get(cacheKey);
  if (cachedPlayers) return cachedPlayers;

  const playersPromise = readWithNativeFallback(
    `private roster contacts ${normalizedTeamId}`,
    () => Promise.resolve(getPlayersWithPrivateRosterContacts(normalizedTeamId, {
      includeInactive: true,
      players: publicPlayers
    })),
    () => Promise.resolve(publicPlayers)
  ).catch((error) => {
    privilegedTeamPlayersCache.delete(cacheKey);
    throw error;
  });
  privilegedTeamPlayersCache.set(cacheKey, playersPromise);
  return playersPromise;
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

async function loadTeamTrackingItems(teamId: string) {
  const normalizedTeamId = cleanString(teamId);
  return readWithNativeFallback(
    `team tracking items ${normalizedTeamId}`,
    async () => {
      const itemSnapshot = await getDocs(collection(db, `teams/${normalizedTeamId}/trackingItems`));
      return (itemSnapshot.docs as any[]).map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() }));
    },
    async () => nativeListCollection(`teams/${encodeURIComponent(normalizedTeamId)}/trackingItems`)
  );
}

async function loadTeamTrackingStatuses(teamId: string, itemId: string) {
  const normalizedTeamId = cleanString(teamId);
  const normalizedItemId = cleanString(itemId);
  return readWithNativeFallback(
    `team tracking statuses ${normalizedTeamId}/${normalizedItemId}`,
    async () => {
      const statusSnapshot = await getDocs(collection(db, `teams/${normalizedTeamId}/trackingItems/${normalizedItemId}/memberTracking`));
      return (statusSnapshot.docs as any[]).map((statusDoc) => ({
        id: statusDoc.id,
        ...statusDoc.data()
      }));
    },
    async () => nativeListCollection(`teams/${encodeURIComponent(normalizedTeamId)}/trackingItems/${encodeURIComponent(normalizedItemId)}/memberTracking`)
  );
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

async function loadUserById(userId: string) {
  const normalizedUserId = cleanString(userId);
  if (!normalizedUserId) return null;

  return readWithNativeFallback(
    `user ${normalizedUserId}`,
    async () => {
      const snapshot = await getDoc(doc(db, 'users', normalizedUserId));
      return snapshot.exists() ? { id: snapshot.id, ...(snapshot.data() || {}) } : null;
    },
    async () => nativeGetDocument(`users/${encodeURIComponent(normalizedUserId)}`)
  );
}

async function loadUsersByEmail(email: string) {
  const normalizedEmail = cleanString(email).toLowerCase();
  if (!normalizedEmail) return [] as any[];

  return readWithNativeFallback(
    `users by email ${normalizedEmail}`,
    async () => {
      const snapshot = await getDocs(query(collection(db, 'users'), where('email', '==', normalizedEmail)));
      return snapshot.docs.map((docSnap: any) => ({ id: docSnap.id, ...(docSnap.data() || {}) }));
    },
    async () => nativeRunQuery('users', 'email', 'EQUAL', normalizedEmail)
  );
}

async function loadUsersByParentTeamId(teamId: string) {
  const normalizedTeamId = cleanString(teamId);
  if (!normalizedTeamId) return [] as any[];

  return readWithNativeFallback(
    `users by parentTeamIds ${normalizedTeamId}`,
    async () => {
      const snapshot = await getDocs(query(collection(db, 'users'), where('parentTeamIds', 'array-contains', normalizedTeamId)));
      return snapshot.docs.map((docSnap: any) => ({ id: docSnap.id, ...(docSnap.data() || {}) }));
    },
    async () => nativeRunQuery('users', 'parentTeamIds', 'ARRAY_CONTAINS', normalizedTeamId)
  );
}

async function loadUsersByParentPlayerKey(parentPlayerKey: string) {
  const normalizedParentPlayerKey = cleanString(parentPlayerKey);
  if (!normalizedParentPlayerKey) return [] as any[];

  return readWithNativeFallback(
    `users by parentPlayerKeys ${normalizedParentPlayerKey}`,
    async () => {
      const snapshot = await getDocs(query(collection(db, 'users'), where('parentPlayerKeys', 'array-contains', normalizedParentPlayerKey)));
      return snapshot.docs.map((docSnap: any) => ({ id: docSnap.id, ...(docSnap.data() || {}) }));
    },
    async () => nativeRunQuery('users', 'parentPlayerKeys', 'ARRAY_CONTAINS', normalizedParentPlayerKey)
  );
}

function collectRelevantTeamMemberUserIds(team: any, players: any[] = []) {
  const userIds = new Set<string>();
  const addUserId = (value: any) => {
    const normalizedValue = cleanString(value);
    if (normalizedValue) userIds.add(normalizedValue);
  };

  addUserId(team?.ownerId);
  getSelectedPermissionIds(team, 'scorekeeping').forEach(addUserId);
  getSelectedPermissionIds(team, 'videography').forEach(addUserId);

  (Array.isArray(players) ? players : []).forEach((player) => {
    getPlayerLinkedUserIds(player).forEach(addUserId);
  });

  return [...userIds];
}

function collectRelevantTeamMemberEmails(team: any, players: any[] = [], invites: any[] = []) {
  const emails = new Set<string>();
  const addEmail = (value: any) => {
    const normalizedValue = cleanString(value).toLowerCase();
    if (normalizedValue.includes('@')) emails.add(normalizedValue);
  };

  addEmail(team?.ownerEmail);
  normalizeAdminEmailList(team?.adminEmails).forEach(addEmail);
  (Array.isArray(invites) ? invites : []).forEach((invite) => addEmail(invite?.email));

  (Array.isArray(players) ? players : []).forEach((player) => {
    (Array.isArray(player?.parents) ? player.parents : []).forEach((parent: any) => {
      addEmail(parent?.email);
    });
  });

  return [...emails];
}

function createRelevantTeamMembersCacheEntry(): RelevantTeamMembersCacheEntry {
  return {
    inviteStateKey: '',
    parentInviteStateKey: '',
    baseMembersPromise: null,
    baseMembers: [],
    membersById: new Map<string, any>(),
    membersByEmail: new Map<string, any>(),
    loadedInviteEmails: new Set<string>(),
    inviteEmailPromises: new Map<string, Promise<void>>()
  };
}

function buildRelevantTeamMemberInviteStateKey(pendingAdminInvites: any[] = [], pendingParentInvites: any[] = []) {
  return [...pendingAdminInvites, ...pendingParentInvites]
    .map((invite) => [
      cleanString(invite?.type).toLowerCase(),
      cleanString(invite?.email).toLowerCase(),
      cleanString(invite?.playerId),
      cleanString(invite?.code).toUpperCase()
    ].join(':'))
    .filter(Boolean)
    .sort()
    .join('|');
}

function resetRelevantTeamMembersCacheEntry(entry: RelevantTeamMembersCacheEntry, inviteStateKey: string, options: { resetBaseMembers?: boolean; parentInviteStateKey?: string } = {}) {
  entry.inviteStateKey = inviteStateKey;
  if (typeof options.parentInviteStateKey === 'string') entry.parentInviteStateKey = options.parentInviteStateKey;
  if (options.resetBaseMembers) {
    entry.baseMembersPromise = null;
    entry.baseMembers = [];
  }
  entry.membersById.clear();
  entry.membersByEmail.clear();
  mergeRelevantTeamMembers(entry, entry.baseMembers);
  entry.loadedInviteEmails.clear();
  entry.inviteEmailPromises.clear();
}

function mergeRelevantTeamMembers(entry: RelevantTeamMembersCacheEntry, members: any[] = []) {
  (Array.isArray(members) ? members : []).forEach((member) => {
    const normalizedUserId = cleanString(member?.id || member?.uid);
    const normalizedEmail = cleanString(member?.email).toLowerCase();
    if (normalizedUserId && !entry.membersById.has(normalizedUserId)) entry.membersById.set(normalizedUserId, member);
    if (normalizedEmail && !entry.membersByEmail.has(normalizedEmail)) entry.membersByEmail.set(normalizedEmail, member);
  });
}

function getCachedRelevantTeamMembers(entry: RelevantTeamMembersCacheEntry) {
  return Array.from(new Set([...entry.membersById.values(), ...entry.membersByEmail.values()]));
}

async function loadRelevantTeamMembers({
  team,
  players = [],
  pendingAdminInvites = [],
  pendingParentInvites = []
}: {
  team: any;
  players?: any[];
  pendingAdminInvites?: any[];
  pendingParentInvites?: any[];
}) {
  const normalizedTeamId = cleanString(team?.id || team?.teamId);
  if (!normalizedTeamId) return [];

  let cacheEntry = relevantTeamMembersCache.get(normalizedTeamId);
  if (!cacheEntry) {
    cacheEntry = createRelevantTeamMembersCacheEntry();
    relevantTeamMembersCache.set(normalizedTeamId, cacheEntry);
  }

  const inviteStateKey = buildRelevantTeamMemberInviteStateKey(pendingAdminInvites, pendingParentInvites);
  const parentInviteStateKey = buildRelevantTeamMemberInviteStateKey([], pendingParentInvites);
  if (cacheEntry.parentInviteStateKey !== parentInviteStateKey) {
    resetRelevantTeamMembersCacheEntry(cacheEntry, inviteStateKey, { resetBaseMembers: true, parentInviteStateKey });
  } else if (cacheEntry.inviteStateKey !== inviteStateKey) {
    resetRelevantTeamMembersCacheEntry(cacheEntry, inviteStateKey, { parentInviteStateKey });
  }

  const userIds = collectRelevantTeamMemberUserIds(team, players);
  const emails = collectRelevantTeamMemberEmails(team, players, [...pendingAdminInvites, ...pendingParentInvites]);
  const parentPlayerKeys = (Array.isArray(players) ? players : [])
    .map((player) => {
      const playerId = cleanString(player?.id || player?.playerId);
      return normalizedTeamId && playerId ? `${normalizedTeamId}::${playerId}` : '';
    })
    .filter(Boolean);

  if (!cacheEntry.baseMembersPromise) {
    cacheEntry.baseMembersPromise = Promise.all([
      Promise.all(userIds.map((userId) => loadUserById(userId).catch(() => null))),
      loadUsersByParentTeamId(normalizedTeamId).catch(() => []),
      Promise.all(parentPlayerKeys.map((parentPlayerKey) => loadUsersByParentPlayerKey(parentPlayerKey).catch(() => [])))
    ]).then(([usersById, usersByParentTeamId, usersByParentPlayerKey]) => {
      mergeRelevantTeamMembers(cacheEntry!, [
        ...usersById.filter(Boolean),
        ...usersByParentTeamId,
        ...usersByParentPlayerKey.flat()
      ]);
      cacheEntry!.baseMembers = getCachedRelevantTeamMembers(cacheEntry!);
      return cacheEntry!.baseMembers;
    });
  }

  await cacheEntry.baseMembersPromise;

  const inviteEmailsToLoad = emails.filter((email) => (
    email
    && !cacheEntry!.loadedInviteEmails.has(email)
    && !cacheEntry!.membersByEmail.has(email)
  ));

  await Promise.all(inviteEmailsToLoad.map((email) => {
    let invitePromise = cacheEntry!.inviteEmailPromises.get(email);
    if (!invitePromise) {
      invitePromise = loadUsersByEmail(email)
        .catch(() => [])
        .then((members) => {
          mergeRelevantTeamMembers(cacheEntry!, members);
          cacheEntry!.loadedInviteEmails.add(email);
        })
        .finally(() => {
          cacheEntry!.inviteEmailPromises.delete(email);
        });
      cacheEntry!.inviteEmailPromises.set(email, invitePromise);
    }
    return invitePromise;
  }));

  return getCachedRelevantTeamMembers(cacheEntry);
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
  invalidateTeamDetailBaseSnapshotCache(normalizedTeamId);
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

export async function createRosterParentInviteForApp(
  teamId: string,
  user: AuthUser | null,
  player: Pick<TeamDetailPlayer, 'id' | 'number'>,
  invite: { email?: string; relation?: string } = {}
): Promise<CreateRosterParentInviteForAppResult> {
  const normalizedTeamId = cleanString(teamId);
  const normalizedPlayerId = cleanString(player?.id);
  const normalizedEmail = cleanString(invite?.email).toLowerCase();
  const relation = cleanString(invite?.relation) || 'Parent';
  if (!normalizedTeamId) throw new Error('Team ID is required.');
  if (!normalizedPlayerId) throw new Error('Player ID is required.');
  if (normalizedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw new Error('Enter a valid parent email address.');
  }

  const { team } = await loadTeamDetailBaseSnapshot(normalizedTeamId);
  if (!team || !hasFullTeamAccess(user, team)) {
    throw new Error('You do not have permission to invite parents for this team.');
  }

  const inviteResult = await inviteParent(normalizedTeamId, normalizedPlayerId, cleanString(player?.number), normalizedEmail, relation);
  const code = cleanString(inviteResult?.code).toUpperCase();
  if (!code) throw new Error('Invite code was not created.');
  let emailSent = false;
  if (normalizedEmail) {
    try {
      await queueInviteEmail(code);
      emailSent = true;
    } catch (error) {
      logger.warn('Parent invite was created, but its email could not be queued.', { error });
    }
  }
  invalidateTeamDetailBaseSnapshotCache(normalizedTeamId);

  return {
    code,
    inviteUrl: buildAppAcceptInviteUrl(code, 'parent'),
    status: inviteResult?.autoLinked ? 'accepted' : 'pending',
    email: normalizedEmail || null,
    emailSent,
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

  return mergeStandardRosterFieldDefinitions(await getRosterFieldDefinitions(normalizedTeamId, team)) as TeamRosterFieldDefinition[];
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
  const { publicValues, privateValues } = splitRosterProfileValuesByVisibility(rosterFields, rosterFieldValues);
  const position = cleanString(publicValues.position);

  let photoUrl: string | null = null;
  if (input?.photoFile) {
    validateLegacyRosterPhotoFile(input.photoFile);
    photoUrl = await uploadPlayerPhoto(input.photoFile);
  }

  const player = {
    name,
    number: cleanString(input?.number),
    photoUrl,
    ...(position ? { position } : {}),
    profile: {
      customFields: publicValues
    }
  };

  const playerId = await addPlayer(normalizedTeamId, player);
  await setPlayerPrivateRosterProfileFields(normalizedTeamId, playerId, privateValues);
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

export async function updateTeamSettingsForApp(teamId: string, user: AuthUser | null, input: UpdateTeamSettingsForAppInput) {
  const normalizedTeamId = cleanString(teamId);
  if (!normalizedTeamId) throw new Error('Team ID is required.');

  const { team } = await loadTeamDetailBaseSnapshot(normalizedTeamId);
  if (!team || !hasFullTeamAccess(user, team)) {
    throw new Error('You do not have permission to edit this team.');
  }

  const name = cleanString(input?.name);
  if (!name) throw new Error('Team name is required.');

  const rawLeagueUrl = cleanString(input?.leagueUrl);
  const leagueUrl = rawLeagueUrl ? normalizeOptionalHttpUrl(rawLeagueUrl) : null;
  if (rawLeagueUrl && !leagueUrl) throw new Error('League link must be a valid http:// or https:// URL.');

  const rawStreamUrl = cleanString(input?.streamUrl);
  const parsedLivestream = parseTeamLivestreamInput(rawStreamUrl);
  if (rawStreamUrl && !parsedLivestream) throw new Error('Livestream link must be a valid YouTube or Twitch URL.');

  let photoUrl = getFirstUrl(team?.photoUrl, team?.teamPhotoUrl, team?.logoUrl, team?.imageUrl) || null;
  if (input?.photoFile) {
    photoUrl = await uploadTeamPhoto(input.photoFile);
  }

  await updateTeam(normalizedTeamId, {
    name,
    sport: cleanString(input?.sport),
    zip: normalizeTeamZip(input?.zip),
    isPublic: input?.isPublic === true,
    photoUrl,
    leagueUrl,
    twitchChannel: parsedLivestream?.twitchChannel ?? null,
    streamEmbedUrl: parsedLivestream?.streamEmbedUrl ?? null,
    youtubeEmbedUrl: null,
    updatedAt: new Date()
  });

  invalidateTeamDetailBaseSnapshotCache(normalizedTeamId);
}

export async function createStatTrackerConfigForApp(teamId: string, user: AuthUser | null, input: UpsertStatTrackerConfigForAppInput) {
  const normalizedTeamId = cleanString(teamId);
  if (!normalizedTeamId) throw new Error('Team ID is required.');

  const { team } = await loadTeamDetailBaseSnapshot(normalizedTeamId);
  if (!team || !hasFullTeamAccess(user, team)) {
    throw new Error('You do not have permission to edit this team.');
  }

  const normalizedConfig = normalizeStatTrackerConfig(input || {});
  normalizedConfig.createdAt = new Date();

  const label = `create stat tracker config ${normalizedTeamId}`;
  const createPromise = Promise.resolve(createConfig(normalizedTeamId, normalizedConfig));

  let created: { id?: string } | FirestoreDocument | null = null;
  try {
    const id = await withTimeout(createPromise, label);
    created = { id };
  } catch (error) {
    if (!isNativeRuntime()) throw error;
    if (error instanceof Error && error.message === `${label} timed out.`) {
      created = { id: await createPromise };
    } else {
      logger.warn('Falling back to REST.', { label, error });
      created = await nativeCreateDocument(`teams/${encodeURIComponent(normalizedTeamId)}/statTrackerConfigs`, normalizedConfig);
    }
  }

  invalidateTeamDetailBaseSnapshotCache(normalizedTeamId);
  return cleanString((created as any)?.id);
}

export async function updateStatTrackerConfigForApp(teamId: string, configId: string, user: AuthUser | null, input: UpsertStatTrackerConfigForAppInput) {
  const normalizedTeamId = cleanString(teamId);
  const normalizedConfigId = cleanString(configId);
  if (!normalizedTeamId) throw new Error('Team ID is required.');
  if (!normalizedConfigId) throw new Error('Config ID is required.');

  const { team } = await loadTeamDetailBaseSnapshot(normalizedTeamId);
  if (!team || !hasFullTeamAccess(user, team)) {
    throw new Error('You do not have permission to edit this team.');
  }

  const normalizedConfig = normalizeStatTrackerConfig(input || {});
  normalizedConfig.updatedAt = new Date();

  await writeWithNativeFallback(
    `update stat tracker config ${normalizedTeamId}:${normalizedConfigId}`,
    async () => updateConfig(normalizedTeamId, normalizedConfigId, normalizedConfig),
    async () => nativePatchDocument(`teams/${encodeURIComponent(normalizedTeamId)}/statTrackerConfigs/${encodeURIComponent(normalizedConfigId)}`, normalizedConfig)
  );

  invalidateTeamDetailBaseSnapshotCache(normalizedTeamId);
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
  const { team, players: publicPlayers, games, configs } = await loadTeamDetailBaseSnapshot(teamId, { includeGamesAndConfigs: true });

  if (!team) throw new Error('Team not found.');

  const players = await loadPrivilegedTeamPlayers(teamId, user, team, publicPlayers);

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
    includeStaffPermissions: false,
    includeInsights: includeDeferredData
  });
}

export async function loadParentTeamDetailBootstrap(teamId: string, user: AuthUser | null): Promise<TeamDetailModel> {
  const { team, players: publicPlayers } = await loadTeamDetailBaseSnapshot(teamId, { includeGamesAndConfigs: false });

  if (!team) throw new Error('Team not found.');

  const players = await loadPrivilegedTeamPlayers(teamId, user, team, publicPlayers);

  const linkedPlayerIds = getLinkedPlayerIds(user, teamId, players);

  return buildTeamDetailModel({
    teamId,
    team,
    players,
    games: [],
    configs: [],
    user,
    linkedPlayerIds,
    seasonStatsByPlayerId: {},
    trackingItems: [],
    trackingStatuses: [],
    sponsors: [],
    includeStaffPermissions: false,
    includeInsights: false
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
  const { team, players: publicPlayers } = await loadTeamDetailBaseSnapshot(teamId);

  if (!team || !hasFullTeamAccess(user, team)) return null;

  const players = await loadPrivilegedTeamPlayers(teamId, user, team, publicPlayers);

  const pendingAdminInvites = await loadPendingAdminInvites(teamId).catch(() => []);
  const confirmedTeamMembers = await loadRelevantTeamMembers({
    team,
    players,
    pendingAdminInvites
  });

  return buildTeamStaffPermissionsSummary({
    teamId,
    team,
    players,
    pendingAdminInvites,
    confirmedTeamMembers
  });
}

export async function loadTeamRosterParentInvites(teamId: string, user: AuthUser | null): Promise<TeamRosterParentInviteSummary[]> {
  const { team, players: publicPlayers } = await loadTeamDetailBaseSnapshot(teamId);

  if (!team || !hasFullTeamAccess(user, team)) return [];

  const players = await loadPrivilegedTeamPlayers(teamId, user, team, publicPlayers);

  const pendingParentInvites = await loadPendingParentInvites(teamId).catch(() => []);
  const confirmedTeamMembers = await loadRelevantTeamMembers({
    team,
    players,
    pendingParentInvites
  });

  return buildRosterParentInviteSummaries({
    teamId,
    players,
    pendingParentInvites,
    confirmedTeamMembers
  });
}

export async function loadTeamTrackingAdmin(teamId: string, user: AuthUser | null): Promise<TeamTrackingAdminItem[]> {
  const { team, players } = await loadTeamDetailBaseSnapshot(teamId);

  if (!team || !hasFullTeamAccess(user, team)) {
    throw new Error('Only team staff can manage tracking items.');
  }

  const normalizedTeamId = cleanString(teamId);
  const trackingItems = (await loadTeamTrackingItems(normalizedTeamId))
    .map((itemDoc) => normalizeTeamTrackingItem(itemDoc))
    .filter((item): item is ReturnType<typeof normalizeTeamTrackingItem> => Boolean(item.id))
    .sort((a, b) => a.name.localeCompare(b.name));

  const activePlayers = normalizePlayers(players, []);
  const trackingStatusesByItemId = new Map<string, any[]>();

  if (trackingItems.length) {
    await Promise.all(trackingItems.map(async (item) => {
      const statuses = (await loadTeamTrackingStatuses(normalizedTeamId, item.id))
        .map((statusDoc) => normalizeTrackingStatus(statusDoc))
        .filter((status) => cleanString((status as any)?.trackingItemId || (status as any)?.itemId) === item.id);
      trackingStatusesByItemId.set(item.id, statuses);
    }));
  }

  return trackingItems.map((item) => buildTeamTrackingAdminItem(item, activePlayers, trackingStatusesByItemId.get(item.id) || []));
}

export async function saveTeamTrackingItemForApp(
  teamId: string,
  user: AuthUser | null,
  input: TeamTrackingItemForAppInput,
  options: { itemId?: string } = {}
): Promise<string> {
  const normalizedTeamId = cleanString(teamId);
  const normalizedItemId = cleanString(options.itemId);
  await assertTrackingAdminAccess(normalizedTeamId, user);
  const itemPayload = normalizeTeamTrackingItemDraft(input);
  const actorId = cleanString(user?.uid);

  if (normalizedItemId) {
    await updateDoc(doc(db, `teams/${normalizedTeamId}/trackingItems`, normalizedItemId), {
      ...itemPayload,
      teamId: normalizedTeamId,
      updatedAt: serverTimestamp(),
      updatedBy: actorId || null
    });
  } else {
    const itemRef = doc(collection(db, `teams/${normalizedTeamId}/trackingItems`));
    await setDoc(itemRef, {
      ...itemPayload,
      teamId: normalizedTeamId,
      createdAt: serverTimestamp(),
      createdBy: actorId || null,
      updatedAt: serverTimestamp(),
      updatedBy: actorId || null
    });
    invalidateTeamDetailBaseSnapshotCache(normalizedTeamId);
    return itemRef.id;
  }

  invalidateTeamDetailBaseSnapshotCache(normalizedTeamId);
  return normalizedItemId;
}

export async function archiveTeamTrackingItemForApp(teamId: string, user: AuthUser | null, itemId: string) {
  const normalizedTeamId = cleanString(teamId);
  const normalizedItemId = cleanString(itemId);
  await assertTrackingAdminAccess(normalizedTeamId, user);

  await updateDoc(doc(db, `teams/${normalizedTeamId}/trackingItems`, normalizedItemId), {
    status: 'archived',
    archived: true,
    active: false,
    updatedAt: serverTimestamp(),
    updatedBy: cleanString(user?.uid) || null
  });

  invalidateTeamDetailBaseSnapshotCache(normalizedTeamId);
}

export async function setPlayerTrackingStatusForApp(
  teamId: string,
  user: AuthUser | null,
  itemId: string,
  player: TeamDetailPlayer,
  complete: boolean
) {
  const normalizedTeamId = cleanString(teamId);
  await assertTrackingAdminAccess(normalizedTeamId, user);

  await setTeamTrackingStatus(normalizedTeamId, cleanString(itemId), cleanString(player.id), {
    ...buildTrackingStatusPayload({
      teamId: normalizedTeamId,
      itemId: cleanString(itemId),
      player: {
        id: cleanString(player.id),
        name: player.name,
        number: player.number
      },
      complete,
      actorId: cleanString(user?.uid) || null,
      actorEmail: cleanString(user?.email || (user as any)?.profileEmail) || null
    })
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
  includeStaffPermissions = true,
  includeInsights = true
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
  includeInsights?: boolean;
}): TeamDetailModel {
  const canManageTeam = hasFullTeamAccess(user, team);
  const normalizedPlayers = normalizePlayers(players, linkedPlayerIds, { includeParentContacts: canManageTeam });
  const normalizedInactivePlayers = normalizePlayers(players, linkedPlayerIds, { inactiveOnly: true, includeParentContacts: canManageTeam });
  const normalizedStatTrackerConfigs = buildTeamStatTrackerConfigs(configs, games);
  const normalizedEvents = normalizeEvents(games, normalizedStatTrackerConfigs.byId);
  const seasonLabels = listSeasonLabels(games);
  const currentYearLabel = String(new Date().getFullYear());
  const seasonLabel = seasonLabels.includes(currentYearLabel) ? currentYearLabel : (seasonLabels[0] || currentYearLabel);
  const record = calculateSeasonRecord(games, { seasonLabel });
  const completedGames = games.filter(isCompletedGame);
  const standings = buildStandings(team, games);
  const leaderboards = includeInsights ? buildLeaderboards(configs, normalizedPlayers, seasonStatsByPlayerId, team?.sport) : [];
  const trackingSummaries = includeInsights ? buildTrackingSummaries(normalizedPlayers, linkedPlayerIds, trackingItems, trackingStatuses) : [];
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
      isPublic: team?.isPublic !== false,
      active: team?.active !== false,
      leagueUrl: getFirstUrl(team?.leagueUrl),
      bracketUrl: getFirstUrl(team?.bracketUrl),
      streamUrl: getStreamUrl(team),
      websiteUrl: getPublicHashUrl('team.html', teamId),
      editTeamUrl: getPublicHashUrl('edit-team.html', teamId),
      mediaUrl: getPublicHashUrl('team-media.html', teamId),
      registrationProvider: getRegistrationProviderDetails(team),
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
  const acceptedParentKeysByPlayerId = new Map<string, Set<string>>();
  const getAcceptedParentKey = (contact: any) => cleanString(contact?.userId || contact?.uid || contact?.id || contact?.email).toLowerCase();
  (Array.isArray(players) ? players : []).forEach((player) => {
    const playerId = cleanString(player?.id || player?.playerId);
    if (!playerId) return;
    const contacts = collectRosterParentContacts(player, {
      includeImported: false,
      includeFamilyContacts: false
    });
    if (contacts.length > 0) {
      acceptedCounts.set(playerId, contacts.length);
      acceptedParentKeysByPlayerId.set(playerId, new Set(contacts.map(getAcceptedParentKey).filter(Boolean)));
    }
  });

  (Array.isArray(confirmedTeamMembers) ? confirmedTeamMembers : []).forEach((member) => {
    const linkedPlayerIds = getAcceptedParentPlayerIds(member, normalizedTeamId);
    const parentKey = getAcceptedParentKey(member);
    linkedPlayerIds.forEach((playerId) => {
      const parentKeys = acceptedParentKeysByPlayerId.get(playerId) || new Set<string>();
      if (parentKey && parentKeys.has(parentKey)) return;
      acceptedCounts.set(playerId, (acceptedCounts.get(playerId) || 0) + 1);
      if (parentKey) {
        parentKeys.add(parentKey);
        acceptedParentKeysByPlayerId.set(playerId, parentKeys);
      }
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

async function assertTrackingAdminAccess(teamId: string, user: AuthUser | null) {
  const { team } = await loadTeamDetailBaseSnapshot(teamId);
  if (!team || !hasFullTeamAccess(user, team)) {
    throw new Error('Only team staff can manage tracking items.');
  }
  return team;
}

function normalizeTeamTrackingItemDraft(input: TeamTrackingItemForAppInput) {
  const name = cleanString(input?.name);
  const description = cleanString(input?.description);
  const visibility = input?.visibility === 'public' ? 'public' : 'private';
  const status = input?.status === 'archived' ? 'archived' : 'active';

  if (!name) {
    throw new Error('Tracking item name is required.');
  }

  return {
    name,
    description,
    visibility,
    status,
    active: status === 'active',
    archived: status === 'archived'
  };
}

function normalizeTeamTrackingItem(item: any): Omit<TeamTrackingAdminItem, 'playerStatuses' | 'completionSummary'> {
  const status: 'active' | 'archived' = item?.status === 'archived' || item?.archived === true || item?.active === false ? 'archived' : 'active';
  return {
    id: cleanString(item?.id),
    name: cleanString(item?.name || item?.title || item?.label),
    description: cleanString(item?.description || item?.note),
    visibility: item?.visibility === 'public' ? 'public' as const : 'private' as const,
    status,
    active: status === 'active',
    archived: status === 'archived'
  };
}

function buildTeamTrackingAdminItem(item: ReturnType<typeof normalizeTeamTrackingItem>, players: TeamDetailPlayer[], statuses: any[] = []): TeamTrackingAdminItem {
  const statusByPlayerId = new Map<string, any>();
  (Array.isArray(statuses) ? statuses : []).forEach((status) => {
    const playerId = cleanString(status?.playerId || status?.id);
    if (playerId) statusByPlayerId.set(playerId, status);
  });

  const playerStatuses = players.map((player) => {
    const status = statusByPlayerId.get(player.id) || {};
    return {
      playerId: player.id,
      playerName: player.name,
      playerNumber: player.number,
      photoUrl: player.photoUrl,
      complete: status.complete === true || status.isComplete === true || cleanString(status.status).toLowerCase() === 'complete'
    };
  });

  return {
    ...item,
    playerStatuses,
    completionSummary: summarizeTrackingStatus(playerStatuses.map((playerStatus) => ({ complete: playerStatus.complete })))
  };
}

function normalizePlayers(players: any[], linkedPlayerIds: string[], options: { inactiveOnly?: boolean; includeParentContacts?: boolean } = {}): TeamDetailPlayer[] {
  const linked = new Set(linkedPlayerIds);
  const inactiveOnly = options.inactiveOnly === true;
  return (Array.isArray(players) ? players : [])
    .filter((player) => inactiveOnly ? player?.active === false : player?.active !== false)
    .map((player) => normalizePlayer(player, linked, options.includeParentContacts === true))
    .filter((player) => player.id)
    .sort((a, b) => sortByNumberThenName(a, b));
}

function normalizePlayer(player: any, linked: Set<string>, includeParentContacts = false): TeamDetailPlayer {
  const id = cleanString(player?.id || player?.playerId);
  const normalizedPlayer: TeamDetailPlayer = {
    id,
    name: cleanString(player?.name || player?.playerName) || 'Player',
    number: cleanString(player?.number),
    photoUrl: getFirstUrl(player?.photoUrl, player?.imageUrl, player?.headshotUrl),
    position: cleanString(player?.position || player?.primaryPosition || player?.profile?.customFields?.position || player?.customFields?.position),
    isLinked: linked.has(id),
    active: player?.active !== false
  };
  if (includeParentContacts) {
    normalizedPlayer.parentContacts = collectRosterParentContacts(player, {
      includeImported: true,
      includeFamilyContacts: true
    }) as TeamRosterParentContact[];
  }
  return normalizedPlayer;
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
    getAcceptedParentPlayerIds(member, teamId).forEach((playerId) => {
      const player = playersById.get(playerId);
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
    columns: normalized.columns || [],
    statDefinitions: Array.isArray(normalized.statDefinitions) ? normalized.statDefinitions.map((definition: Record<string, unknown>) => ({ ...definition })) : [],
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

function getRegistrationProviderDetails(team: Record<string, any>) {
  const source = team?.registrationSource || team?.registrationProvider || {};
  const lastSyncStatus = cleanString(source.lastSyncStatus || source.syncStatus);
  const lastSyncTime = formatRegistrationProviderSyncTime(source.lastSyncedAt || source.lastSyncAt || source.syncedAt || source.updatedAt);
  const appTeamId = cleanString(team?.id || team?.teamId);
  const externalTeamId = cleanString(source.externalTeamId || source.externalTeamID || source.providerTeamId || source.providerTeamID || source.sourceTeamId);
  const sourceTeamId = cleanString(source.teamId);
  const providerTeamId = sourceTeamId && sourceTeamId !== appTeamId && sourceTeamId !== externalTeamId
    ? sourceTeamId
    : '';
  const rows = [
    { label: 'Provider', value: cleanString(source.provider || source.providerName) },
    { label: 'External team ID', value: externalTeamId, copyable: true },
    { label: 'Provider team ID', value: providerTeamId, copyable: true },
    { label: 'Last sync', value: formatRegistrationProviderSyncDetail(lastSyncStatus, lastSyncTime) }
  ].filter((row) => row.value);
  return rows;
}

function formatRegistrationProviderSyncDetail(status: string, time: string) {
  const friendlyStatus = humanizeRegistrationProviderStatus(status);
  if (friendlyStatus && time) return `${friendlyStatus} - ${time}`;
  return friendlyStatus || time;
}

function humanizeRegistrationProviderStatus(status: string) {
  const value = cleanString(status);
  if (!value) return '';
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatRegistrationProviderSyncTime(value: any) {
  const date = toNullableDate(value);
  if (!date) return '';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
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

function toNullableDate(value: any) {
  if (!value) return null;
  const date = value instanceof Date
    ? value
    : typeof value?.toDate === 'function'
      ? value.toDate()
      : typeof value?.seconds === 'number'
        ? new Date(value.seconds * 1000)
        : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toNullableNumber(value: any) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cleanString(value: unknown) {
  return String(value || '').trim();
}

function normalizeTeamZip(value: unknown) {
  const digits = cleanString(value).replace(/[^0-9]/g, '');
  return digits.length >= 5 ? digits.slice(0, 9) : '';
}

function normalizeRosterFieldValuesForSave(fields: TeamRosterFieldDefinition[], values: Record<string, unknown>) {
  const normalizedValues: Record<string, unknown> = {};
  fields.forEach((field) => {
    const hasValue = Object.prototype.hasOwnProperty.call(values || {}, field.key);
    if (!field.required && !hasValue) return;
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
