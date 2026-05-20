import { getTeamAccessInfo } from './team-access.js';

function hasRulesCompatibleConfigWriteAccess(user, team) {
    if (!user || !team) return false;
    if (team.ownerId === user.uid || user.isAdmin === true) return true;

    const authEmail = String(user.email || '').toLowerCase();
    return Boolean(
        authEmail &&
        Array.isArray(team.adminEmails) &&
        team.adminEmails.includes(authEmail)
    );
}

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
        allowed: accessInfo.accessLevel === 'full' && hasRulesCompatibleConfigWriteAccess(user, normalizedTeam),
        exitUrl: accessInfo.exitUrl,
        team: normalizedTeam
    };
}
