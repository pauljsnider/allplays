'use strict';

function normalizeParentInviteEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function appendUniqueParentLink(parentOf, link) {
  const links = Array.isArray(parentOf) ? [...parentOf] : [];
  const exists = links.some((entry) => entry?.teamId === link.teamId && entry?.playerId === link.playerId);
  if (!exists) links.push(link);
  return links;
}

function appendUniqueValue(values, value) {
  const nextValues = Array.isArray(values) ? [...values] : [];
  if (!nextValues.includes(value)) nextValues.push(value);
  return nextValues;
}

function buildAutoAcceptedParentLink({ codeData, team, player }) {
  return {
    teamId: codeData.teamId,
    playerId: codeData.playerId,
    teamName: team?.name || codeData.teamName || null,
    playerName: player?.name || codeData.playerName || null,
    playerNumber: player?.number ?? codeData.playerNum ?? null,
    playerPhotoUrl: player?.photoUrl || null,
    relation: codeData.relation || null
  };
}

module.exports = {
  normalizeParentInviteEmail,
  appendUniqueParentLink,
  appendUniqueValue,
  buildAutoAcceptedParentLink
};
