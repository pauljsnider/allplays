import { functions, getFamilyShareToken, httpsCallable, resolveFamilyShareTokenChildren } from './adapters/legacyParentTools';
import { getGames, getTeam } from './adapters/legacyScheduleDb';
import {
  expandRecurrence,
  extractOpponent,
  fetchAndParseCalendar,
  getCalendarEventTrackingId,
  isPracticeEvent,
  isTrackedCalendarEvent
} from './adapters/legacyScheduleHelpers';

export type FamilyShareTokenErrorReason = 'missing' | 'invalid' | 'revoked' | 'expired' | 'load-failed';

export class FamilyShareTokenError extends Error {
  readonly reason: FamilyShareTokenErrorReason;

  constructor(reason: FamilyShareTokenErrorReason, message: string) {
    super(message);
    this.name = 'FamilyShareTokenError';
    this.reason = reason;
  }
}

export type FamilyShareChild = {
  teamId: string;
  teamName: string;
  playerId: string;
  playerName: string;
  playerNumber?: string;
  playerPhotoUrl?: string | null;
};

export type FamilyShareTeam = {
  teamId: string;
  teamName: string;
  playerNames: string[];
};

export type FamilyShareEvent = {
  eventKey: string;
  id: string;
  teamId: string;
  teamName: string;
  type: 'game' | 'practice';
  date: Date;
  title: string;
  opponent: string;
  location: string;
  status: string;
  isCancelled: boolean;
  isDbGame: boolean;
  childIds: string[];
  childNames: string[];
  homeScore: number | null;
  awayScore: number | null;
  notes?: string | null;
  sourceLabel?: string | null;
};

export type FamilyShareViewModel = {
  tokenId: string;
  label: string;
  expiresAt: Date | null;
  children: FamilyShareChild[];
  teams: FamilyShareTeam[];
  events: FamilyShareEvent[];
  upcomingEvents: FamilyShareEvent[];
  recentResults: FamilyShareEvent[];
  calendarWarnings: string[];
};

type FamilyShareScheduleProjection = {
  children: FamilyShareChild[];
  teams: FamilyShareScheduleTeamProjection[];
};

type FamilyShareScheduleTeamProjection = {
  teamId: string;
  teamName: string;
  calendarUrls: string[];
  games: Record<string, any>[];
};

const upcomingCutoffMs = 3 * 60 * 60 * 1000;
const maxUpcomingEvents = 12;
const maxRecentResults = 8;

export async function loadFamilyShareView(tokenId: string): Promise<FamilyShareViewModel> {
  const normalizedTokenId = compactString(tokenId);
  if (!normalizedTokenId) {
    throw new FamilyShareTokenError('missing', 'Family share link is missing a token.');
  }

  let token: Record<string, any>;
  try {
    token = asRecord(await getFamilyShareToken(normalizedTokenId));
  } catch (error: any) {
    throw new FamilyShareTokenError('load-failed', error?.message || 'Unable to load this family share link.');
  }

  if (!Object.keys(token).length) {
    throw new FamilyShareTokenError('invalid', 'This family share link is no longer valid.');
  }

  if (token.active === false || token.revoked || token.revokedAt) {
    throw new FamilyShareTokenError('revoked', 'This family share link has been revoked.');
  }

  const expiresAt = toDate(token.expiresAt);
  if (expiresAt && expiresAt.getTime() <= Date.now()) {
    throw new FamilyShareTokenError('expired', 'This family share link has expired.');
  }

  const scheduleProjection = await loadFamilyShareScheduleProjection(normalizedTokenId);
  const children = scheduleProjection === null
    ? await resolveTokenChildren(normalizedTokenId, token)
    : scheduleProjection.children;
  const calendarWarnings: string[] = [];
  const events = await buildCombinedFamilySchedule(
    children,
    normalizeCalendarUrls(token.extraCalendarUrls),
    calendarWarnings,
    scheduleProjection?.teams
  );
  const upcomingEvents = getUpcomingEvents(events);
  const recentResults = getRecentResults(events);

  return {
    tokenId: normalizedTokenId,
    label: compactString(token.label) || 'Family Page',
    expiresAt,
    children,
    teams: buildFamilyTeams(children),
    events,
    upcomingEvents,
    recentResults,
    calendarWarnings
  };
}

export function normalizeFamilyShareChildren(children: unknown): FamilyShareChild[] {
  const seen = new Set<string>();
  return (Array.isArray(children) ? children : [])
    .map((child) => {
      const source = asRecord(child);
      const teamId = compactString(source.teamId);
      const playerId = compactString(source.playerId || source.childId);
      return {
        teamId,
        teamName: compactString(source.teamName || source.team),
        playerId,
        playerName: compactString(source.playerName || source.childName || source.name) || 'Player',
        playerNumber: compactString(source.playerNumber || source.number),
        playerPhotoUrl: compactString(source.playerPhotoUrl || source.photoUrl) || null
      };
    })
    .filter((child) => {
      if (!child.teamId || !child.playerId) return false;
      const key = `${child.teamId}:${child.playerId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

async function resolveTokenChildren(tokenId: string, token: Record<string, any>) {
  const storedChildren = normalizeFamilyShareChildren(token.children);
  if (storedChildren.length > 0) return storedChildren;

  try {
    return normalizeFamilyShareChildren(await resolveFamilyShareTokenChildren(tokenId));
  } catch {
    return [];
  }
}

async function loadFamilyShareScheduleProjection(tokenId: string): Promise<FamilyShareScheduleProjection | null> {
  try {
    const callable = httpsCallable(functions, 'getFamilyShareSchedule');
    const response = await callable({ tokenId });
    const data = asRecord(response?.data);
    return {
      children: normalizeFamilyShareChildren(data.children),
      teams: normalizeScheduleProjectionTeams(data.teams)
    };
  } catch {
    return null;
  }
}

function buildFamilyTeams(children: FamilyShareChild[]): FamilyShareTeam[] {
  const teams = new Map<string, FamilyShareTeam>();
  children.forEach((child) => {
    if (!teams.has(child.teamId)) {
      teams.set(child.teamId, {
        teamId: child.teamId,
        teamName: child.teamName || 'Team',
        playerNames: []
      });
    }
    const team = teams.get(child.teamId);
    if (team && child.playerName && !team.playerNames.includes(child.playerName)) {
      team.playerNames.push(child.playerName);
    }
  });
  return [...teams.values()];
}

async function buildCombinedFamilySchedule(
  children: FamilyShareChild[],
  extraCalendarUrls: string[],
  calendarWarnings: string[],
  scheduleTeams: FamilyShareScheduleTeamProjection[] = []
) {
  const byTeam = new Map<string, FamilyShareChild[]>();
  const projectedTeamsById = new Map(scheduleTeams.map((team) => [team.teamId, team]));
  children.forEach((child) => {
    if (!byTeam.has(child.teamId)) byTeam.set(child.teamId, []);
    byTeam.get(child.teamId)?.push(child);
  });

  const eventRows = await Promise.all([...byTeam.entries()].map(([teamId, teamChildren]) => (
    buildTeamFamilyEvents(teamId, teamChildren, calendarWarnings, projectedTeamsById.get(teamId) || null)
  )));
  const events = eventRows.flat();
  events.push(...await buildExtraCalendarEvents(children, extraCalendarUrls, events, calendarWarnings));
  return mergeFamilyEvents(events).sort((a, b) => a.date.getTime() - b.date.getTime());
}

async function buildTeamFamilyEvents(
  teamId: string,
  children: FamilyShareChild[],
  calendarWarnings: string[],
  scheduleTeam: FamilyShareScheduleTeamProjection | null = null
) {
  let team: Record<string, any> | null = null;
  let games: Record<string, any>[] = [];
  if (scheduleTeam) {
    team = {
      id: scheduleTeam.teamId,
      name: scheduleTeam.teamName,
      calendarUrls: scheduleTeam.calendarUrls
    };
    games = scheduleTeam.games;
  } else {
    try {
      [team, games] = await Promise.all([
        Promise.resolve(getTeam(teamId)).catch(() => null),
        Promise.resolve(getGames(teamId)).catch(() => [])
      ]);
    } catch {
      return [];
    }
  }

  if (!team) return [];

  const teamName = compactString(team.name) || children[0]?.teamName || 'Team';
  const events: FamilyShareEvent[] = [];
  games.forEach((game) => {
    events.push(...buildDbGameEvents(teamId, teamName, children, asRecord(game)));
  });

  const trackedUids = games.map((game) => compactString(game?.calendarEventUid)).filter(Boolean);
  const dbTimestamps = events.filter((event) => event.isDbGame).map((event) => event.date.getTime());
  const calendarUrls = normalizeCalendarUrls(team.calendarUrls);
  if (calendarUrls.length) {
    const calendarResults = await Promise.all(calendarUrls.map((calendarUrl) => loadCalendar(calendarUrl, teamName, calendarWarnings)));
    calendarResults.flat().forEach((calendarEvent) => {
      if (isTrackedCalendarEvent(calendarEvent, trackedUids)) return;
      const eventDate = toDate(calendarEvent.dtstart);
      if (!eventDate) return;
      if (dbTimestamps.some((timestamp) => Math.abs(timestamp - eventDate.getTime()) < 60000)) return;
      events.push(buildCalendarEvent(teamId, teamName, children, calendarEvent, calendarEvent.sourceLabel || teamName));
    });
  }

  return events;
}

function buildDbGameEvents(teamId: string, teamName: string, children: FamilyShareChild[], game: Record<string, any>) {
  const type: 'game' | 'practice' = game.type === 'practice' ? 'practice' : 'game';
  if (type === 'practice' && game.isSeriesMaster && game.recurrence) {
    return expandRecurrence(game).map((occurrence) => {
      const source = asRecord(occurrence);
      const date = toDate(source.date || source.instanceDate) || new Date();
      const id = compactString(source.id || source.occurrenceId) || `${compactString(source.masterId || game.id || game.gameId)}__${compactString(source.instanceDate)}`;
      return buildFamilyEvent({
        id,
        teamId,
        teamName,
        type,
        date,
        title: compactString(source.title) || 'Practice',
        opponent: '',
        location: compactString(source.location || game.location) || 'TBD',
        status: compactString(game.status) || 'scheduled',
        isCancelled: game.status === 'cancelled',
        isDbGame: true,
        children,
        notes: compactString(source.notes || game.notes) || null
      });
    });
  }

  const date = toDate(game.date);
  if (!date) return [];
  const id = compactString(game.id || game.gameId) || `${teamId}-${date.toISOString()}`;
  return [buildFamilyEvent({
    id,
    teamId,
    teamName,
    type,
    date,
    title: compactString(game.title) || (type === 'practice' ? 'Practice' : ''),
    opponent: type === 'game' ? compactString(game.opponent) || 'TBD' : '',
    location: compactString(game.location) || 'TBD',
    status: compactString(game.status) || 'scheduled',
    isCancelled: game.status === 'cancelled',
    isDbGame: true,
    children,
    homeScore: toScore(game.homeScore),
    awayScore: toScore(game.awayScore),
    notes: compactString(game.notes) || null
  })];
}

async function buildExtraCalendarEvents(
  children: FamilyShareChild[],
  calendarUrls: string[],
  existingEvents: FamilyShareEvent[],
  calendarWarnings: string[]
) {
  if (!children.length || !calendarUrls.length) return [];
  const dbTimestamps = existingEvents.filter((event) => event.isDbGame).map((event) => event.date.getTime());
  const uniqueChildren = [...new Map(children.map((child) => [child.playerId, child])).values()];
  const calendarResults = await Promise.all(calendarUrls.map((calendarUrl) => loadCalendar(calendarUrl, getCalendarFailureLabel(calendarUrl), calendarWarnings)));
  return calendarResults.flat().flatMap((calendarEvent) => {
    const eventDate = toDate(calendarEvent.dtstart);
    if (!eventDate) return [];
    if (dbTimestamps.some((timestamp) => Math.abs(timestamp - eventDate.getTime()) < 60000)) return [];
    return [buildCalendarEvent(
      uniqueChildren[0]?.teamId || '',
      uniqueChildren[0]?.teamName || 'Shared calendar',
      uniqueChildren,
      calendarEvent,
      calendarEvent.sourceLabel || 'Shared calendar'
    )];
  });
}

async function loadCalendar(calendarUrl: string, label: string, calendarWarnings: string[]) {
  try {
    const events = await fetchAndParseCalendar(calendarUrl);
    return events.map((event) => ({ ...event, sourceLabel: label }));
  } catch {
    const warning = getCalendarFailureLabel(calendarUrl, label);
    if (!calendarWarnings.includes(warning)) calendarWarnings.push(warning);
    return [];
  }
}

function buildCalendarEvent(
  teamId: string,
  teamName: string,
  children: FamilyShareChild[],
  calendarEvent: Record<string, any>,
  sourceLabel: string
) {
  const summary = compactString(calendarEvent.summary).replace(/\[CANCELED\]\s*/gi, '');
  const type: 'game' | 'practice' = isPracticeEvent(summary) ? 'practice' : 'game';
  const date = toDate(calendarEvent.dtstart) || new Date();
  return buildFamilyEvent({
    id: getCalendarEventTrackingId(calendarEvent) || compactString(calendarEvent.uid) || `${sourceLabel}-${date.toISOString()}`,
    teamId,
    teamName,
    type,
    date,
    title: type === 'practice' ? summary || 'Practice' : '',
    opponent: type === 'game' ? extractOpponent(summary, teamName) || 'TBD' : '',
    location: compactString(calendarEvent.location) || 'TBD',
    status: compactString(calendarEvent.status) || 'scheduled',
    isCancelled: compactString(calendarEvent.status).toUpperCase() === 'CANCELLED' || /\[CANCELED\]/i.test(compactString(calendarEvent.summary)),
    isDbGame: false,
    children,
    sourceLabel
  });
}

function buildFamilyEvent(input: {
  id: string;
  teamId: string;
  teamName: string;
  type: 'game' | 'practice';
  date: Date;
  title: string;
  opponent: string;
  location: string;
  status: string;
  isCancelled: boolean;
  isDbGame: boolean;
  children: FamilyShareChild[];
  homeScore?: number | null;
  awayScore?: number | null;
  notes?: string | null;
  sourceLabel?: string | null;
}): FamilyShareEvent {
  const childIds = uniqueStrings(input.children.map((child) => child.playerId));
  const childNames = uniqueStrings(input.children.map((child) => child.playerName));
  const event = {
    eventKey: '',
    id: compactString(input.id),
    teamId: compactString(input.teamId),
    teamName: compactString(input.teamName) || 'Team',
    type: input.type,
    date: input.date,
    title: compactString(input.title),
    opponent: compactString(input.opponent),
    location: compactString(input.location) || 'TBD',
    status: compactString(input.status) || 'scheduled',
    isCancelled: input.isCancelled,
    isDbGame: input.isDbGame,
    childIds,
    childNames,
    homeScore: input.homeScore ?? null,
    awayScore: input.awayScore ?? null,
    notes: input.notes || null,
    sourceLabel: input.sourceLabel || null
  };
  event.eventKey = getFamilyEventKey(event);
  return event;
}

function mergeFamilyEvents(events: FamilyShareEvent[]) {
  const merged = new Map<string, FamilyShareEvent>();
  events.forEach((event) => {
    const key = getFamilyEventKey(event);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...event, eventKey: key });
      return;
    }
    existing.childIds = uniqueStrings([...existing.childIds, ...event.childIds]);
    existing.childNames = uniqueStrings([...existing.childNames, ...event.childNames]);
  });
  return [...merged.values()];
}

function getUpcomingEvents(events: FamilyShareEvent[]) {
  const cutoff = Date.now() - upcomingCutoffMs;
  return events
    .filter((event) => event.date.getTime() >= cutoff)
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .slice(0, maxUpcomingEvents);
}

function getRecentResults(events: FamilyShareEvent[]) {
  return events
    .filter((event) => event.type === 'game' && isPastResult(event))
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .slice(0, maxRecentResults);
}

function isPastResult(event: FamilyShareEvent) {
  const status = event.status.toLowerCase();
  return ['final', 'finished', 'complete', 'completed'].includes(status)
    || event.homeScore !== null
    || event.awayScore !== null
    || event.date.getTime() < Date.now() - upcomingCutoffMs;
}

function getFamilyEventKey(event: Pick<FamilyShareEvent, 'teamId' | 'id' | 'date' | 'type'>) {
  const datePart = event.date instanceof Date && !Number.isNaN(event.date.getTime()) ? event.date.toISOString() : '';
  return `${event.teamId}:${event.id}:${datePart}:${event.type}`;
}

function normalizeCalendarUrls(value: unknown) {
  return uniqueStrings(Array.isArray(value) ? value.map(compactString) : []);
}

function normalizeScheduleProjectionTeams(value: unknown): FamilyShareScheduleTeamProjection[] {
  const seen = new Set<string>();
  return (Array.isArray(value) ? value : [])
    .map((entry) => {
      const team = asRecord(entry);
      const teamId = compactString(team.teamId || team.id);
      return {
        teamId,
        teamName: compactString(team.teamName || team.name),
        calendarUrls: normalizeCalendarUrls(team.calendarUrls),
        games: (Array.isArray(team.games) ? team.games : []).map(asRecord)
      };
    })
    .filter((team) => {
      if (!team.teamId || seen.has(team.teamId)) return false;
      seen.add(team.teamId);
      return true;
    });
}

function uniqueStrings(values: unknown[]) {
  return [...new Set(values.map(compactString).filter(Boolean))];
}

function toScore(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const score = Number(value);
  return Number.isFinite(score) ? score : null;
}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof (value as any)?.toDate === 'function') {
    const date = (value as any).toDate();
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
  }
  if (typeof (value as any)?.toMillis === 'function') {
    const date = new Date((value as any).toMillis());
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof (value as any)?.seconds === 'number') {
    const timestamp = (value as any).seconds * 1000 + Math.floor(Number((value as any).nanoseconds || 0) / 1000000);
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(value as any);
  return Number.isNaN(date.getTime()) ? null : date;
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

function compactString(value: unknown) {
  return String(value || '').trim();
}

function getCalendarFailureLabel(url: string, fallback = 'External calendar') {
  try {
    return new URL(url).hostname || fallback;
  } catch {
    return fallback;
  }
}
