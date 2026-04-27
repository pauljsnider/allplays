function normalizeTeam(value) {
    return value === 'away' ? 'away' : 'home';
}

function normalizeOutcome(value) {
    return String(value || '').trim().toLowerCase();
}

export function isVolleyballSport(value) {
    return normalizeOutcome(value) === 'volleyball';
}

export function getVolleyballSetLabels(count = 5) {
    return Array.from({ length: count }, (_, index) => `Set ${index + 1}`);
}

export function getDefaultVolleyballState({ homeScore = 0, awayScore = 0, servingTeam = 'home', period = 'Set 1' } = {}) {
    return {
        homeScore: Number(homeScore) || 0,
        awayScore: Number(awayScore) || 0,
        servingTeam: normalizeTeam(servingTeam),
        period: String(period || '').trim() || 'Set 1'
    };
}

export function applyVolleyballServeOutcome(state = {}, outcome) {
    const current = getDefaultVolleyballState(state);
    const normalizedOutcome = normalizeOutcome(outcome);
    let pointWinner = null;
    let label = '';

    switch (normalizedOutcome) {
        case 'ace':
            pointWinner = current.servingTeam;
            label = `${current.servingTeam === 'home' ? 'Home' : 'Away'} ace`;
            break;
        case 'service_error':
        case 'service-error':
        case 'service error':
            pointWinner = current.servingTeam === 'home' ? 'away' : 'home';
            label = `${current.servingTeam === 'home' ? 'Home' : 'Away'} service error`;
            break;
        case 'home_point':
        case 'home-point':
        case 'home point':
            pointWinner = 'home';
            label = 'Home in-play point';
            break;
        case 'away_point':
        case 'away-point':
        case 'away point':
            pointWinner = 'away';
            label = 'Away in-play point';
            break;
        default:
            throw new Error(`Unknown volleyball outcome: ${outcome}`);
    }

    const next = {
        ...current,
        homeScore: current.homeScore + (pointWinner === 'home' ? 1 : 0),
        awayScore: current.awayScore + (pointWinner === 'away' ? 1 : 0),
        servingTeam: pointWinner
    };

    return {
        ...next,
        pointWinner,
        sideOut: current.servingTeam !== pointWinner,
        outcome: normalizedOutcome,
        description: `${label}: ${next.homeScore}-${next.awayScore}`
    };
}
