import { getTeamAccessInfo, normalizeAdminEmailList } from './team-access.js';

function hasRulesCompatibleConfigWriteAccess(user, team) {
    if (!user || !team) return false;
    if (team.ownerId === user.uid || user.isAdmin === true) return true;

    const authEmail = String(user.email || '').trim().toLowerCase();
    const adminEmails = normalizeAdminEmailList(team.adminEmails);
    return Boolean(authEmail && adminEmails.includes(authEmail));
}

export function getEditConfigAccessDecision(user, team, teamId, configType = 'stat_settings') {
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

    let allowed = false;

    if (accessInfo.accessLevel === 'full') {
        // Full access users can edit any config type, subject to rules-compatible write access
        allowed = hasRulesCompatibleConfigWriteAccess(user, normalizedTeam);
    } else if (configType === 'stream_settings' && accessInfo.accessLevel === 'stream') {
        // Stream users can edit stream settings (no additional write access rules needed)
        allowed = true;
    } else if (configType === 'child_profile' && accessInfo.accessLevel === 'parent') {
        // Parent users can edit child profiles (no additional write access rules needed)
        allowed = true;
    } else {
        // For 'stat_settings' (or any other configType not explicitly handled),
        // only full access is allowed, subject to rules-compatible write access.
        // This covers the default 'stat_settings' if no specific rules apply earlier.
        allowed = accessInfo.accessLevel === 'full' && hasRulesCompatibleConfigWriteAccess(user, normalizedTeam);
    }

    return {
        allowed: allowed,
        exitUrl: accessInfo.exitUrl,
        team: normalizedTeam
    };
}
