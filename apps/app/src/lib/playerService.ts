import {
  deleteAthleteProfileMediaByPath,
  getAggregatedStatsForPlayer,
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
  saveAthleteProfile,
  setPlayerPrivateRosterProfileFields,
  updatePlayer,
  updatePlayerProfile,
  uploadAthleteProfileMedia,
  uploadPlayerPhoto,
  type LegacyAthleteProfileRecord,
  type LegacyPlayerPrivateProfileRecord,
  type LegacyPlayerRecord,
  type LegacyTeamRecord
} from './adapters/legacyPlayerDb';
import {
  buildAthleteProfileShareUrl,
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
  splitRosterProfileValuesByVisibility,
  validateRosterProfileValues,
  type RosterFieldDefinition,
  type RosterProfileValues
} from './adapters/legacyRosterPrivacy';
import { getOpenScheduleAssignments, normalizeRsvpResponse, type ParentScheduleEvent } from './scheduleLogic';
import { loadParentPlayerSchedule, type ParentScheduleChild } from './scheduleService';
import { clearAppDataCache } from './appDataCache';
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
  access: {
    isLinkedParent: boolean;
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
  clips: PlayerVideoClip[];
  certificates: Array<Record<string, any>>;
  trackingSummary: PlayerTrackingSummary[];
  privateProfile: ParentPlayerPrivateProfile | null;
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

  const schedule = await loadParentPlayerSchedule(user, { teamId, playerId });
  const requestedTeamId = decodeURIComponent(teamId || '');
  const requestedPlayerId = decodeURIComponent(playerId || '');
  const linkedChild = findLinkedChild(schedule.children, teamId, playerId);
  const initialTeam = await getTeam(requestedTeamId, { includeInactive: true });
  const routeAccess = buildPlayerAccess(user, requestedTeamId, requestedPlayerId, initialTeam);
  if (!linkedChild && !routeAccess.isTeamStaff) {
    throw new Error('This player is not linked to your account.');
  }

  const resolvedTeamId = linkedChild?.teamId || requestedTeamId;
  const resolvedPlayerId = linkedChild?.playerId || requestedPlayerId;
  const events = schedule.events
    .filter((event) => event.teamId === resolvedTeamId && event.childId === resolvedPlayerId)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  const nextEvent = events.find((event) => !event.isCancelled && event.date.getTime() >= startOfDay(new Date()).getTime()) || null;

  const team = requestedTeamId === resolvedTeamId
    ? initialTeam
    : await getTeam(resolvedTeamId, { includeInactive: true });

  const [
    players,
    games,
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
    getGames(resolvedTeamId).catch(() => []),
    listCertificatesForPlayer(resolvedTeamId, resolvedPlayerId, { status: 'published', limit: 5 }).catch(() => []),
    getPublicTrackingItems(resolvedTeamId).catch(() => []),
    getPlayerTrackingStatuses(resolvedTeamId, [resolvedPlayerId]).catch(() => []),
    getPlayerPrivateProfile(resolvedTeamId, resolvedPlayerId).catch(() => null),
    getRosterFieldDefinitions(resolvedTeamId, team || null).catch(() => []),
    getIncentiveRules(user.uid, resolvedPlayerId).catch(() => []),
    getPaidGames(user.uid, resolvedPlayerId).catch(() => new Map()),
    getCapSetting(user.uid, resolvedPlayerId).catch(() => null),
    getStatOptionsForTeam(resolvedTeamId).catch(() => [])
  ]);

  const playerDoc = (Array.isArray(players) ? players : []).find((candidate: LegacyPlayerRecord) => candidate?.id === resolvedPlayerId) || {};
  const access = buildPlayerAccess(user, resolvedTeamId, resolvedPlayerId, team);
  const child = linkedChild || {
    teamId: resolvedTeamId,
    teamName: String(team?.name || '').trim() || String(playerDoc?.teamName || '').trim() || resolvedTeamId,
    playerId: resolvedPlayerId,
    playerName: String(playerDoc?.name || '').trim() || 'Player'
  };
  const customRosterFields = buildVisibleCustomRosterFields({
    definitions: rosterFieldDefinitions,
    player: playerDoc,
    privateProfile,
    access
  });
  const completedGameEvents = events
    .filter((event) => event.type === 'game' && event.isDbGame && isPastOrCompleted(event))
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .slice(0, 6);

  const statRows = await Promise.all(completedGameEvents.map(async (event) => ({
    event,
    stats: await getAggregatedStatsForPlayer(resolvedTeamId, event.id, resolvedPlayerId).catch(() => ({})) || {}
  })));

  const clips = collectPlayerVideoClips(games, {
    teamId: resolvedTeamId,
    playerId: resolvedPlayerId
  }).slice(0, 8);

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
      number: playerDoc.number || (child as any).playerNumber || null
    },
    team,
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
    clips,
    certificates: Array.isArray(certificates) ? certificates : [],
    trackingSummary,
    privateProfile: normalizePrivateProfile(privateProfile),
    incentives: buildPlayerIncentiveData({
      rules: incentiveRules,
      paidGames,
      statOptions,
      maxPerGameCents,
      statRows
    }),
    athleteProfile: buildParentAthleteProfileShell(
      Array.isArray(user.parentOf) ? user.parentOf : [],
      resolvedTeamId,
      resolvedPlayerId
    )
  };
}

export async function loadParentPlayerAthleteProfile(user: AuthUser | null, teamId: string, playerId: string): Promise<ParentAthleteProfileData> {
  if (!user?.uid) {
    throw new Error('Player details require a signed-in user.');
  }

  const profiles = await listAthleteProfilesForParent(user.uid).catch(() => []);
  return buildAthleteProfileData({
    profiles: Array.isArray(profiles) ? profiles : [],
    parentLinks: Array.isArray(user.parentOf) ? user.parentOf : [],
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
  const nextProfile = {
    ...(player?.profile || {}),
    customFields: publicValues
  };

  await Promise.all([
    updatePlayer(teamId, playerId, {
      profile: nextProfile
    }),
    setPlayerPrivateRosterProfileFields(teamId, playerId, privateValues)
  ]);

  return {
    profile: nextProfile,
    privateRosterFields: privateValues,
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
  const payload: Record<string, any> = {};

  if (nextName !== currentName) {
    payload.name = nextName;
  }
  if (nextNumber !== currentNumber) {
    payload.number = nextNumber;
  }

  if (photoFile) {
    validateImageFile(photoFile);
    payload.photoUrl = await uploadPlayerPhoto(photoFile);
  } else if (removePhoto && currentPhotoUrl) {
    payload.photoUrl = null;
  }

  if (!Object.keys(payload).length) {
    return { updatedFields: [] };
  }

  await updatePlayer(teamId, playerId, payload);
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
  const workingProfileId = profileId || createLocalId('profile');
  let uploadedProfilePhoto: Record<string, any> | null = null;
  const uploadedHighlightClips: Array<Record<string, any>> = [];
  const uploadRequests = buildHighlightClipUploadRequests(highlightClipUploads, highlightClipFile, highlightClipTitle);
  if (profilePhotoFile) validateImageFile(profilePhotoFile);
  uploadRequests.forEach((upload) => validateHighlightClipFile(upload.file));
  if (profilePhotoFile) {
    uploadedProfilePhoto = await uploadAthleteProfileMedia(user!.uid, workingProfileId, profilePhotoFile, { kind: 'profile-photo' });
  }
  try {
    for (const upload of uploadRequests) {
      const uploaded = await uploadAthleteProfileMedia(user!.uid, workingProfileId, upload.file, { kind: 'clip' });
      uploadedHighlightClips.push(buildUploadedHighlightClip(upload, uploaded));
    }
  } catch (error) {
    await cleanupUploadedAthleteProfileMedia([
      uploadedProfilePhoto?.storagePath,
      ...uploadedHighlightClips.map((clip) => clip.storagePath)
    ]);
    throw error;
  }
  const profilePhoto = uploadedProfilePhoto || (resetProfilePhoto ? null : draft.profilePhoto);

  let saved;
  try {
    const clips = buildAthleteProfileHighlightClips(draft.clips, uploadedHighlightClips);
    saved = await saveAthleteProfile(user!.uid, {
      ...draft,
      profilePhoto,
      clips,
      selectedSeasonKeys
    }, { profileId: workingProfileId });
  } catch (error) {
    await cleanupUploadedAthleteProfileMedia([
      uploadedProfilePhoto?.storagePath,
      ...uploadedHighlightClips.map((clip) => clip.storagePath)
    ]);
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
  if (globalThis.crypto?.randomUUID) {
    return `${prefix}_${globalThis.crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
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

function assertLinkedParent(user: AuthUser | null, teamId: string, playerId: string) {
  if (!user?.uid) {
    throw new Error('A signed-in parent account is required.');
  }
  const linked = (user.parentOf || []).some((entry: any) => entry?.teamId === teamId && entry?.playerId === playerId);
  if (!linked && !user.isAdmin && !user.roles?.includes('admin') && !user.roles?.includes('platformAdmin')) {
    throw new Error('This player is not linked to your account.');
  }
}

function isLinkedParent(user: AuthUser | null, teamId: string, playerId: string) {
  return !!(user?.parentOf || []).some((entry: any) => entry?.teamId === teamId && entry?.playerId === playerId);
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
  const resolvedTeam = team ? { ...team, id: team.id || teamId } : { id: teamId };
  const isTeamStaff = isTeamStaffUser(user, resolvedTeam);
  const canEditRosterDetails = isTeamOwnerOrAdminUser(user, resolvedTeam);
  const canEditCustomRosterFields = canEditRosterDetails;
  return {
    isLinkedParent: linkedParent,
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
  access: { isLinkedParent: boolean; isTeamStaff: boolean; canEditRosterDetails: boolean; canEditCustomRosterFields: boolean };
}) {
  const normalizedFields = normalizeRosterFieldDefinitions(definitions);
  if (!normalizedFields.length) return [];

  const mergedValues = {
    ...getRosterProfileValues(player),
    ...(access.canEditCustomRosterFields ? (privateProfile?.rosterFields || {}) : {})
  };

  return normalizedFields
    .filter((field) => canViewRosterField({ id: field.key, visibility: field.visibility }, {
      isAdmin: access.canEditCustomRosterFields,
      isTeamMember: access.isTeamStaff || access.isLinkedParent,
      isLinkedParent: access.isLinkedParent
    }))
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
