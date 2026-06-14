export const SPORT_STAT_TEMPLATES = {
    Basketball: {
        sport: 'Basketball',
        name: 'Basketball Standard',
        baseType: 'Basketball',
        columns: ['PTS', 'REB', 'AST', 'STL', 'TO']
    },
    Soccer: {
        sport: 'Soccer',
        name: 'Soccer Standard',
        baseType: 'Soccer',
        columns: ['GOALS', 'SHOTS', 'PASSES', 'BLOCKS', 'HUSTLE']
    },
    Baseball: {
        sport: 'Baseball',
        name: 'Baseball Standard',
        baseType: 'Baseball',
        columns: ['AB', 'H', 'R', 'RBI', 'BB', 'FP']
    },
    Softball: {
        sport: 'Softball',
        name: 'Softball Standard',
        baseType: 'Softball',
        columns: ['AB', 'H', 'R', 'RBI', 'BB', 'FP']
    }
};

function normalizeSport(value) {
    return String(value || '').trim().toLowerCase();
}

export function getSportStatTemplate(sport) {
    const normalized = normalizeSport(sport);
    return Object.values(SPORT_STAT_TEMPLATES).find(template => normalizeSport(template.sport) === normalized) || null;
}

export function getSportTemplateOptions() {
    return Object.values(SPORT_STAT_TEMPLATES);
}

