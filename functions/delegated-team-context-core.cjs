'use strict';

const DELEGATED_PERMISSION_KEYS = Object.freeze({
  scorekeeping: 'scorekeeping',
  videography: 'videography',
  streaming: 'streaming',
  media: 'teamMediaManagement'
});

function cleanText(value, maxLength = 256) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value).replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function normalizeId(value, fieldName) {
  if (typeof value !== 'string' || value !== value.trim() || !value || value.length > 128 || value.includes('/')) {
    const error = new Error(`${fieldName} is invalid.`);
    error.code = 'invalid-argument';
    throw error;
  }
  return value;
}

function normalizeEmail(value) {
  return cleanText(value, 320).toLowerCase();
}

function getCanonicalOwnerIdState(team = {}) {
  if (!Object.prototype.hasOwnProperty.call(team || {}, 'ownerId')) {
    return { state: 'legacy', ownerId: '' };
  }
  const ownerId = team.ownerId;
  if (ownerId === '') return { state: 'legacy', ownerId: '' };
  if (typeof ownerId === 'string'
    && ownerId === ownerId.trim()
    && ownerId.length <= 128
    && !ownerId.includes('/')) {
    return { state: 'canonical', ownerId };
  }
  return { state: 'invalid', ownerId: '' };
}

function normalizeStringList(value) {
  return Array.from(new Set(
    (Array.isArray(value) ? value : [])
      .filter((entry) => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter(Boolean)
  ));
}

function cleanHttpUrl(value) {
  const text = cleanText(value, 2048);
  if (!text) return null;
  try {
    const url = new URL(text);
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function getRecordedReplayPaywallSetting(team = {}) {
  return [
    team?.teamPassConfig?.recordedReplayPaywallEnabled,
    team?.teamPass?.recordedReplayPaywallEnabled,
    team?.premiumFeatures?.recordedReplayPaywallEnabled,
    team?.recordedReplayPaywallEnabled,
    team?.recordedReplayTeamPassRequired
  ].find((value) => typeof value === 'boolean');
}

function hasSelectedGrant(team, permissionName, uid) {
  const permission = team?.teamPermissions?.[permissionName];
  return permission?.mode === 'selected' && normalizeStringList(permission.memberIds).includes(uid);
}

function hasConfirmedRsvp(rsvp) {
  const response = cleanText(rsvp?.response || rsvp?.status, 32).toLowerCase();
  return ['going', 'yes', 'confirmed', 'attending'].includes(response);
}

function isGameDayEligible(game) {
  if (!game || typeof game !== 'object') return false;
  const status = cleanText(game.status || 'scheduled', 32).toLowerCase();
  const liveStatus = cleanText(game.liveStatus, 32).toLowerCase();
  const terminalStatuses = ['cancelled', 'canceled', 'completed', 'finished', 'final', 'deleted'];
  return !terminalStatuses.includes(status) && !terminalStatuses.includes(liveStatus);
}

function hasAllConfirmedGrant(team, permissionName, rsvp, game) {
  return team?.teamPermissions?.[permissionName]?.mode === 'all_confirmed'
    && isGameDayEligible(game)
    && hasConfirmedRsvp(rsvp);
}

function hasFullTeamAccess({ uid, email, user }, team) {
  if (user?.isAdmin === true || user?.isPlatformAdmin === true) return true;
  const owner = getCanonicalOwnerIdState(team);
  if (owner.state === 'canonical' && owner.ownerId === uid) return true;
  if (!email) return false;
  const adminEmails = normalizeStringList(team?.adminEmails).map(normalizeEmail);
  if (adminEmails.includes(email)) return true;
  const legacyOwnerEmails = Array.from(new Set(
    [team?.ownerEmail, team?.ownerEmailLower].map(normalizeEmail).filter(Boolean)
  ));
  return owner.state === 'legacy'
    && legacyOwnerEmails.length === 1
    && legacyOwnerEmails[0] === email;
}

function resolveDelegatedAccess({ uid, email, user, teamId, team, game, rsvp }) {
  const full = hasFullTeamAccess({ uid, email, user }, team);
  const parent = normalizeStringList(user?.parentTeamIds).includes(teamId);
  const scorekeeping = full
    || hasSelectedGrant(team, DELEGATED_PERMISSION_KEYS.scorekeeping, uid)
    || hasAllConfirmedGrant(team, DELEGATED_PERMISSION_KEYS.scorekeeping, rsvp, game);
  const videography = full
    || hasSelectedGrant(team, DELEGATED_PERMISSION_KEYS.videography, uid)
    || hasAllConfirmedGrant(team, DELEGATED_PERMISSION_KEYS.videography, rsvp, game);
  const streamingPermission = team?.teamPermissions?.streaming;
  const legacyStreamMode = cleanText(team?.streamAccessMode, 40).toLowerCase();
  const legacySelectedStreaming = Boolean(
    email
    && ['selected_volunteers', 'selected'].includes(legacyStreamMode)
    && normalizeStringList(team?.streamVolunteerEmails).map(normalizeEmail).includes(email)
  );
  const legacyConfirmedStreaming = ['confirmed_members', 'all_confirmed'].includes(legacyStreamMode)
    && isGameDayEligible(game)
    && hasConfirmedRsvp(rsvp);
  const selectedStreaming = streamingPermission?.mode === 'selected'
    && normalizeStringList(streamingPermission.memberIds).includes(uid);
  const confirmedStreaming = hasAllConfirmedGrant(team, DELEGATED_PERMISSION_KEYS.streaming, rsvp, game);
  const streaming = full
    || selectedStreaming
    || confirmedStreaming
    || legacySelectedStreaming
    || legacyConfirmedStreaming;
  const streamingMode = full
    ? 'full'
    : (selectedStreaming || legacySelectedStreaming ? 'selected' : 'all_confirmed');
  const media = full || hasSelectedGrant(team, DELEGATED_PERMISSION_KEYS.media, uid);

  return {
    full,
    parent,
    scorekeeping,
    videography,
    streaming,
    media,
    modes: {
      ...(scorekeeping ? { scorekeeping: full ? 'full' : cleanText(team?.teamPermissions?.scorekeeping?.mode, 32) || 'selected' } : {}),
      ...(videography ? { videography: full ? 'full' : cleanText(team?.teamPermissions?.videography?.mode, 32) || 'selected' } : {}),
      ...(streaming ? { streaming: streamingMode } : {}),
      ...(media ? { media: full ? 'full' : 'selected' } : {})
    }
  };
}

function buildCompatibilityPermissions(uid, access) {
  const permissions = {};
  for (const [accessKey, permissionKey] of Object.entries(DELEGATED_PERMISSION_KEYS)) {
    if (!access[accessKey]) continue;
    const reportedMode = access.modes?.[accessKey];
    const mode = reportedMode === 'all_confirmed' ? 'all_confirmed' : 'selected';
    permissions[permissionKey] = {
      mode,
      memberIds: mode === 'selected' ? [uid] : []
    };
  }
  return permissions;
}

function serializeDelegatedTeamContext(teamId, team, uid, access) {
  const photoUrl = cleanHttpUrl(
    team?.photoUrl || team?.teamPhotoUrl || team?.logoUrl || team?.teamLogoUrl || team?.imageUrl
  );
  const item = {
    id: teamId,
    name: cleanText(team?.name || team?.teamName, 160) || 'Team',
    sport: cleanText(team?.sport, 80) || null,
    photoUrl,
    active: team?.active !== false,
    archived: team?.archived === true,
    status: cleanText(team?.status, 32) || null,
    isPublic: team?.isPublic === true,
    isDelegatedTeamContext: true,
    delegatedAccess: {
      full: access.full === true,
      parent: access.parent === true,
      scorekeeping: access.scorekeeping === true,
      videography: access.videography === true,
      streaming: access.streaming === true,
      media: access.media === true,
      modes: { ...access.modes }
    },
    teamPermissions: buildCompatibilityPermissions(uid, access)
  };

  const recordedReplayPaywallEnabled = getRecordedReplayPaywallSetting(team);
  if (typeof recordedReplayPaywallEnabled === 'boolean') {
    item.recordedReplayPaywallEnabled = recordedReplayPaywallEnabled;
  }

  if (access.full || access.parent || access.streaming) {
    item.twitchChannel = cleanText(team?.twitchChannel, 160) || null;
    item.streamEmbedUrl = cleanHttpUrl(team?.streamEmbedUrl);
    item.youtubeEmbedUrl = cleanHttpUrl(team?.youtubeEmbedUrl);
    item.youtubeVideoId = cleanText(team?.youtubeVideoId, 160) || null;
    item.streamUrl = cleanHttpUrl(team?.streamUrl || team?.livestreamUrl);
  }
  return item;
}

function createDelegatedTeamContextHandler({ loadTeam, loadUser, loadGame, loadRsvp, makeError }) {
  return async function getDelegatedTeamContext(data = {}, context = {}) {
    const uid = cleanText(context?.auth?.uid, 128);
    if (!uid) throw makeError('unauthenticated', 'Authentication is required.');

    let teamId;
    let gameId = null;
    try {
      teamId = normalizeId(data?.teamId, 'teamId');
      gameId = data?.gameId == null || data.gameId === '' ? null : normalizeId(data.gameId, 'gameId');
    } catch (error) {
      throw makeError('invalid-argument', error.message);
    }

    const [team, user] = await Promise.all([loadTeam(teamId), loadUser(uid)]);
    if (!team) throw makeError('not-found', 'Team not found.');
    const [game, rsvp] = gameId
      ? await Promise.all([loadGame(teamId, gameId), loadRsvp(teamId, gameId, uid)])
      : [null, null];
    if (gameId && !game) throw makeError('not-found', 'Game not found.');

    const email = normalizeEmail(context?.auth?.token?.email);
    const access = resolveDelegatedAccess({ uid, email, user: user || {}, teamId, team, game, rsvp });
    if (!access.full && !access.parent && !access.scorekeeping && !access.videography && !access.streaming && !access.media) {
      throw makeError('permission-denied', 'No current delegated team access was found.');
    }
    return { item: serializeDelegatedTeamContext(teamId, team, uid, access) };
  };
}

module.exports = {
  createDelegatedTeamContextHandler,
  getRecordedReplayPaywallSetting,
  resolveDelegatedAccess,
  serializeDelegatedTeamContext
};
