import {
  collectRosterParentContacts,
  deleteAthleteProfileMediaByPath,
  deleteLegacyImageUpload,
  getAggregatedStatsForGames,
  getAggregatedStatsDocumentForPlayer,
  getAggregatedStatsForPlayer,
  getConfigs,
  getGameEvents,
  getGames,
  getPlayerPrivateProfile,
  getPlayers,
  getPlayerTrackingStatuses,
  getPublicTrackingItems,
  getRosterFieldDefinitions,
  getTeam,
  inviteCoParentToAthlete,
  listAthleteProfilesForParent,
  listCertificatesForPlayer,
  releaseAthleteProfileMediaReservation,
  reserveAthleteProfileMediaOwnership,
  saveAthleteProfile,
  setPlayerPrivateRosterProfileFields,
  updatePlayer,
  updatePlayerWithPrivateRosterProfileFields,
  updatePlayerPrivateProfile,
  updatePlayerProfile,
  uploadAthleteProfileMedia,
  uploadPlayerPhoto,
  type LegacyAthleteProfileRecord,
  type LegacyPlayerPrivateProfileRecord,
  type LegacyPlayerRecord,
  type LegacyTeamRecord
} from './adapters/legacyPlayerDb';
import { createSecureUploadToken } from './secureUploadToken';
import {
  buildAthleteProfileShareUrl,
  buildPlayerLeaderboardSnapshot,
  calculateEarnings,
  collectPlayerVideoClips,
  getApplicableRulesForGame,
  getCapSetting,
  getIncentiveRules,
  getPaidGames,
  getStatOptionsForTeam,
  getVisiblePlayerTrackingSummary,
  isCurrentRuleVersion,
  markGamePaid,
  retireIncentiveRule,
  saveCapSetting,
  saveIncentiveRule,
  selectAnalyticsConfig,
  summarizePlayerTopStats,
  toggleIncentiveRule,
  type PlayerEarningsBreakdownItem,
  type PlayerIncentiveRule,
  type PlayerPaidGameRecord,
  type PlayerStatOption,
  type PlayerTrackingSummary,
  type PlayerVideoClip
} from './adapters/legacyPlayerProfile';
import {
  canViewRosterField,
  getRosterProfileValues,
  normalizeRosterFieldDefinitions,
  splitProtectedRosterProfileValues,
  splitRosterProfileValuesByVisibility,
  validateRosterProfileValues,
  type RosterFieldDefinition,
  type RosterProfileValues
} from './adapters/legacyRosterPrivacy';
import { getOpenScheduleAssignments, normalizeRsvpResponse, type ParentScheduleEvent } from './scheduleLogic';
import {
  loadParentPlayerSchedule,
  type ParentScheduleChild,
  type ParentScheduleTeamLoadState
} from './scheduleService';
import { clearAppDataCache, loadCachedAppData } from './appDataCache';
import { createLogger } from './logger';
import { isNativeRuntime } from './nativeRuntime';
import {
  applyCurrentParentAccessProfile,
  collectCanonicalParentAccessLinks,
  findCanonicalParentAccessLink,
  findOnlyCanonicalParentAccessLinkForTeam,
  isCanonicalParentPlayerLinked,
  isCanonicalParentTeamLinked
} from './parentAccessScope';
import { loadProfileDocument } from './profileService';
import type { AuthUser } from './types';

export type { PlayerVideoClip };

const logger = createLogger('player-service');

export type ParentPlayerStatRow = {
  event: ParentScheduleEvent;
  stats: Record<string, unknown>;
  timeMs?: number;
};

export type ParentPlayerTopStat = {
  id: string;
  label: string;
  rank: number;
  totalPlayers: number;
  value: number;
  formattedValue: string;
};

export type ParentPlayerTrend = {
  key: string;
  label: string;
  recentAverage: number;
  earlierAverage: number;
  direction: 'up' | 'down' | 'neutral';
  percentChange: number;
};

export type ParentPlayerGameEventRow = {
  gameId: string;
  gameLabel: string;
  gameDate: string;
  events: Array<{
    id: string;
    statKey: string;
    value: number | string;
    period: string;
    clock: string;
    description: string;
    timestampMs: number;
  }>;
};

export type ParentPlayerStatsSummary = {
  gamesPlayed: number;
  gamesWithTime: number;
  totalTimeMs: number;
  totals: Record<string, number>;
  averages: Record<string, number>;
  topStats: ParentPlayerTopStat[];
  trends: ParentPlayerTrend[];
  gameLimit: number;
  hasMoreGames: boolean;
};

export type ParentPlayerStatsDetailData = {
  summary: ParentPlayerStatsSummary;
  statRows: ParentPlayerStatRow[];
  gameEventRows: ParentPlayerGameEventRow[];
};

export type ParentPlayerStatTotals = {
  teamId: string;
  playerId: string;
  gameCount: number;
  gameIds: string[];
  totals: Record<string, number>;
};

export type ParentPlayerPrivateProfile = {
  emergencyContact?: {
    name?: string | null;
    phone?: string | null;
  } | null;
  medicalInfo?: string | null;
};

export type ParentPlayerFamilyContact = {
  id: string;
  name: string;
  email: string;
  phone: string;
  relation: string;
  status: 'linked' | 'contact';
};

export type ParentPlayerIncentiveData = {
  rules: PlayerIncentiveRule[];
  currentRules: PlayerIncentiveRule[];
  statOptions: PlayerStatOption[];
  maxPerGameCents: number | null;
  seasonGameEarnings: Array<{
    event: ParentScheduleEvent;
    stats: Record<string, unknown>;
    totalCents: number;
    uncappedTotalCents: number;
    wasCapped: boolean;
    breakdown: PlayerEarningsBreakdownItem[];
    paid: boolean;
    paidAmountCents: number;
  }>;
  totalEarnedCents: number;
  totalPaidCents: number;
  unpaidCents: number;
};

export type ParentAthleteProfileData = {
  profile: Record<string, any> | null;
  shareUrl: string;
  builderUrl: string;
  seasonOptions: Array<{
    seasonKey: string;
    teamId: string;
    teamName: string;
    playerId: string;
    playerName: string;
  }>;
};

function buildParentAthleteProfileShell(parentLinks: Array<Record<string, any>>, teamId: string, playerId: string): ParentAthleteProfileData {
  return {
    profile: null,
    shareUrl: '',
    builderUrl: buildLegacyUrl('athlete-profile-builder.html', { teamId, playerId }),
    seasonOptions: buildAthleteProfileSeasonOptions(parentLinks)
  };
}

export type ParentPlayerDetailData = {
  child: ParentScheduleChild;
  player: Record<string, any>;
  team: Record<string, any> | null;
  scheduleLoadError: string | null;
  scheduleIsPartial: boolean;
  scheduleTeamLoadState: ParentScheduleTeamLoadState;
  scheduleAccessUserId: string | null;
  scheduleSourceKey: string | null;
  access: {
    isLinkedParent: boolean;
    isTeamParent: boolean;
    isTeamStaff: boolean;
    canEditRosterDetails: boolean;
    canEditCustomRosterFields: boolean;
  };
  customRosterFields: Array<{
    key: string;
    label: string;
    type: 'text' | 'menu' | 'checkbox' | 'date';
    section?: string;
    description?: string;
    visibility: string;
    required: boolean;
    options: Array<{ value: string; label: string }>;
    value: string | boolean;
  }>;
  events: ParentScheduleEvent[];
  nextEvent: ParentScheduleEvent | null;
  actionCounts: {
    rsvpNeeded: number;
    packetsReady: number;
    openAssignments: number;
  };
  statRows: ParentPlayerStatRow[];
  statsDetail: ParentPlayerStatsDetailData | null;
  clips: PlayerVideoClip[];
  certificates: Array<Record<string, any>>;
  trackingSummary: PlayerTrackingSummary[];
  privateProfile: ParentPlayerPrivateProfile | null;
  familyContacts: ParentPlayerFamilyContact[];
  incentives: ParentPlayerIncentiveData;
  athleteProfile: ParentAthleteProfileData;
};

export type AthleteProfileHighlightClipDraft = {
  id?: string;
  source?: 'external' | 'upload';
  mediaType?: 'link' | 'image' | 'video';
  title?: string;
  label?: string;
  url?: string;
  storagePath?: string;
  mimeType?: string;
  sizeBytes?: number | null;
  uploadedAtMs?: number | null;
  pendingUpload?: boolean;
};

export type AthleteProfileHighlightClipUpload = {
  id?: string;
  file: File;
  title?: string;
  label?: string;
};

export async function loadParentPlayerDetail(user: AuthUser | null, teamId: string, playerId: string): Promise<ParentPlayerDetailData> {
  if (!user?.uid) {
    throw new Error('Player details require a signed-in user.');
  }

  const requestedTeamId = decodeURIComponent(teamId || '');
  const requestedPlayerId = decodeURIComponent(playerId || '');
  let scheduleLoadError: string | null = null;
  let accessUser = await loadUserWithPlayerAccessProfile(user);
  let schedule = await loadParentPlayerSchedule(accessUser, { teamId, playerId }).catch((error) => {
    scheduleLoadError = 'Schedule is temporarily unavailable. Refresh the player to try again.';
    logger.warn('Continuing without player schedule data.', {
      operation: 'player-detail-schedule-load',
      teamId: requestedTeamId,
      playerId: requestedPlayerId,
      error
    });
    return {
      children: [],
      events: [],
      sourceKeysByTeam: {},
      teamLoadStates: { [requestedTeamId]: 'failed' as const },
      isPartial: true
    };
  });
  if (schedule.teamLoadStates?.[requestedTeamId] === 'access-lost') {
    throw Object.assign(new Error('This player is no longer available for your account.'), {
      code: 'permission-denied',
      status: 403
    });
  }
  if (schedule.isPartial === true) {
    scheduleLoadError = 'The complete player schedule could not be loaded. Retry before relying on missing events.';
  }
  let linkedChild = findLinkedChild(schedule.children, requestedTeamId, requestedPlayerId) || findLinkedParentChild(accessUser, requestedTeamId, requestedPlayerId);
  const initialTeam = await getTeam(requestedTeamId, { includeInactive: true });
  let routeAccess = buildPlayerAccess(accessUser, requestedTeamId, requestedPlayerId, initialTeam);
  const canUseScheduleFailureFallback = !!scheduleLoadError && routeAccess.isLinkedParent;
  if (!linkedChild && !canUseScheduleFailureFallback && !routeAccess.isTeamParent && !routeAccess.isTeamStaff) {
    throw Object.assign(new Error('This player is not linked to your account.'), {
      code: 'permission-denied',
      status: 403
    });
  }

  const resolvedTeamId = linkedChild?.teamId || requestedTeamId;
  const resolvedPlayerId = linkedChild?.playerId || requestedPlayerId;
  const events = schedule.events
    .filter((event) => event.teamId === resolvedTeamId && event.childId === resolvedPlayerId)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  const nextEvent = events.find((event) => !event.isCancelled && event.date.getTime() >= startOfDay(new Date()).getTime()) || null;
  const scheduleSourceKeys = schedule.sourceKeysByTeam as Record<string, string | null> | undefined;
  const scheduleSourceKey = typeof scheduleSourceKeys?.[resolvedTeamId] === 'string'
    ? scheduleSourceKeys[resolvedTeamId]?.trim() || null
    : null;
  const scheduleTeamLoadState = schedule.teamLoadStates?.[resolvedTeamId] || 'failed';

  const team = requestedTeamId === resolvedTeamId
    ? initialTeam
    : await getTeam(resolvedTeamId, { includeInactive: true });

  const [
    players,
    certificates,
    trackingItems,
    trackingStatuses,
    privateProfile,
    rosterFieldDefinitions,
    incentiveRules,
    paidGames,
    maxPerGameCents,
    statOptions
  ] = await Promise.all([
    getPlayers(resolvedTeamId, { includeInactive: true }).catch(() => []),
    listCertificatesForPlayer(resolvedTeamId, resolvedPlayerId, { status: 'published', limit: 5 }).catch(() => []),
    getPublicTrackingItems(resolvedTeamId).catch(() => []),
    getPlayerTrackingStatuses(resolvedTeamId, [resolvedPlayerId]).catch(() => []),
    (routeAccess.isLinkedParent || routeAccess.isTeamStaff) ? getPlayerPrivateProfile(resolvedTeamId, resolvedPlayerId).catch(() => null) : Promise.resolve(null),
    getRosterFieldDefinitions(resolvedTeamId, team || null).catch(() => []),
    routeAccess.isLinkedParent ? getIncentiveRules(user.uid, resolvedPlayerId).catch(() => []) : Promise.resolve([]),
    routeAccess.isLinkedParent ? getPaidGames(user.uid, resolvedPlayerId).catch(() => new Map()) : Promise.resolve(new Map()),
    routeAccess.isLinkedParent ? getCapSetting(user.uid, resolvedPlayerId).catch(() => null) : Promise.resolve(null),
    getStatOptionsForTeam(resolvedTeamId).catch(() => [])
  ]);

  const playerDoc = (Array.isArray(players) ? players : []).find((candidate: LegacyPlayerRecord) => candidate?.id === resolvedPlayerId) || {};
  const access = buildPlayerAccess(accessUser, resolvedTeamId, resolvedPlayerId, team);
  const visiblePrivateProfile = access.isLinkedParent || access.isTeamStaff ? privateProfile : null;
  const child = linkedChild || {
    teamId: resolvedTeamId,
    teamName: String(team?.name || '').trim() || String(playerDoc?.teamName || '').trim() || resolvedTeamId,
    playerId: resolvedPlayerId,
    playerName: String(playerDoc?.name || '').trim() || 'Player'
  };
  const customRosterFields = buildVisibleCustomRosterFields({
    definitions: rosterFieldDefinitions,
    player: playerDoc,
    privateProfile: visiblePrivateProfile,
    access
  });
  const rosterFamilyContacts = collectRosterParentContacts(playerDoc, {
    includeImported: false,
    includeFamilyContacts: true,
    includeHousehold: true
  });
  const completedGameEvents = events
    .filter((event) => event.type === 'game' && event.isDbGame && isPastOrCompleted(event))
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .slice(0, 6);

  const statRows = await Promise.all(completedGameEvents.map(async (event) => ({
    event,
    stats: await getAggregatedStatsForPlayer(resolvedTeamId, event.id, resolvedPlayerId).catch(() => ({})) || {}
  })));

  const trackingSummary = getVisiblePlayerTrackingSummary({
    items: trackingItems,
    statuses: trackingStatuses,
    playerIds: [resolvedPlayerId]
  });

  const upcoming = events.filter((event) => !event.isCancelled && event.date.getTime() >= startOfDay(new Date()).getTime());

  return {
    child,
    player: {
      ...playerDoc,
      id: resolvedPlayerId,
      name: playerDoc.name || child.playerName,
      teamId: resolvedTeamId,
      teamName: child.teamName,
      photoUrl: playerDoc.photoUrl || (child as any).playerPhotoUrl || null,
      photoPath: visiblePrivateProfile?.photoPath || playerDoc.photoPath || null,
      number: playerDoc.number || (child as any).playerNumber || null
    },
    team,
    scheduleLoadError,
    scheduleIsPartial: schedule.isPartial === true,
    scheduleTeamLoadState,
    scheduleAccessUserId: accessUser.uid || null,
    scheduleSourceKey,
    access,
    customRosterFields,
    events,
    nextEvent,
    actionCounts: {
      rsvpNeeded: upcoming.filter((event) => event.isDbGame && !event.availabilityLocked && normalizeRsvpResponse(event.myRsvp) === 'not_responded').length,
      packetsReady: upcoming.filter((event) => event.type === 'practice' && event.practiceHomePacketSummary).length,
      openAssignments: upcoming.reduce((total, event) => total + getOpenScheduleAssignments(event.assignments).length, 0)
    },
    statRows,
    statsDetail: null,
    clips: [],
    certificates: Array.isArray(certificates) ? certificates : [],
    trackingSummary,
    privateProfile: normalizePrivateProfile(visiblePrivateProfile),
    familyContacts: normalizePlayerFamilyContacts(playerDoc, visiblePrivateProfile, rosterFamilyContacts),
    incentives: buildPlayerIncentiveData({
      rules: incentiveRules,
      paidGames,
      statOptions,
      maxPerGameCents,
      statRows
    }),
    athleteProfile: buildParentAthleteProfileShell(
      collectCanonicalParentAccessLinks(accessUser),
      resolvedTeamId,
      resolvedPlayerId
    )
  };
}

const playerStatsDetailGameLimit = 20;
const playerStatsDetailCacheTtlMs = 2 * 60 * 1000;

export async function loadParentPlayerStatsDetail(user: AuthUser | null, teamId: string, playerId: string): Promise<ParentPlayerStatsDetailData> {
  if (!user?.uid) {
    throw new Error('Player details require a signed-in user.');
  }

  const requestedTeamId = decodeURIComponent(teamId || '');
  const requestedPlayerId = decodeURIComponent(playerId || '');
  const cacheKey = `player-stats-detail:${user.uid}:${requestedTeamId}:${requestedPlayerId}`;
  return loadCachedAppData(cacheKey, () => loadParentPlayerStatsDetailUncached(user, requestedTeamId, requestedPlayerId), {
    ttlMs: playerStatsDetailCacheTtlMs,
    persist: false
  });
}

async function loadParentPlayerStatsDetailUncached(user: AuthUser, teamId: string, playerId: string): Promise<ParentPlayerStatsDetailData> {
  const accessUser = await loadUserWithPlayerAccessProfile(user);
  const [team, players, games, configs] = await Promise.all([
    getTeam(teamId, { includeInactive: true }),
    getPlayers(teamId, { includeInactive: true }).catch(() => []),
    getGames(teamId).catch(() => []),
    getConfigs(teamId).catch(() => [])
  ]);
  const access = buildPlayerAccess(accessUser, teamId, playerId, team);
  if (!access.isLinkedParent && !access.isTeamParent && !access.isTeamStaff) {
    throw new Error('This player is not linked to your account.');
  }

  const completedGames = (Array.isArray(games) ? games : [])
    .filter(isCompletedGame)
    .sort((a, b) => getGameDate(b).getTime() - getGameDate(a).getTime());
  const limitedGames = completedGames.slice(0, playerStatsDetailGameLimit);
  const statRows = await Promise.all(limitedGames.map(async (game) => {
    const statDocument = await getAggregatedStatsDocumentForPlayer(teamId, String(game.id || ''), playerId).catch(() => ({})) || {};
    const stats = getAggregatedStatsDocumentStats(statDocument);
    return {
      event: buildStatsEventFromGame(game, teamId, team, playerId),
      stats,
      timeMs: getGamePlayerTimeMs(game, playerId, stats, statDocument)
    };
  }));

  const participatingRows = statRows.filter((row) => hasStatParticipation(row.stats, row.timeMs));
  const totals = buildStatTotals(participatingRows);
  const gamesPlayed = participatingRows.length;
  const averages = buildStatAverages(totals, gamesPlayed);
  const totalTimeMs = participatingRows.reduce((total, row) => total + (Number(row.timeMs || 0) || 0), 0);
  const gamesWithTime = participatingRows.filter((row) => Number(row.timeMs || 0) > 0).length;
  const trends = buildPlayerTrends(participatingRows);
  const topStats = await buildConfiguredTopStats({
    teamId,
    playerId,
    players: Array.isArray(players) ? players : [],
    games: limitedGames,
    configs,
    team
  });
  const gameEventRows = await loadPlayerGameEventRows({ teamId, playerId, games: limitedGames, team });

  return {
    summary: {
      gamesPlayed,
      gamesWithTime,
      totalTimeMs,
      totals,
      averages,
      topStats,
      trends,
      gameLimit: playerStatsDetailGameLimit,
      hasMoreGames: completedGames.length > limitedGames.length
    },
    statRows: participatingRows,
    gameEventRows
  };
}

export async function loadParentPlayerVideoClips(user: AuthUser | null, teamId: string, playerId: string): Promise<PlayerVideoClip[]> {
  if (!user?.uid) {
    throw new Error('Player details require a signed-in user.');
  }

  const accessUser = await loadUserWithPlayerAccessProfile(user);
  const schedule = await loadParentPlayerSchedule(accessUser, { teamId, playerId });
  const linkedChild = findLinkedChild(schedule.children, teamId, playerId);
  const requestedTeamId = decodeURIComponent(teamId || '');
  const requestedPlayerId = decodeURIComponent(playerId || '');
  const resolvedTeamId = linkedChild?.teamId || requestedTeamId;
  const resolvedPlayerId = linkedChild?.playerId || requestedPlayerId;
  const team = await getTeam(resolvedTeamId, { includeInactive: true });
  const access = buildPlayerAccess(accessUser, resolvedTeamId, resolvedPlayerId, team);
  if (!linkedChild && !access.isLinkedParent && !access.isTeamParent && !access.isTeamStaff) {
    throw new Error('This player is not linked to your account.');
  }

  const games = await getGames(resolvedTeamId);
  return collectPlayerVideoClips(games, {
    teamId: resolvedTeamId,
    playerId: resolvedPlayerId
  }).slice(0, 8);
}

export async function loadParentPlayerAthleteProfile(user: AuthUser | null, teamId: string, playerId: string): Promise<ParentAthleteProfileData> {
  if (!user?.uid) {
    throw new Error('Player details require a signed-in user.');
  }

  const accessUser = await loadUserWithPlayerAccessProfile(user);
  const profiles = await listAthleteProfilesForParent(user.uid).catch(() => []);
  return buildAthleteProfileData({
    profiles: Array.isArray(profiles) ? profiles : [],
    parentLinks: collectCanonicalParentAccessLinks(accessUser),
    teamId,
    playerId
  });
}

export async function loadParentPlayerDetailWithAthleteProfile(user: AuthUser | null, teamId: string, playerId: string): Promise<ParentPlayerDetailData> {
  const detail = await loadParentPlayerDetail(user, teamId, playerId);
  if (detail?.athleteProfile?.profile) {
    return detail;
  }

  const athleteProfile = await loadParentPlayerAthleteProfile(user, detail.child.teamId, detail.child.playerId).catch(() => detail.athleteProfile);
  return {
    ...detail,
    athleteProfile: athleteProfile || detail.athleteProfile
  };
}

export async function loadParentPlayerStatTotals(user: AuthUser | null, teamId: string, playerId: string): Promise<ParentPlayerStatTotals> {
  if (!user?.uid) {
    throw new Error('Player stats require a signed-in user.');
  }

  const requestedTeamId = decodeURIComponent(teamId || '');
  const requestedPlayerId = decodeURIComponent(playerId || '');
  const accessUser = await loadUserWithPlayerAccessProfile(user);
  const team = await getTeam(requestedTeamId, { includeInactive: true });
  const access = buildPlayerAccess(accessUser, requestedTeamId, requestedPlayerId, team);
  if (!access.isLinkedParent && !access.isTeamParent && !access.isTeamStaff) {
    throw new Error('This player is not linked to your account.');
  }

  const games = await getGames(requestedTeamId).catch(() => []);
  const gameIds = (Array.isArray(games) ? games : [])
    .map((game: any) => String(game?.id || game?.gameId || '').trim())
    .filter(Boolean);
  const totalsByPlayer: Record<string, Record<string, unknown>> = gameIds.length
    ? await getAggregatedStatsForGames(requestedTeamId, gameIds).catch(() => ({}))
    : {};
  const rawTotals = totalsByPlayer?.[requestedPlayerId] || {};
  const totals = Object.entries(rawTotals).reduce<Record<string, number>>((acc, [key, value]) => {
    const numeric = Number(value);
    if (key && Number.isFinite(numeric)) {
      acc[key] = numeric;
    }
    return acc;
  }, {});

  return {
    teamId: requestedTeamId,
    playerId: requestedPlayerId,
    gameCount: gameIds.length,
    gameIds,
    totals
  };
}

function isCompletedGame(game: Record<string, any>) {
  const status = String(game?.status || '').toLowerCase();
  const liveStatus = String(game?.liveStatus || '').toLowerCase();
  return status === 'completed' || status === 'final' || liveStatus === 'completed' || liveStatus === 'final' || getGameDate(game).getTime() < Date.now();
}

function getGameDate(game: Record<string, any>) {
  const value = game?.date || game?.gameDate || game?.startTime || game?.createdAt;
  if (value instanceof Date) return value;
  if (typeof value?.toDate === 'function') return value.toDate();
  if (typeof value?.seconds === 'number') return new Date(value.seconds * 1000);
  const date = new Date(value || Date.now());
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function buildStatsEventFromGame(game: Record<string, any>, teamId: string, team: LegacyTeamRecord | null, playerId: string): ParentScheduleEvent {
  const date = getGameDate(game);
  const gameId = String(game?.id || '');
  return {
    eventKey: `${teamId}-${gameId}-${playerId}-${date.getTime()}`,
    id: gameId,
    teamId,
    teamName: String(team?.name || game?.teamName || '').trim() || teamId,
    type: 'game',
    date,
    endDate: null,
    location: String(game?.location || ''),
    opponent: String(game?.opponent || game?.opponentName || '').trim() || 'Opponent',
    opponentTeamId: game?.opponentTeamId || null,
    opponentTeamName: game?.opponentTeamName || null,
    childId: playerId,
    childName: '',
    isDbGame: true,
    isCancelled: game?.isCancelled === true || game?.cancelled === true,
    status: game?.status || null,
    liveStatus: game?.liveStatus || null,
    homeScore: typeof game?.homeScore === 'number' ? game.homeScore : null,
    awayScore: typeof game?.awayScore === 'number' ? game.awayScore : null,
    statTrackerConfigId: game?.statTrackerConfigId || null,
    assignments: [],
    openAssignmentCount: 0
  } as ParentScheduleEvent;
}

function getAggregatedStatsDocumentStats(statDocument: Record<string, any>) {
  const stats = statDocument?.stats && typeof statDocument.stats === 'object' ? statDocument.stats : {};
  return stats as Record<string, unknown>;
}

function getGamePlayerTimeMs(game: Record<string, any>, playerId: string, stats: Record<string, unknown>, statDocument: Record<string, any> = {}) {
  const directTime = Number(statDocument?.timeMs ?? statDocument?.minutesMs ?? statDocument?.playingTimeMs ?? (stats as any)?.timeMs ?? (stats as any)?.minutesMs ?? (stats as any)?.playingTimeMs);
  if (Number.isFinite(directTime) && directTime > 0) return directTime;
  const byPlayer = (game?.playerTimes || game?.playingTimeByPlayerId || game?.playerTimeMsById || {}) as Record<string, unknown>;
  const gameTime = Number(byPlayer?.[playerId]);
  return Number.isFinite(gameTime) && gameTime > 0 ? gameTime : 0;
}

function hasStatParticipation(stats: Record<string, unknown>, timeMs = 0) {
  if (Number(timeMs || 0) > 0) return true;
  return Object.values(stats || {}).some((value) => Number.isFinite(Number(value)) && Number(value) !== 0);
}

function buildStatTotals(rows: ParentPlayerStatRow[]) {
  const totals: Record<string, number> = {};
  rows.forEach((row) => {
    Object.entries(row.stats || {}).forEach(([key, value]) => {
      const normalizedKey = String(key || '').trim().toLowerCase();
      const numeric = Number(value);
      if (!normalizedKey || !Number.isFinite(numeric)) return;
      totals[normalizedKey] = (totals[normalizedKey] || 0) + numeric;
    });
  });
  return totals;
}

function buildStatAverages(totals: Record<string, number>, gamesPlayed: number) {
  if (gamesPlayed <= 0) return {};
  return Object.fromEntries(Object.entries(totals).map(([key, total]) => [key, total / gamesPlayed]));
}

function buildPlayerTrends(rows: ParentPlayerStatRow[]): ParentPlayerTrend[] {
  const chronological = [...rows].sort((a, b) => a.event.date.getTime() - b.event.date.getTime());
  if (chronological.length < 2) return [];
  const earlier = chronological.slice(0, Math.min(3, chronological.length));
  const recent = chronological.slice(-Math.min(3, chronological.length));
  const keys = Object.keys(buildStatTotals(rows)).slice(0, 5);

  return keys.map((key) => {
    const earlierAverage = averageStat(earlier, key);
    const recentAverage = averageStat(recent, key);
    const change = recentAverage - earlierAverage;
    const percentChange = earlierAverage > 0 ? Math.round((change / earlierAverage) * 100) : (change > 0 ? 100 : 0);
    return {
      key,
      label: key.toUpperCase(),
      recentAverage,
      earlierAverage,
      direction: change > 0 ? 'up' : change < 0 ? 'down' : 'neutral',
      percentChange
    };
  });
}

function averageStat(rows: ParentPlayerStatRow[], key: string) {
  if (!rows.length) return 0;
  return rows.reduce((total, row) => total + (Number((row.stats || {})[key]) || 0), 0) / rows.length;
}

async function buildConfiguredTopStats({
  teamId,
  playerId,
  players,
  games,
  configs,
  team
}: {
  teamId: string;
  playerId: string;
  players: LegacyPlayerRecord[];
  games: Record<string, any>[];
  configs: Record<string, any>[];
  team: LegacyTeamRecord | null;
}): Promise<ParentPlayerTopStat[]> {
  const analyticsConfig = selectAnalyticsConfig(configs, String(team?.sport || team?.baseType || ''));
  const topDefinitions = Array.isArray(analyticsConfig?.statDefinitions)
    ? analyticsConfig.statDefinitions.filter((definition: any) => definition?.topStat && definition?.scope !== 'team' && definition?.visibility !== 'private')
    : [];
  if (!analyticsConfig || !topDefinitions.length || !games.length) return [];

  const seasonStatsByPlayerId = await getAggregatedStatsForGames(teamId, games.map((game) => String(game.id || '')).filter(Boolean)).catch(() => ({}));
  const snapshot = buildPlayerLeaderboardSnapshot({
    config: analyticsConfig,
    players,
    seasonStatsByPlayerId
  });
  return summarizePlayerTopStats(snapshot, playerId).map((stat: any) => ({
    id: String(stat.id || ''),
    label: String(stat.label || stat.id || 'Stat'),
    rank: Number(stat.rank || 0),
    totalPlayers: Number(stat.totalPlayers || 0),
    value: Number(stat.value || 0),
    formattedValue: String(stat.formattedValue || stat.value || '0')
  })).filter((stat) => stat.id && stat.rank > 0);
}

async function loadPlayerGameEventRows({
  teamId,
  playerId,
  games,
  team
}: {
  teamId: string;
  playerId: string;
  games: Record<string, any>[];
  team: LegacyTeamRecord | null;
}): Promise<ParentPlayerGameEventRow[]> {
  const eventGroups = await Promise.all(games.slice(0, 10).map(async (game) => {
    const gameId = String(game.id || '');
    if (!gameId) return null;
    const events = await getGameEvents(teamId, gameId, { limit: 100 }).catch(() => []);
    const playerEvents = (Array.isArray(events) ? events : [])
      .filter((event) => isEventForPlayer(event, playerId))
      .map(normalizePlayerGameEvent)
      .filter((event): event is ParentPlayerGameEventRow['events'][number] => !!event)
      .sort((a, b) => b.timestampMs - a.timestampMs)
      .slice(0, 12);
    if (!playerEvents.length) return null;
    const event = buildStatsEventFromGame(game, teamId, team, playerId);
    return {
      gameId,
      gameLabel: getGameLabel(game),
      gameDate: event.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      events: playerEvents
    };
  }));
  return eventGroups.filter((group): group is ParentPlayerGameEventRow => !!group);
}

function isEventForPlayer(event: Record<string, any>, playerId: string) {
  if (String(event?.playerId || event?.playerID || '') === playerId) return true;
  if (Array.isArray(event?.playerIds) && event.playerIds.map(String).includes(playerId)) return true;
  if (Array.isArray(event?.players) && event.players.some((player: any) => String(player?.id || player?.playerId || player) === playerId)) return true;
  return false;
}

function normalizePlayerGameEvent(event: Record<string, any>): ParentPlayerGameEventRow['events'][number] | null {
  const id = String(event?.id || event?.eventId || event?.timestamp?.seconds || Math.random()).trim();
  const timestampMs = getTimestampMs(event?.timestamp || event?.createdAt || event?.time);
  return {
    id,
    statKey: String(event?.statKey || event?.stat || event?.type || '').trim(),
    value: typeof event?.value === 'undefined' ? '' : event.value,
    period: String(event?.period || event?.quarter || event?.segment || '').trim(),
    clock: String(event?.clock || event?.gameTime || '').trim(),
    description: String(event?.description || event?.text || event?.label || event?.type || 'Tracked event').trim(),
    timestampMs
  };
}

function getTimestampMs(value: any) {
  if (typeof value === 'number') return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value?.toDate === 'function') return value.toDate().getTime();
  if (typeof value?.seconds === 'number') return value.seconds * 1000;
  const parsed = new Date(value || 0).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function getGameLabel(game: Record<string, any>) {
  const opponent = String(game?.opponent || game?.opponentName || '').trim();
  return opponent ? `vs. ${opponent}` : String(game?.title || game?.name || 'Game');
}

export async function savePlayerCustomRosterFieldValues({
  user,
  teamId,
  playerId,
  values
}: {
  user: AuthUser | null;
  teamId: string;
  playerId: string;
  values: Record<string, unknown>;
}) {
  if (!user?.uid) {
    throw new Error('A signed-in team staff account is required.');
  }

  const team = await getTeam(teamId, { includeInactive: true });
  const access = buildPlayerAccess(user, teamId, playerId, team);
  if (!access.canEditCustomRosterFields) {
    throw new Error('Only team owners and admins can edit custom roster fields.');
  }

  const [players, privateProfile, rosterFieldDefinitions] = await Promise.all([
    getPlayers(teamId, { includeInactive: true }).catch(() => []),
    getPlayerPrivateProfile(teamId, playerId).catch(() => null),
    getRosterFieldDefinitions(teamId, team || null).catch(() => [])
  ]);

  const player = (Array.isArray(players) ? players : []).find((candidate: any) => candidate?.id === playerId) || {};
  const normalizedFields = normalizeRosterFieldDefinitions(rosterFieldDefinitions);
  const filteredValues = normalizeCustomRosterFieldInput(values, normalizedFields);
  const validationErrors = validateRosterProfileValues(normalizedFields, filteredValues);
  if (validationErrors.length > 0) {
    throw new Error(validationErrors[0]);
  }

  const { publicValues, privateValues } = splitRosterProfileValuesByVisibility(normalizedFields, filteredValues);
  const { publicProfile: existingPublicProfile, privateValues: legacyProtectedValues } = splitProtectedRosterProfileValues(player?.profile || {});
  const nextProfile = {
    ...existingPublicProfile,
    customFields: publicValues
  };
  const existingPrivateRosterFields = privateProfile?.rosterFields && typeof privateProfile.rosterFields === 'object'
    ? privateProfile.rosterFields
    : {};
  const nextPrivateRosterFields = {
    ...legacyProtectedValues,
    ...existingPrivateRosterFields,
    ...privateValues
  };

  await updatePlayerWithPrivateRosterProfileFields(teamId, playerId, {
    profile: nextProfile
  }, nextPrivateRosterFields);

  return {
    profile: nextProfile,
    privateRosterFields: nextPrivateRosterFields,
    privateProfile
  };
}

export async function updateParentPlayerEditableProfile({
  user,
  teamId,
  playerId,
  emergencyContactName = '',
  emergencyContactPhone = '',
  medicalInfo = '',
  photoFile = null
}: {
  user: AuthUser | null;
  teamId: string;
  playerId: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  medicalInfo?: string;
  photoFile?: File | null;
}) {
  assertLinkedParent(user, teamId, playerId);
  const nativeRuntime = isNativeRuntime();
  let photoUrl: string | undefined;
  let nativePhotoPath = '';
  let webPhotoPath = '';
  let previousPhotoPath = '';
  if (photoFile) {
    validateImageFile(photoFile);
    const privateProfile = await getPlayerPrivateProfile(teamId, playerId).catch(() => {
      throw new Error('The existing player photo state could not be loaded. Refresh before replacing the photo.');
    });
    previousPhotoPath = String(privateProfile?.photoPath || '').trim();
    if (nativeRuntime) {
      const uploaded = await import('./nativeStorageUpload').then((module) => module.uploadNativePlayerPhotoFile(photoFile, teamId, playerId));
      photoUrl = uploaded.url;
      nativePhotoPath = uploaded.path;
    } else {
      const uploaded = await uploadPlayerPhoto(photoFile, { returnUpload: true, teamId, playerId });
      photoUrl = uploaded.url;
      webPhotoPath = uploaded.path;
    }
  }

  const privatePayload: Record<string, any> = {
    emergencyContact: {
      name: String(emergencyContactName || '').trim(),
      phone: String(emergencyContactPhone || '').trim()
    },
    medicalInfo: String(medicalInfo || '').trim()
  };

  if (nativeRuntime) {
    try {
      const writes: Array<{ pathSegments: string[]; data: Record<string, unknown> }> = [{
        pathSegments: ['teams', teamId, 'players', playerId, 'private', 'profile'],
        data: {
          ...privatePayload,
          ...(typeof photoUrl !== 'undefined' ? { photoPath: nativePhotoPath || null } : {}),
          updatedAt: new Date()
        }
      }];
      if (typeof photoUrl !== 'undefined') {
        writes.push({
          pathSegments: ['teams', teamId, 'players', playerId],
          data: { photoUrl, updatedAt: new Date() }
        });
      }
      await import('./nativeFirestoreMutation').then((module) => module.commitNativeFirestoreWrites(writes));
    } catch (error) {
      const persistenceState = nativePhotoPath && !isDefinitiveFirestoreWriteFailure(error)
        ? await getPlayerPhotoPersistenceState(teamId, playerId, nativePhotoPath)
        : 'not-committed';
      if (persistenceState !== 'committed') {
        if (nativePhotoPath && persistenceState === 'not-committed') {
          await import('./nativeStorageUpload').then((module) => module.deleteNativePrimaryStorageFile(nativePhotoPath)).catch(() => undefined);
        }
        throw error;
      }
    }
  } else {
    try {
      await updatePlayerPrivateProfile(teamId, playerId, privatePayload);
    } catch (error) {
      if (webPhotoPath) {
        await Promise.resolve(deleteLegacyImageUpload(webPhotoPath)).catch(() => undefined);
      }
      throw error;
    }

    if (typeof photoUrl !== 'undefined') {
      try {
        await updatePlayerProfile(teamId, playerId, { photoUrl, photoPath: webPhotoPath || null });
      } catch (error) {
        const persistenceState = isDefinitiveFirestoreWriteFailure(error)
          ? 'not-committed'
          : await getPlayerPhotoPersistenceState(teamId, playerId, webPhotoPath);
        if (persistenceState !== 'committed') {
          if (webPhotoPath && persistenceState === 'not-committed') {
            await Promise.resolve(deleteLegacyImageUpload(webPhotoPath)).catch(() => undefined);
          }
          throw error;
        }
      }
    }
  }

  const nextPhotoPath = nativePhotoPath || webPhotoPath;
  if (previousPhotoPath && previousPhotoPath !== nextPhotoPath) {
    if (nativeRuntime) {
      await import('./nativeStorageUpload').then((module) => module.deleteNativePrimaryStorageFile(previousPhotoPath)).catch(() => undefined);
    } else {
      await Promise.resolve(deleteLegacyImageUpload(previousPhotoPath)).catch(() => undefined);
    }
  }

  return {
    ...privatePayload,
    ...(typeof photoUrl !== 'undefined' ? { photoUrl, photoPath: nextPhotoPath || null } : {})
  };
}

export async function saveStaffPlayerRosterDetails({
  user,
  teamId,
  playerId,
  currentPlayer,
  name,
  number = '',
  photoFile = null,
  removePhoto = false
}: {
  user: AuthUser | null;
  teamId: string;
  playerId: string;
  currentPlayer: Record<string, any> | null;
  name: string;
  number?: string;
  photoFile?: File | null;
  removePhoto?: boolean;
}) {
  if (!user?.uid) {
    throw new Error('A signed-in team staff account is required.');
  }

  const team = await getTeam(teamId, { includeInactive: true });
  const access = buildPlayerAccess(user, teamId, playerId, team);
  if (!access.canEditRosterDetails) {
    throw new Error('Only team owners and admins can edit roster details.');
  }

  const nextName = String(name || '').trim();
  if (!nextName) {
    throw new Error('Player name is required.');
  }

  const nextNumber = String(number || '').trim();
  const currentName = String(currentPlayer?.name || '').trim();
  const currentNumber = String(currentPlayer?.number || '').trim();
  const currentPhotoUrl = String(currentPlayer?.photoUrl || '').trim();
  let currentPrivateProfile: Record<string, any> | null = null;
  let currentPrivateProfileLoadError: unknown = null;
  try {
    currentPrivateProfile = await getPlayerPrivateProfile(teamId, playerId);
  } catch (error) {
    currentPrivateProfile = null;
    currentPrivateProfileLoadError = error;
  }
  if (currentPrivateProfileLoadError && (photoFile || removePhoto)) {
    throw new Error('The existing player photo state could not be loaded. Refresh before changing the photo.');
  }
  const currentPhotoPath = String(currentPrivateProfile?.photoPath || currentPlayer?.photoPath || '').trim();
  const nativeRuntime = isNativeRuntime();
  const payload: Record<string, any> = {};
  let nativePhotoPath = '';
  let webPhotoPath = '';

  if (nextName !== currentName) {
    payload.name = nextName;
  }
  if (nextNumber !== currentNumber) {
    payload.number = nextNumber;
  }

  if (photoFile) {
    validateImageFile(photoFile);
    if (nativeRuntime) {
      const uploaded = await import('./nativeStorageUpload').then((module) => module.uploadNativePlayerPhotoFile(photoFile, teamId, playerId));
      payload.photoUrl = uploaded.url;
      nativePhotoPath = uploaded.path;
      payload.photoPath = uploaded.path;
    } else {
      const uploaded = await uploadPlayerPhoto(photoFile, { returnUpload: true, teamId, playerId });
      payload.photoUrl = uploaded.url;
      webPhotoPath = uploaded.path;
      payload.photoPath = webPhotoPath || null;
    }
  } else if (removePhoto && (currentPhotoUrl || currentPhotoPath)) {
    payload.photoUrl = null;
    payload.photoPath = null;
  }

  if (!Object.keys(payload).length) {
    return { updatedFields: [] };
  }

  if (nativeRuntime) {
    try {
      const publicPayload = { ...payload };
      const hasPhotoPath = Object.prototype.hasOwnProperty.call(publicPayload, 'photoPath');
      const privatePhotoPath = hasPhotoPath ? (publicPayload.photoPath || null) : undefined;
      delete publicPayload.photoPath;
      const writes: Array<{ pathSegments: string[]; data: Record<string, unknown> }> = [{
        pathSegments: ['teams', teamId, 'players', playerId],
        data: { ...publicPayload, updatedAt: new Date() }
      }];
      if (hasPhotoPath) {
        writes.push({
          pathSegments: ['teams', teamId, 'players', playerId, 'private', 'profile'],
          data: { photoPath: privatePhotoPath, updatedAt: new Date() }
        });
      }
      await import('./nativeFirestoreMutation').then((module) => module.commitNativeFirestoreWrites(writes));
    } catch (error) {
      const persistenceState = !isDefinitiveFirestoreWriteFailure(error)
        ? nativePhotoPath
          ? await getPlayerPhotoPersistenceState(teamId, playerId, nativePhotoPath)
          : removePhoto && currentPhotoPath
            ? await getPlayerPhotoRemovalPersistenceState(teamId, playerId, currentPhotoPath)
            : 'unknown'
        : 'not-committed';
      if (persistenceState !== 'committed') {
        if (nativePhotoPath && persistenceState === 'not-committed') {
          await import('./nativeStorageUpload').then((module) => module.deleteNativePrimaryStorageFile(nativePhotoPath)).catch(() => undefined);
        }
        throw error;
      }
    }
  } else {
    try {
      await updatePlayer(teamId, playerId, payload);
    } catch (error) {
      const persistenceState = !isDefinitiveFirestoreWriteFailure(error)
        ? webPhotoPath
          ? await getPlayerPhotoPersistenceState(teamId, playerId, webPhotoPath)
          : removePhoto && currentPhotoPath
            ? await getPlayerPhotoRemovalPersistenceState(teamId, playerId, currentPhotoPath)
            : 'unknown'
        : 'not-committed';
      if (persistenceState !== 'committed') {
        if (webPhotoPath && persistenceState === 'not-committed') {
          await Promise.resolve(deleteLegacyImageUpload(webPhotoPath)).catch(() => undefined);
        }
        throw error;
      }
    }
  }
  const nextPhotoPath = nativePhotoPath || webPhotoPath || (removePhoto ? '' : currentPhotoPath);
  if (currentPhotoPath && currentPhotoPath !== nextPhotoPath) {
    if (nativeRuntime) {
      await import('./nativeStorageUpload').then((module) => module.deleteNativePrimaryStorageFile(currentPhotoPath)).catch(() => undefined);
    } else {
      await Promise.resolve(deleteLegacyImageUpload(currentPhotoPath)).catch(() => undefined);
    }
  }
  clearAppDataCache();
  return {
    updatedFields: Object.keys(payload),
    payload
  };
}

export async function sendParentCoParentInvite({
  user,
  teamId,
  playerId,
  email
}: {
  user: AuthUser | null;
  teamId: string;
  playerId: string;
  email: string;
  playerName: string;
}) {
  assertLinkedParent(user, teamId, playerId);
  return inviteCoParentToAthlete(teamId, playerId, email);
}

export async function saveParentPlayerIncentiveRule({
  user,
  teamId,
  playerId,
  playerName,
  rule
}: {
  user: AuthUser | null;
  teamId: string;
  playerId: string;
  playerName: string;
  rule: Record<string, any>;
}) {
  assertLinkedParent(user, teamId, playerId);
  return saveIncentiveRule(user!.uid, {
    teamId,
    playerId,
    playerName,
    statKey: String(rule.statKey || '').trim(),
    type: rule.type === 'threshold' ? 'threshold' : 'per_unit',
    amountCents: Number(rule.amountCents || 0),
    threshold: rule.type === 'threshold' ? Number(rule.threshold || 0) : null,
    thresholdOp: rule.type === 'threshold' && rule.thresholdOp === 'gte' ? 'gte' : (rule.type === 'threshold' ? 'gt' : null),
    active: rule.active !== false,
    ...(rule.id ? { id: rule.id } : {})
  });
}

export async function toggleParentPlayerIncentiveRule(user: AuthUser | null, teamId: string, playerId: string, rule: PlayerIncentiveRule) {
  assertLinkedParent(user, teamId, playerId);
  return toggleIncentiveRule(user!.uid, rule);
}

export async function retireParentPlayerIncentiveRule(user: AuthUser | null, teamId: string, playerId: string, ruleId: string) {
  assertLinkedParent(user, teamId, playerId);
  return retireIncentiveRule(user!.uid, ruleId);
}

export async function saveParentPlayerIncentiveCap(user: AuthUser | null, teamId: string, playerId: string, maxPerGameCents: number | null) {
  assertLinkedParent(user, teamId, playerId);
  return saveCapSetting(user!.uid, teamId, playerId, maxPerGameCents);
}

export async function markParentPlayerIncentivePaid(user: AuthUser | null, teamId: string, playerId: string, gameId: string, amountCents: number) {
  assertLinkedParent(user, teamId, playerId);
  return markGamePaid(user!.uid, gameId, playerId, teamId, amountCents);
}

export async function saveParentAthleteProfileDraft({
  user,
  teamId,
  playerId,
  draft,
  profileId,
  profilePhotoFile,
  resetProfilePhoto = false,
  highlightClipFile = null,
  highlightClipTitle = '',
  highlightClipUploads = []
}: {
  user: AuthUser | null;
  teamId: string;
  playerId: string;
  draft: Record<string, any>;
  profileId?: string | null;
  profilePhotoFile?: File | null;
  resetProfilePhoto?: boolean;
  highlightClipFile?: File | null;
  highlightClipTitle?: string;
  highlightClipUploads?: AthleteProfileHighlightClipUpload[];
}) {
  assertLinkedParent(user, teamId, playerId);
  const seasonKey = buildParentSeasonKey(teamId, playerId);
  const selectedSeasonKeys = Array.isArray(draft.selectedSeasonKeys) && draft.selectedSeasonKeys.length
    ? draft.selectedSeasonKeys
    : [seasonKey];
  const isNewProfile = !profileId;
  const workingProfileId = profileId || createLocalId('profile');
  let uploadedProfilePhoto: Record<string, any> | null = null;
  const uploadedHighlightClips: Array<Record<string, any>> = [];
  const uploadRequests = buildHighlightClipUploadRequests(highlightClipUploads, highlightClipFile, highlightClipTitle);
  if (profilePhotoFile) validateImageFile(profilePhotoFile);
  uploadRequests.forEach((upload) => validateHighlightClipFile(upload.file));
  const hasPendingMedia = !!profilePhotoFile || uploadRequests.length > 0;
  let createdMediaReservation = false;
  if (hasPendingMedia) {
    const reservation = isNewProfile
      ? await reserveAthleteProfileMediaOwnership(user!.uid, workingProfileId, { isNewProfile: true })
      : await reserveAthleteProfileMediaOwnership(user!.uid, workingProfileId);
    createdMediaReservation = reservation.created === true;
  }
  try {
    if (profilePhotoFile) {
      uploadedProfilePhoto = await uploadAthleteProfileMedia(user!.uid, workingProfileId, profilePhotoFile, { kind: 'profile-photo' });
    }
    for (const upload of uploadRequests) {
      const uploaded = await uploadAthleteProfileMedia(user!.uid, workingProfileId, upload.file, { kind: 'clip' });
      uploadedHighlightClips.push(buildUploadedHighlightClip(upload, uploaded));
    }
  } catch (error) {
    await cleanupUploadedAthleteProfileMedia([
      uploadedProfilePhoto?.storagePath,
      ...uploadedHighlightClips.map((clip) => clip.storagePath)
    ]);
    if (createdMediaReservation) {
      await releaseAthleteProfileMediaReservation(user!.uid, workingProfileId).catch(() => undefined);
    }
    throw error;
  }
  const profilePhoto = uploadedProfilePhoto || (resetProfilePhoto ? null : draft.profilePhoto);

  let saved;
  try {
    const clips = buildAthleteProfileHighlightClips(draft.clips, uploadedHighlightClips);
    const saveOptions = isNewProfile
      ? { profileId: workingProfileId, isNewProfile: true }
      : { profileId: workingProfileId };
    saved = await saveAthleteProfile(user!.uid, {
      ...draft,
      profilePhoto,
      clips,
      selectedSeasonKeys
    }, saveOptions);
  } catch (error) {
    await cleanupUploadedAthleteProfileMedia([
      uploadedProfilePhoto?.storagePath,
      ...uploadedHighlightClips.map((clip) => clip.storagePath)
    ]);
    if (createdMediaReservation) {
      await releaseAthleteProfileMediaReservation(user!.uid, workingProfileId).catch(() => undefined);
    }
    throw error;
  }
  return {
    profile: saved,
    shareUrl: buildAthleteProfileShareUrl(getLegacyOrigin(), saved.id),
    builderUrl: buildLegacyUrl('athlete-profile-builder.html', { teamId, playerId, profileId: saved.id })
  };
}

export function normalizeAthleteProfileHighlightClipUrl(value: unknown) {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    throw new Error('Enter a highlight clip link.');
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('Enter a valid http or https highlight clip link.');
    }
    return parsed.toString();
  } catch (error) {
    if (error instanceof Error && error.message.includes('http or https')) {
      throw error;
    }
    throw new Error('Enter a valid highlight clip link.');
  }
}

function createLocalId(prefix: string) {
  return `${prefix}_${createSecureUploadToken()}`;
}

function buildHighlightClipUploadRequests(
  highlightClipUploads: AthleteProfileHighlightClipUpload[],
  highlightClipFile: File | null,
  highlightClipTitle: string
) {
  const requests = (Array.isArray(highlightClipUploads) ? highlightClipUploads : [])
    .filter((upload) => upload?.file)
    .map((upload) => ({
      id: String(upload.id || createLocalId('clip')).trim(),
      file: upload.file,
      title: String(upload.title || '').trim(),
      label: String(upload.label || '').trim()
    }));

  if (highlightClipFile) {
    requests.push({
      id: createLocalId('clip'),
      file: highlightClipFile,
      title: String(highlightClipTitle || '').trim(),
      label: ''
    });
  }

  return requests;
}

function buildUploadedHighlightClip(upload: { id: string; file: File; title: string; label: string }, uploaded: Record<string, any>) {
  return {
    id: upload.id,
    source: 'upload',
    mediaType: uploaded.mediaType,
    title: upload.title || fileTitle(upload.file?.name || ''),
    label: upload.label,
    url: uploaded.url,
    storagePath: uploaded.storagePath,
    mimeType: uploaded.mimeType,
    sizeBytes: uploaded.sizeBytes,
    uploadedAtMs: uploaded.uploadedAtMs
  };
}

function buildAthleteProfileHighlightClips(rawClips: unknown, uploadedClips: Array<Record<string, any>>) {
  const uploadsById = new Map(uploadedClips.map((clip) => [String(clip.id || '').trim(), clip]));
  const consumedUploadIds = new Set<string>();
  const clips: Array<Record<string, any>> = [];

  (Array.isArray(rawClips) ? rawClips : []).forEach((rawClip, index) => {
    if (!rawClip || typeof rawClip !== 'object') return;
    const clip = rawClip as AthleteProfileHighlightClipDraft;
    const clipId = String(clip.id || '').trim();
    if (clip.pendingUpload) {
      const uploaded = uploadsById.get(clipId);
      if (!uploaded) {
        throw new Error('One highlight clip could not be found. Re-add it and try again.');
      }
      consumedUploadIds.add(clipId);
      clips.push(uploaded);
      return;
    }

    const normalized = normalizeAthleteProfileHighlightClipDraft(clip, index);
    if (normalized) {
      clips.push(normalized);
    }
  });

  uploadedClips.forEach((clip) => {
    const clipId = String(clip.id || '').trim();
    if (!consumedUploadIds.has(clipId)) {
      clips.push(clip);
    }
  });

  return clips;
}

function normalizeAthleteProfileHighlightClipDraft(clip: AthleteProfileHighlightClipDraft, index: number) {
  const source = clip.source === 'upload' ? 'upload' : 'external';
  const rawUrl = String(clip.url || '').trim();
  if (!rawUrl) return null;
  const url = source === 'external'
    ? normalizeAthleteProfileHighlightClipUrl(rawUrl)
    : rawUrl;

  return {
    id: String(clip.id || '').trim() || createLocalId(`clip_${index + 1}`),
    source,
    mediaType: normalizeHighlightClipMediaType(clip.mediaType, clip.mimeType, url, source),
    title: String(clip.title || '').trim(),
    label: String(clip.label || '').trim(),
    url,
    storagePath: String(clip.storagePath || '').trim(),
    mimeType: String(clip.mimeType || '').trim(),
    sizeBytes: Number.isFinite(Number(clip.sizeBytes)) ? Number(clip.sizeBytes) : null,
    uploadedAtMs: Number.isFinite(Number(clip.uploadedAtMs)) ? Number(clip.uploadedAtMs) : null
  };
}

function normalizeHighlightClipMediaType(
  mediaType: unknown,
  mimeType: unknown,
  url: string,
  source: 'external' | 'upload'
) {
  const explicit = String(mediaType || '').trim().toLowerCase();
  if (explicit === 'image' || explicit === 'video' || explicit === 'link') {
    return source === 'external' && explicit === 'link' ? 'link' : explicit;
  }

  const mime = String(mimeType || '').trim().toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';

  const lowerUrl = String(url || '').toLowerCase();
  if (/\.(png|jpe?g|gif|webp|avif)(\?|#|$)/.test(lowerUrl)) return 'image';
  if (/\.(mp4|webm|mov|m4v|ogg)(\?|#|$)/.test(lowerUrl)) return 'video';
  return 'link';
}

async function cleanupUploadedAthleteProfileMedia(paths: Array<string | null | undefined>) {
  await Promise.all(paths
    .filter((path): path is string => !!path)
    .map((path) => deleteAthleteProfileMediaByPath(path).catch(() => undefined)));
}

function normalizePrivateProfile(profile: any): ParentPlayerPrivateProfile | null {
  if (!profile) return null;
  return {
    emergencyContact: profile.emergencyContact || null,
    medicalInfo: profile.medicalInfo || ''
  };
}

function buildPlayerIncentiveData({
  rules,
  paidGames,
  statOptions,
  maxPerGameCents,
  statRows
}: {
  rules: PlayerIncentiveRule[];
  paidGames: Map<string, PlayerPaidGameRecord>;
  statOptions: PlayerStatOption[];
  maxPerGameCents: number | null;
  statRows: ParentPlayerStatRow[];
}): ParentPlayerIncentiveData {
  let totalEarnedCents = 0;
  let totalPaidCents = 0;
  const seasonGameEarnings = statRows.map((row) => {
    const applicableRules = getApplicableRulesForGame(rules, row.event.date);
    const calculated = calculateEarnings(applicableRules, row.stats || {}, maxPerGameCents);
    const paid = paidGames.get(row.event.id);
    const paidAmountCents = Number(paid?.amountCents || 0);
    totalEarnedCents += calculated.totalCents;
    totalPaidCents += paidAmountCents;
    return {
      event: row.event,
      stats: row.stats,
      totalCents: calculated.totalCents,
      uncappedTotalCents: calculated.uncappedTotalCents,
      wasCapped: calculated.wasCapped,
      breakdown: calculated.breakdown,
      paid: !!paid,
      paidAmountCents
    };
  });

  return {
    rules,
    currentRules: rules.filter((rule) => isCurrentRuleVersion(rule)),
    statOptions,
    maxPerGameCents,
    seasonGameEarnings,
    totalEarnedCents,
    totalPaidCents,
    unpaidCents: totalEarnedCents - totalPaidCents
  };
}

function buildAthleteProfileSeasonOptions(parentLinks: Array<Record<string, any>>) {
  const seen = new Set<string>();
  return (Array.isArray(parentLinks) ? parentLinks : [])
    .map((link) => {
      const optionTeamId = String(link?.teamId || '').trim();
      const optionPlayerId = String(link?.playerId || link?.childId || '').trim();
      if (!optionTeamId || !optionPlayerId) return null;
      const seasonKey = buildParentSeasonKey(optionTeamId, optionPlayerId);
      if (seen.has(seasonKey)) return null;
      seen.add(seasonKey);
      return {
        seasonKey,
        teamId: optionTeamId,
        teamName: String(link?.teamName || '').trim() || 'Team',
        playerId: optionPlayerId,
        playerName: String(link?.playerName || link?.childName || link?.name || '').trim() || 'Athlete'
      };
    })
    .filter(Boolean) as ParentAthleteProfileData['seasonOptions'];
}

function buildAthleteProfileData({
  profiles,
  parentLinks,
  teamId,
  playerId
}: {
  profiles: LegacyAthleteProfileRecord[];
  parentLinks: Array<Record<string, any>>;
  teamId: string;
  playerId: string;
}): ParentAthleteProfileData {
  const profile = profiles.find((candidate) => (
    Array.isArray(candidate?.seasons) &&
    candidate.seasons.some((season: any) => season?.teamId === teamId && season?.playerId === playerId)
  )) || null;
  const profileId = profile?.id || '';
  return {
    profile,
    shareUrl: profileId ? buildAthleteProfileShareUrl(getLegacyOrigin(), profileId) : '',
    builderUrl: buildLegacyUrl('athlete-profile-builder.html', { teamId, playerId, ...(profileId ? { profileId } : {}) }),
    seasonOptions: buildAthleteProfileSeasonOptions(parentLinks)
  };
}

async function getPlayerPhotoPersistenceState(teamId: string, playerId: string, expectedPhotoPath: string) {
  if (!expectedPhotoPath) return 'not-committed' as const;
  try {
    const privateProfile = await getPlayerPrivateProfile(teamId, playerId);
    return String(privateProfile?.photoPath || '').trim() === expectedPhotoPath
      ? 'committed' as const
      : 'not-committed' as const;
  } catch {
    return 'unknown' as const;
  }
}

async function getPlayerPhotoRemovalPersistenceState(teamId: string, playerId: string, previousPhotoPath: string) {
  try {
    const privateProfile = await getPlayerPrivateProfile(teamId, playerId);
    const authoritativePath = String(privateProfile?.photoPath || '').trim();
    if (!authoritativePath) return 'committed' as const;
    return authoritativePath === previousPhotoPath
      ? 'not-committed' as const
      : 'unknown' as const;
  } catch {
    return 'unknown' as const;
  }
}

function isDefinitiveFirestoreWriteFailure(error: unknown) {
  const code = String((error as { code?: unknown })?.code || '').trim().toLowerCase().split('/').pop() || '';
  return new Set([
    'already-exists',
    'failed-precondition',
    'invalid-argument',
    'not-found',
    'out-of-range',
    'permission-denied',
    'resource-exhausted',
    'unauthenticated',
    'unimplemented'
  ]).has(code);
}

function assertLinkedParent(user: AuthUser | null, teamId: string, playerId: string) {
  if (!user?.uid) {
    throw new Error('A signed-in parent account is required.');
  }
  const linked = isLinkedParent(user, teamId, playerId);
  if (!linked && !user.isAdmin && !user.roles?.includes('admin') && !user.roles?.includes('platformAdmin')) {
    throw new Error('This player is not linked to your account.');
  }
}

function isLinkedParent(user: AuthUser | null, teamId: string, playerId: string) {
  return isCanonicalParentPlayerLinked(user, safeDecode(teamId), safeDecode(playerId));
}

function isParentLinkedToTeam(user: AuthUser | null, teamId: string) {
  return isCanonicalParentTeamLinked(user, safeDecode(teamId));
}

function isParentOnTeam(user: AuthUser | null, teamId: string) {
  return isParentLinkedToTeam(user, teamId);
}

function normalizePlayerFamilyContacts(
  player: Record<string, any>,
  privateProfile: Record<string, any> | null | undefined,
  rosterContacts: Array<Record<string, any>> = []
): ParentPlayerFamilyContact[] {
  const contacts: ParentPlayerFamilyContact[] = [];
  const seen = new Set<string>();
  const clean = (value: unknown) => String(value || '').trim();
  const addContact = (source: Record<string, any> | null | undefined, fallback: Record<string, any> = {}) => {
    if (!source || typeof source !== 'object') return;
    const email = normalizeEmail(source.email || source.parentEmail || source.guardianEmail || fallback.email);
    const userId = clean(source.userId || source.uid || source.accountUserId || source.parentUserId || source.guardianUserId || fallback.userId);
    const name = clean(source.name || source.displayName || source.fullName || source.parentName || source.guardianName || fallback.name);
    const phone = clean(source.phone || source.parentPhone || source.guardianPhone || fallback.phone);
    const relation = clean(source.relation || source.relationship || source.parentRelation || source.guardianRelation || fallback.relation) || 'Parent/guardian';
    if (!email && !userId && !name && !phone) return;
    const key = email || userId || `${name}:${phone}:${relation}`.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    contacts.push({
      id: userId || email || key || `family-contact-${contacts.length + 1}`,
      name,
      email,
      phone,
      relation,
      status: userId ? 'linked' : 'contact'
    });
  };

  [
    ...(Array.isArray(player?.parents) ? player.parents : []),
    ...(Array.isArray(player?.privateProfileParents) ? player.privateProfileParents : []),
    ...(Array.isArray(rosterContacts) ? rosterContacts : []),
    ...(Array.isArray(privateProfile?.parents) ? privateProfile.parents : [])
  ].forEach((contact) => addContact(contact));

  addContact({
    userId: player?.parentUserId,
    email: player?.parentEmail,
    name: player?.parentName,
    phone: player?.parentPhone,
    relation: player?.parentRelation || 'Parent'
  });
  addContact({
    userId: player?.guardianUserId,
    email: player?.guardianEmail,
    name: player?.guardianName,
    phone: player?.guardianPhone,
    relation: player?.guardianRelation || 'Guardian'
  });

  return contacts.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'linked' ? -1 : 1;
    return (a.name || a.email || a.phone).localeCompare(b.name || b.email || b.phone);
  });
}

function isElevatedAppAdmin(user: AuthUser | null) {
  return !!(user?.isAdmin || user?.isPlatformAdmin || user?.roles?.includes('admin') || user?.roles?.includes('platformAdmin'));
}

function normalizeEmail(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function isTeamOwnerOrAdminUser(user: AuthUser | null, team: LegacyTeamRecord | null) {
  if (!user?.uid) return false;
  if (isElevatedAppAdmin(user)) return true;
  if (team?.ownerId === user.uid) return true;
  const email = normalizeEmail(user.email);
  const adminEmails = Array.isArray(team?.adminEmails) ? team.adminEmails.map(normalizeEmail) : [];
  return !!(email && adminEmails.includes(email));
}

function isTeamStaffUser(user: AuthUser | null, team: LegacyTeamRecord | null) {
  if (isTeamOwnerOrAdminUser(user, team)) return true;
  return !!(Array.isArray(user?.coachOf) && user.coachOf.map((value) => String(value || '').trim()).includes(String(team?.id || '').trim()));
}

function buildPlayerAccess(user: AuthUser | null, teamId: string, playerId: string, team: LegacyTeamRecord | null) {
  const linkedParent = isLinkedParent(user, teamId, playerId);
  const teamParent = linkedParent || isParentOnTeam(user, teamId);
  const resolvedTeam = team ? { ...team, id: team.id || teamId } : { id: teamId };
  const isTeamStaff = isTeamStaffUser(user, resolvedTeam);
  const canEditRosterDetails = isTeamOwnerOrAdminUser(user, resolvedTeam);
  const canEditCustomRosterFields = canEditRosterDetails;
  return {
    isLinkedParent: linkedParent,
    isTeamParent: teamParent,
    isTeamStaff,
    canEditRosterDetails,
    canEditCustomRosterFields
  };
}

function buildVisibleCustomRosterFields({
  definitions,
  player,
  privateProfile,
  access
}: {
  definitions: unknown;
  player: LegacyPlayerRecord;
  privateProfile: LegacyPlayerPrivateProfileRecord | null;
  access: { isLinkedParent: boolean; isTeamParent?: boolean; isTeamStaff: boolean; canEditRosterDetails: boolean; canEditCustomRosterFields: boolean };
}) {
  const normalizedFields = normalizeRosterFieldDefinitions(definitions);
  if (!normalizedFields.length) return [];

  const mergedValues = {
    ...getRosterProfileValues(player),
    ...(privateProfile?.rosterFields || {})
  };

  return normalizedFields
    .filter((field) => {
      if (field.visibility === 'parents' && !access.canEditCustomRosterFields && !access.isTeamStaff && !access.isLinkedParent) {
        return false;
      }
      return canViewRosterField({ id: field.key, visibility: field.visibility }, {
        isAdmin: access.canEditCustomRosterFields,
        isTeamMember: access.isTeamStaff || access.isLinkedParent || !!access.isTeamParent,
        isLinkedParent: access.isLinkedParent
      });
    })
    .map((field) => ({
      key: field.key,
      label: field.label,
      type: field.type,
      section: field.section,
      description: field.description,
      visibility: field.visibility,
      required: field.required === true,
      options: Array.isArray(field.options) ? field.options : [],
      value: normalizeCustomRosterFieldValue(field.type, mergedValues[field.key])
    }));
}

function normalizeCustomRosterFieldValue(type: RosterFieldDefinition['type'], value: unknown) {
  if (type === 'checkbox') return value === true;
  return String(value ?? '').trim();
}

function normalizeCustomRosterFieldInput(values: Record<string, unknown>, fields: Array<Pick<RosterFieldDefinition, 'key' | 'type'>>): RosterProfileValues {
  const normalized: RosterProfileValues = {};
  fields.forEach((field) => {
    if (!Object.prototype.hasOwnProperty.call(values || {}, field.key)) return;
    if (field.type === 'checkbox') {
      normalized[field.key] = values[field.key] === true;
      return;
    }
    const nextValue = String(values[field.key] ?? '').trim();
    if (nextValue) {
      normalized[field.key] = nextValue;
    }
  });
  return normalized;
}

function validateImageFile(file: File) {
  if (!String(file.type || '').startsWith('image/')) {
    throw new Error('Player photos must be image files.');
  }
  if (!Number.isFinite(file.size) || file.size <= 0) {
    throw new Error('Choose a valid image file.');
  }
  if (file.size > 10 * 1024 * 1024) {
    throw new Error('Choose an image under 10 MB.');
  }
}

function validateHighlightClipFile(file: File) {
  const fileType = String(file.type || '');
  if (!fileType.startsWith('image/') && !fileType.startsWith('video/')) {
    throw new Error('Highlight clips must be image or video files.');
  }
  if (!Number.isFinite(file.size) || file.size <= 0) {
    throw new Error('Choose a valid image or video file.');
  }
  if (file.size > 100 * 1024 * 1024) {
    throw new Error('Choose a highlight clip under 100 MB.');
  }
}

function fileTitle(fileName: string) {
  return String(fileName || '').replace(/\.[^.]+$/, '').trim();
}

function buildParentSeasonKey(teamId: string, playerId: string) {
  return `${teamId || ''}::${playerId || ''}`;
}

function getLegacyOrigin() {
  return 'https://allplays.ai';
}

function buildLegacyUrl(path: string, params: Record<string, string>) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) query.set(key, value);
  });
  return `${getLegacyOrigin()}/${path}${query.toString() ? `?${query.toString()}` : ''}`;
}

function findLinkedChild(children: ParentScheduleChild[], teamId: string, playerId: string) {
  const decodedTeamId = safeDecode(teamId);
  const decodedPlayerId = safeDecode(playerId);
  if (decodedTeamId && decodedPlayerId) {
    return children.find((child) => child.teamId === decodedTeamId && child.playerId === decodedPlayerId) || null;
  }
  return children.find((child) => child.playerId === decodedPlayerId) || null;
}

function findLinkedParentChild(user: AuthUser | null, teamId: string, playerId: string): ParentScheduleChild | null {
  const decodedTeamId = safeDecode(teamId);
  const decodedPlayerId = safeDecode(playerId);
  const parentLink = findCanonicalParentAccessLink(user, decodedTeamId, decodedPlayerId);
  if (!parentLink) return null;
  return {
    teamId: decodedTeamId,
    teamName: parentLink.teamName,
    playerId: decodedPlayerId,
    playerName: parentLink.playerName
  };
}

function findOnlyLinkedChildForTeam(children: ParentScheduleChild[], user: AuthUser | null, teamId: string) {
  const decodedTeamId = safeDecode(teamId);
  const teamChildren = children.filter((child) => safeDecode(child.teamId) === decodedTeamId);
  if (teamChildren.length === 1) return teamChildren[0];

  const linkedChild = findOnlyCanonicalParentAccessLinkForTeam(user, decodedTeamId);
  return linkedChild ? {
    teamId: linkedChild.teamId,
    teamName: linkedChild.teamName,
    playerId: linkedChild.playerId,
    playerName: linkedChild.playerName
  } : null;
}

async function loadUserWithPlayerAccessProfile(user: AuthUser): Promise<AuthUser> {
  const profile = await loadProfileDocument(user.uid);
  if (!profile) return user;
  const parentAccessUser = applyCurrentParentAccessProfile(user, profile as Record<string, unknown>);
  return {
    ...parentAccessUser,
    coachOf: mergeProfileArray(user.coachOf, (profile as any).coachOf)
  };
}

function mergeProfileArray<T>(userValues: T[] | undefined, profileValues: unknown): T[] {
  const merged = [...(Array.isArray(userValues) ? userValues : [])];
  if (Array.isArray(profileValues)) {
    profileValues.forEach((value) => {
      if (!merged.some((current) => JSON.stringify(current) === JSON.stringify(value))) {
        merged.push(value as T);
      }
    });
  }
  return merged;
}

function safeDecode(value: unknown) {
  const text = String(value || '').trim();
  if (!text) return '';
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function startOfDay(date: Date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function isPastOrCompleted(event: ParentScheduleEvent) {
  const status = String(event.status || '').toLowerCase();
  const liveStatus = String(event.liveStatus || '').toLowerCase();
  return event.date.getTime() < Date.now() || status === 'final' || status === 'completed' || liveStatus === 'final' || liveStatus === 'completed';
}
