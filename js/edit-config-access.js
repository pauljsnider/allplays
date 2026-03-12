import { getTeamAccessInfo } from './team-access.js';

export function getEditConfigAccessDecision(user, team, teamId) {
    if (!team) {
        return {
            allowed: false,
            exitUrl: 'dashboard.html',
            team: null
        };
    }

    const normalizedTeam = {
        ...team,
        id: team.id || teamId
    };
    const accessInfo = getTeamAccessInfo(user, normalizedTeam);

    return {
        allowed: accessInfo.accessLevel === 'full',
        exitUrl: accessInfo.exitUrl,
        team: normalizedTeam
    };
}
