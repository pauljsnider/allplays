'use strict';

function cleanText(value, maxLength = 256) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value).replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function normalizeEmail(value) {
  return cleanText(value, 320).toLowerCase();
}

function normalizeEmailList(value) {
  return Array.from(new Set(
    (Array.isArray(value) ? value : [])
      .map(normalizeEmail)
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

function serializeStaffTeamProfile(teamId, team = {}) {
  const id = cleanText(teamId, 128);
  if (!id) return null;
  return {
    id,
    name: cleanText(team.name || team.teamName, 160) || 'Team',
    sport: cleanText(team.sport, 80) || null,
    photoUrl: cleanHttpUrl(team.photoUrl || team.logoUrl || team.imageUrl),
    description: cleanText(team.description, 1000) || null,
    active: team.active !== false,
    archived: team.archived === true,
    status: cleanText(team.status, 32) || null,
    isPublic: team.isPublic === true
  };
}

function serializeManagedTeamProfile(teamId, team = {}) {
  const summary = serializeStaffTeamProfile(teamId, team);
  if (!summary) return null;
  return {
    ...summary,
    ownerId: cleanText(team.ownerId, 160) || null,
    ownerEmail: normalizeEmail(team.ownerEmail || team.ownerEmailLower) || null,
    adminEmails: normalizeEmailList(team.adminEmails)
  };
}

// Keep this recovery response intentionally explicit. Managers normally read the
// canonical document through Firestore, but this callable is also the fallback
// when that read is temporarily denied. Spreading the document here would make
// every future server-only field part of the client API (billing IDs included).
const MANAGED_TEAM_DOCUMENT_FIELDS = Object.freeze([
  'name',
  'teamName',
  'description',
  'sport',
  'photoUrl',
  'photoPath',
  'teamPhotoUrl',
  'logoUrl',
  'imageUrl',
  'zip',
  'city',
  'state',
  'colors',
  'isPublic',
  'active',
  'archived',
  'status',
  'ownerId',
  'ownerEmail',
  'ownerEmailLower',
  'adminEmails',
  'notificationEmail',
  'leagueUrl',
  'bracketUrl',
  'standingsConfig',
  'tournamentPoolOverrides',
  'twitchChannel',
  'streamEmbedUrl',
  'youtubeEmbedUrl',
  'streamUrl',
  'livestreamUrl',
  'scheduleNotifications',
  'calendarUrls',
  'availabilityPreferences',
  'defaultAssignments',
  'teamPermissions',
  'streamAccessMode',
  'streamVolunteerEmails',
  'mediaContributorEmails',
  'mediaContributorUids',
  'teamPassConfig',
  'registrationSource',
  'registrationProvider',
  'registrationSourceId',
  'externalRegistrationTeamId',
  'registrationExternalTeamId',
  'registrationSourceSnapshot',
  'registrationScheduleSnapshot',
  'registrationRosterSnapshot',
  'externalScheduleEvents',
  'externalRosterPlayers',
  'rosterFields',
  'rosterProfileFields',
  'playerProfileFields',
  'customRosterFields',
  'rosterFieldDefinitions',
  'season',
  'division',
  'createdAt',
  'updatedAt',
  'deactivatedAt',
  'deactivatedBy'
]);

function serializeManagedTeamDocument(teamId, team = {}) {
  const id = cleanText(teamId, 128);
  if (!id || !team || typeof team !== 'object' || Array.isArray(team)) return null;
  const item = { id };
  MANAGED_TEAM_DOCUMENT_FIELDS.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(team, field)) item[field] = team[field];
  });
  return item;
}

module.exports = {
  normalizeEmail,
  normalizeEmailList,
  serializeManagedTeamDocument,
  serializeStaffTeamProfile,
  serializeManagedTeamProfile
};
