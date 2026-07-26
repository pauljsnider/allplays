'use strict';

const crypto = require('node:crypto');

function compactPublicProfileString(value) {
  return String(value || '').trim();
}

function uniquePublicProfileStrings(values = []) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => compactPublicProfileString(value))
    .filter(Boolean))];
}

function isValidPublicProfileTeamId(value) {
  const teamId = compactPublicProfileString(value);
  return Boolean(teamId)
    && teamId !== '.'
    && teamId !== '..'
    && !teamId.includes('/')
    && !/^__.*__$/.test(teamId)
    && Buffer.byteLength(teamId, 'utf8') <= 1500;
}

function derivePublicProfileTeamIds(userData = {}, extraTeamIds = []) {
  const parentOfTeamIds = Array.isArray(userData.parentOf)
    ? userData.parentOf.map((link) => link?.teamId)
    : [];
  const parentTeamIds = Array.isArray(userData.parentTeamIds)
    ? userData.parentTeamIds
    : [];
  return uniquePublicProfileStrings([
    ...parentOfTeamIds,
    ...parentTeamIds,
    ...(Array.isArray(extraTeamIds) ? extraTeamIds : [])
  ]).filter(isValidPublicProfileTeamId);
}

function hashPublicProfileEmail(email) {
  const normalized = compactPublicProfileString(email).toLowerCase();
  return normalized ? crypto.createHash('sha256').update(normalized).digest('hex') : null;
}

function buildPublicUserProfileProjection(userData = {}, options = {}) {
  const trustedDisplayName = compactPublicProfileString(options.trustedDisplayName);
  const fullName = compactPublicProfileString(
    userData.fullName || userData.displayName || userData.name || trustedDisplayName
  );
  const displayName = compactPublicProfileString(
    userData.displayName || userData.fullName || userData.name || trustedDisplayName
  );
  const trustedEmail = options.trustedEmail ?? userData.email;
  const photoUrl = compactPublicProfileString(userData.photoUrl || options.trustedPhotoUrl);

  return {
    displayName: displayName || null,
    fullName: fullName || null,
    photoUrl: photoUrl || null,
    discoveryTeamIds: derivePublicProfileTeamIds(userData, options.discoveryTeamIds),
    emailHash: hashPublicProfileEmail(trustedEmail)
  };
}

function buildTeamStaffMembershipKey(teamData = null) {
  if (!teamData) return '';
  const ownerId = compactPublicProfileString(teamData.ownerId);
  const adminEmails = uniquePublicProfileStrings(teamData.adminEmails)
    .map((email) => email.toLowerCase())
    .sort();
  return JSON.stringify({ ownerId, adminEmails });
}

function buildPublicProfileUserSourceKey(userData = null) {
  if (!userData) return '';
  return JSON.stringify({
    displayName: compactPublicProfileString(userData.displayName),
    fullName: compactPublicProfileString(userData.fullName),
    name: compactPublicProfileString(userData.name),
    photoUrl: compactPublicProfileString(userData.photoUrl),
    email: compactPublicProfileString(userData.email).toLowerCase(),
    discoveryTeamIds: derivePublicProfileTeamIds(userData).sort()
  });
}

module.exports = {
  buildPublicProfileUserSourceKey,
  buildPublicUserProfileProjection,
  buildTeamStaffMembershipKey,
  compactPublicProfileString,
  derivePublicProfileTeamIds,
  hashPublicProfileEmail,
  isValidPublicProfileTeamId,
  uniquePublicProfileStrings
};
