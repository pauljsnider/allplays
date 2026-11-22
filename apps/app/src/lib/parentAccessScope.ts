import type { AuthUser } from './types';

/**
 * Shared parent-scope merging for #5246 (regression of #2525).
 *
 * The Firestore user profile and the in-memory auth user are two snapshots of
 * the same parent scope, taken at different times: the auth user is hydrated
 * once at sign-in, while the profile keeps changing as invites are accepted
 * or auto-linked. Neither store alone is authoritative, so consumers must
 * union them instead of letting one win. Every link produced here is still
 * validated against the live team/player records by the schedule resolver,
 * so unioning cannot resurrect a removed or inactive child.
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

export function mergeParentAccessUser(user: AuthUser | null, profile: Record<string, unknown> | null | undefined): AuthUser | null {
  if (!user?.uid) return user;
  if (!profile) return user;
  return {
    ...user,
    parentOf: mergeParentOfLinks(user.parentOf, profile.parentOf),
    parentTeamIds: mergeParentScopeStrings(user.parentTeamIds, profile.parentTeamIds),
    parentPlayerKeys: mergeParentScopeStrings(user.parentPlayerKeys, profile.parentPlayerKeys),
    coachOf: mergeParentScopeStrings(user.coachOf, profile.coachOf)
  };
}
