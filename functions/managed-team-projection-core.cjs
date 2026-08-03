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

function serializeManagedTeamProfile(teamId, team = {}) {
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
    isPublic: team.isPublic === true,
    ownerId: cleanText(team.ownerId, 160) || null,
    ownerEmail: normalizeEmail(team.ownerEmail || team.ownerEmailLower) || null,
    adminEmails: normalizeEmailList(team.adminEmails)
  };
}

module.exports = {
  normalizeEmail,
  normalizeEmailList,
  serializeManagedTeamProfile
};
