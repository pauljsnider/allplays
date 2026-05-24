import {
  getAggregatedStatsForGames,
  getAdSpaceSponsors,
  getConfigs,
  getGames,
  getLocalAttractionSponsors,
  getPlayers,
  getPlayerTrackingStatuses,
  getPublicTrackingItems,
  getTeam
} from '../../../../js/db.js';
import { calculateSeasonRecord, listSeasonLabels } from '../../../../js/season-record.js';
import { computeNativeStandings } from '../../../../js/native-standings.js';
import { buildPlayerLeaderboardSnapshot, selectAnalyticsConfig } from '../../../../js/stat-leaderboards.js';
import { getVisiblePlayerTrackingSummary } from '../../../../js/player-tracking-summary.js';
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

export type TeamDetailEvent = {
  id: string;
  type: 'game' | 'practice';
  title: string;
  date: Date;
  location: string;
  opponent: string;
  status: string;
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

export type TeamDetailModel = {
  team: {
    id: string;
    name: string;
    sport: string;
    photoUrl: string | null;
    description: string;
    zip: string;
    leagueUrl: string | null;
    streamUrl: string | null;
    websiteUrl: string;
    mediaUrl: string;
    registrationProvider: Array<{ label: string; value: string }>;
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
  counts: {
    games: number;
    practices: number;
    completedGames: number;
  };
};

type FirestoreDocument = Record<string, any> & { id: string };

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

async function nativeFirestoreRequest(path: string) {
  const response = await withTimeout(fetch(`${getFirestoreBaseUrl()}${path}`, {
    headers: await getNativeHeaders()
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

export async function loadParentTeamDetail(teamId: string, user: AuthUser | null): Promise<TeamDetailModel> {
  const [team, players, games, configs] = await Promise.all([
    loadTeamDocument(teamId),
    loadTeamPlayers(teamId),
    loadTeamGames(teamId),
    loadTeamConfigs(teamId)
  ]);

  if (!team) throw new Error('Team not found.');

  const linkedPlayerIds = getLinkedPlayerIds(user, teamId, players);
  const completedGameIds = (Array.isArray(games) ? games : [])
    .filter(isCompletedGame)
    .map((game: any) => cleanString(game.id || game.gameId))
    .filter(Boolean);

  const [seasonStatsByPlayerId, trackingItems, trackingStatuses, localSponsors, adSponsors] = await Promise.all([
    completedGameIds.length ? Promise.resolve(getAggregatedStatsForGames(teamId, completedGameIds)).catch(() => ({})) : Promise.resolve({}),
    linkedPlayerIds.length ? Promise.resolve(getPublicTrackingItems(teamId)).catch(() => []) : Promise.resolve([]),
    linkedPlayerIds.length ? Promise.resolve(getPlayerTrackingStatuses(teamId, linkedPlayerIds)).catch(() => []) : Promise.resolve([]),
    Promise.resolve(getLocalAttractionSponsors(teamId)).catch(() => []),
    Promise.resolve(getAdSpaceSponsors(teamId)).catch(() => [])
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
    sponsors: [...normalizeSponsorList(adSponsors), ...normalizeSponsorList(localSponsors)]
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
  sponsors = []
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

  return {
    team: {
      id: teamId,
      name: cleanString(team?.name) || 'Team',
      sport: cleanString(team?.sport) || 'Sport not set',
      photoUrl: getFirstUrl(team?.photoUrl, team?.teamPhotoUrl, team?.logoUrl, team?.imageUrl),
      description: cleanString(team?.description),
      zip: cleanString(team?.zip),
      leagueUrl: getFirstUrl(team?.leagueUrl),
      streamUrl: getStreamUrl(team),
      websiteUrl: getPublicHashUrl('team.html', teamId),
      mediaUrl: getPublicHashUrl('team-media.html', teamId),
      registrationProvider: getRegistrationProviderDetails(team, teamId)
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
    counts: {
      games: games.filter((game: any) => game?.type !== 'practice').length,
      practices: games.filter((game: any) => game?.type === 'practice').length,
      completedGames: completedGames.length
    }
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
