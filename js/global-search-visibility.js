import { getTeamAccessInfo } from './team-access.js';

export function canUserDiscoverTeamInSearch(team, user) {
    if (!team) return false;
    if (team.isPublic !== false) return true;
    return getTeamAccessInfo(user, team).hasAccess;
}

export function filterSearchableTeams(teams, user) {
    return (Array.isArray(teams) ? teams : []).filter((team) => canUserDiscoverTeamInSearch(team, user));
}
