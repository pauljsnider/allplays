'use strict';

const {
  isStrictPublicTeam,
  serializePublicPlayer,
  serializePublicTeam
} = require('./public-team-api-core.cjs');
const {
  buildSharePreviewHtml,
  compactText
} = require('./live-game-share-preview-core.cjs');

const RESTRICTED_ROSTER_KEYS = Object.freeze([
  'birthDate', 'gender', 'grade', 'school', 'jerseySize', 'memberId', 'dominantHandFoot', 'address',
  'medicalInfo', 'medical_info', 'medicalNotes', 'medical_notes',
  'emergencyContact', 'emergency_contact', 'emergencyContactName', 'emergencyContactPhone',
  'contacts', 'contact', 'contactInfo', 'contact_info', 'contactEmail', 'contactPhone', 'contactRelation',
  'parents', 'parent', 'parentEmail', 'parentPhone', 'parentRelation',
  'guardian', 'guardians', 'guardianEmail', 'guardianPhone', 'guardianRelation',
  'householdContact', 'householdContacts', 'householdEmail', 'householdPhone', 'householdRelation',
  'photoPath'
]);

const RESTRICTED_ROSTER_KEY_SET = new Set(RESTRICTED_ROSTER_KEYS);
const ROSTER_FIELD_CONTAINERS = Object.freeze([
  'rosterFieldValues',
  'customFields',
  'profileFields',
  'extraFields'
]);
const NESTED_ROSTER_FIELD_CONTAINERS = Object.freeze([
  'rosterFields',
  'customFields',
  'profileFields',
  'extraFields'
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasRestrictedKeys(value) {
  return isPlainObject(value) && Object.keys(value).some((key) => RESTRICTED_ROSTER_KEY_SET.has(key));
}

function hasRestrictedRosterFieldValues(player = {}) {
  if (!isPlainObject(player)) return true;
  if (hasRestrictedKeys(player)) return true;

  const profile = isPlainObject(player.profile) ? player.profile : null;
  if (profile && hasRestrictedKeys(profile)) return true;
  if (ROSTER_FIELD_CONTAINERS.some((key) => hasRestrictedKeys(player[key]))) return true;
  return Boolean(profile && NESTED_ROSTER_FIELD_CONTAINERS.some((key) => hasRestrictedKeys(profile[key])));
}

function normalizePlayerId(value) {
  if (typeof value !== 'string') return '';
  const playerId = value.trim();
  return playerId && playerId.length <= 128 && !playerId.includes('/') ? playerId : '';
}

function buildPublicPlayerShareProjection({ teamId, team, player } = {}) {
  if (!isStrictPublicTeam(team) || hasRestrictedRosterFieldValues(player)) return null;
  const serializedTeam = serializePublicTeam(teamId, team);
  const serializedPlayer = serializePublicPlayer(player);
  if (!serializedTeam?.id || !serializedPlayer?.id || !serializedPlayer?.name) return null;
  const safeTeam = {
    id: serializedTeam.id,
    name: serializedTeam.name,
    sport: serializedTeam.sport,
    city: serializedTeam.city,
    state: serializedTeam.state,
    zip: serializedTeam.zip
  };
  const safePlayer = {
    id: serializedPlayer.id,
    name: serializedPlayer.name,
    number: serializedPlayer.number,
    position: serializedPlayer.position
  };
  return { team: safeTeam, player: safePlayer };
}

function buildPlayerShareMetadata({ team, player } = {}) {
  const playerName = compactText(player?.name, 160) || 'Player';
  const teamName = compactText(team?.name, 160) || 'ALL PLAYS';
  const number = compactText(player?.number, 32);
  const position = compactText(player?.position, 80);
  const sport = compactText(team?.sport, 80);
  const playerLabel = number ? `${playerName} #${number}` : playerName;
  const detail = [position, sport ? `${sport} player profile` : 'Player profile']
    .filter(Boolean)
    .join(' · ');

  return {
    title: compactText(`${playerLabel} — ${teamName}`, 220),
    description: compactText(`${detail} on ALL PLAYS.`, 220),
    imageUrl: 'https://allplays.ai/img/logo_large.png',
    imageAlt: 'ALL PLAYS logo',
    siteName: 'ALL PLAYS'
  };
}

function buildPlayerShareHtml({ metadata, redirectUrl, shareUrl } = {}) {
  return buildSharePreviewHtml({
    metadata,
    redirectUrl,
    shareUrl,
    openLabel: 'Open the player profile on ALL PLAYS'
  });
}

module.exports = {
  RESTRICTED_ROSTER_KEYS,
  buildPlayerShareHtml,
  buildPlayerShareMetadata,
  buildPublicPlayerShareProjection,
  hasRestrictedRosterFieldValues,
  normalizePlayerId
};
