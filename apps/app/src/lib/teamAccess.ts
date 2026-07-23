export function mergeOwnedTeamIds(
  profileTeamIds: unknown,
  ownedTeams: unknown
): string[] {
  const normalizedProfileTeamIds = Array.isArray(profileTeamIds)
    ? profileTeamIds.map((teamId) => String(teamId || '').trim()).filter(Boolean)
    : [];
  const ownedTeamIds = Array.isArray(ownedTeams)
    ? ownedTeams
      .map((team) => String((team as Record<string, unknown>)?.id || '').trim())
      .filter(Boolean)
    : [];

  return [...new Set([...normalizedProfileTeamIds, ...ownedTeamIds])];
}
