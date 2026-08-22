import type { AuthUser } from './types';

export type CanonicalParentAccessLink = {
  teamId: string;
  teamName: string;
  playerId: string;
  playerName: string;
  playerNumber: string;
  playerPhotoUrl: string | null;
};

type ParentAccessRecord = Record<string, unknown> | AuthUser | null | undefined;

function compactString(value: unknown) {
  return value == null ? '' : String(value).trim();
}

function compactAuthorityString(value: unknown) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  return normalized && normalized.length <= 128 && !normalized.includes('/') ? normalized : '';
}

function hasOwn(record: ParentAccessRecord, key: string) {
  return Boolean(record && Object.prototype.hasOwnProperty.call(record, key));
}

function parseParentPlayerKey(value: unknown) {
  if (typeof value !== 'string') return null;
  const parts = value.split('::').map(compactAuthorityString);
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { teamId: parts[0], playerId: parts[1] };
}

function normalizeParentOfEntry(value: unknown): CanonicalParentAccessLink | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entry = value as Record<string, unknown>;
  const teamId = compactAuthorityString(entry.teamId || entry.teamID || entry.team_id || entry.team);
  const playerId = compactAuthorityString(
    entry.playerId || entry.playerID || entry.player_id || entry.childId || entry.childID || entry.child_id
  );
  if (!teamId || !playerId) return null;
  return {
    teamId,
    teamName: compactString(entry.teamName || entry.team),
    playerId,
    playerName: compactString(entry.playerName || entry.childName || entry.name),
    playerNumber: compactString(entry.playerNumber ?? entry.number),
    playerPhotoUrl: compactString(entry.playerPhotoUrl || entry.photoUrl) || null
  };
}

export function collectCanonicalParentAccessLinks(
  primary: ParentAccessRecord,
  fallback?: ParentAccessRecord
): CanonicalParentAccessLink[] {
  // When a current profile is supplied as `primary`, it owns the complete
  // grant boundary. The fallback auth shell may enrich exact link metadata,
  // but a field missing from the current profile is never restored from it.
  const canonicalTeamField = {
    present: hasOwn(primary, 'parentTeamIds'),
    value: primary ? (primary as Record<string, unknown>).parentTeamIds : undefined
  };
  const canonicalTeamIds = new Set(
    (canonicalTeamField.present && Array.isArray(canonicalTeamField.value) ? canonicalTeamField.value : [])
      .map(compactAuthorityString)
      .filter(Boolean)
  );
  const canonicalPlayerField = {
    present: hasOwn(primary, 'parentPlayerKeys'),
    value: primary ? (primary as Record<string, unknown>).parentPlayerKeys : undefined
  };
  const canonicalPlayerLinks = (
    canonicalPlayerField.present && Array.isArray(canonicalPlayerField.value) ? canonicalPlayerField.value : []
  )
    .map(parseParentPlayerKey)
    .filter((link): link is { teamId: string; playerId: string } => Boolean(link));
  const canonicalPlayerKeys = new Set(
    canonicalPlayerLinks.map((link) => `${link.teamId}::${link.playerId}`)
  );
  const primaryParentOf = primary ? (primary as Record<string, unknown>).parentOf : undefined;
  const fallbackParentOf = fallback ? (fallback as Record<string, unknown>).parentOf : undefined;
  const parentOf = hasOwn(primary, 'parentOf')
    ? (Array.isArray(primaryParentOf) ? primaryParentOf : [])
    : canonicalPlayerField.present && Array.isArray(fallbackParentOf)
      ? fallbackParentOf
      : [];
  const linksByKey = new Map<string, CanonicalParentAccessLink>();

  const addLink = (link: CanonicalParentAccessLink) => {
    const key = `${link.teamId}::${link.playerId}`;
    if (canonicalTeamField.present && !canonicalTeamIds.has(link.teamId)) return;
    // A canonical team grant alone authorizes team-level workflows, not an
    // arbitrary stale child row. Legacy parentOf is child authority only when
    // both revocable canonical fields are genuinely absent.
    if (canonicalTeamField.present && !canonicalPlayerField.present) return;
    if (canonicalPlayerField.present && !canonicalPlayerKeys.has(key)) return;
    const existing = linksByKey.get(key);
    if (!existing) {
      linksByKey.set(key, link);
      return;
    }
    linksByKey.set(key, {
      ...existing,
      teamName: existing.teamName || link.teamName,
      playerName: existing.playerName || link.playerName,
      playerNumber: existing.playerNumber || link.playerNumber,
      playerPhotoUrl: existing.playerPhotoUrl || link.playerPhotoUrl
    });
  };

  parentOf.map(normalizeParentOfEntry).filter(Boolean).forEach((link) => addLink(link!));
  canonicalPlayerLinks.forEach((link) => addLink({
    ...link,
    teamName: '',
    playerName: '',
    playerNumber: '',
    playerPhotoUrl: null
  }));

  return [...linksByKey.values()];
}

export function isCanonicalParentPlayerLinked(user: ParentAccessRecord, teamId: string, playerId: string) {
  const normalizedTeamId = compactAuthorityString(teamId);
  const normalizedPlayerId = compactAuthorityString(playerId);
  if (!normalizedTeamId || !normalizedPlayerId) return false;
  return collectCanonicalParentAccessLinks(user).some((link) => (
    link.teamId === normalizedTeamId && link.playerId === normalizedPlayerId
  ));
}

export function isCanonicalParentTeamLinked(user: ParentAccessRecord, teamId: string) {
  const normalizedTeamId = compactAuthorityString(teamId);
  if (!normalizedTeamId) return false;
  const canonicalTeamField = {
    present: hasOwn(user, 'parentTeamIds'),
    value: user ? (user as Record<string, unknown>).parentTeamIds : undefined
  };
  if (canonicalTeamField.present) {
    return Array.isArray(canonicalTeamField.value)
      && canonicalTeamField.value.some((value) => compactAuthorityString(value) === normalizedTeamId);
  }
  return collectCanonicalParentAccessLinks(user).some((link) => link.teamId === normalizedTeamId);
}

export function findCanonicalParentAccessLink(
  user: ParentAccessRecord,
  teamId: string,
  playerId: string
) {
  const normalizedTeamId = compactAuthorityString(teamId);
  const normalizedPlayerId = compactAuthorityString(playerId);
  return collectCanonicalParentAccessLinks(user).find((link) => (
    link.teamId === normalizedTeamId && link.playerId === normalizedPlayerId
  )) || null;
}

export function findOnlyCanonicalParentAccessLinkForTeam(user: ParentAccessRecord, teamId: string) {
  const normalizedTeamId = compactAuthorityString(teamId);
  const links = collectCanonicalParentAccessLinks(user).filter((link) => link.teamId === normalizedTeamId);
  return links.length === 1 ? links[0] : null;
}

export function applyCurrentParentAccessProfile(user: AuthUser, profile: Record<string, unknown>): AuthUser {
  const next = { ...user } as AuthUser;
  const hasCanonicalTeamField = hasOwn(profile, 'parentTeamIds');
  const hasCanonicalPlayerField = hasOwn(profile, 'parentPlayerKeys');
  const canonicalTeamIds = new Set(
    (hasCanonicalTeamField && Array.isArray(profile.parentTeamIds) ? profile.parentTeamIds : [])
      .map(compactAuthorityString)
      .filter(Boolean)
  );
  const canonicalPlayerLinks = (
    hasCanonicalPlayerField && Array.isArray(profile.parentPlayerKeys) ? profile.parentPlayerKeys : []
  )
    .map(parseParentPlayerKey)
    .filter((link): link is { teamId: string; playerId: string } => Boolean(
      link && (!hasCanonicalTeamField || canonicalTeamIds.has(link.teamId))
    ));
  if (hasCanonicalTeamField || hasCanonicalPlayerField) {
    next.parentPlayerKeys = canonicalPlayerLinks.map((link) => `${link.teamId}::${link.playerId}`);
    next.parentTeamIds = hasCanonicalTeamField
      ? [...canonicalTeamIds]
      : [...new Set(canonicalPlayerLinks.map((link) => link.teamId))];
  } else {
    delete next.parentTeamIds;
    delete next.parentPlayerKeys;
  }
  // Keep the compatibility metadata itself inside the same canonical
  // boundary so a downstream legacy-shaped reader cannot see a revoked link.
  next.parentOf = collectCanonicalParentAccessLinks(profile, user);
  return next;
}
