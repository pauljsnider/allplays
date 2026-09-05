"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DIAMOND_RULES_PROFILES = void 0;
exports.listDiamondRulesProfiles = listDiamondRulesProfiles;
exports.getDiamondRulesProfile = getDiamondRulesProfile;
exports.requireDiamondRulesProfile = requireDiamondRulesProfile;
const contracts_1 = require("./contracts");
function freezeProfile(profile) {
    Object.freeze(profile.runAheadRules);
    Object.freeze(profile.tiebreaker);
    Object.freeze(profile.dpFlex);
    Object.freeze(profile.courtesyRunner);
    Object.freeze(profile.droppedThirdStrike);
    return Object.freeze(profile);
}
const BASEBALL_OBR_V1 = freezeProfile({
    id: 'baseball-obr',
    version: 1,
    name: 'Baseball — OBR style',
    sport: 'baseball',
    scheduledInnings: 9,
    eraInningsBasis: 9,
    timeLimitMinutes: null,
    inningRunLimit: null,
    runAheadRules: [],
    tiebreaker: { enabled: false, startInning: 10, runnerBase: 'second' },
    continuousBatting: false,
    freeSubstitution: false,
    starterReentryLimit: 0,
    allowsDh: true,
    allowsEh: false,
    allowsEp: false,
    dpFlex: { enabled: false, flexMayBatForDpOnly: false },
    courtesyRunner: { pitcher: false, catcher: false },
    droppedThirdStrike: { enabled: true, disallowWhenFirstOccupiedWithFewerThanTwoOuts: true },
    illegalPitchPolicy: 'ball',
    lookBackRule: false,
    leavingEarlyRule: 'appeal'
});
const BASEBALL_NFHS_V1 = freezeProfile({
    id: 'baseball-nfhs',
    version: 1,
    name: 'Baseball — NFHS style',
    sport: 'baseball',
    scheduledInnings: 7,
    eraInningsBasis: 7,
    timeLimitMinutes: null,
    inningRunLimit: null,
    runAheadRules: [{ afterInning: 5, runDifferential: 10 }],
    tiebreaker: { enabled: false, startInning: 8, runnerBase: 'second' },
    continuousBatting: false,
    freeSubstitution: false,
    starterReentryLimit: 1,
    allowsDh: true,
    allowsEh: true,
    allowsEp: false,
    dpFlex: { enabled: false, flexMayBatForDpOnly: false },
    courtesyRunner: { pitcher: true, catcher: true },
    droppedThirdStrike: { enabled: true, disallowWhenFirstOccupiedWithFewerThanTwoOuts: true },
    illegalPitchPolicy: 'ball',
    lookBackRule: false,
    leavingEarlyRule: 'appeal'
});
const BASEBALL_YOUTH_V1 = freezeProfile({
    id: 'baseball-youth',
    version: 1,
    name: 'Baseball — configurable youth',
    sport: 'baseball',
    scheduledInnings: 6,
    eraInningsBasis: 6,
    timeLimitMinutes: 90,
    inningRunLimit: 5,
    runAheadRules: [{ afterInning: 4, runDifferential: 10 }],
    tiebreaker: { enabled: true, startInning: 7, runnerBase: 'second' },
    continuousBatting: true,
    freeSubstitution: true,
    starterReentryLimit: 99,
    allowsDh: false,
    allowsEh: true,
    allowsEp: false,
    dpFlex: { enabled: false, flexMayBatForDpOnly: false },
    courtesyRunner: { pitcher: true, catcher: true },
    droppedThirdStrike: { enabled: true, disallowWhenFirstOccupiedWithFewerThanTwoOuts: true },
    illegalPitchPolicy: 'configurable',
    lookBackRule: false,
    leavingEarlyRule: 'appeal'
});
const FASTPITCH_NFHS_V1 = freezeProfile({
    id: 'fastpitch-nfhs',
    version: 1,
    name: 'Fastpitch — NFHS style',
    sport: 'fastpitch',
    scheduledInnings: 7,
    eraInningsBasis: 7,
    timeLimitMinutes: null,
    inningRunLimit: null,
    runAheadRules: [{ afterInning: 5, runDifferential: 10 }],
    tiebreaker: { enabled: true, startInning: 8, runnerBase: 'second' },
    continuousBatting: false,
    freeSubstitution: false,
    starterReentryLimit: 1,
    allowsDh: false,
    allowsEh: true,
    allowsEp: true,
    dpFlex: { enabled: true, flexMayBatForDpOnly: true },
    courtesyRunner: { pitcher: true, catcher: true },
    droppedThirdStrike: { enabled: true, disallowWhenFirstOccupiedWithFewerThanTwoOuts: true },
    illegalPitchPolicy: 'ball_and_advance',
    lookBackRule: true,
    leavingEarlyRule: 'immediate_out'
});
const FASTPITCH_YOUTH_V1 = freezeProfile({
    id: 'fastpitch-youth',
    version: 1,
    name: 'Fastpitch — configurable youth',
    sport: 'fastpitch',
    scheduledInnings: 6,
    eraInningsBasis: 7,
    timeLimitMinutes: 80,
    inningRunLimit: 5,
    runAheadRules: [{ afterInning: 4, runDifferential: 10 }],
    tiebreaker: { enabled: true, startInning: 7, runnerBase: 'second' },
    continuousBatting: true,
    freeSubstitution: true,
    starterReentryLimit: 1,
    allowsDh: false,
    allowsEh: true,
    allowsEp: true,
    dpFlex: { enabled: true, flexMayBatForDpOnly: true },
    courtesyRunner: { pitcher: true, catcher: true },
    droppedThirdStrike: { enabled: true, disallowWhenFirstOccupiedWithFewerThanTwoOuts: true },
    illegalPitchPolicy: 'configurable',
    lookBackRule: true,
    leavingEarlyRule: 'immediate_out'
});
exports.DIAMOND_RULES_PROFILES = Object.freeze([
    BASEBALL_OBR_V1,
    BASEBALL_NFHS_V1,
    BASEBALL_YOUTH_V1,
    FASTPITCH_NFHS_V1,
    FASTPITCH_YOUTH_V1
]);
function listDiamondRulesProfiles() {
    return exports.DIAMOND_RULES_PROFILES;
}
function getDiamondRulesProfile(id, version) {
    return exports.DIAMOND_RULES_PROFILES.find((profile) => profile.id === id && profile.version === version) ?? null;
}
function requireDiamondRulesProfile(id, version) {
    const profile = getDiamondRulesProfile(id, version);
    if (!profile) {
        throw new contracts_1.DiamondDomainError('unsupported-rules-profile', `Unsupported Diamond rules profile ${id}@${String(version)}.`);
    }
    return profile;
}
