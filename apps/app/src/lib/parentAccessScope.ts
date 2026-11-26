import type { AuthUser } from './types';

/**
 * Shared parent-scope merging for #5246 (regression of #2525).
 *
 * The Firestore user profile and the in-memory auth user are snapshots of
 * the same parent scope taken at different times. The fresh profile supplies
 * links created after sign-in. When it carries parent-scope fields it is also
 * current revocation evidence: a sign-in-only link must be backed by live
 * parent membership on the player document before it can be retained
 * (#5252). A profile with no parent-scope fields proves nothing, so the
 * sign-in snapshot remains the fallback for legacy/unhydrated records.
 */

function compactScopeString(value: unknown) {
  return String(value || '').trim();
}

export function mergeParentScopeStrings(userValues: unknown, profileValues: unknown): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();
  [userValues, profileValues].forEach((values) => {
    (Array.isArray(values) ? values : []).forEach((value) => {
      const normalized = compactScopeString(value);
      if (normalized && !seen.has(normalized)) {
        seen.add(normalized);
        merged.push(normalized);
      }
    });
  });
  return merged;
}

export function mergeParentOfLinks(userLinks: unknown, profileLinks: unknown): Array<Record<string, unknown>> {
  const merged: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  [userLinks, profileLinks].forEach((links) => {
    (Array.isArray(links) ? links : []).forEach((link: any) => {
      const teamId = compactScopeString(link?.teamId);
      const playerId = compactScopeString(link?.playerId || link?.childId);
      if (!teamId || !playerId) return;
      const key = `${teamId}::${playerId}`;
      if (seen.has(key)) return;
      seen.add(key);
      merged.push(link);
    });
  });
  return merged;
}

export function parseParentPlayerKey(value: unknown): { teamId: string; playerId: string } | null {
  const raw = compactScopeString(value);
  const separatorIndex = raw.indexOf('::');
  if (separatorIndex <= 0 || separatorIndex >= raw.length - 2) return null;
  const teamId = compactScopeString(raw.slice(0, separatorIndex));
  const playerId = compactScopeString(raw.slice(separatorIndex + 2));
  return teamId && playerId ? { teamId, playerId } : null;
}

export function getParentLinkKey(link: unknown): string {
  const teamId = compactScopeString((link as any)?.teamId);
  const playerId = compactScopeString((link as any)?.playerId || (link as any)?.childId);
  return teamId && playerId ? `${teamId}::${playerId}` : '';
}

export function getParentScopeLinkKeys(scope: Record<string, unknown> | AuthUser | null | undefined): Set<string> {
  const keys = new Set<string>();
  (Array.isArray(scope?.parentOf) ? scope.parentOf : []).forEach((link) => {
    const key = getParentLinkKey(link);
    if (key) keys.add(key);
  });
  (Array.isArray(scope?.parentPlayerKeys) ? scope.parentPlayerKeys : []).forEach((value) => {
    const parsed = parseParentPlayerKey(value);
    if (parsed) keys.add(`${parsed.teamId}::${parsed.playerId}`);
  });
  return keys;
}

export function profileHasParentScope(profile: Record<string, unknown> | null | undefined): boolean {
  return Boolean(profile) && ['parentOf', 'parentTeamIds', 'parentPlayerKeys'].some((key) => Array.isArray(profile![key]));
}

export function playerListsParent(player: unknown, parentUid: string): boolean {
  const uid = compactScopeString(parentUid);
  if (!uid) return false;
  if (compactScopeString((player as any)?.parentUserId) === uid) return true;
  if (compactScopeString((player as any)?.guardianUserId) === uid) return true;
  const parents = Array.isArray((player as any)?.parents) ? (player as any).parents : [];
  return parents.some((parent: any) => {
    const candidate = compactScopeString(parent?.userId || parent?.uid || parent?.parentUserId || parent?.accountUserId);
    return candidate !== '' && candidate === uid;
  });
}

type MergeParentAccessOptions = {
  validatedSnapshotLinkKeys?: ReadonlySet<string>;
};

export function mergeParentAccessUser(
  user: AuthUser | null,
  profile: Record<string, unknown> | null | undefined,
  options: MergeParentAccessOptions = {}
): AuthUser | null {
  if (!user?.uid) return user;
  if (!profile) return user;
  const authoritativeProfile = profileHasParentScope(profile);
  const profileLinkKeys = getParentScopeLinkKeys(profile);
  const validatedSnapshotLinkKeys = options.validatedSnapshotLinkKeys || new Set<string>();
  const snapshotLinkAllowed = (key: string) => (
    !authoritativeProfile || profileLinkKeys.has(key) || validatedSnapshotLinkKeys.has(key)
  );
  const userParentOf = (Array.isArray(user.parentOf) ? user.parentOf : [])
    .filter((link) => snapshotLinkAllowed(getParentLinkKey(link)));
  const userParentPlayerKeys = (Array.isArray(user.parentPlayerKeys) ? user.parentPlayerKeys : [])
    .filter((value) => {
      const parsed = parseParentPlayerKey(value);
      return parsed ? snapshotLinkAllowed(`${parsed.teamId}::${parsed.playerId}`) : false;
    });
  const parentOf = mergeParentOfLinks(userParentOf, profile.parentOf);
  const parentPlayerKeys = mergeParentScopeStrings(userParentPlayerKeys, profile.parentPlayerKeys);
  const linkedTeamIds = new Set<string>([
    ...parentOf.map((link) => compactScopeString(link.teamId)),
    ...parentPlayerKeys.map((value) => parseParentPlayerKey(value)?.teamId || '')
  ].filter(Boolean));
  const parentTeamIds = authoritativeProfile
    ? [...linkedTeamIds]
    : mergeParentScopeStrings(user.parentTeamIds, profile.parentTeamIds);
  if (authoritativeProfile) {
    mergeParentScopeStrings([], profile.parentTeamIds).forEach((teamId) => {
      if (linkedTeamIds.has(teamId) && !parentTeamIds.includes(teamId)) parentTeamIds.push(teamId);
    });
  }
  return {
    ...user,
    parentOf,
    parentTeamIds,
    parentPlayerKeys,
    coachOf: Array.isArray(profile.coachOf)
      ? mergeParentScopeStrings([], profile.coachOf)
      : mergeParentScopeStrings(user.coachOf, undefined)
  };
}
