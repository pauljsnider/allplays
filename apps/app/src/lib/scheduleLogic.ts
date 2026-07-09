import { formatLongDate, formatShortDate, formatTimeOfDay } from './datetime';

export type ParentScheduleFilter = 'upcoming-all' | 'upcoming-games' | 'upcoming-practices' | 'availability' | 'recent-results' | 'past-all';
export type ScheduleViewMode = 'list' | 'compact' | 'calendar' | 'packets';
export type ScheduleTimeRange = 'week' | 'month' | 'quarter' | 'all';
export type ScheduleEventType = 'game' | 'practice';
export type RsvpResponse = 'going' | 'maybe' | 'not_going' | 'not_responded';
export type ScheduleSourceType = 'db' | 'calendar' | 'practice-session' | 'unknown';
export type ScheduleEventDetailSection = 'availability' | 'rideshare' | 'assignments' | 'game';
export const PRACTICE_PACKET_DETAIL_SECTION: ScheduleEventDetailSection = 'game';

export type ScheduleRsvpSummary = {
  going?: number;
  maybe?: number;
  notGoing?: number;
  notResponded?: number;
  total?: number;
};

export type ScheduleTournamentStandingRow = {
  rank: string;
  teamName: string;
  record: string;
  points: number | null;
};

export type ScheduleTournamentStandingInfo = {
  groupName: string;
  rows: ScheduleTournamentStandingRow[];
  isOverridden: boolean;
  note: string;
};

export type ScheduleTournamentInfo = {
  isTournament: boolean;
  label: string;
  details: string;
  divisionName: string;
  bracketName: string;
  roundName: string;
  poolName: string;
  matchupLabel: string;
  positionLabel: string;
  standings: ScheduleTournamentStandingInfo | null;
};

export type StaffRsvpReminderPreviewPlayer = {
  playerId: string;
  playerName: string;
  playerNumber?: string | number | null;
  parentEmails: string[];
  hasEligibleParentEmail: boolean;
};

export type StaffRsvpReminderPreview = {
  missingPlayerCount: number;
  eligibleEmailCount: number;
  eligibleEmails: string[];
  players: StaffRsvpReminderPreviewPlayer[];
};

export type ScheduleAssignment = {
  role?: string;
  value?: string;
  claimable?: boolean;
  claim?: {
    id?: string;
    claimedByName?: string;
    claimedByUserId?: string;
    claimedAt?: unknown;
  } | null;
};

export type ScheduleRideSummary = {
  offerCount: number;
  seatsLeft: number;
  requests: number;
  pending: number;
  confirmed: number;
  isFull: boolean;
};

export type RideOfferStatus = 'open' | 'closed' | 'cancelled';
export type RideOfferDirection = 'to' | 'from' | 'round-trip';
export type RideRequestStatus = 'pending' | 'confirmed' | 'waitlisted' | 'declined';

export type ScheduleRideRequest = {
  id: string;
  parentUserId?: string;
  childId?: string;
  childName?: string | null;
  status?: RideRequestStatus;
  requestedAt?: unknown;
  respondedAt?: unknown;
  updatedAt?: unknown;
};

export type ScheduleRideOffer = {
  id: string;
  sourceGameId?: string;
  driverUserId?: string;
  driverName?: string | null;
  seatCapacity: number;
  seatCountConfirmed: number;
  direction: RideOfferDirection;
  note?: string | null;
  status: RideOfferStatus;
  createdAt?: unknown;
  updatedAt?: unknown;
  requests: ScheduleRideRequest[];
};

export type PracticePacketBlock = {
  drillId?: string | null;
  type?: string | null;
  duration?: string | number | null;
  drillTitle?: string | null;
  title?: string | null;
  description?: string | null;
  notes?: string | null;
};

export type PracticeHomePacket = {
  blocks?: PracticePacketBlock[];
  totalMinutes?: number | null;
};

export type PracticePacketCompletion = {
  id?: string;
  parentUserId?: string | null;
  parentName?: string | null;
  childId?: string | null;
  childName?: string | null;
  status?: string | null;
  completedAt?: unknown;
  updatedAt?: unknown;
};

export type ParentScheduleEvent = {
  eventKey: string;
  id: string;
  teamId: string;
  teamName: string;
  teamNotificationEmail?: string | null;
  type: ScheduleEventType;
  date: Date;
  endDate?: Date | null;
  location: string;
  opponent?: string | null;
  opponentTeamId?: string | null;
  opponentTeamName?: string | null;
  opponentTeamPhoto?: string | null;
  sharedScheduleOpponentTeamId?: string | null;
  counterpartTitle?: string | null;
  title?: string | null;
  childId: string;
  childName: string;
  isDbGame: boolean;
  isCancelled: boolean;
  status?: string | null;
  liveStatus?: string | null;
  liveClockMs?: number | null;
  liveClockRunning?: boolean | null;
  liveClockPeriod?: string | null;
  liveClockUpdatedAt?: Date | null;
  homeScore?: number | null;
  awayScore?: number | null;
  postGameNotes?: string | null;
  summary?: string | null;
  practiceFeedItems?: Array<{
    weakness: string;
    evidence: string;
    drillCategory: string;
    urgency: string;
    addedAt: string;
  }>;
  canUpdateScore?: boolean;
  isHome?: boolean | null;
  kitColor?: string | null;
  arrivalTime?: Date | null;
  notes?: string | null;
  seasonLabel?: string | null;
  competitionType?: string | null;
  countsTowardSeasonRecord?: boolean | null;
  tournament?: Record<string, any> | null;
  statTrackerConfigId?: string | null;
  sourceType?: ScheduleSourceType | string | null;
  sourceLabel?: string | null;
  isImported?: boolean;
  visibility?: string | null;
  myRsvp?: RsvpResponse;
  myRsvpNote?: string | null;
  rsvpSummary?: ScheduleRsvpSummary | null;
  rideshareSummary?: ScheduleRideSummary | null;
  assignments: ScheduleAssignment[];
  openAssignmentCount: number;
  availabilityLocked?: boolean;
  availabilityCutoffLabel?: string;
  availabilityPreferences?: Record<string, unknown> | null;
  availabilityNoteVisibility?: string | null;
  availabilityNotesVisible?: boolean;
  availabilityNotes?: Array<{ displayName: string; response: string; note: string }>;
  practiceAttendanceSummary?: string | null;
  practiceHomePacketSummary?: string | null;
  practiceSessionId?: string | null;
  practiceHomePacket?: PracticeHomePacket | null;
  practicePacketCompletions?: PracticePacketCompletion[];
  isTeamAdmin?: boolean;
  isTeamStaff?: boolean;
  isTeamRsvpReminderManager?: boolean;
  calendarUrls?: string[];
  gamePlan?: {
    lineups?: Record<string, string>;
    formationId?: string | null;
    numPeriods?: number | null;
    isPublished?: boolean;
    publishedAt?: Date | null;
    publishedBy?: string | null;
    publishedByName?: string | null;
    publishedVersion?: number;
    publishedFormationId?: string | null;
    publishedNumPeriods?: number | null;
    publishedLineups?: Record<string, string>;
    publishedRecipientPlayerIds?: string[];
    publishedRecipientParentIds?: string[];
    publishedReadBy?: string[];
  } | null;
  rotationPlan?: Record<string, any> | null;
  rotationActual?: Record<string, any> | null;
  coachingNotes?: Array<{
    text: string;
    type?: string;
    period?: string | null;
    createdAt?: Date | string | null;
  }>;
  liveEvents?: Array<{
    id?: string;
    eventId?: string;
    type?: string;
    period?: string | null;
    description?: string;
    playerName?: string;
    stat?: string;
    createdAt?: Date | string | number | null;
  }>;
};

export type CalendarScheduleEntry = ParentScheduleEvent & {
  childIds: string[];
  childNames: string[];
  childRsvps: Array<{ childId: string; childName: string; myRsvp: RsvpResponse }>;
};

export type ParentScheduleTeamOption = {
  teamId: string;
  teamName: string;
  playerCount: number;
  eventCount: number;
  calendarUrls: string[];
};

export type PracticePacketScheduleRow = {
  event: ParentScheduleEvent;
  completedChildIds: string[];
  isCompletedForChild: boolean;
  needsAction: boolean;
  status: 'ready' | 'completed' | 'past';
};

export type WindowedCalendarScheduleEntries = {
  entries: CalendarScheduleEntry[];
  totalCount: number;
  gameCount: number;
  practiceCount: number;
  hasMore: boolean;
  nextEvent: CalendarScheduleEntry | null;
  packetsReady: number;
  openAssignments: number;
  rideRequests: number;
};

export type WindowedPracticePacketRows = {
  rows: PracticePacketScheduleRow[];
  totalCount: number;
  readyCount: number;
  hasMore: boolean;
};

export type ParentScheduleFilterOptions = {
  filter: ParentScheduleFilter;
  playerId?: string;
  teamId?: string;
  timeRange?: ScheduleTimeRange;
  now?: Date;
};


export function validateExternalCalendarUrl(value: unknown) {
  const normalizedUrl = String(value || '').trim();
  if (!normalizedUrl) {
    return { valid: false, url: '', error: 'Enter a calendar .ics URL.' };
  }
  if (!normalizedUrl.toLowerCase().includes('.ics')) {
    return { valid: false, url: '', error: 'Calendar URL must be an .ics link.' };
  }
  return { valid: true, url: normalizedUrl, error: null };
}

export function normalizeScheduleDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof (value as { toDate?: unknown }).toDate === 'function') {
    const date = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof (value as { seconds?: unknown }).seconds === 'number') {
    const date = new Date((value as { seconds: number }).seconds * 1000);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(value as string | number);
  return Number.isNaN(date.getTime()) ? null : date;
}


export type LiveClockViewModel = {
  visible: boolean;
  label: string;
  period: string;
  clock: string;
};

const LIVE_CLOCK_RECENT_MS = 10 * 60 * 1000;

function normalizeLiveClockMs(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.floor(parsed);
}

function formatLiveClockMs(clockMs: number) {
  const totalSeconds = Math.max(0, Math.floor(clockMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function getLiveClockViewModel(event: Pick<ParentScheduleEvent, 'type' | 'liveStatus' | 'liveClockMs' | 'liveClockRunning' | 'liveClockPeriod' | 'liveClockUpdatedAt'>, now: Date = new Date()): LiveClockViewModel | null {
  if (event.type !== 'game') return null;
  const clockMs = normalizeLiveClockMs(event.liveClockMs);
  const period = String(event.liveClockPeriod || '').trim();
  const hasClockData = clockMs !== null;
  const isLive = String(event.liveStatus || '').toLowerCase() === 'live';
  if (!hasClockData && !period) return null;

  let displayClockMs = clockMs ?? 0;
  const updatedAtMs = event.liveClockUpdatedAt instanceof Date ? event.liveClockUpdatedAt.getTime() : NaN;
  const nowMs = now.getTime();
  const elapsedMs = nowMs - updatedAtMs;
  if (event.liveClockRunning === true && Number.isFinite(elapsedMs) && elapsedMs >= 0 && elapsedMs <= LIVE_CLOCK_RECENT_MS) {
    displayClockMs += elapsedMs;
  }

  const clock = formatLiveClockMs(displayClockMs);
  const parts = [period, hasClockData ? clock : ''].filter(Boolean);
  if (!parts.length) return null;
  return {
    visible: true,
    period,
    clock: hasClockData ? clock : '',
    label: `${isLive ? 'LIVE · ' : ''}${parts.join(' · ')}`
  };
}

export function formatEventDateLabel(date: Date) {
  return formatShortDate(date);
}

export function formatEventTimeLabel(date: Date) {
  return formatTimeOfDay(date);
}

export function getScheduleTitle(event: Pick<ParentScheduleEvent, 'type' | 'title' | 'opponent'>) {
  if (event.type === 'practice') {
    return event.title || 'Practice';
  }
  return `vs. ${event.opponent || 'TBD'}`;
}

export function normalizeRsvpResponse(response: unknown): RsvpResponse {
  const value = String(response || '').trim().toLowerCase();
  if (value === 'going' || value === 'maybe' || value === 'not_going') return value;
  return 'not_responded';
}

function compactString(value: unknown) {
  return String(value || '').trim();
}

function compactFirst(values: unknown[]) {
  return values.map(compactString).find(Boolean) || '';
}

export function uniqueNonEmptyStrings(values: unknown[]) {
  return [...new Set(values.map(compactString).filter(Boolean))];
}

function getObjectValue(value: unknown): Record<string, any> {
  return value && typeof value === 'object' ? value as Record<string, any> : {};
}

function normalizePositiveInteger(value: unknown) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function getTournamentPoolLabel(source: Record<string, any> = {}, context: Record<string, any> = {}) {
  const divisionName = compactFirst([
    source.divisionName,
    source.division,
    context.divisionName,
    context.division
  ]);
  const poolName = compactFirst([source.poolName, context.poolName]);
  if (divisionName && poolName) return `${divisionName} / ${poolName}`;
  return poolName || divisionName;
}

function describeScheduleTournamentSource(sourceInput: unknown, contextInput: unknown = {}) {
  const source = getObjectValue(sourceInput);
  const context = getObjectValue(contextInput);
  const sourceType = compactString(source.sourceType).toLowerCase() || 'team';

  if (sourceType === 'pool_seed' || sourceType === 'poolseed') {
    const poolName = getTournamentPoolLabel(source, context) || 'Pool';
    const seed = normalizePositiveInteger(source.seed);
    return seed ? `${poolName} #${seed}` : poolName;
  }

  if (sourceType === 'game_result') {
    const outcome = compactString(source.outcome).toLowerCase() === 'loser' ? 'Loser' : 'Winner';
    const gameId = compactFirst([source.gameId, source.sourceRef, source.ref]);
    return `${outcome} ${gameId || 'game'}`;
  }

  if (sourceType === 'winner' || sourceType === 'loser') {
    const gameId = compactFirst([source.gameId, source.sourceRef, source.ref]);
    return `${sourceType === 'loser' ? 'Loser' : 'Winner'} ${gameId || 'game'}`;
  }

  if (sourceType === 'seed') {
    const teamName = compactFirst([source.teamName, source.name]);
    if (teamName) return teamName;
    const seed = normalizePositiveInteger(source.seed);
    return seed ? `Seed #${seed}` : 'Seed';
  }

  return compactFirst([source.teamName, source.label, source.name]);
}

function getScheduleTournamentMatchupLabel(tournament: Record<string, any>) {
  const resolved = getObjectValue(tournament.resolved);
  const matchupLabel = compactString(resolved.matchupLabel);
  if (matchupLabel) return matchupLabel;

  const slotAssignments = getObjectValue(tournament.slotAssignments);
  const homeLabel = compactFirst([
    resolved.homeLabel,
    resolved.homeTeamName,
    describeScheduleTournamentSource(slotAssignments.home, tournament)
  ]);
  const awayLabel = compactFirst([
    resolved.awayLabel,
    resolved.awayTeamName,
    describeScheduleTournamentSource(slotAssignments.away, tournament)
  ]);

  if (homeLabel && awayLabel) return `${homeLabel} vs ${awayLabel}`;
  return homeLabel || awayLabel;
}

function getScheduleTournamentPositionLabel(tournament: Record<string, any>) {
  const gameNumber = normalizePositiveInteger(tournament.gameNumber);
  const positionParts = uniqueNonEmptyStrings([
    tournament.gameLabel,
    tournament.bracketGameLabel,
    gameNumber ? `Game ${gameNumber}` : '',
    tournament.bracketGameId,
    tournament.bracketPosition,
    tournament.position
  ]);
  return positionParts.join(' / ');
}

function normalizeTournamentStandingRow(rowInput: unknown, index: number): ScheduleTournamentStandingRow | null {
  const row = getObjectValue(rowInput);
  const teamName = compactFirst([row.teamName, row.team, row.name, typeof rowInput === 'string' ? rowInput : '']);
  if (!teamName) return null;

  const rank = compactFirst([row.displayRank, row.rank, row.seed]) || String(index + 1);
  const wins = Number(row.wins ?? row.win);
  const losses = Number(row.losses ?? row.loss);
  const ties = Number(row.ties ?? row.tie);
  const hasRecordParts = Number.isFinite(wins) && Number.isFinite(losses);
  const record = compactString(row.record) || (hasRecordParts
    ? `${wins}-${losses}${Number.isFinite(ties) && ties > 0 ? `-${ties}` : ''}`
    : '');
  const points = Number(row.points);

  return {
    rank,
    teamName,
    record,
    points: Number.isFinite(points) ? points : null
  };
}

function normalizeTournamentStandingInfo(value: unknown, fallbackGroupName: string): ScheduleTournamentStandingInfo | null {
  const group = getObjectValue(value);
  const rowSource = Array.isArray(value)
    ? value
    : Array.isArray(group.rows)
      ? group.rows
      : Array.isArray(group.computedRows)
        ? group.computedRows
        : Array.isArray(group.standings)
          ? group.standings
          : [];
  const rows = rowSource
    .map((row, index) => normalizeTournamentStandingRow(row, index))
    .filter(Boolean) as ScheduleTournamentStandingRow[];

  if (!rows.length) return null;

  const groupName = compactFirst([
    group.poolName,
    group.groupName,
    group.name,
    group.label,
    fallbackGroupName
  ]) || 'Tournament standings';
  const override = getObjectValue(group.override);
  const isOverridden = group.isOverridden === true || Object.keys(override).length > 0;
  const note = isOverridden
    ? 'Final ranking'
    : group.unresolvedTie
      ? 'Tie unresolved'
      : compactString(group.note);

  return {
    groupName,
    rows,
    isOverridden,
    note
  };
}

function getTournamentStandingCandidates(source: unknown, fallbackGroupName: string, poolName: string) {
  if (!source) return [];
  if (Array.isArray(source)) return [{ value: source, fallbackGroupName }];
  const sourceObject = getObjectValue(source);
  if (Array.isArray(sourceObject.rows) || Array.isArray(sourceObject.computedRows) || Array.isArray(sourceObject.standings)) {
    return [{ value: sourceObject, fallbackGroupName }];
  }

  const values = Object.entries(sourceObject).map(([key, value]) => ({
    key,
    value,
    objectValue: getObjectValue(value)
  }));
  const normalizedFallback = compactString(fallbackGroupName).toLowerCase();
  const normalizedPool = compactString(poolName).toLowerCase();
  const preferred = values.find(({ key, objectValue }) => {
    const names = [
      key,
      objectValue.poolName,
      objectValue.groupName,
      objectValue.name,
      objectValue.label
    ].map((item) => compactString(item).toLowerCase()).filter(Boolean);
    return names.includes(normalizedFallback) || (normalizedPool && names.includes(normalizedPool));
  });

  const toCandidate = (item: { key: string; value: unknown; objectValue: Record<string, any> }) => ({
    value: item.value,
    fallbackGroupName: compactFirst([
      item.objectValue.poolName,
      item.objectValue.groupName,
      item.objectValue.name,
      item.objectValue.label,
      item.key,
      fallbackGroupName
    ])
  });

  return preferred
    ? [toCandidate(preferred), ...values.filter((item) => item.value !== preferred.value).map(toCandidate)]
    : values.map(toCandidate);
}

function getScheduleTournamentStandingInfo(event: Record<string, any>, tournament: Record<string, any>, fallbackGroupName: string, poolName: string) {
  const sources = [
    tournament.standings,
    tournament.poolStandings,
    tournament.standingRows,
    tournament.standingsRows,
    event.tournamentStandings,
    event.poolStandings,
    event.standings
  ];

  for (const source of sources) {
    const candidates = getTournamentStandingCandidates(source, fallbackGroupName, poolName);
    for (const candidate of candidates) {
      const standings = normalizeTournamentStandingInfo(candidate.value, candidate.fallbackGroupName);
      if (standings) return standings;
    }
  }

  return null;
}

function uniqueEligibleEmails(values: unknown[]) {
  return uniqueNonEmptyStrings(values).filter((email) => email.includes('@'));
}

function getRsvpPlayerIds(rsvp: any) {
  const playerIds = Array.isArray(rsvp?.playerIds) ? rsvp.playerIds : [];
  return uniqueNonEmptyStrings([...playerIds, rsvp?.playerId, rsvp?.childId]);
}

function getPlayerRosterParents(player: any) {
  const privateParents = Array.isArray(player?.privateProfileParents) ? player.privateProfileParents : [];
  if (privateParents.length > 0) return privateParents;
  return Array.isArray(player?.parents) ? player.parents : [];
}

export function getPlayerParentUserIds(player: any) {
  return uniqueNonEmptyStrings([
    ...getPlayerRosterParents(player).map((parent: any) => parent?.userId),
    player?.parentUserId,
    player?.guardianUserId
  ]);
}

function getPlayerParentEmails(player: any) {
  return uniqueEligibleEmails([
    ...getPlayerRosterParents(player).map((parent: any) => parent?.email),
    player?.parentEmail,
    player?.guardianEmail
  ]);
}

export function buildStaffRsvpReminderPreview(players: any[] = [], rsvps: any[] = []): StaffRsvpReminderPreview {
  const activePlayers = (Array.isArray(players) ? players : [])
    .filter((player) => player?.active !== false && compactString(player?.id));
  const playerIdsByParentUserId = new Map<string, string[]>();
  activePlayers.forEach((player) => {
    getPlayerParentUserIds(player).forEach((userId) => {
      playerIdsByParentUserId.set(userId, [...(playerIdsByParentUserId.get(userId) || []), compactString(player.id)]);
    });
  });

  const respondedPlayerIds = new Set<string>();
  (Array.isArray(rsvps) ? rsvps : []).forEach((rsvp) => {
    if (normalizeRsvpResponse(rsvp?.response) === 'not_responded') return;
    const explicitPlayerIds = getRsvpPlayerIds(rsvp);
    const fallbackPlayerIds = explicitPlayerIds.length ? [] : (playerIdsByParentUserId.get(compactString(rsvp?.userId)) || []);
    [...explicitPlayerIds, ...fallbackPlayerIds].forEach((playerId) => respondedPlayerIds.add(playerId));
  });

  const previewPlayers = activePlayers
    .filter((player) => !respondedPlayerIds.has(compactString(player.id)))
    .map((player) => {
      const parentEmails = getPlayerParentEmails(player);
      return {
        playerId: compactString(player.id),
        playerName: compactString(player.name) || compactString(player.displayName) || `#${compactString(player.number)}`.trim() || 'Unknown Player',
        playerNumber: player.number || null,
        parentEmails,
        hasEligibleParentEmail: parentEmails.length > 0
      };
    });
  const eligibleEmails = uniqueEligibleEmails(previewPlayers.flatMap((player) => player.parentEmails));

  return {
    missingPlayerCount: previewPlayers.length,
    eligibleEmailCount: eligibleEmails.length,
    eligibleEmails,
    players: previewPlayers
  };
}

export function buildStaffRsvpReminderMessage({
  eventType,
  title,
  dateLabel,
  missingCount
}: {
  eventType?: string | null;
  title?: string | null;
  dateLabel?: string | null;
  missingCount?: number | null;
}) {
  const typeLabel = String(eventType || '').toLowerCase() === 'practice' ? 'Practice' : 'Game';
  return [
    `RSVP reminder: ${typeLabel}`,
    `${typeLabel}: ${title || 'Untitled event'}`,
    dateLabel ? `When: ${dateLabel}` : '',
    `${Number.parseInt(String(missingCount || 0), 10) || 0} player(s) still have not responded.`
  ].filter(Boolean).join('\n');
}

export function resolveStaffRsvpReminderEmailSentCount(sentCount: unknown, fallbackCount: unknown) {
  const parsedSentCount = Number(sentCount);
  if (sentCount !== null && sentCount !== undefined && Number.isFinite(parsedSentCount)) {
    return Math.max(0, parsedSentCount);
  }

  const parsedFallbackCount = Number(fallbackCount);
  return Number.isFinite(parsedFallbackCount) ? Math.max(0, parsedFallbackCount) : 0;
}

export function getStaffRsvpReminderMetadataTarget(eventId: string) {
  const normalizedEventId = String(eventId || '').trim();
  const [persistedEventId, occurrenceKey] = normalizedEventId.includes('__')
    ? normalizedEventId.split(/__(.+)/).filter(Boolean)
    : [normalizedEventId, ''];

  return {
    persistedEventId: persistedEventId || normalizedEventId,
    occurrenceKey: String(occurrenceKey || '').replace(/[^A-Za-z0-9_-]/g, '_')
  };
}

function normalizeNonNegativeCount(value: unknown) {
  return Math.max(0, Number.parseInt(String(value || 0), 10) || 0);
}

export function buildStaffRsvpReminderMetadata(
  userId: string | null | undefined,
  missingCount: number,
  emailCount: number,
  sentAt = new Date().toISOString(),
  pushMetrics: {
    rsvpPushSuccessCount?: unknown;
    rsvpPushFailureCount?: unknown;
    rsvpPushTargetCount?: unknown;
    rsvpPushError?: unknown;
  } = {}
) {
  return {
    sent: true,
    sentAt,
    lastAction: 'rsvp_reminder',
    lastSentAt: sentAt,
    lastSentBy: userId || null,
    lastRsvpReminderCount: normalizeNonNegativeCount(missingCount),
    lastRsvpEmailCount: normalizeNonNegativeCount(emailCount),
    lastRsvpPushSuccessCount: normalizeNonNegativeCount(pushMetrics.rsvpPushSuccessCount),
    lastRsvpPushFailureCount: normalizeNonNegativeCount(pushMetrics.rsvpPushFailureCount),
    lastRsvpPushTargetCount: normalizeNonNegativeCount(pushMetrics.rsvpPushTargetCount),
    lastRsvpPushError: compactString(pushMetrics.rsvpPushError) || null
  };
}

export function normalizeScheduleAssignment(assignment: Partial<ScheduleAssignment> = {}): ScheduleAssignment {
  return {
    ...assignment,
    role: String(assignment.role || '').trim(),
    value: String(assignment.value || '').trim(),
    claimable: assignment.claimable === true,
    claim: assignment.claim || null
  };
}

export function isScheduleAssignmentOpen(assignment: Partial<ScheduleAssignment>) {
  const normalized = normalizeScheduleAssignment(assignment);
  return Boolean(normalized.claimable && normalized.role && !normalized.value && !normalized.claim?.claimedByUserId);
}

export function isScheduleAssignmentClaimedByUser(assignment: Partial<ScheduleAssignment>, userId: string) {
  const normalized = normalizeScheduleAssignment(assignment);
  return Boolean(userId && normalized.claim?.claimedByUserId === userId);
}

export function getOpenScheduleAssignments(assignments: Array<Partial<ScheduleAssignment>> = []) {
  return (Array.isArray(assignments) ? assignments : [])
    .map((assignment) => normalizeScheduleAssignment(assignment))
    .filter(isScheduleAssignmentOpen);
}

export function countOpenScheduleAssignments(assignments: Array<Partial<ScheduleAssignment>> = []) {
  return getOpenScheduleAssignments(assignments).length;
}

export function getEventOpenAssignmentCount(event: Pick<ParentScheduleEvent, 'openAssignmentCount' | 'assignments'> | Pick<CalendarScheduleEntry, 'openAssignmentCount' | 'assignments'>) {
  return Number.isFinite(event.openAssignmentCount)
    ? Math.max(0, Number(event.openAssignmentCount))
    : countOpenScheduleAssignments(event.assignments);
}

export function getScheduleTaskDetailSection(event: Pick<ParentScheduleEvent, 'type' | 'practiceHomePacketSummary' | 'assignments' | 'openAssignmentCount' | 'rideshareSummary' | 'isDbGame' | 'isCancelled' | 'myRsvp'>): ScheduleEventDetailSection | '' {
  if (event.type === 'game' && event.isDbGame && !event.isCancelled && normalizeRsvpResponse(event.myRsvp) === 'not_responded') return 'availability';
  // Practice packets render in the shared game/report tab inside ScheduleEventDetail.
  if (event.type === 'practice' && event.practiceHomePacketSummary) return PRACTICE_PACKET_DETAIL_SECTION;
  if (getEventOpenAssignmentCount(event) > 0) return 'assignments';
  const rideSummary = event.rideshareSummary;
  if (rideSummary && (rideSummary.requests > 0 || rideSummary.pending > 0 || rideSummary.seatsLeft > 0)) return 'rideshare';
  return '';
}

export function getScheduleEventDetailPath(
  event: Pick<ParentScheduleEvent, 'teamId' | 'id' | 'childId'>,
  section: ScheduleEventDetailSection | '' = ''
) {
  const params = new URLSearchParams();
  if (event.childId) params.set('childId', event.childId);
  if (section) params.set('section', section);
  const query = params.toString();
  return `/schedule/${encodeURIComponent(event.teamId)}/${encodeURIComponent(event.id)}${query ? `?${query}` : ''}`;
}

function getTaskTargetedEventDetailPath(event: ParentScheduleEvent | CalendarScheduleEntry) {
  return getScheduleEventDetailPath(event, getScheduleTaskDetailSection(event));
}

function hasStaffGameHubAccess(event: Pick<ParentScheduleEvent, 'isTeamStaff' | 'isTeamAdmin' | 'canUpdateScore'>) {
  return event.isTeamStaff === true || event.isTeamAdmin === true || event.canUpdateScore === true;
}

export function getGenericEventDetailPath(
  event: ParentScheduleEvent | CalendarScheduleEntry,
  preferGameHubForStaff = false
) {
  if (preferGameHubForStaff && hasStaffGameHubAccess(event)) {
    return getScheduleEventDetailPath(event, 'game');
  }
  return getTaskTargetedEventDetailPath(event);
}

export function getScheduleTournamentInfo(
  event: Pick<ParentScheduleEvent, 'competitionType' | 'tournament'> & Record<string, any>
): ScheduleTournamentInfo {
  const tournament = event?.tournament && typeof event.tournament === 'object' ? event.tournament : {};
  const isTournament = String(event?.competitionType || '').trim().toLowerCase() === 'tournament'
    || Object.keys(tournament).length > 0;

  if (!isTournament) {
    return {
      isTournament: false,
      label: '',
      details: '',
      divisionName: '',
      bracketName: '',
      roundName: '',
      poolName: '',
      matchupLabel: '',
      positionLabel: '',
      standings: null
    };
  }

  const divisionName = compactFirst([tournament.divisionName, tournament.division, event.divisionName, event.division]);
  const bracketName = compactFirst([tournament.bracketName, tournament.bracket, tournament.groupName, event.bracketName, event.bracket]);
  const roundName = compactFirst([tournament.roundName, tournament.round, event.roundName, event.round]);
  const poolName = compactFirst([tournament.poolName, tournament.pool, event.poolName, event.pool]);
  const labelParts = [divisionName, bracketName, roundName || poolName].filter(Boolean);
  const groupName = getTournamentPoolLabel(tournament, tournament) || labelParts.join(' / ');
  const matchupLabel = getScheduleTournamentMatchupLabel(tournament);
  const positionLabel = getScheduleTournamentPositionLabel(tournament);
  const detailParts = [
    poolName && roundName ? `Pool: ${poolName}` : poolName,
    positionLabel,
    tournament.seedLabel,
    matchupLabel && !compactString(tournament.gameLabel) ? matchupLabel : ''
  ].map(compactString).filter(Boolean);
  const standings = getScheduleTournamentStandingInfo(event, tournament, groupName || poolName || divisionName || bracketName, poolName);

  return {
    isTournament: true,
    label: labelParts.join(' / ') || 'Tournament',
    details: detailParts.join(' - '),
    divisionName,
    bracketName,
    roundName,
    poolName,
    matchupLabel,
    positionLabel,
    standings
  };
}

export function getScheduleAssignmentStatus(assignment: Partial<ScheduleAssignment>, userId = '') {
  const normalized = normalizeScheduleAssignment(assignment);
  if (!normalized.role && !normalized.value) return 'None posted';
  if (!normalized.claimable) return normalized.value || 'TBD';
  if (isScheduleAssignmentClaimedByUser(normalized, userId)) return 'You';
  if (normalized.claim?.claimedByName) return normalized.claim.claimedByName;
  if (normalized.claim?.claimedByUserId) return 'Taken';
  return 'Open';
}

export function normalizeRideOfferStatus(status: unknown): RideOfferStatus {
  const value = String(status || '').trim().toLowerCase();
  if (value === 'closed' || value === 'cancelled') return value;
  return 'open';
}

export function normalizeRideOfferDirection(direction: unknown): RideOfferDirection {
  const value = String(direction || '').trim().toLowerCase();
  if (value === 'from' || value === 'round-trip') return value;
  return 'to';
}

export function normalizeRideRequestStatus(status: unknown): RideRequestStatus {
  const value = String(status || '').trim().toLowerCase();
  if (value === 'confirmed' || value === 'waitlisted' || value === 'declined') return value;
  return 'pending';
}

function toNonNegativeInteger(value: unknown) {
  const parsed = Number.parseInt(String(value ?? 0), 10);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

export function normalizeScheduleRideOffer(offer: Partial<ScheduleRideOffer> & Record<string, any>): ScheduleRideOffer {
  const requests = Array.isArray(offer?.requests) ? offer.requests : [];
  return {
    ...offer,
    id: String(offer?.id || ''),
    sourceGameId: offer?.sourceGameId ? String(offer.sourceGameId) : undefined,
    driverUserId: offer?.driverUserId ? String(offer.driverUserId) : undefined,
    driverName: offer?.driverName ? String(offer.driverName) : null,
    seatCapacity: toNonNegativeInteger(offer?.seatCapacity),
    seatCountConfirmed: toNonNegativeInteger(offer?.seatCountConfirmed),
    direction: normalizeRideOfferDirection(offer?.direction),
    note: offer?.note ? String(offer.note) : null,
    status: normalizeRideOfferStatus(offer?.status),
    requests: requests.map((request: any) => ({
      ...request,
      id: String(request?.id || ''),
      parentUserId: request?.parentUserId ? String(request.parentUserId) : undefined,
      childId: request?.childId ? String(request.childId) : undefined,
      childName: request?.childName ? String(request.childName) : null,
      status: normalizeRideRequestStatus(request?.status)
    }))
  };
}

export function getScheduleRideSeatInfo(offer: Partial<ScheduleRideOffer>) {
  const normalized = normalizeScheduleRideOffer(offer as ScheduleRideOffer);
  const seatsLeft = Math.max(0, normalized.seatCapacity - normalized.seatCountConfirmed);
  return {
    seatCapacity: normalized.seatCapacity,
    seatCountConfirmed: normalized.seatCountConfirmed,
    seatsLeft,
    isFull: normalized.status !== 'open' || seatsLeft === 0
  };
}

export function getScheduleRideRequestCounts(offer: Partial<ScheduleRideOffer>) {
  const normalized = normalizeScheduleRideOffer(offer as ScheduleRideOffer);
  return normalized.requests.reduce((acc, request) => {
    const status = normalizeRideRequestStatus(request.status);
    if (status === 'confirmed') acc.confirmed += 1;
    else if (status === 'waitlisted') acc.waitlisted += 1;
    else if (status === 'declined') acc.declined += 1;
    else acc.pending += 1;
    return acc;
  }, { pending: 0, confirmed: 0, waitlisted: 0, declined: 0 });
}

export function getScheduleRideshareSummary(offers: Array<Partial<ScheduleRideOffer>> = []): ScheduleRideSummary {
  const openOffers = (Array.isArray(offers) ? offers : [])
    .map((offer) => normalizeScheduleRideOffer(offer as ScheduleRideOffer))
    .filter((offer) => offer.status === 'open');

  const totals = openOffers.reduce((acc, offer) => {
    const seatInfo = getScheduleRideSeatInfo(offer);
    const requestCounts = getScheduleRideRequestCounts(offer);
    acc.seatsLeft += seatInfo.seatsLeft;
    acc.requests += offer.requests.length;
    acc.pending += requestCounts.pending;
    acc.confirmed += requestCounts.confirmed;
    return acc;
  }, { seatsLeft: 0, requests: 0, pending: 0, confirmed: 0 });

  return {
    offerCount: openOffers.length,
    seatsLeft: totals.seatsLeft,
    requests: totals.requests,
    pending: totals.pending,
    confirmed: totals.confirmed,
    isFull: openOffers.length > 0 && totals.seatsLeft === 0
  };
}

export function findScheduleRideRequestForChild(offer: Partial<ScheduleRideOffer>, parentUserId: string, childId: string) {
  if (!parentUserId || !childId) return null;
  const normalized = normalizeScheduleRideOffer(offer as ScheduleRideOffer);
  return normalized.requests.find((request) =>
    request.parentUserId === parentUserId && request.childId === childId
  ) || null;
}

export function canRequestScheduleRide(offer: Partial<ScheduleRideOffer>, parentUserId: string, childId: string) {
  const normalized = normalizeScheduleRideOffer(offer as ScheduleRideOffer);
  if (normalized.status !== 'open') return false;
  if (!parentUserId || !childId) return false;
  if (normalized.driverUserId === parentUserId) return false;
  const existing = findScheduleRideRequestForChild(normalized, parentUserId, childId);
  if (existing?.status === 'pending' || existing?.status === 'confirmed') return false;
  return getScheduleRideSeatInfo(normalized).seatsLeft > 0;
}

export function getNextRideConfirmedSeatCount(currentSeatCount: number, currentStatus: unknown, nextStatus: unknown) {
  let nextCount = toNonNegativeInteger(currentSeatCount);
  if (normalizeRideRequestStatus(currentStatus) === 'confirmed') {
    nextCount -= 1;
  }
  if (normalizeRideRequestStatus(nextStatus) === 'confirmed') {
    nextCount += 1;
  }
  return Math.max(0, nextCount);
}

export function formatRideDirection(direction: unknown) {
  const normalized = normalizeRideOfferDirection(direction);
  if (normalized === 'from') return 'From event';
  if (normalized === 'round-trip') return 'Round trip';
  return 'To event';
}

function isCompletedScheduleEvent(event: Pick<ParentScheduleEvent, 'status' | 'liveStatus'>) {
  const status = String(event.status || '').toLowerCase();
  const liveStatus = String(event.liveStatus || '').toLowerCase();
  return status === 'completed' || status === 'final' || liveStatus === 'completed' || liveStatus === 'final';
}

export function filterParentScheduleEvents(
  events: ParentScheduleEvent[],
  options: ParentScheduleFilterOptions
) {
  const now = options.now || new Date();
  const cutoff = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  const selectedPlayerId = String(options.playerId || '').trim();
  const selectedTeamId = String(options.teamId || '').trim();
  const filter = options.filter || 'upcoming-all';
  let visible = selectedPlayerId
    ? events.filter((event) => event.childId === selectedPlayerId)
    : [...events];

  if (selectedTeamId) {
    visible = visible.filter((event) => event.teamId === selectedTeamId);
  }

  const range = options.timeRange || 'all';
  const applyRange = (eventList: ParentScheduleEvent[], direction: 'future' | 'past') => {
    if (range === 'all') return eventList;
    const rangeDays = range === 'week' ? 7 : range === 'month' ? 31 : 92;
    const rangeMs = rangeDays * 24 * 60 * 60 * 1000;
    if (direction === 'past') {
      const start = new Date(now.getTime() - rangeMs);
      return eventList.filter((event) => event.date >= start);
    }
    const end = new Date(now.getTime() + rangeMs);
    return eventList.filter((event) => event.date <= end);
  };

  if (filter === 'upcoming-games') {
    visible = applyRange(visible.filter((event) => event.type === 'game' && event.date >= cutoff && !isCompletedScheduleEvent(event)), 'future');
    return visible.sort((a, b) => a.date.getTime() - b.date.getTime());
  }

  if (filter === 'upcoming-practices') {
    visible = applyRange(visible.filter((event) => event.type === 'practice' && event.date >= cutoff && !isCompletedScheduleEvent(event)), 'future');
    return visible.sort((a, b) => a.date.getTime() - b.date.getTime());
  }

  if (filter === 'availability') {
    visible = applyRange(visible.filter((event) => event.isDbGame && !event.isCancelled && event.date >= cutoff && !isCompletedScheduleEvent(event)), 'future');
    return visible.sort((a, b) => {
      const aNeeds = normalizeRsvpResponse(a.myRsvp) === 'not_responded' ? 0 : 1;
      const bNeeds = normalizeRsvpResponse(b.myRsvp) === 'not_responded' ? 0 : 1;
      if (aNeeds !== bNeeds) return aNeeds - bNeeds;
      return a.date.getTime() - b.date.getTime();
    });
  }

  if (filter === 'recent-results') {
    visible = applyRange(visible.filter((event) => (
      event.type === 'game' &&
      (
        event.date < cutoff ||
        isCompletedScheduleEvent(event)
      )
    )), 'past');
    return visible.sort((a, b) => b.date.getTime() - a.date.getTime());
  }

  if (filter === 'past-all') {
    visible = applyRange(visible.filter((event) => event.date < cutoff), 'past');
    return visible.sort((a, b) => b.date.getTime() - a.date.getTime());
  }

  visible = applyRange(visible.filter((event) => event.date >= cutoff && !isCompletedScheduleEvent(event)), 'future');
  return visible.sort((a, b) => a.date.getTime() - b.date.getTime());
}

export function getParentScheduleTeamOptions(
  events: ParentScheduleEvent[],
  children: Array<{ teamId?: string; teamName?: string }> = []
): ParentScheduleTeamOption[] {
  const byTeam = new Map<string, ParentScheduleTeamOption>();
  const playerIdsByTeam = new Map<string, Set<string>>();

  const ensureTeam = (teamId: string, teamName?: string) => {
    const normalizedTeamId = String(teamId || '').trim();
    if (!normalizedTeamId) return null;
    if (!byTeam.has(normalizedTeamId)) {
      byTeam.set(normalizedTeamId, {
        teamId: normalizedTeamId,
        teamName: String(teamName || normalizedTeamId).trim() || normalizedTeamId,
        playerCount: 0,
        eventCount: 0,
        calendarUrls: []
      });
      playerIdsByTeam.set(normalizedTeamId, new Set());
    }
    return byTeam.get(normalizedTeamId) || null;
  };

  children.forEach((child: any) => {
    const option = ensureTeam(child.teamId, child.teamName);
    const playerId = String(child.playerId || '').trim();
    if (option && playerId) {
      playerIdsByTeam.get(option.teamId)?.add(playerId);
    }
  });

  events.forEach((event) => {
    const option = ensureTeam(event.teamId, event.teamName);
    if (!option) return;
    option.eventCount += 1;
    if (Array.isArray(event.calendarUrls) && event.calendarUrls.length > 0 && option.calendarUrls.length === 0) {
      option.calendarUrls = event.calendarUrls.map((url) => String(url || '').trim()).filter(Boolean);
    }
    if (event.childId) {
      playerIdsByTeam.get(option.teamId)?.add(event.childId);
    }
  });

  byTeam.forEach((option) => {
    option.playerCount = playerIdsByTeam.get(option.teamId)?.size || 0;
  });

  return [...byTeam.values()].sort((a, b) => a.teamName.localeCompare(b.teamName));
}

export function getPracticePacketRows(events: ParentScheduleEvent[], now = new Date()): PracticePacketScheduleRow[] {
  const cutoff = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  return (Array.isArray(events) ? events : [])
    .filter((event) => event.type === 'practice' && Boolean(event.practiceHomePacketSummary))
    .map((event) => {
      const completedChildIds = (Array.isArray(event.practicePacketCompletions) ? event.practicePacketCompletions : [])
        .filter((completion) => completion.status === 'completed')
        .map((completion) => String(completion.childId || '').trim())
        .filter(Boolean);
      const isCompletedForChild = completedChildIds.includes(event.childId);
      const status: PracticePacketScheduleRow['status'] = isCompletedForChild ? 'completed' : event.date < cutoff ? 'past' : 'ready';
      return {
        event,
        completedChildIds,
        isCompletedForChild,
        needsAction: status === 'ready',
        status
      };
    })
    .sort((a, b) => {
      const statusOrder: Record<PracticePacketScheduleRow['status'], number> = { ready: 0, completed: 1, past: 2 };
      const statusDelta = statusOrder[a.status] - statusOrder[b.status];
      if (statusDelta !== 0) return statusDelta;
      return a.event.date.getTime() - b.event.date.getTime();
    });
}

function normalizeWindowLimit(limit: number) {
  if (!Number.isFinite(limit)) return 0;
  return Math.max(0, Math.floor(limit));
}

function getScheduleEventGroupingKey(event: ParentScheduleEvent) {
  return `${event.teamId}::${event.id}::${event.date.toISOString()}::${event.type}`;
}

function buildPracticePacketRow(event: ParentScheduleEvent, cutoff: Date): PracticePacketScheduleRow {
  const completedChildIds = (Array.isArray(event.practicePacketCompletions) ? event.practicePacketCompletions : [])
    .filter((completion) => completion.status === 'completed')
    .map((completion) => String(completion.childId || '').trim())
    .filter(Boolean);
  const isCompletedForChild = completedChildIds.includes(event.childId);
  const status: PracticePacketScheduleRow['status'] = isCompletedForChild ? 'completed' : event.date < cutoff ? 'past' : 'ready';
  return {
    event,
    completedChildIds,
    isCompletedForChild,
    needsAction: status === 'ready',
    status
  };
}

export function getWindowedPracticePacketRows(events: ParentScheduleEvent[], limit: number, now = new Date()): WindowedPracticePacketRows {
  const normalizedLimit = normalizeWindowLimit(limit);
  const cutoff = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  const packets = (Array.isArray(events) ? events : [])
    .reduce<Array<{ event: ParentScheduleEvent; status: PracticePacketScheduleRow['status']; index: number }>>((packetList, event) => {
      if (event.type !== 'practice' || !event.practiceHomePacketSummary) return packetList;
      const completedChildIds = (Array.isArray(event.practicePacketCompletions) ? event.practicePacketCompletions : [])
        .filter((completion) => completion.status === 'completed')
        .map((completion) => String(completion.childId || '').trim())
        .filter(Boolean);
      const status: PracticePacketScheduleRow['status'] = completedChildIds.includes(event.childId) ? 'completed' : event.date < cutoff ? 'past' : 'ready';
      packetList.push({ event, status, index: packetList.length });
      return packetList;
    }, [])
    .sort((a, b) => {
      const statusOrder: Record<PracticePacketScheduleRow['status'], number> = { ready: 0, completed: 1, past: 2 };
      const statusDelta = statusOrder[a.status] - statusOrder[b.status];
      if (statusDelta !== 0) return statusDelta;
      const dateDelta = a.event.date.getTime() - b.event.date.getTime();
      return dateDelta !== 0 ? dateDelta : a.index - b.index;
    });

  const totalCount = packets.length;
  const readyCount = packets.reduce((count, packet) => count + (packet.status === 'ready' ? 1 : 0), 0);

  return {
    rows: packets.slice(0, normalizedLimit).map((packet) => buildPracticePacketRow(packet.event, cutoff)),
    totalCount,
    readyCount,
    hasMore: totalCount > normalizedLimit
  };
}

export function getCalendarScheduleEntries(events: ParentScheduleEvent[]): CalendarScheduleEntry[] {
  const byKey = new Map<string, CalendarScheduleEntry>();
  events.forEach((event) => {
    const key = getScheduleEventGroupingKey(event);
    if (!byKey.has(key)) {
      byKey.set(key, {
        ...event,
        childIds: [],
        childNames: [],
        childRsvps: []
      });
    }

    const entry = byKey.get(key);
    if (!entry) return;
    if (event.childId && !entry.childIds.includes(event.childId)) {
      entry.childIds.push(event.childId);
    }
    if (event.childName && !entry.childNames.includes(event.childName)) {
      entry.childNames.push(event.childName);
    }
    if (event.childId && !entry.childRsvps.some((child) => child.childId === event.childId)) {
      entry.childRsvps.push({
        childId: event.childId,
        childName: event.childName,
        myRsvp: normalizeRsvpResponse(event.myRsvp)
      });
    }
    entry.openAssignmentCount = getEventOpenAssignmentCount(entry);
  });

  return [...byKey.values()].sort((a, b) => a.date.getTime() - b.date.getTime());
}

export function getWindowedCalendarScheduleEntries(events: ParentScheduleEvent[], limit: number, now = new Date()): WindowedCalendarScheduleEntries {
  const normalizedLimit = normalizeWindowLimit(limit);
  const sourceEvents = Array.isArray(events) ? events : [];
  const packetCutoff = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  const byKey = new Map<string, { key: string; event: ParentScheduleEvent; index: number }>();

  sourceEvents.forEach((event) => {
    const key = getScheduleEventGroupingKey(event);
    if (!byKey.has(key)) {
      byKey.set(key, { key, event, index: byKey.size });
    }
  });

  const sortedGroups = [...byKey.values()].sort((a, b) => {
    const dateDelta = a.event.date.getTime() - b.event.date.getTime();
    return dateDelta !== 0 ? dateDelta : a.index - b.index;
  });
  const totalCount = sortedGroups.length;
  const windowKeys = new Set(sortedGroups.slice(0, normalizedLimit).map((group) => group.key));
  const windowEntries = new Map<string, CalendarScheduleEntry>();
  let nextEvent: CalendarScheduleEntry | null = null;
  let gameCount = 0;
  let practiceCount = 0;
  const packetsReady = sourceEvents.reduce((count, event) => (
    event.type === 'practice' && event.practiceHomePacketSummary && buildPracticePacketRow(event, packetCutoff).needsAction
      ? count + 1
      : count
  ), 0);
  let openAssignments = 0;
  let rideRequests = 0;

  sortedGroups.forEach((group) => {
    if (group.event.type === 'game') gameCount += 1;
    if (group.event.type === 'practice') practiceCount += 1;
    if (!nextEvent && !group.event.isCancelled) {
      nextEvent = {
        ...group.event,
        childIds: [],
        childNames: [],
        childRsvps: []
      };
    }
    openAssignments += getEventOpenAssignmentCount(group.event);
    rideRequests += group.event.rideshareSummary?.requests || 0;
    if (windowKeys.has(group.key)) {
      windowEntries.set(group.key, {
        ...group.event,
        childIds: [],
        childNames: [],
        childRsvps: []
      });
    }
  });

  sourceEvents.forEach((event) => {
    const entry = windowEntries.get(getScheduleEventGroupingKey(event));
    if (!entry) return;
    if (event.childId && !entry.childIds.includes(event.childId)) {
      entry.childIds.push(event.childId);
    }
    if (event.childName && !entry.childNames.includes(event.childName)) {
      entry.childNames.push(event.childName);
    }
    if (event.childId && !entry.childRsvps.some((child) => child.childId === event.childId)) {
      entry.childRsvps.push({
        childId: event.childId,
        childName: event.childName,
        myRsvp: normalizeRsvpResponse(event.myRsvp)
      });
    }
    entry.openAssignmentCount = getEventOpenAssignmentCount(entry);
  });

  return {
    entries: sortedGroups.slice(0, normalizedLimit).map((group) => windowEntries.get(group.key)).filter((entry): entry is CalendarScheduleEntry => Boolean(entry)),
    totalCount,
    gameCount,
    practiceCount,
    hasMore: totalCount > normalizedLimit,
    nextEvent,
    packetsReady,
    openAssignments,
    rideRequests
  };
}

function formatIcsDate(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

function escapeIcsText(value: unknown) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

export function buildScheduleIcs(events: ParentScheduleEvent[], now = new Date()) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ALL PLAYS//EN'];
  const seen = new Set<string>();

  events.forEach((event) => {
    const eventKey = `${event.teamId}-${event.id}-${event.date.getTime()}`;
    if (seen.has(eventKey)) return;
    seen.add(eventKey);

    const endDate = event.endDate && event.endDate > event.date
      ? event.endDate
      : new Date(event.date.getTime() + 60 * 60 * 1000);
    const summary = event.type === 'practice'
      ? `${event.childName} - ${event.title || 'Practice'}`
      : `${event.childName} vs ${event.opponent || 'TBD'}`;
    const uid = `${event.teamId}-${event.id || eventKey}-${event.date.getTime()}@allplays`;
    const description = [
      `For ${event.childName}`,
      event.teamName ? `Team: ${event.teamName}` : '',
      event.myRsvp ? `Availability: ${normalizeRsvpResponse(event.myRsvp)}` : '',
      event.arrivalTime ? `Arrival: ${formatEventTimeLabel(event.arrivalTime)}` : '',
      event.practiceHomePacketSummary ? `Practice packet: ${event.practiceHomePacketSummary}` : '',
      event.sourceLabel ? `Source: ${event.sourceLabel}` : '',
      event.notes || ''
    ].filter(Boolean).join('\n');
    lines.push(
      'BEGIN:VEVENT',
      `UID:${escapeIcsText(uid)}`,
      `DTSTAMP:${formatIcsDate(now)}`,
      `DTSTART:${formatIcsDate(event.date)}`,
      `DTEND:${formatIcsDate(endDate)}`,
      `SUMMARY:${escapeIcsText(summary)}`,
      `LOCATION:${escapeIcsText(event.location || 'TBD')}`,
      `DESCRIPTION:${escapeIcsText(description)}`,
      'END:VEVENT'
    );
  });

  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

export function buildScheduleAgendaText(events: ParentScheduleEvent[]) {
  return getCalendarScheduleEntries(events).map((event) => {
    const childLabel = event.childNames.length ? `For ${event.childNames.join(', ')}` : `For ${event.childName}`;
    return [
      `${formatEventDateLabel(event.date)} ${formatEventTimeLabel(event.date)}`,
      getScheduleTitle(event),
      event.teamName,
      event.location || 'Location TBD',
      childLabel
    ].filter(Boolean).join(' · ');
  }).join('\n');
}

export function getScheduleMapHref(location: string | null | undefined) {
  const normalized = String(location || '').trim();
  if (!normalized || normalized.toLowerCase() === 'tbd') return '';
  const url = new URL('https://www.google.com/maps/search/');
  url.searchParams.set('api', '1');
  url.searchParams.set('query', normalized);
  return url.toString();
}

export function getScheduleForecastHref(location: string | null | undefined, date?: Date | null) {
  const normalizedLocation = String(location || '').trim();
  if (!normalizedLocation || normalizedLocation.toLowerCase() === 'tbd') return '';

  let query = `weather in ${normalizedLocation}`;
  if (date) {
    const formattedDate = formatLongDate(date);
    query += ` on ${formattedDate}`;
  }

  const url = new URL('https://www.google.com/search');
  url.searchParams.set('q', query);
  return url.toString();
}
