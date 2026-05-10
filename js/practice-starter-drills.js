const SHARED_DIAMOND_DRILLS = [
    {
        slug: 'throwing-ladder',
        title: 'Partner Throwing Ladder',
        type: 'Warm-up',
        level: 'All',
        skills: ['throwing', 'catching', 'partner catch'],
        duration: 10,
        players: '2+',
        cones: 0,
        description: 'Pairs build throwing rhythm by stepping back after clean catches and stepping in after misses.',
        instructions: 'Pair players 20 feet apart. Each pair makes five clean throws before taking two steps back. Keep throws chest-high, reset feet before throwing, and finish with five accurate short throws.'
    },
    {
        slug: 'grounders-to-first',
        title: 'Grounders and Throws to First',
        type: 'Technical',
        level: 'Basic',
        skills: ['ground balls', 'throws to first', 'fielding play'],
        duration: 15,
        players: '4+',
        cones: 2,
        description: 'Players field routine ground balls and make controlled throws to first base.',
        instructions: 'Set one line at shortstop depth and one first-base target. Roll grounders at game pace. Field out front, funnel to throwing hand, make one strong throw, then rotate.'
    },
    {
        slug: 'fly-ball-communication',
        title: 'Fly Ball Communication',
        type: 'Technical',
        level: 'Basic',
        skills: ['fly balls', 'communication', 'fielding play'],
        duration: 12,
        players: '3+',
        cones: 4,
        description: 'Small groups practice calling the ball early and yielding to the player with the best angle.',
        instructions: 'Place players in a shallow outfield triangle. Toss pop flies between them. The catching player calls three times, other players peel away and back up.'
    },
    {
        slug: 'base-running-turns',
        title: 'Base Running Turns',
        type: 'Physical',
        level: 'All',
        skills: ['base running', 'rounding bases', 'speed'],
        duration: 10,
        players: '4+',
        cones: 4,
        description: 'Players practice aggressive but controlled turns through first and second.',
        instructions: 'Start at home. Players run through first, round first, then round first and second on later reps. Emphasize touching the inside corner, eyes up, and slowing under control.'
    },
    {
        slug: 'tee-contact-zones',
        title: 'Tee Contact Zones',
        type: 'Technical',
        level: 'All',
        skills: ['tee work', 'contact', 'bat path'],
        duration: 15,
        players: '2+',
        cones: 0,
        description: 'Hitters work inside, middle, and outside contact points from a tee.',
        instructions: 'Set the tee at three plate locations. Hit five balls from each spot. Players should drive through the ball, keep balance, and reset between swings.'
    },
    {
        slug: 'situational-outs',
        title: 'Situational Outs',
        type: 'Game',
        level: 'Intermediate',
        skills: ['situations', 'cutoffs', 'team defense', 'fielding play'],
        duration: 18,
        players: '8+',
        cones: 0,
        description: 'Defense gets a simple situation before each ball and makes the high-percentage out.',
        instructions: 'Call a base/out situation before each rep. Put the ball in play by rolling or hitting it softly. Players call the play, make the throw, and reset quickly.'
    }
];

function normalizeSport(value) {
    return String(value || '').trim().toLowerCase();
}

function buildSportDrill(sport, drill) {
    return {
        id: `starter-${sport.toLowerCase()}-${drill.slug}`,
        source: 'starter',
        sport,
        title: drill.title,
        type: drill.type,
        level: drill.level,
        ageGroup: 'All',
        skills: drill.skills,
        description: drill.description,
        instructions: drill.instructions,
        setup: {
            duration: drill.duration,
            players: drill.players,
            cones: drill.cones,
            balls: 'Baseballs or softballs'
        }
    };
}

export const PRACTICE_STARTER_DRILLS = [
    ...SHARED_DIAMOND_DRILLS.map(drill => buildSportDrill('Baseball', drill)),
    ...SHARED_DIAMOND_DRILLS.map(drill => buildSportDrill('Softball', drill))
];

export function getStarterDrills(sport, filters = {}) {
    const targetSport = normalizeSport(sport);
    const term = filters.searchText ? String(filters.searchText).toLowerCase() : '';
    return PRACTICE_STARTER_DRILLS.filter(drill => {
        if (targetSport && normalizeSport(drill.sport) !== targetSport) return false;
        if (filters.type && drill.type !== filters.type) return false;
        if (filters.level && drill.level !== filters.level) return false;
        if (filters.skill && !drill.skills.includes(filters.skill)) return false;
        if (term) {
            const haystack = `${drill.title} ${drill.description} ${drill.skills.join(' ')}`.toLowerCase();
            if (!haystack.includes(term)) return false;
        }
        return true;
    });
}

export function getStarterDrillById(id) {
    return PRACTICE_STARTER_DRILLS.find(drill => drill.id === id) || null;
}
