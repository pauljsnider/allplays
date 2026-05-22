export function isTeamActive(team) {
    return team?.active !== false;
}

export function isTeamPublic(team) {
    return team?.isPublic === true;
}

export function filterTeamsByActive(teams, includeInactive = false) {
    const safeTeams = Array.isArray(teams) ? teams : [];
    if (includeInactive) return safeTeams;
    return safeTeams.filter(isTeamActive);
}

export function shouldIncludeTeamInLiveOrUpcoming(team) {
    return isTeamActive(team) && isTeamPublic(team);
}

// Policy choice: keep completed replay history visible even if a public team is inactive.
export function shouldIncludeTeamInReplay(team) {
    return isTeamPublic(team);
}
