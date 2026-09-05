export const DIAMOND_TRACKING_ENGINE = 'diamond-v2';

export const DIAMOND_COVERAGE_STATUSES = Object.freeze([
    'complete',
    'partial',
    'not_collected'
]);

const COVERAGE_STATUS_SET = new Set(DIAMOND_COVERAGE_STATUSES);
const MAX_STAT_KEYS = 256;
const SAFE_STAT_KEY = /^[a-z0-9][a-z0-9_]{0,63}$/;
const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const rawStat = (id, label, group, options = {}) => Object.freeze({
    id,
    label,
    acronym: label,
    group,
    scope: 'player',
    visibility: 'public',
    format: 'number',
    precision: 0,
    rankingOrder: options.rankingOrder === 'asc' ? 'asc' : 'desc',
    topStat: options.topStat === true
});

const derivedStat = (id, label, group, formula, options = {}) => Object.freeze({
    id,
    label,
    acronym: label,
    formula,
    group,
    scope: 'player',
    visibility: 'public',
    format: 'number',
    precision: Number.isInteger(options.precision) ? options.precision : 3,
    rankingOrder: options.rankingOrder === 'asc' ? 'asc' : 'desc',
    topStat: options.topStat === true
});

/**
 * The stored-key catalog written by diamond-scorebook-projections.cjs. Keep
 * these IDs additive: existing non-Diamond schemas and their column order are
 * intentionally unaffected.
 */
export const DIAMOND_PLAYER_STAT_CATALOG = Object.freeze([
    rawStat('g', 'G', 'Batting'),
    rawStat('gs', 'GS', 'Batting'),
    rawStat('pa', 'PA', 'Batting'),
    rawStat('ab', 'AB', 'Batting', { topStat: true }),
    rawStat('r', 'R', 'Batting', { topStat: true }),
    rawStat('h', 'H', 'Batting', { topStat: true }),
    rawStat('1b', '1B', 'Batting'),
    rawStat('2b', '2B', 'Batting'),
    rawStat('3b', '3B', 'Batting'),
    rawStat('hr', 'HR', 'Batting', { topStat: true }),
    rawStat('tb', 'TB', 'Batting'),
    rawStat('rbi', 'RBI', 'Batting', { topStat: true }),
    rawStat('bb', 'BB', 'Plate Discipline', { topStat: true }),
    rawStat('ibb', 'IBB', 'Plate Discipline'),
    rawStat('hbp', 'HBP', 'Plate Discipline'),
    rawStat('so', 'SO', 'Plate Discipline', { rankingOrder: 'asc' }),
    rawStat('sf', 'SF', 'Batting'),
    rawStat('sh', 'SH', 'Batting'),
    rawStat('roe', 'ROE', 'Batting'),
    rawStat('fc', 'FC', 'Batting'),
    rawStat('gidp', 'GIDP', 'Batting', { rankingOrder: 'asc' }),
    derivedStat('avg', 'AVG', 'Batting Rates', 'H/AB', { topStat: true }),
    derivedStat('obp', 'OBP', 'Batting Rates', '(H+BB+HBP)/(AB+BB+HBP+SF)', { topStat: true }),
    derivedStat('slg', 'SLG', 'Batting Rates', 'TB/AB', { topStat: true }),
    derivedStat('ops', 'OPS', 'Batting Rates', '((H+BB+HBP)/(AB+BB+HBP+SF))+(TB/AB)', { topStat: true }),
    derivedStat('bb_rate', 'BB RATE', 'Batting Rates', '(BB+IBB)/PA'),
    derivedStat('strikeout_rate', 'K RATE', 'Batting Rates', 'SO/PA', { rankingOrder: 'asc' }),
    rawStat('sb', 'SB', 'Baserunning', { topStat: true }),
    rawStat('cs', 'CS', 'Baserunning', { rankingOrder: 'asc' }),
    rawStat('pickoffs', 'PKO', 'Baserunning', { rankingOrder: 'asc' }),
    rawStat('br_advances', 'ADV', 'Baserunning'),
    rawStat('br_outs', 'BR OUT', 'Baserunning', { rankingOrder: 'asc' }),
    derivedStat('stolen_base_rate', 'SB RATE', 'Baserunning', 'SB/(SB+CS)', { topStat: true }),
    rawStat('p_app', 'APP', 'Pitching'),
    rawStat('p_gs', 'P GS', 'Pitching'),
    rawStat('w', 'W', 'Pitching', { topStat: true }),
    rawStat('l', 'L', 'Pitching', { rankingOrder: 'asc' }),
    rawStat('sv', 'SV', 'Pitching'),
    rawStat('bf', 'BF', 'Pitching'),
    rawStat('ip_outs', 'IP OUTS', 'Pitching'),
    rawStat('p_h', 'H ALLOWED', 'Pitching', { rankingOrder: 'asc' }),
    rawStat('p_r', 'R ALLOWED', 'Pitching', { rankingOrder: 'asc' }),
    rawStat('er', 'ER', 'Pitching', { rankingOrder: 'asc' }),
    rawStat('p_bb', 'BB ALLOWED', 'Pitching', { rankingOrder: 'asc' }),
    rawStat('p_ibb', 'IBB ALLOWED', 'Pitching', { rankingOrder: 'asc' }),
    rawStat('p_hbp', 'HBP ALLOWED', 'Pitching', { rankingOrder: 'asc' }),
    rawStat('p_so', 'K', 'Pitching', { topStat: true }),
    rawStat('p_hr', 'HR ALLOWED', 'Pitching', { rankingOrder: 'asc' }),
    rawStat('wp', 'WP', 'Pitching', { rankingOrder: 'asc' }),
    rawStat('balk_illegal_pitch', 'BK/IP', 'Pitching', { rankingOrder: 'asc' }),
    rawStat('inherited_runners', 'IR', 'Pitching'),
    rawStat('inherited_scored', 'IRS', 'Pitching', { rankingOrder: 'asc' }),
    rawStat('pitches', 'PITCHES', 'Pitch Detail'),
    rawStat('strikes', 'STRIKES', 'Pitch Detail'),
    rawStat('first_pitch_strikes', 'FPS', 'Pitch Detail'),
    derivedStat('innings_pitched', 'IP', 'Pitching Rates', 'INNINGS_PITCHED', { precision: 1 }),
    derivedStat('era', 'ERA', 'Pitching Rates', 'ERA', { precision: 2, rankingOrder: 'asc', topStat: true }),
    derivedStat('whip', 'WHIP', 'Pitching Rates', '((P_BB+P_IBB+P_H)*3)/IP_OUTS', { precision: 2, rankingOrder: 'asc', topStat: true }),
    derivedStat('strikeout_walk_ratio', 'K/BB', 'Pitching Rates', 'P_SO/(P_BB+P_IBB)', { precision: 2, topStat: true }),
    derivedStat('strike_rate', 'STRIKE RATE', 'Pitching Rates', 'STRIKES/PITCHES'),
    derivedStat('first_pitch_strike_rate', 'FPS RATE', 'Pitching Rates', 'FIRST_PITCH_STRIKES/BF'),
    rawStat('defensive_outs', 'DEF OUTS', 'Fielding'),
    rawStat('po', 'PO', 'Fielding'),
    rawStat('a', 'A', 'Fielding'),
    rawStat('e', 'E', 'Fielding', { rankingOrder: 'asc' }),
    rawStat('dp', 'DP', 'Fielding'),
    rawStat('tp', 'TP', 'Fielding'),
    rawStat('pb', 'PB', 'Fielding', { rankingOrder: 'asc' }),
    rawStat('fp', 'FP', 'Fielding', { topStat: true }),
    derivedStat('fpct', 'FPCT', 'Fielding Rates', '(PO+A)/(PO+A+E)', { topStat: true }),
    derivedStat('chances', 'CH', 'Fielding Rates', 'PO+A+E', { precision: 0 })
]);

export const DIAMOND_TEAM_STAT_CATALOG = Object.freeze([
    rawStat('r', 'R', 'Team'),
    rawStat('h', 'H', 'Team'),
    rawStat('e', 'E', 'Team', { rankingOrder: 'asc' }),
    rawStat('lob', 'LOB', 'Team'),
    rawStat('risp_opportunities', 'RISP PA', 'Situational'),
    rawStat('risp_hits', 'RISP H', 'Situational'),
    rawStat('two_out_runs', '2-OUT R', 'Situational'),
    rawStat('two_strike_pa', '2-STRIKE PA', 'Situational'),
    rawStat('two_strike_hits', '2-STRIKE H', 'Situational'),
    rawStat('first_pitch_strike_opportunities', 'FPS OPP', 'Pitch Detail'),
    rawStat('first_pitch_strikes', 'FPS', 'Pitch Detail')
]);

const PLAYER_STAT_FAMILY = Object.freeze(Object.fromEntries([
    ['g', 'gs', 'pa', 'ab', 'r', 'h', '1b', '2b', '3b', 'hr', 'tb', 'rbi', 'bb', 'ibb', 'hbp', 'so', 'sf', 'sh', 'roe', 'fc', 'gidp', 'avg', 'obp', 'slg', 'ops', 'bb_rate', 'strikeout_rate'].map((key) => [key, 'batting']),
    ['sb', 'cs', 'pickoffs', 'br_advances', 'br_outs', 'stolen_base_rate'].map((key) => [key, 'baserunning']),
    ['p_app', 'p_gs', 'w', 'l', 'sv', 'bf', 'ip_outs', 'p_h', 'p_r', 'er', 'p_bb', 'p_ibb', 'p_hbp', 'p_so', 'p_hr', 'wp', 'balk_illegal_pitch', 'inherited_runners', 'inherited_scored', 'innings_pitched', 'era', 'whip', 'strikeout_walk_ratio'].map((key) => [key, 'pitching']),
    ['pitches', 'strikes', 'first_pitch_strikes', 'strike_rate', 'first_pitch_strike_rate'].map((key) => [key, 'pitches']),
    ['defensive_outs', 'po', 'a', 'e', 'dp', 'tp', 'pb', 'fp', 'fpct', 'chances'].map((key) => [key, 'fielding'])
].flat()));

const DERIVED_STAT_IDS = new Set(DIAMOND_PLAYER_STAT_CATALOG.filter((definition) => definition.formula).map((definition) => definition.id));
const LEADING_ZEROLESS_IDS = new Set(['avg', 'obp', 'slg', 'ops', 'bb_rate', 'strikeout_rate', 'stolen_base_rate', 'strike_rate', 'first_pitch_strike_rate', 'fpct']);

function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeStatKey(value) {
    const key = String(value || '').trim().toLowerCase();
    return SAFE_STAT_KEY.test(key) && !BLOCKED_KEYS.has(key) ? key : '';
}

function toRevision(value) {
    const revision = Number(value);
    return Number.isSafeInteger(revision) && revision >= 0 ? revision : null;
}

function sanitizeStatMap(value) {
    if (!isRecord(value)) return {};
    const result = {};
    Object.entries(value).slice(0, MAX_STAT_KEYS).forEach(([rawKey, rawValue]) => {
        const key = normalizeStatKey(rawKey);
        if (!key) return;
        if (typeof rawValue === 'number' && Number.isFinite(rawValue)) result[key] = rawValue;
        else if (typeof rawValue === 'string' && rawValue.trim() && rawValue.length <= 32) result[key] = rawValue.trim();
        else if (typeof rawValue === 'boolean') result[key] = rawValue;
        else if (rawValue === null) result[key] = null;
    });
    return result;
}

function normalizeCoverage(value) {
    if (!isRecord(value)) return {};
    const result = {};
    Object.entries(value).slice(0, MAX_STAT_KEYS).forEach(([rawKey, rawStatus]) => {
        const key = normalizeStatKey(rawKey);
        if (key && COVERAGE_STATUS_SET.has(rawStatus)) result[key] = rawStatus;
    });
    return result;
}

function normalizeFamilyCoverage(value) {
    if (!isRecord(value)) return {};
    return Object.entries(value).reduce((result, [family, status]) => {
        if (COVERAGE_STATUS_SET.has(status)) result[family] = status;
        return result;
    }, {});
}

function getAuthoritativeRevision(game) {
    return toRevision(game?.diamondProjectionRevision ?? game?.diamondRevision);
}

export function isDiamondV2Game(game) {
    return game?.trackingEngine === DIAMOND_TRACKING_ENGINE;
}

export function getPublicDiamondStatCatalog(resolvedConfig = null, scope = 'player') {
    const normalizedScope = scope === 'team' ? 'team' : 'player';
    const catalog = normalizedScope === 'team' ? DIAMOND_TEAM_STAT_CATALOG : DIAMOND_PLAYER_STAT_CATALOG;
    const configured = Array.isArray(resolvedConfig?.statDefinitions)
        ? resolvedConfig.statDefinitions.filter((definition) => (
            normalizedScope === 'team'
                ? definition?.scope === 'team'
                : definition?.scope !== 'team'
        ))
        : [];
    const configuredById = new Map(configured.map((definition) => [
        normalizeStatKey(definition?.id || definition?.acronym || definition?.label),
        definition
    ]).filter(([id]) => id));
    const privateIds = new Set(configured
        .filter((definition) => String(definition?.visibility || '').trim().toLowerCase() === 'private')
        .map((definition) => normalizeStatKey(definition?.id || definition?.acronym || definition?.label))
        .filter(Boolean));

    return Object.freeze(catalog
        .filter((definition) => !privateIds.has(definition.id))
        .map((definition) => {
            const override = configuredById.get(definition.id);
            if (!override) return definition;
            return Object.freeze({
                ...definition,
                ...override,
                id: definition.id,
                scope: normalizedScope,
                visibility: 'public'
            });
        }));
}

export function resolveDiamondProjectionState(game, sourceRevisions = [], options = {}) {
    if (!isDiamondV2Game(game)) {
        return Object.freeze({
            isDiamond: false,
            status: 'legacy',
            pending: false,
            authoritativeRevision: null,
            sourceRevisions: []
        });
    }

    const authoritativeRevision = getAuthoritativeRevision(game);
    const normalizedSources = [...new Set((Array.isArray(sourceRevisions) ? sourceRevisions : [])
        .map(toRevision)
        .filter((revision) => revision !== null))].sort((left, right) => left - right);
    const advertisedStatus = String(game?.diamondProjectionStatus || options.projectionStatus || '').trim().toLowerCase();
    const advertisedCurrent = advertisedStatus === 'current' || advertisedStatus === 'complete';
    const revisionMismatch = authoritativeRevision !== null && normalizedSources.some((revision) => revision !== authoritativeRevision);
    const missingDocuments = options.expectDocuments === true && normalizedSources.length === 0;
    const pending = !advertisedCurrent || revisionMismatch || missingDocuments || options.documentsComplete === false;

    return Object.freeze({
        isDiamond: true,
        status: pending ? 'pending' : 'current',
        pending,
        authoritativeRevision,
        sourceRevisions: Object.freeze(normalizedSources),
        advertisedStatus: advertisedStatus || 'missing'
    });
}

export function readCoverageAwareStatDocument(document, game = {}) {
    const rawStats = sanitizeStatMap(document?.stats);
    if (!isDiamondV2Game(game)) {
        return Object.freeze({
            isDiamond: false,
            values: Object.freeze(rawStats),
            completeValues: Object.freeze({ ...rawStats }),
            statCoverage: Object.freeze({}),
            observedStatKeys: Object.freeze([]),
            unavailableStatKeys: Object.freeze([]),
            sourceRevision: null,
            projection: resolveDiamondProjectionState(game)
        });
    }

    if (document?.trackingEngine !== DIAMOND_TRACKING_ENGINE) {
        return Object.freeze({
            isDiamond: true,
            values: Object.freeze({}),
            completeValues: Object.freeze({}),
            statCoverage: Object.freeze({}),
            observedStatKeys: Object.freeze([]),
            unavailableStatKeys: Object.freeze(DIAMOND_PLAYER_STAT_CATALOG.map((definition) => definition.id)),
            sourceRevision: null,
            projection: resolveDiamondProjectionState(game, [], { expectDocuments: true, documentsComplete: false })
        });
    }

    const completeCandidates = {
        ...rawStats,
        ...sanitizeStatMap(document?.derivedStats)
    };
    const observedCandidates = {
        ...sanitizeStatMap(document?.observedStats),
        ...sanitizeStatMap(document?.observedDerivedStats)
    };
    const statCoverage = normalizeCoverage(document?.statCoverage);
    const candidateKeys = [...new Set([
        ...Object.keys(statCoverage),
        ...Object.keys(completeCandidates),
        ...Object.keys(observedCandidates),
        ...(Array.isArray(document?.unavailableDerivedStats) ? document.unavailableDerivedStats.map(normalizeStatKey).filter(Boolean) : [])
    ])].slice(0, MAX_STAT_KEYS);
    const values = {};
    const completeValues = {};
    const observedStatKeys = [];
    const unavailableStatKeys = [];

    candidateKeys.forEach((key) => {
        const status = statCoverage[key];
        if (status === 'complete' && Object.prototype.hasOwnProperty.call(completeCandidates, key)) {
            values[key] = completeCandidates[key];
            completeValues[key] = completeCandidates[key];
            return;
        }
        if (status === 'partial' && Object.prototype.hasOwnProperty.call(observedCandidates, key)) {
            values[key] = observedCandidates[key];
            observedStatKeys.push(key);
            return;
        }
        unavailableStatKeys.push(key);
    });

    const sourceRevision = toRevision(document?.sourceRevision);
    const projection = resolveDiamondProjectionState(game, sourceRevision === null ? [] : [sourceRevision], {
        expectDocuments: true,
        documentsComplete: document?.complete === true
    });
    const trustedCompleteValues = projection.pending ? {} : completeValues;

    return Object.freeze({
        isDiamond: true,
        values: Object.freeze(values),
        // Stale/pending values remain visible with their explicit source
        // revision, but must not feed rankings, incentives, or insights as an
        // authoritative complete result.
        completeValues: Object.freeze(trustedCompleteValues),
        statCoverage: Object.freeze(statCoverage),
        familyCoverage: Object.freeze(normalizeFamilyCoverage(document?.coverage)),
        observedStatKeys: Object.freeze(observedStatKeys.sort()),
        unavailableStatKeys: Object.freeze(unavailableStatKeys.sort()),
        sourceRevision,
        projection
    });
}

export function readCoverageAwareOpponentStats(record, game = {}) {
    if (!isDiamondV2Game(game)) {
        const { name, number, notes, playerId, photoUrl, ...stats } = isRecord(record) ? record : {};
        void name;
        void number;
        void notes;
        void playerId;
        void photoUrl;
        return readCoverageAwareStatDocument({ stats }, {});
    }

    const familyCoverage = normalizeFamilyCoverage(record?.diamondCoverage);
    const sourceRevision = toRevision(record?.diamondSourceRevision);
    const metadataKeys = new Set(['name', 'number', 'notes', 'playerid', 'photourl', 'diamondcoverage', 'diamondsourcerevision']);
    const candidateValues = sanitizeStatMap(Object.entries(isRecord(record) ? record : {}).reduce((values, [key, value]) => {
        if (!metadataKeys.has(String(key || '').toLowerCase())) values[key] = value;
        return values;
    }, {}));
    const values = {};
    const completeValues = {};
    const statCoverage = {};
    const observedStatKeys = [];

    DIAMOND_PLAYER_STAT_CATALOG.forEach(({ id }) => {
        const family = PLAYER_STAT_FAMILY[id];
        const status = familyCoverage[family] || 'not_collected';
        statCoverage[id] = status;
        if (!Object.prototype.hasOwnProperty.call(candidateValues, id)) return;
        if (status === 'complete') {
            values[id] = candidateValues[id];
            completeValues[id] = candidateValues[id];
        } else if (status === 'partial') {
            values[id] = candidateValues[id];
            observedStatKeys.push(id);
        }
    });

    const projection = resolveDiamondProjectionState(game, sourceRevision === null ? [] : [sourceRevision], { expectDocuments: true });

    return Object.freeze({
        isDiamond: true,
        values: Object.freeze(values),
        completeValues: Object.freeze(projection.pending ? {} : completeValues),
        statCoverage: Object.freeze(statCoverage),
        familyCoverage: Object.freeze(familyCoverage),
        observedStatKeys: Object.freeze(observedStatKeys.sort()),
        unavailableStatKeys: Object.freeze(DIAMOND_PLAYER_STAT_CATALOG.map(({ id }) => id).filter((id) => !Object.prototype.hasOwnProperty.call(values, id))),
        sourceRevision,
        projection
    });
}

function coverageForAggregate(statuses, hasValue) {
    if (statuses.length > 0 && statuses.every((status) => status === 'complete')) return 'complete';
    if (statuses.some((status) => status === 'partial')) return 'partial';
    return hasValue ? 'partial' : 'not_collected';
}

function safeRatio(numerator, denominator) {
    return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0 ? numerator / denominator : null;
}

function formatInningsFromOuts(outs) {
    return Number.isSafeInteger(outs) && outs >= 0 ? `${Math.floor(outs / 3)}.${outs % 3}` : null;
}

function getEraBasis(game) {
    const profileId = String(game?.rulesProfileId || game?.diamondRulesProfileId || '')
        .trim()
        .replace(/@\d+$/, '');
    if (profileId === 'baseball-obr') return 9;
    if (profileId === 'baseball-nfhs') return 7;
    if (profileId === 'baseball-youth') return 6;
    if (profileId === 'fastpitch-nfhs' || profileId === 'fastpitch-youth') return 7;
    return null;
}

function deriveSeasonStats(stats, familyCoverage, eraBasis) {
    const derived = {};
    const derivedCoverage = {};
    const setRatio = (id, family, numerator, denominator) => {
        const coverage = familyCoverage[family] || 'not_collected';
        derivedCoverage[id] = coverage;
        if (coverage !== 'complete') return;
        const value = safeRatio(numerator, denominator);
        if (value !== null) derived[id] = value;
    };

    setRatio('avg', 'batting', Number(stats.h || 0), Number(stats.ab || 0));
    setRatio('obp', 'batting', Number(stats.h || 0) + Number(stats.bb || 0) + Number(stats.hbp || 0), Number(stats.ab || 0) + Number(stats.bb || 0) + Number(stats.hbp || 0) + Number(stats.sf || 0));
    setRatio('slg', 'batting', Number(stats.tb || 0), Number(stats.ab || 0));
    derivedCoverage.ops = familyCoverage.batting || 'not_collected';
    if (Object.prototype.hasOwnProperty.call(derived, 'obp') && Object.prototype.hasOwnProperty.call(derived, 'slg')) derived.ops = derived.obp + derived.slg;
    setRatio('bb_rate', 'batting', Number(stats.bb || 0) + Number(stats.ibb || 0), Number(stats.pa || 0));
    setRatio('strikeout_rate', 'batting', Number(stats.so || 0), Number(stats.pa || 0));
    setRatio('stolen_base_rate', 'baserunning', Number(stats.sb || 0), Number(stats.sb || 0) + Number(stats.cs || 0));

    derivedCoverage.innings_pitched = familyCoverage.pitching || 'not_collected';
    if (familyCoverage.pitching === 'complete') {
        const innings = formatInningsFromOuts(Number(stats.ip_outs));
        if (innings !== null) derived.innings_pitched = innings;
    }
    derivedCoverage.era = familyCoverage.pitching || 'not_collected';
    if (familyCoverage.pitching === 'complete' && eraBasis !== null) {
        const era = safeRatio(Number(stats.er || 0) * eraBasis * 3, Number(stats.ip_outs || 0));
        if (era !== null) derived.era = era;
    }
    setRatio('whip', 'pitching', (Number(stats.p_bb || 0) + Number(stats.p_ibb || 0) + Number(stats.p_h || 0)) * 3, Number(stats.ip_outs || 0));
    setRatio('strikeout_walk_ratio', 'pitching', Number(stats.p_so || 0), Number(stats.p_bb || 0) + Number(stats.p_ibb || 0));
    setRatio('strike_rate', 'pitches', Number(stats.strikes || 0), Number(stats.pitches || 0));
    setRatio('first_pitch_strike_rate', 'pitches', Number(stats.first_pitch_strikes || 0), Number(stats.bf || 0));
    setRatio('fpct', 'fielding', Number(stats.po || 0) + Number(stats.a || 0), Number(stats.po || 0) + Number(stats.a || 0) + Number(stats.e || 0));
    derivedCoverage.chances = familyCoverage.fielding || 'not_collected';
    if (familyCoverage.fielding === 'complete') derived.chances = Number(stats.po || 0) + Number(stats.a || 0) + Number(stats.e || 0);
    return { derived, derivedCoverage };
}

export function aggregateCoverageAwareSeasonStats({ legacyStatsByPlayerId = {}, diamondGames = [] } = {}) {
    const statsByPlayerId = {};
    const legacyPlayerIds = new Set();
    const statusListsByPlayerId = {};
    const familyStatusListsByPlayerId = {};
    const sourceRevisions = [];
    let projectionPending = false;
    const eraBases = new Set();

    Object.entries(isRecord(legacyStatsByPlayerId) ? legacyStatsByPlayerId : {}).forEach(([playerId, values]) => {
        statsByPlayerId[playerId] = { ...sanitizeStatMap(values) };
        if (Object.keys(statsByPlayerId[playerId]).length > 0) legacyPlayerIds.add(playerId);
    });

    (Array.isArray(diamondGames) ? diamondGames : []).forEach(({ game = {}, documents = [] }) => {
        const eraBasis = getEraBasis(game);
        if (eraBasis !== null) eraBases.add(eraBasis);
        if (!Array.isArray(documents) || documents.length === 0) {
            const state = resolveDiamondProjectionState(game, [], {
                expectDocuments: String(game?.status || game?.liveStatus || '').toLowerCase() === 'completed'
            });
            projectionPending ||= state.pending;
            return;
        }

        documents.forEach(({ id, data }) => {
            const playerId = String(id || '').trim();
            if (!playerId) return;
            const view = readCoverageAwareStatDocument(data, game);
            projectionPending ||= view.projection.pending;
            if (view.sourceRevision !== null) sourceRevisions.push(view.sourceRevision);
            statsByPlayerId[playerId] ||= {};
            statusListsByPlayerId[playerId] ||= {};
            familyStatusListsByPlayerId[playerId] ||= {};

            Object.entries(view.statCoverage).forEach(([key, status]) => {
                statusListsByPlayerId[playerId][key] ||= [];
                statusListsByPlayerId[playerId][key].push(status);
            });
            Object.entries(view.familyCoverage || {}).forEach(([family, status]) => {
                familyStatusListsByPlayerId[playerId][family] ||= [];
                familyStatusListsByPlayerId[playerId][family].push(status);
            });
            Object.entries(view.values).forEach(([key, value]) => {
                if (DERIVED_STAT_IDS.has(key)) return;
                const numeric = Number(value);
                if (!Number.isFinite(numeric)) return;
                statsByPlayerId[playerId][key] = (Number(statsByPlayerId[playerId][key]) || 0) + numeric;
            });
        });
    });

    const presentationByPlayerId = {};
    const completeStatsByPlayerId = {};
    const eraBasis = eraBases.size === 1 ? [...eraBases][0] : null;
    Object.keys(statsByPlayerId).forEach((playerId) => {
        const stats = statsByPlayerId[playerId];
        const statCoverage = {};
        Object.entries(statusListsByPlayerId[playerId] || {}).forEach(([key, statuses]) => {
            statCoverage[key] = legacyPlayerIds.has(playerId)
                ? 'partial'
                : coverageForAggregate(statuses, Object.prototype.hasOwnProperty.call(stats, key));
        });
        if (legacyPlayerIds.has(playerId)) {
            Object.keys(stats).forEach((key) => {
                statCoverage[key] ||= 'partial';
            });
        }
        const familyCoverage = {};
        Object.entries(familyStatusListsByPlayerId[playerId] || {}).forEach(([family, statuses]) => {
            familyCoverage[family] = legacyPlayerIds.has(playerId)
                ? 'partial'
                : coverageForAggregate(statuses, false);
        });
        if (legacyPlayerIds.has(playerId)) {
            Object.keys(stats).forEach((key) => {
                const family = PLAYER_STAT_FAMILY[key];
                if (family) familyCoverage[family] = 'partial';
            });
        }
        // If any expected Diamond projection is missing, stale, or incomplete,
        // the season aggregate is only an observed lower bound. A complete
        // value from the games that did load cannot prove the full-season
        // value while another authoritative game is unresolved.
        if (projectionPending) {
            Object.keys(statCoverage).forEach((key) => {
                if (statCoverage[key] === 'complete') statCoverage[key] = 'partial';
            });
            Object.keys(familyCoverage).forEach((family) => {
                if (familyCoverage[family] === 'complete') familyCoverage[family] = 'partial';
            });
        }
        const { derived, derivedCoverage } = deriveSeasonStats(stats, familyCoverage, eraBasis);
        Object.assign(stats, derived);
        Object.assign(statCoverage, derivedCoverage);
        const observedStatKeys = Object.keys(statCoverage).filter((key) => statCoverage[key] === 'partial' && Object.prototype.hasOwnProperty.call(stats, key));
        const unavailableStatKeys = Object.keys(statCoverage).filter((key) => !Object.prototype.hasOwnProperty.call(stats, key));
        if (Object.keys(statusListsByPlayerId[playerId] || {}).length > 0
            || (Array.isArray(diamondGames) && diamondGames.length > 0 && legacyPlayerIds.has(playerId))) {
            presentationByPlayerId[playerId] = Object.freeze({
                isDiamond: true,
                statCoverage: Object.freeze(statCoverage),
                observedStatKeys: Object.freeze(observedStatKeys.sort()),
                unavailableStatKeys: Object.freeze(unavailableStatKeys.sort()),
                projectionPending
            });
            completeStatsByPlayerId[playerId] = Object.freeze(Object.fromEntries(
                Object.entries(stats).filter(([key]) => statCoverage[key] === 'complete')
            ));
        }
    });

    return Object.freeze({
        statsByPlayerId: Object.freeze(Object.fromEntries(Object.entries(statsByPlayerId).map(([playerId, stats]) => [playerId, Object.freeze(stats)]))),
        completeStatsByPlayerId: Object.freeze(completeStatsByPlayerId),
        presentationByPlayerId: Object.freeze(presentationByPlayerId),
        projection: Object.freeze({
            hasDiamond: Array.isArray(diamondGames) && diamondGames.length > 0,
            pending: projectionPending,
            sourceRevisions: Object.freeze([...new Set(sourceRevisions)].sort((left, right) => left - right))
        })
    });
}

export function getCoverageAwareStatValue(presentation, stats, key, definition = {}) {
    const normalizedKey = normalizeStatKey(key);
    const isDiamond = presentation?.isDiamond === true;
    const hasValue = normalizedKey && Object.prototype.hasOwnProperty.call(stats || {}, normalizedKey);
    const status = isDiamond ? (presentation?.statCoverage?.[normalizedKey] || 'not_collected') : (hasValue ? 'complete' : 'legacy_missing');
    if (!hasValue || (isDiamond && status === 'not_collected')) {
        return Object.freeze({ available: false, observed: false, status, text: '—', value: null });
    }

    const value = stats[normalizedKey];
    let text = String(value);
    const numeric = Number(value);
    if (normalizedKey === 'innings_pitched' && typeof value === 'string') {
        text = value;
    } else if (Number.isFinite(numeric)) {
        const precision = Number.isInteger(Number(definition?.precision)) && Number(definition.precision) >= 0
            ? Number(definition.precision)
            : 0;
        text = precision > 0 ? numeric.toFixed(precision) : String(Math.round(numeric));
        if (LEADING_ZEROLESS_IDS.has(normalizedKey)) text = text.replace(/^(-?)0(?=\.)/, '$1');
        if (definition?.format === 'percentage') text += '%';
    }

    return Object.freeze({
        available: true,
        observed: status === 'partial',
        status,
        text,
        value
    });
}

export function getDiamondCatalogDefinition(statId, scope = 'player') {
    const catalog = scope === 'team' ? DIAMOND_TEAM_STAT_CATALOG : DIAMOND_PLAYER_STAT_CATALOG;
    return catalog.find((definition) => definition.id === normalizeStatKey(statId)) || null;
}
