/**
 * Practice Command Center - Drill Constants
 * Skills taxonomy, types, and levels for drill classification.
 * Stored as JS constants (not Firestore) since they change rarely.
 * Keyed by sport for multi-sport extensibility.
 */

export const DRILL_SKILLS = {
    Soccer: {
        "Awareness": ["attacking", "defending", "identifying space", "providing support", "change of direction"],
        "Ball Control": ["dribbling", "receiving", "turning"],
        "Communication": ["communication"],
        "Conditioning": ["conditioning"],
        "Finishing": ["finishing"],
        "Goalkeeping": ["basics", "conditioning", "distribution", "diving", "reflexes", "situational"],
        "Passing": ["passing", "short passing", "long passing", "wall passing"],
        "Shooting": ["power", "finishing", "volleys", "long shots", "driven shots", "ball striking"],
        "Dribbling": ["ball mastery", "close control", "speed dribbling", "1v1 moves"],
        "First Touch": ["ground control", "aerial control", "turning with ball", "one-touch control"],
        "Fitness": ["speed", "agility", "endurance"],
        "Other": ["ice breaker", "strength building"]
    }
};

export const DRILL_TYPES = ["Warm-up", "Tactical", "Technical", "Physical", "Game"];

export const DRILL_LEVELS = ["All", "Initial", "Basic", "Intermediate", "Advanced", "Professional"];

export const DRILL_AGE_GROUPS = ["All", "U6", "U7", "U8", "U6-U8", "U9-U10", "U10-U12", "U13-U14", "U15-U18"];

/** Flat list of all skill tags for a given sport */
export function getAllSkillTags(sport = 'Soccer') {
    const categories = DRILL_SKILLS[sport];
    if (!categories) return [];
    const tags = new Set();
    Object.values(categories).forEach(arr => arr.forEach(s => tags.add(s)));
    return [...tags].sort();
}

/** Color classes for drill type badges */
export const DRILL_TYPE_COLORS = {
    "Warm-up":   { bg: 'bg-green-100',  text: 'text-green-800',  bar: 'bg-green-400' },
    "Tactical":  { bg: 'bg-blue-100',   text: 'text-blue-800',   bar: 'bg-blue-400' },
    "Technical": { bg: 'bg-purple-100',  text: 'text-purple-800', bar: 'bg-purple-400' },
    "Physical":  { bg: 'bg-orange-100',  text: 'text-orange-800', bar: 'bg-orange-400' },
    "Game":      { bg: 'bg-red-100',     text: 'text-red-800',    bar: 'bg-red-400' }
};
