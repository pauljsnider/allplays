export const DIAMOND_RULES_PROFILE_VERSION = 1;

export const DIAMOND_RULES_PROFILES = Object.freeze([
    Object.freeze({ id: 'baseball-obr', version: 1, sport: 'baseball', label: 'Baseball — OBR style', scheduledInnings: 9 }),
    Object.freeze({ id: 'baseball-nfhs', version: 1, sport: 'baseball', label: 'Baseball — NFHS style', scheduledInnings: 7 }),
    Object.freeze({ id: 'baseball-youth', version: 1, sport: 'baseball', label: 'Baseball — configurable youth', scheduledInnings: 6 }),
    Object.freeze({ id: 'fastpitch-nfhs', version: 1, sport: 'fastpitch', label: 'Fastpitch — NFHS style', scheduledInnings: 7 }),
    Object.freeze({ id: 'fastpitch-youth', version: 1, sport: 'fastpitch', label: 'Fastpitch — configurable youth', scheduledInnings: 6 })
]);

const profileByKey = new Map(DIAMOND_RULES_PROFILES.map((profile) => [`${profile.id}@${profile.version}`, profile]));

export function normalizeDiamondRulesSport(value) {
    const sport = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (sport === 'baseball') return 'baseball';
    if (sport === 'softball' || sport === 'fastpitch' || sport === 'fastpitch softball') return 'fastpitch';
    return '';
}

export function getDiamondRulesProfile(profileId, version = DIAMOND_RULES_PROFILE_VERSION) {
    const id = typeof profileId === 'string' ? profileId.trim() : '';
    const normalizedVersion = Number(version);
    if (!id || !Number.isInteger(normalizedVersion)) return null;
    return profileByKey.get(`${id}@${normalizedVersion}`) || null;
}

export function listDiamondRulesProfilesForSport(sport) {
    const normalizedSport = normalizeDiamondRulesSport(sport);
    if (!normalizedSport) return [];
    return DIAMOND_RULES_PROFILES.filter((profile) => profile.sport === normalizedSport);
}

export function getDefaultDiamondRulesProfile(sport) {
    const normalizedSport = normalizeDiamondRulesSport(sport);
    const defaultId = normalizedSport === 'baseball'
        ? 'baseball-youth'
        : normalizedSport === 'fastpitch'
            ? 'fastpitch-youth'
            : '';
    return defaultId ? getDiamondRulesProfile(defaultId, DIAMOND_RULES_PROFILE_VERSION) : null;
}

export function buildDiamondTeamSetup(sport, options = {}) {
    const requested = getDiamondRulesProfile(options.rulesProfileId, options.rulesProfileVersion);
    const profile = requested && requested.sport === normalizeDiamondRulesSport(sport)
        ? requested
        : getDefaultDiamondRulesProfile(sport);
    if (!profile) return null;
    return {
        enabled: options.enabled !== false,
        sport: profile.sport,
        rulesProfileId: profile.id,
        rulesProfileVersion: profile.version,
        captureMode: options.captureMode === 'full' ? 'full' : 'quick'
    };
}
