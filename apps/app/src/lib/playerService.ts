import {
  getAggregatedStatsForPlayer,
  getGames,
  getPlayerPrivateProfile,
  getPlayerTrackingStatuses,
  getPlayers,
  getPublicTrackingItems,
  getTeam,
  inviteCoParentToAthlete,
  listAthleteProfilesForParent,
  listCertificatesForPlayer,
  saveAthleteProfile,
  updatePlayerProfile,
  uploadPlayerPhoto
} from '../../../../js/db.js';
import {
  calculateEarnings,
  getApplicableRulesForGame,
  getCapSetting,
  getIncentiveRules,
  getPaidGames,
  getStatOptionsForTeam,
  isCurrentRuleVersion,
  markGamePaid,
  retireIncentiveRule,
  saveCapSetting,
  saveIncentiveRule,
  toggleIncentiveRule
} from '../../../../js/parent-incentives.js';
import { buildAthleteProfileShareUrl } from '../../../../js/athlete-profile-utils.js';
import { collectPlayerVideoClips } from '../../../../js/player-profile-stats.js';
import { getVisiblePlayerTrackingSummary } from '../../../../js/player-tracking-summary.js';
import { getOpenScheduleAssignments, normalizeRsvpResponse, type ParentScheduleEvent } from './scheduleLogic';
import { loadParentSchedule, type ParentScheduleChild } from './scheduleService';
import type { AuthUser } from './types';

export type ParentPlayerStatRow = {
  event: ParentScheduleEvent;
  stats: Record<string, unknown>;
};

export type ParentPlayerPrivateProfile = {
  emergencyContact?: {
    name?: string | null;
    phone?: string | null;
  } | null;
  medicalInfo?: string | null;
};

export type ParentPlayerIncentiveData = {
  rules: Array<Record<string, any>>;
  currentRules: Array<Record<string, any>>;
  statOptions: Array<{ key: string; label: string }>;
  maxPerGameCents: number | null;
  seasonGameEarnings: Array<{
    event: ParentScheduleEvent;
    stats: Record<string, unknown>;
    totalCents: number;
    uncappedTotalCents: number;
    wasCapped: boolean;
    breakdown: Array<Record<string, any>>;
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
};

export type ParentPlayerDetailData = {
  child: ParentScheduleChild;
  player: Record<string, any>;
  team: Record<string, any> | null;
  events: ParentScheduleEvent[];
  nextEvent: ParentScheduleEvent | null;
  actionCounts: {
    rsvpNeeded: number;
    packetsReady: number;
    openAssignments: number;
  };
  statRows: ParentPlayerStatRow[];
  clips: Array<Record<string, any>>;
  certificates: Array<Record<string, any>>;
  trackingSummary: Array<Record<string, any>>;
  privateProfile: ParentPlayerPrivateProfile | null;
  incentives: ParentPlayerIncentiveData;
  athleteProfile: ParentAthleteProfileData;
};

export async function loadParentPlayerDetail(user: AuthUser | null, teamId: string, playerId: string): Promise<ParentPlayerDetailData> {
  if (!user?.uid) {
    throw new Error('Player details require a signed-in user.');
  }

  const schedule = await loadParentSchedule(user);
  const child = findLinkedChild(schedule.children, teamId, playerId);
  if (!child) {
    throw new Error('This player is not linked to your account.');
  }

  const resolvedTeamId = child.teamId;
  const resolvedPlayerId = child.playerId;
  const events = schedule.events
    .filter((event) => event.teamId === resolvedTeamId && event.childId === resolvedPlayerId)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  const nextEvent = events.find((event) => !event.isCancelled && event.date.getTime() >= startOfDay(new Date()).getTime()) || null;

  const [
    team,
    players,
    games,
    certificates,
    trackingItems,
    trackingStatuses,
    privateProfile,
    incentiveRules,
    paidGames,
    maxPerGameCents,
    statOptions,
    athleteProfiles
  ] = await Promise.all([
    Promise.resolve(getTeam(resolvedTeamId, { includeInactive: true })).catch(() => null),
    Promise.resolve(getPlayers(resolvedTeamId, { includeInactive: true })).catch(() => []),
    Promise.resolve(getGames(resolvedTeamId)).catch(() => []),
    Promise.resolve(listCertificatesForPlayer(resolvedTeamId, resolvedPlayerId, { status: 'published', limit: 5 })).catch(() => []),
    Promise.resolve(getPublicTrackingItems(resolvedTeamId)).catch(() => []),
    Promise.resolve(getPlayerTrackingStatuses(resolvedTeamId, [resolvedPlayerId])).catch(() => []),
    Promise.resolve(getPlayerPrivateProfile(resolvedTeamId, resolvedPlayerId)).catch(() => null),
    Promise.resolve(getIncentiveRules(user.uid, resolvedPlayerId)).catch(() => []),
    Promise.resolve(getPaidGames(user.uid, resolvedPlayerId)).catch(() => new Map()),
    Promise.resolve(getCapSetting(user.uid, resolvedPlayerId)).catch(() => null),
    Promise.resolve(getStatOptionsForTeam(resolvedTeamId)).catch(() => []),
    Promise.resolve(listAthleteProfilesForParent(user.uid)).catch(() => [])
  ]);

  const playerDoc = (Array.isArray(players) ? players : []).find((candidate: any) => candidate?.id === resolvedPlayerId) || {};
  const completedGameEvents = events
    .filter((event) => event.type === 'game' && event.isDbGame && isPastOrCompleted(event))
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .slice(0, 6);

  const statRows = await Promise.all(completedGameEvents.map(async (event) => ({
    event,
    stats: await Promise.resolve(getAggregatedStatsForPlayer(resolvedTeamId, event.id, resolvedPlayerId)).catch(() => ({})) || {}
  })));

  const clips = collectPlayerVideoClips(Array.isArray(games) ? games : [], {
    teamId: resolvedTeamId,
    playerId: resolvedPlayerId
  }).slice(0, 8);

  const trackingSummary = getVisiblePlayerTrackingSummary({
    items: trackingItems || [],
    statuses: trackingStatuses || [],
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
      number: playerDoc.number || (child as any).playerNumber || null
    },
    team,
    events,
    nextEvent,
    actionCounts: {
      rsvpNeeded: upcoming.filter((event) => event.isDbGame && !event.availabilityLocked && normalizeRsvpResponse(event.myRsvp) === 'not_responded').length,
      packetsReady: upcoming.filter((event) => event.type === 'practice' && event.practiceHomePacketSummary).length,
      openAssignments: upcoming.reduce((total, event) => total + getOpenScheduleAssignments(event.assignments).length, 0)
    },
    statRows,
    clips,
    certificates: Array.isArray(certificates) ? certificates : [],
    trackingSummary,
    privateProfile: normalizePrivateProfile(privateProfile),
    incentives: buildPlayerIncentiveData({
      rules: Array.isArray(incentiveRules) ? incentiveRules : [],
      paidGames: paidGames instanceof Map ? paidGames : new Map(),
      statOptions: Array.isArray(statOptions) ? statOptions : [],
      maxPerGameCents: typeof maxPerGameCents === 'number' ? maxPerGameCents : null,
      statRows
    }),
    athleteProfile: buildAthleteProfileData({
      profiles: Array.isArray(athleteProfiles) ? athleteProfiles : [],
      teamId: resolvedTeamId,
      playerId: resolvedPlayerId
    })
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
  let photoUrl: string | undefined;
  if (photoFile) {
    validateImageFile(photoFile);
    photoUrl = await uploadPlayerPhoto(photoFile);
  }

  const payload: Record<string, any> = {
    emergencyContact: {
      name: String(emergencyContactName || '').trim(),
      phone: String(emergencyContactPhone || '').trim()
    },
    medicalInfo: String(medicalInfo || '').trim()
  };
  if (typeof photoUrl !== 'undefined') {
    payload.photoUrl = photoUrl;
  }

  await updatePlayerProfile(teamId, playerId, payload);
  return payload;
}

export async function sendParentCoParentInvite({
  user,
  teamId,
  playerId,
  email,
  playerName
}: {
  user: AuthUser | null;
  teamId: string;
  playerId: string;
  email: string;
  playerName: string;
}) {
  assertLinkedParent(user, teamId, playerId);
  return inviteCoParentToAthlete(user!.uid, teamId, playerId, email, playerName);
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

export async function toggleParentPlayerIncentiveRule(user: AuthUser | null, teamId: string, playerId: string, rule: Record<string, any>) {
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
  profileId
}: {
  user: AuthUser | null;
  teamId: string;
  playerId: string;
  draft: Record<string, any>;
  profileId?: string | null;
}) {
  assertLinkedParent(user, teamId, playerId);
  const seasonKey = buildParentSeasonKey(teamId, playerId);
  const saved = await saveAthleteProfile(user!.uid, {
    ...draft,
    selectedSeasonKeys: [seasonKey]
  }, profileId ? { profileId } : {});
  return {
    profile: saved,
    shareUrl: buildAthleteProfileShareUrl(getLegacyOrigin(), saved.id),
    builderUrl: buildLegacyUrl('athlete-profile-builder.html', { teamId, playerId, profileId: saved.id })
  };
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
  rules: Array<Record<string, any>>;
  paidGames: Map<string, any>;
  statOptions: Array<{ key: string; label: string }>;
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

function buildAthleteProfileData({ profiles, teamId, playerId }: { profiles: Array<Record<string, any>>; teamId: string; playerId: string }): ParentAthleteProfileData {
  const profile = profiles.find((candidate) => (
    Array.isArray(candidate?.seasons) &&
    candidate.seasons.some((season: any) => season?.teamId === teamId && season?.playerId === playerId)
  )) || null;
  const profileId = profile?.id || '';
  return {
    profile,
    shareUrl: profileId ? buildAthleteProfileShareUrl(getLegacyOrigin(), profileId) : '',
    builderUrl: buildLegacyUrl('athlete-profile-builder.html', { teamId, playerId, ...(profileId ? { profileId } : {}) })
  };
}

function assertLinkedParent(user: AuthUser | null, teamId: string, playerId: string) {
  if (!user?.uid) {
    throw new Error('A signed-in parent account is required.');
  }
  const linked = (user.parentOf || []).some((entry: any) => entry?.teamId === teamId && entry?.playerId === playerId);
  if (!linked && !user.isAdmin && !user.roles?.includes('admin') && !user.roles?.includes('platformAdmin')) {
    throw new Error('This player is not linked to your account.');
  }
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
  const decodedTeamId = decodeURIComponent(teamId || '');
  const decodedPlayerId = decodeURIComponent(playerId || '');
  if (decodedTeamId && decodedPlayerId) {
    return children.find((child) => child.teamId === decodedTeamId && child.playerId === decodedPlayerId) || null;
  }
  return children.find((child) => child.playerId === decodedPlayerId) || null;
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
