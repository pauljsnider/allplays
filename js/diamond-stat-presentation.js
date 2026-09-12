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
const DIAMOND_MANAGER_STAT_VISIBILITY = 'manager-internal';
const DIAMOND_UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIAMOND_SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const SAFE_RESOURCE_ID = /^[^/]{1,128}$/u;
const MAX_PUBLIC_PLAYER_DOCUMENTS = 50;
const MAX_SOURCE_PLAY_IDS = 5000;
const DIAMOND_STAT_CONFIG_SNAPSHOT_SCHEMA_VERSION = 2;
const DIAMOND_STAT_SCOPES = new Set(['player', 'team']);
const DIAMOND_STAT_VISIBILITIES = new Set(['public', 'private']);
const SHA_256_CONSTANTS = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be,
    0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa,
    0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85,
    0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
    0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);
const DIAMOND_PUBLIC_PLAYER_DOCUMENT_KEYS = new Set([
    'schemaVersion',
    'trackingEngine',
    'projectionSchemaVersion',
    'playerId',
    'playerName',
    'playerNumber',
    'participated',
    'participationStatus',
    'participationSource',
    'didNotPlay',
    'sourceRevision',
    'checkpointHash',
    'coverage',
    'complete',
    'publicStatIds',
    'stats',
    'observedStats',
    'derivedStats',
    'observedDerivedStats',
    'statCoverage',
    'statSources',
    'sourcePlayIds',
    'unavailableDerivedStats',
    'missingStatFamilies',
    'teamId',
    'diamondGameId',
    'instanceId',
    'diamondScorebookInstanceId',
    'projectionGeneration',
    'statConfigSnapshotHash',
    'projectionHash'
]);
const DIAMOND_PUBLIC_TEAM_DOCUMENT_KEYS = new Set([
    'trackingEngine',
    'projectionSchemaVersion',
    'sourceRevision',
    'checkpointHash',
    'coverage',
    'publicStatIds',
    'side',
    'complete',
    'stats',
    'observedStats',
    'statCoverage',
    'teamId',
    'diamondGameId',
    'instanceId',
    'diamondScorebookInstanceId',
    'projectionGeneration',
    'statConfigSnapshotHash',
    'projectionHash'
]);
const DIAMOND_PUBLIC_STATS_PARTIAL_KEYS = new Set([
    'schemaVersion',
    'trackingEngine',
    'status',
    'complete'
]);
const DIAMOND_PUBLIC_STATS_COMPLETE_KEYS = new Set([
    ...DIAMOND_PUBLIC_STATS_PARTIAL_KEYS,
    'instanceId',
    'sourceRevision',
    'checkpointHash',
    'statConfigSnapshotHash',
    'projectionHash',
    'publicTeamStats'
]);

function isPlainSnapshotObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function isExactDiamondResourceId(value) {
    return typeof value === 'string'
        && value.length >= 1
        && value.length <= 128
        && value === value.trim()
        && !value.includes('/')
        && !/[\u0000-\u001f\u007f]/.test(value);
}

function isExactDiamondStatId(value) {
    return typeof value === 'string'
        && value === value.trim()
        && SAFE_STAT_KEY.test(value)
        && !BLOCKED_KEYS.has(value);
}

function canonicalDiamondSnapshotDefinitions(config) {
    if (!isPlainSnapshotObject(config) || !Array.isArray(config.statDefinitions) || config.statDefinitions.length > MAX_STAT_KEYS) {
        return null;
    }
    const seen = new Set();
    const definitions = [];
    for (const candidate of config.statDefinitions) {
        if (
            !isPlainSnapshotObject(candidate)
            || !isExactDiamondStatId(candidate.id)
            || seen.has(candidate.id)
            || !DIAMOND_STAT_SCOPES.has(candidate.scope)
            || !DIAMOND_STAT_VISIBILITIES.has(candidate.visibility)
        ) return null;
        seen.add(candidate.id);
        definitions.push({
            id: candidate.id,
            scope: candidate.scope,
            visibility: candidate.visibility
        });
    }
    return definitions.sort((left, right) => (
        left.id < right.id ? -1 : left.id > right.id ? 1 : 0
    ));
}

function canonicalDiamondStatIdList(value) {
    if (!Array.isArray(value) || value.length > MAX_STAT_KEYS || value.some((entry) => !isExactDiamondStatId(entry))) {
        return null;
    }
    if (new Set(value).size !== value.length) return null;
    return [...value].sort();
}

function canonicalizeDiamondSnapshotValue(value, seen = new Set()) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new TypeError('Canonical Diamond values must contain finite numbers.');
        return Object.is(value, -0) ? 0 : value;
    }
    if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) throw new TypeError('Canonical Diamond values must contain valid dates.');
        return value.toISOString();
    }
    if (Array.isArray(value)) {
        if (seen.has(value)) throw new TypeError('Canonical Diamond values cannot be cyclic.');
        seen.add(value);
        const result = value.map((entry) => canonicalizeDiamondSnapshotValue(entry, seen));
        seen.delete(value);
        return result;
    }
    if (value && typeof value === 'object') {
        if (seen.has(value)) throw new TypeError('Canonical Diamond values cannot be cyclic.');
        seen.add(value);
        const result = {};
        Object.keys(value).sort().forEach((key) => {
            if (value[key] !== undefined) result[key] = canonicalizeDiamondSnapshotValue(value[key], seen);
        });
        seen.delete(value);
        return result;
    }
    throw new TypeError('Canonical Diamond values must be JSON-compatible.');
}

function rotateDiamondHashWord(value, amount) {
    return (value >>> amount) | (value << (32 - amount));
}

function diamondSha256Hex(input) {
    const source = new TextEncoder().encode(input);
    const bitLength = source.length * 8;
    const paddedLength = Math.ceil((source.length + 9) / 64) * 64;
    const bytes = new Uint8Array(paddedLength);
    bytes.set(source);
    bytes[source.length] = 0x80;

    const view = new DataView(bytes.buffer);
    view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false);
    view.setUint32(paddedLength - 4, bitLength >>> 0, false);

    const hash = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const words = new Uint32Array(64);
    for (let offset = 0; offset < paddedLength; offset += 64) {
        for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(offset + index * 4, false);
        for (let index = 16; index < 64; index += 1) {
            const s0 = rotateDiamondHashWord(words[index - 15], 7)
                ^ rotateDiamondHashWord(words[index - 15], 18)
                ^ (words[index - 15] >>> 3);
            const s1 = rotateDiamondHashWord(words[index - 2], 17)
                ^ rotateDiamondHashWord(words[index - 2], 19)
                ^ (words[index - 2] >>> 10);
            words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
        }

        let a = hash[0];
        let b = hash[1];
        let c = hash[2];
        let d = hash[3];
        let e = hash[4];
        let f = hash[5];
        let g = hash[6];
        let h = hash[7];
        for (let index = 0; index < 64; index += 1) {
            const sum1 = rotateDiamondHashWord(e, 6) ^ rotateDiamondHashWord(e, 11) ^ rotateDiamondHashWord(e, 25);
            const choice = (e & f) ^ (~e & g);
            const temp1 = (h + sum1 + choice + SHA_256_CONSTANTS[index] + words[index]) >>> 0;
            const sum0 = rotateDiamondHashWord(a, 2) ^ rotateDiamondHashWord(a, 13) ^ rotateDiamondHashWord(a, 22);
            const majority = (a & b) ^ (a & c) ^ (b & c);
            const temp2 = (sum0 + majority) >>> 0;
            h = g;
            g = f;
            f = e;
            e = (d + temp1) >>> 0;
            d = c;
            c = b;
            b = a;
            a = (temp1 + temp2) >>> 0;
        }
        hash[0] = (hash[0] + a) >>> 0;
        hash[1] = (hash[1] + b) >>> 0;
        hash[2] = (hash[2] + c) >>> 0;
        hash[3] = (hash[3] + d) >>> 0;
        hash[4] = (hash[4] + e) >>> 0;
        hash[5] = (hash[5] + f) >>> 0;
        hash[6] = (hash[6] + g) >>> 0;
        hash[7] = (hash[7] + h) >>> 0;
    }
    return Array.from(hash, (word) => word.toString(16).padStart(8, '0')).join('');
}

function buildDiamondStatConfigSnapshotMaterial({ teamId, configId, config }) {
    if (!isExactDiamondResourceId(teamId) || !isExactDiamondResourceId(configId) || !isPlainSnapshotObject(config)) return null;
    const statDefinitions = canonicalDiamondSnapshotDefinitions(config);
    const explicitPublicTeamStatIds = canonicalDiamondStatIdList(config.diamondPublicTeamStatIds ?? []);
    if (!statDefinitions || !explicitPublicTeamStatIds) return null;
    const privatePlayerStatIds = statDefinitions
        .filter((definition) => definition.scope === 'player' && definition.visibility === 'private')
        .map((definition) => definition.id);
    const publicPlayerStatIds = statDefinitions
        .filter((definition) => definition.scope === 'player' && definition.visibility === 'public')
        .map((definition) => definition.id);
    const publicTeamStatIds = [...new Set([
        ...statDefinitions
            .filter((definition) => definition.scope === 'team' && definition.visibility === 'public')
            .map((definition) => definition.id),
        ...explicitPublicTeamStatIds
    ])].sort();
    return {
        schemaVersion: DIAMOND_STAT_CONFIG_SNAPSHOT_SCHEMA_VERSION,
        teamId,
        configId,
        definitionCount: statDefinitions.length,
        statDefinitions,
        privatePlayerStatIds,
        publicPlayerStatIds,
        publicTeamStatIds
    };
}

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
    derivedStat('obp', 'OBP', 'Batting Rates', '(H+BB+IBB+HBP)/(AB+BB+IBB+HBP+SF)', { topStat: true }),
    derivedStat('slg', 'SLG', 'Batting Rates', 'TB/AB', { topStat: true }),
    derivedStat('ops', 'OPS', 'Batting Rates', '((H+BB+IBB+HBP)/(AB+BB+IBB+HBP+SF))+(TB/AB)', { topStat: true }),
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

export function buildDiamondStatConfigSnapshotHash({ teamId, configId, config } = {}) {
    const material = buildDiamondStatConfigSnapshotMaterial({ teamId, configId, config });
    if (!material) return null;
    try {
        const canonicalJson = JSON.stringify(canonicalizeDiamondSnapshotValue(material));
        return `sha256:${diamondSha256Hex(canonicalJson)}`;
    } catch {
        return null;
    }
}

export function currentDiamondStatConfigMatchesActivation({ teamId, game, config } = {}) {
    if (!isPlainSnapshotObject(game) || !isDiamondV2Game(game) || !isPlainSnapshotObject(config)) return false;
    const configId = game.statTrackerConfigId;
    const configDocumentId = config.id;
    const expectedHash = game.diamondStatConfigSnapshotHash;
    if (
        !isExactDiamondResourceId(configId)
        || !isExactDiamondResourceId(configDocumentId)
        || configDocumentId !== configId
        || typeof expectedHash !== 'string'
        || !DIAMOND_SHA256_PATTERN.test(expectedHash)
    ) return false;
    return buildDiamondStatConfigSnapshotHash({ teamId, configId, config }) === expectedHash;
}

/**
 * Binds each Diamond game to the one mutable config document whose canonical
 * visibility material still matches the immutable activation hash. Callers may
 * retry their bounded config read when this returns null, but must never turn a
 * missing/mismatched result into an empty public catalog.
 */
export function resolveDiamondStatConfigsForGames({ teamId, games = [], configs = [] } = {}) {
    if (!isExactDiamondResourceId(teamId) || !Array.isArray(games) || !Array.isArray(configs)) return null;
    const diamondGames = games.filter(isDiamondV2Game);
    const entriesById = new Map();
    for (const game of diamondGames) {
        const configId = game?.statTrackerConfigId;
        if (!isExactDiamondResourceId(configId)) return null;
        const matches = configs.filter((config) => isPlainSnapshotObject(config) && config.id === configId);
        if (matches.length !== 1 || !currentDiamondStatConfigMatchesActivation({ teamId, game, config: matches[0] })) {
            return null;
        }
        if (!entriesById.has(configId)) {
            const snapshot = buildDiamondStatConfigSnapshotMaterial({ teamId, configId, config: matches[0] });
            if (!snapshot) return null;
            entriesById.set(configId, Object.freeze({
                configId,
                config: matches[0],
                publicPlayerStatIds: Object.freeze([...snapshot.publicPlayerStatIds]),
                publicTeamStatIds: Object.freeze([...snapshot.publicTeamStatIds])
            }));
        }
    }
    return Object.freeze({
        teamId,
        configIds: Object.freeze([...entriesById.keys()].sort()),
        entries: Object.freeze([...entriesById.values()].sort((left, right) => (
            left.configId < right.configId ? -1 : left.configId > right.configId ? 1 : 0
        )))
    });
}

function getResolvedDiamondConfigEntry(resolution, game) {
    if (!isPlainSnapshotObject(resolution) || !Array.isArray(resolution.entries)) return null;
    if (!game) return null;
    const configId = game?.statTrackerConfigId;
    if (!isExactDiamondResourceId(configId)) return null;
    return resolution.entries.find((entry) => entry?.configId === configId) || null;
}

function getSafeDiamondPresentationValue(definition, field, fallback) {
    const candidate = definition?.[field];
    if (['label', 'acronym', 'group'].includes(field)) {
        if (typeof candidate !== 'string') return fallback;
        const normalized = candidate.trim();
        return normalized && normalized.length <= 160 ? normalized : fallback;
    }
    if (field === 'format') return ['number', 'percentage'].includes(candidate) ? candidate : fallback;
    if (field === 'precision') {
        return Number.isSafeInteger(candidate) && candidate >= 0 && candidate <= 6 ? candidate : fallback;
    }
    if (field === 'rankingOrder') return ['asc', 'desc'].includes(candidate) ? candidate : fallback;
    if (field === 'topStat') return typeof candidate === 'boolean' ? candidate : fallback;
    return fallback;
}

function mergeMatchedDiamondPresentation(definition, selectedEntries, scope) {
    const fields = ['label', 'acronym', 'group', 'format', 'precision', 'rankingOrder', 'topStat'];
    const matchingDefinitions = selectedEntries.map((entry) => (
        Array.isArray(entry?.config?.statDefinitions)
            ? entry.config.statDefinitions.find((candidate) => candidate?.id === definition.id && candidate?.scope === scope)
            : null
    )).filter(Boolean);
    const presentation = {};
    fields.forEach((field) => {
        const values = matchingDefinitions.map((candidate) => (
            getSafeDiamondPresentationValue(candidate, field, definition[field])
        ));
        if (values.length && values.every((value) => value === values[0])) presentation[field] = values[0];
    });
    return presentation;
}

/**
 * Selects stat IDs only from activation-hash-matched visibility material.
 * Presentation-only fields may come from those matched configs; mixed-config
 * conflicts fall back to the fixed catalog. Formula, scope, visibility, and ID
 * remain fixed/pinned so mutable presentation cannot redefine a statistic.
 */
export function getActivationPinnedDiamondStatCatalog({
    resolution,
    game = null,
    scope = 'player',
    visibility = 'public'
} = {}) {
    if (!isPlainSnapshotObject(resolution) || !Array.isArray(resolution.entries)) return null;
    const normalizedScope = scope === 'team' ? 'team' : 'player';
    const normalizedVisibility = visibility === DIAMOND_MANAGER_STAT_VISIBILITY
        ? DIAMOND_MANAGER_STAT_VISIBILITY
        : 'public';
    const catalog = normalizedScope === 'team' ? DIAMOND_TEAM_STAT_CATALOG : DIAMOND_PLAYER_STAT_CATALOG;
    const selectedEntries = (game ? [getResolvedDiamondConfigEntry(resolution, game)].filter(Boolean) : resolution.entries)
        .slice()
        .sort((left, right) => (
            left.configId < right.configId ? -1 : left.configId > right.configId ? 1 : 0
        ));
    if (!selectedEntries.length) return null;
    const allowedIds = normalizedVisibility === DIAMOND_MANAGER_STAT_VISIBILITY
        ? new Set(catalog.map(({ id }) => id))
        : new Set(selectedEntries.flatMap((entry) => (
            normalizedScope === 'team' ? entry.publicTeamStatIds : entry.publicPlayerStatIds
        )));
    return Object.freeze(catalog
        .filter(({ id }) => allowedIds.has(id))
        .map((definition) => Object.freeze({
            ...definition,
            ...mergeMatchedDiamondPresentation(definition, selectedEntries, normalizedScope),
            id: definition.id,
            scope: normalizedScope,
            visibility: normalizedVisibility
        })));
}

export function hasMixedActivationPinnedDiamondStatIds({
    resolution,
    games = [],
    scope = 'player',
    visibility = 'public'
} = {}) {
    if (!Array.isArray(games)) return null;
    const keys = [];
    for (const game of games) {
        const catalog = getActivationPinnedDiamondStatCatalog({ resolution, game, scope, visibility });
        if (!catalog) return null;
        keys.push(catalog.map(({ id }) => id).sort().join('\u0000'));
    }
    return new Set(keys).size > 1;
}

export function prepareDiamondStatDocumentForSeason(
    value,
    allowedStatIds = [],
    { aggregateStatIds = allowedStatIds, clearFamilyCoverage = false } = {}
) {
    if (!isRecord(value)) return value;
    const catalogIds = new Set(DIAMOND_PLAYER_STAT_CATALOG.map(({ id }) => id));
    const normalizeIds = (candidate) => new Set((Array.isArray(candidate) ? candidate : [])
        .map(normalizeStatKey)
        .filter((id) => id && catalogIds.has(id)));
    const allowedIds = normalizeIds(allowedStatIds);
    const aggregateIds = normalizeIds(aggregateStatIds);
    const filterRecord = (candidate) => Object.fromEntries(
        Object.entries(isRecord(candidate) ? candidate : {}).filter(([id]) => allowedIds.has(id))
    );
    const filterList = (candidate) => Array.isArray(candidate)
        ? candidate.filter((id) => typeof id === 'string' && allowedIds.has(id))
        : candidate;
    const statCoverage = filterRecord(value.statCoverage);
    aggregateIds.forEach((id) => {
        if (!Object.prototype.hasOwnProperty.call(statCoverage, id)) statCoverage[id] = 'not_collected';
    });
    return {
        ...value,
        ...(Array.isArray(value.publicStatIds) ? { publicStatIds: filterList(value.publicStatIds) } : {}),
        stats: filterRecord(value.stats),
        observedStats: filterRecord(value.observedStats),
        derivedStats: filterRecord(value.derivedStats),
        observedDerivedStats: filterRecord(value.observedDerivedStats),
        statCoverage,
        ...(isRecord(value.statSources) ? { statSources: filterRecord(value.statSources) } : {}),
        ...(Array.isArray(value.unavailableDerivedStats)
            ? { unavailableDerivedStats: filterList(value.unavailableDerivedStats) }
            : {}),
        ...(clearFamilyCoverage ? { coverage: {}, missingStatFamilies: [] } : {})
    };
}

export function getPublicDiamondStatCatalog(resolvedConfig = null, scope = 'player') {
    const normalizedScope = scope === 'team' ? 'team' : 'player';
    const catalog = normalizedScope === 'team' ? DIAMOND_TEAM_STAT_CATALOG : DIAMOND_PLAYER_STAT_CATALOG;
    const configured = Array.isArray(resolvedConfig?.statDefinitions)
        ? resolvedConfig.statDefinitions.filter((definition) => definition?.scope === normalizedScope)
        : [];
    const configuredById = new Map(configured.map((definition) => [
        normalizeStatKey(definition?.id || definition?.acronym || definition?.label),
        definition
    ]).filter(([id]) => id));
    const explicitlyPublicIds = new Set(configured
        .filter((definition) => String(definition?.visibility || '').trim().toLowerCase() === 'public')
        .map((definition) => normalizeStatKey(definition?.id || definition?.acronym || definition?.label))
        .filter(Boolean));
    if (normalizedScope === 'team' && Array.isArray(resolvedConfig?.diamondPublicTeamStatIds)) {
        resolvedConfig.diamondPublicTeamStatIds
            .map(normalizeStatKey)
            .filter(Boolean)
            .forEach((id) => explicitlyPublicIds.add(id));
    }

    return Object.freeze(catalog
        .filter((definition) => explicitlyPublicIds.has(definition.id))
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

/**
 * Manager reports intentionally use the fixed Diamond catalog rather than a
 * mutable public allowlist. The private projection contains the full derived
 * line; the visibility marker prevents callers and exports from silently
 * presenting it as fan-safe data.
 */
export function getManagerDiamondStatCatalog(resolvedConfig = null, scope = 'player') {
    const normalizedScope = scope === 'team' ? 'team' : 'player';
    const catalog = normalizedScope === 'team' ? DIAMOND_TEAM_STAT_CATALOG : DIAMOND_PLAYER_STAT_CATALOG;
    const configured = Array.isArray(resolvedConfig?.statDefinitions)
        ? resolvedConfig.statDefinitions.filter((definition) => definition?.scope === normalizedScope)
        : [];
    const configuredById = new Map(configured.map((definition) => [
        normalizeStatKey(definition?.id || definition?.acronym || definition?.label),
        definition
    ]).filter(([id]) => id));

    return Object.freeze(catalog.map((definition) => {
        const override = configuredById.get(definition.id);
        return Object.freeze({
            ...definition,
            ...(override || {}),
            id: definition.id,
            scope: normalizedScope,
            visibility: DIAMOND_MANAGER_STAT_VISIBILITY
        });
    }));
}

export function getDiamondProjectionIdentity(game) {
    if (!isDiamondV2Game(game)) return null;
    const status = String(game?.diamondProjectionStatus || '').trim().toLowerCase();
    const instanceId = String(game?.diamondScorebookInstanceId || '').trim();
    const sourceRevision = toRevision(game?.diamondProjectionRevision);
    const checkpointHash = String(game?.diamondProjectionCheckpointHash || '').trim();
    const statConfigSnapshotHash = String(game?.diamondStatConfigSnapshotHash || '').trim();
    const projectionHash = String(game?.diamondProjectionHash || '').trim();
    if (
        !['current', 'complete'].includes(status)
        || game?.diamondProjectionComplete !== true
        || !DIAMOND_UUID_V4_PATTERN.test(instanceId)
        || sourceRevision === null
        || !DIAMOND_SHA256_PATTERN.test(checkpointHash)
        || !DIAMOND_SHA256_PATTERN.test(statConfigSnapshotHash)
        || !DIAMOND_SHA256_PATTERN.test(projectionHash)
    ) return null;
    return Object.freeze({ instanceId, sourceRevision, checkpointHash, statConfigSnapshotHash, projectionHash });
}

export function getDiamondPublicPlayerStatsCollectionPath({ teamId, gameId, game } = {}) {
    const identity = getDiamondProjectionIdentity(game);
    const normalizedTeamId = typeof teamId === 'string' ? teamId.trim() : '';
    const normalizedGameId = typeof gameId === 'string' ? gameId.trim() : '';
    if (
        !identity
        || normalizedTeamId !== teamId
        || normalizedGameId !== gameId
        || !SAFE_RESOURCE_ID.test(normalizedTeamId)
        || !SAFE_RESOURCE_ID.test(normalizedGameId)
    ) return null;
    return `teams/${normalizedTeamId}/games/${normalizedGameId}/diamondStatGenerations/${identity.instanceId}/publicPlayerStats`;
}

function hasExactSanitizedStatMap(value) {
    if (!isRecord(value) || Object.keys(value).length > MAX_STAT_KEYS) return false;
    const sanitized = sanitizeStatMap(value);
    return Object.keys(sanitized).length === Object.keys(value).length;
}

function isStrictStringArray(value, { maximum = MAX_STAT_KEYS, allowed = null } = {}) {
    if (!Array.isArray(value) || value.length > maximum) return false;
    const normalized = value.map((entry) => typeof entry === 'string' ? entry.trim() : '');
    return normalized.every((entry, index) => (
        Boolean(entry)
        && entry === value[index]
        && entry.length <= 128
        && (!allowed || allowed.has(entry))
        && normalized.indexOf(entry) === index
        && (index === 0 || normalized[index - 1].localeCompare(entry) < 0)
    ));
}

function isStrictPublicPlayerStatDocument(entry, identity, teamId, gameId) {
    const data = entry?.data;
    if (
        !SAFE_RESOURCE_ID.test(String(entry?.id || ''))
        || !isRecord(data)
        || Object.keys(data).some((key) => !DIAMOND_PUBLIC_PLAYER_DOCUMENT_KEYS.has(key))
        || data.schemaVersion !== 1
        || data.trackingEngine !== DIAMOND_TRACKING_ENGINE
        || data.projectionSchemaVersion !== 1
        || data.complete !== true
        || data.playerId !== entry.id
        || data.teamId !== teamId
        || data.diamondGameId !== gameId
        || data.instanceId !== identity.instanceId
        || data.diamondScorebookInstanceId !== identity.instanceId
        || data.projectionGeneration !== identity.instanceId
        || toRevision(data.sourceRevision) !== identity.sourceRevision
        || data.checkpointHash !== identity.checkpointHash
        || data.statConfigSnapshotHash !== identity.statConfigSnapshotHash
        || data.projectionHash !== identity.projectionHash
        || typeof data.playerName !== 'string'
        || data.playerName.length > 160
        || typeof data.playerNumber !== 'string'
        || data.playerNumber.length > 32
        || typeof data.participated !== 'boolean'
        || data.participationSource !== DIAMOND_TRACKING_ENGINE
        || !['appeared', 'did-not-appear'].includes(data.participationStatus)
        || (data.participated && data.participationStatus !== 'appeared')
        || (!data.participated && data.participationStatus !== 'did-not-appear')
        || (data.participated && Object.prototype.hasOwnProperty.call(data, 'didNotPlay'))
        || (!data.participated && data.didNotPlay !== true)
    ) return false;

    const catalogIds = new Set(DIAMOND_PLAYER_STAT_CATALOG.map(({ id }) => id));
    if (!isStrictStringArray(data.publicStatIds, { allowed: catalogIds })) return false;
    const publicIds = new Set(data.publicStatIds);
    if (
        !hasExactSanitizedStatMap(data.stats)
        || !hasExactSanitizedStatMap(data.observedStats)
        || !hasExactSanitizedStatMap(data.derivedStats)
        || !hasExactSanitizedStatMap(data.observedDerivedStats)
        || !isRecord(data.statCoverage)
        || Object.keys(data.statCoverage).length !== publicIds.size
        || Object.entries(data.statCoverage).some(([key, status]) => !publicIds.has(key) || !COVERAGE_STATUS_SET.has(status))
        || [data.stats, data.observedStats, data.derivedStats, data.observedDerivedStats]
            .some((map) => Object.keys(map).some((key) => !publicIds.has(key)))
        || Object.keys(data.stats).some((key) => data.statCoverage[key] !== 'complete')
        || Object.keys(data.derivedStats).some((key) => data.statCoverage[key] !== 'complete')
        || Object.keys(data.observedStats).some((key) => data.statCoverage[key] !== 'partial')
        || Object.keys(data.observedDerivedStats).some((key) => data.statCoverage[key] !== 'partial')
        || !isRecord(data.coverage)
        || Object.keys(data.coverage).length > 32
        || Object.entries(data.coverage).some(([family, status]) => !normalizeStatKey(family) || !COVERAGE_STATUS_SET.has(status))
        || !isRecord(data.statSources)
        || Object.keys(data.statSources).length > publicIds.size
        || Object.entries(data.statSources).some(([key, ids]) => !publicIds.has(key) || !isStrictStringArray(ids, { maximum: MAX_SOURCE_PLAY_IDS }))
        || !isStrictStringArray(data.sourcePlayIds, { maximum: MAX_SOURCE_PLAY_IDS })
        || !isStrictStringArray(data.unavailableDerivedStats, { allowed: DERIVED_STAT_IDS })
        || !isStrictStringArray(data.missingStatFamilies, { maximum: 32 })
    ) return false;
    const expectedSourcePlayIds = [...new Set(Object.values(data.statSources).flat())].sort();
    return expectedSourcePlayIds.length === data.sourcePlayIds.length
        && expectedSourcePlayIds.every((eventId, index) => eventId === data.sourcePlayIds[index]);
}

/**
 * Treats one public Diamond player-stat collection load as indivisible. The
 * generation is encoded in the path and repeated in every document so a stale,
 * malformed, or expanded result can never become an authoritative empty/zero.
 */
export function resolveDiamondPublicStatDocuments({
    teamId,
    gameId,
    game,
    documents = [],
    loadStatus = 'complete'
} = {}) {
    const identity = getDiamondProjectionIdentity(game);
    const normalizedTeamId = typeof teamId === 'string' ? teamId.trim() : '';
    const normalizedGameId = typeof gameId === 'string' ? gameId.trim() : '';
    const unavailable = (reason, status = 'partial') => Object.freeze({
        requestedVisibility: 'public',
        appliedVisibility: 'public',
        status,
        reason,
        documents: Object.freeze([]),
        absenceConfirmed: false,
        identity
    });
    if (
        !identity
        || normalizedTeamId !== teamId
        || normalizedGameId !== gameId
        || !SAFE_RESOURCE_ID.test(normalizedTeamId)
        || !SAFE_RESOURCE_ID.test(normalizedGameId)
    ) return unavailable('authoritative-head-unavailable');
    if (loadStatus !== 'complete') return unavailable('public-read-incomplete');
    const normalized = normalizeStatDocuments(documents);
    if (!Array.isArray(documents) || normalized.length !== documents.length) {
        return unavailable('public-document-mismatch');
    }
    if (normalized.length > MAX_PUBLIC_PLAYER_DOCUMENTS) {
        return unavailable('public-read-overflow', 'unavailable');
    }
    const seen = new Set();
    for (const entry of normalized) {
        if (seen.has(entry.id)) return unavailable('public-read-duplicate');
        seen.add(entry.id);
        if (!isStrictPublicPlayerStatDocument(entry, identity, normalizedTeamId, normalizedGameId)) {
            return unavailable('public-document-mismatch');
        }
    }
    return Object.freeze({
        requestedVisibility: 'public',
        appliedVisibility: 'public',
        status: 'complete',
        reason: null,
        documents: Object.freeze(normalized.map((entry) => Object.freeze(entry))),
        absenceConfirmed: normalized.length === 0,
        identity
    });
}

function isStrictTeamStatMap(value, allowedIds) {
    if (!isRecord(value) || Object.keys(value).length > MAX_STAT_KEYS) return false;
    return Object.entries(value).every(([rawKey, rawValue]) => {
        const key = normalizeStatKey(rawKey);
        return key === rawKey
            && allowedIds.has(key)
            && Number.isSafeInteger(rawValue)
            && rawValue >= 0;
    });
}

/**
 * Validates the sanitized team-stat subset embedded in an authoritative game
 * projection. The nested envelope is server-owned and generation-bound; any
 * stale, malformed, or unexpectedly expanded document is rejected as a whole.
 */
export function resolveDiamondPublicTeamStatDocument({
    game,
    allowedStatIds = null
} = {}) {
    const identity = getDiamondProjectionIdentity(game);
    const unavailable = (reason) => Object.freeze({
        requestedVisibility: 'public',
        appliedVisibility: 'public',
        status: 'partial',
        reason,
        document: null,
        identity
    });
    if (!identity) return unavailable('authoritative-head-unavailable');
    const document = game?.diamondPublicTeamStats;
    if (!isRecord(document)) return unavailable('public-team-document-missing');
    if (Object.keys(document).some((key) => !DIAMOND_PUBLIC_TEAM_DOCUMENT_KEYS.has(key))) {
        return unavailable('public-team-document-mismatch');
    }
    const catalogIds = new Set(DIAMOND_TEAM_STAT_CATALOG.map(({ id }) => id));
    const publicStatIds = Array.isArray(document.publicStatIds)
        ? document.publicStatIds.map(normalizeStatKey)
        : [];
    const canonicalPublicStatIds = [...new Set(publicStatIds)].sort();
    const gameId = String(game?.id || game?.gameId || '').trim();
    const teamId = String(game?.teamId || '').trim();
    if (
        document.trackingEngine !== DIAMOND_TRACKING_ENGINE
        || document.complete !== true
        || document.projectionSchemaVersion !== 1
        || !['home', 'away'].includes(document.side)
        || String(document.instanceId || '').trim() !== identity.instanceId
        || String(document.diamondScorebookInstanceId || '').trim() !== identity.instanceId
        || String(document.projectionGeneration || '').trim() !== identity.instanceId
        || toRevision(document.sourceRevision) !== identity.sourceRevision
        || String(document.checkpointHash || '').trim() !== identity.checkpointHash
        || String(document.statConfigSnapshotHash || '').trim() !== identity.statConfigSnapshotHash
        || String(document.projectionHash || '').trim() !== identity.projectionHash
        || !String(document.teamId || '').trim()
        || !String(document.diamondGameId || '').trim()
        || (teamId && String(document.teamId || '').trim() !== teamId)
        || (gameId && String(document.diamondGameId || '').trim() !== gameId)
        || !Array.isArray(document.publicStatIds)
        || document.publicStatIds.length > MAX_STAT_KEYS
        || document.publicStatIds.some((value) => typeof value !== 'string')
        || publicStatIds.some((id) => !id || !catalogIds.has(id))
        || publicStatIds.length !== canonicalPublicStatIds.length
        || publicStatIds.some((id, index) => id !== canonicalPublicStatIds[index])
        || !isRecord(document.statCoverage)
        || Object.keys(document.statCoverage).length !== publicStatIds.length
        || publicStatIds.some((id) => !COVERAGE_STATUS_SET.has(document.statCoverage[id]))
        || Object.keys(document.statCoverage).some((id) => !publicStatIds.includes(id))
        || !isRecord(document.coverage)
        || Object.keys(document.coverage).length > 32
        || Object.entries(document.coverage).some(([family, status]) => !normalizeStatKey(family) || !COVERAGE_STATUS_SET.has(status))
    ) return unavailable('public-team-document-mismatch');

    const publicStatIdSet = new Set(publicStatIds);
    const completeStatIds = new Set(publicStatIds.filter((id) => document.statCoverage[id] === 'complete'));
    const partialStatIds = new Set(publicStatIds.filter((id) => document.statCoverage[id] === 'partial'));
    if (
        !isStrictTeamStatMap(document.stats, completeStatIds)
        || !isStrictTeamStatMap(document.observedStats, partialStatIds)
        || Object.keys(document.stats).some((id) => Object.hasOwn(document.observedStats, id))
    ) return unavailable('public-team-document-mismatch');

    const callerAllowedIds = allowedStatIds === null
        ? publicStatIdSet
        : new Set((Array.isArray(allowedStatIds) ? allowedStatIds : [])
            .map(normalizeStatKey)
            .filter((id) => id && catalogIds.has(id)));
    const visibleIds = publicStatIds.filter((id) => callerAllowedIds.has(id));
    const visibleIdSet = new Set(visibleIds);
    const selectVisible = (value) => Object.freeze(Object.fromEntries(
        Object.entries(value).filter(([id]) => visibleIdSet.has(id))
    ));
    return Object.freeze({
        requestedVisibility: 'public',
        appliedVisibility: 'public',
        status: 'complete',
        reason: null,
        document: Object.freeze({
            ...document,
            publicStatIds: Object.freeze(visibleIds),
            stats: selectVisible(document.stats),
            observedStats: selectVisible(document.observedStats),
            statCoverage: selectVisible(document.statCoverage)
        }),
        identity
    });
}

/**
 * Normalizes the stats sub-envelope returned by getPublicDiamondGame. A
 * partial response deliberately carries no head or data, while a complete
 * response must reproduce one exact current head in its sanitized team doc.
 */
export function resolveDiamondPublicStatsResponse(value) {
    const unavailable = (reason, status = 'unavailable') => Object.freeze({
        status,
        reason,
        complete: false,
        identity: null,
        publicTeamStats: null
    });
    if (!isRecord(value)) return unavailable('public-stats-response-missing', 'partial');
    if (
        value.schemaVersion !== 1
        || value.trackingEngine !== DIAMOND_TRACKING_ENGINE
        || !['complete', 'partial'].includes(value.status)
        || value.complete !== (value.status === 'complete')
    ) return unavailable('public-stats-response-mismatch');
    const expectedKeys = value.status === 'complete'
        ? DIAMOND_PUBLIC_STATS_COMPLETE_KEYS
        : DIAMOND_PUBLIC_STATS_PARTIAL_KEYS;
    if (
        Object.keys(value).length !== expectedKeys.size
        || Object.keys(value).some((key) => !expectedKeys.has(key))
    ) return unavailable('public-stats-response-mismatch');
    if (value.status === 'partial') {
        return unavailable('public-stats-partial', 'partial');
    }
    const publicTeamStats = value.publicTeamStats;
    if (!isRecord(publicTeamStats)) return unavailable('public-stats-response-mismatch');
    const syntheticGame = {
        id: publicTeamStats.diamondGameId,
        teamId: publicTeamStats.teamId,
        trackingEngine: DIAMOND_TRACKING_ENGINE,
        diamondProjectionStatus: 'current',
        diamondProjectionComplete: true,
        diamondScorebookInstanceId: value.instanceId,
        diamondProjectionRevision: value.sourceRevision,
        diamondProjectionCheckpointHash: value.checkpointHash,
        diamondStatConfigSnapshotHash: value.statConfigSnapshotHash,
        diamondProjectionHash: value.projectionHash,
        diamondPublicTeamStats: publicTeamStats
    };
    const resolution = resolveDiamondPublicTeamStatDocument({ game: syntheticGame });
    if (resolution.status !== 'complete' || !resolution.document) {
        return unavailable('public-stats-response-mismatch');
    }
    return Object.freeze({
        status: 'complete',
        reason: null,
        complete: true,
        identity: resolution.identity,
        publicTeamStats: resolution.document
    });
}

function normalizeStatDocuments(documents) {
    if (!Array.isArray(documents)) return [];
    return documents.flatMap((entry) => {
        const id = String(entry?.id || '').trim();
        const data = isRecord(entry?.data) ? entry.data : null;
        return id && data ? [{ id, data }] : [];
    });
}

function isFullManagerStatDocument(entry, identity) {
    const data = entry?.data;
    return Boolean(
        isRecord(data)
        && data.trackingEngine === DIAMOND_TRACKING_ENGINE
        && data.authoritative === true
        && data.complete === true
        && data.projectionSchemaVersion === 1
        && String(data.playerId || '').trim() === entry.id
        && ['home', 'away'].includes(data.side)
        && String(data.instanceId || '').trim() === identity.instanceId
        && String(data.diamondScorebookInstanceId || '').trim() === identity.instanceId
        && String(data.projectionGeneration || '').trim() === identity.instanceId
        && toRevision(data.sourceRevision) === identity.sourceRevision
        && String(data.checkpointHash || '').trim() === identity.checkpointHash
        && String(data.statConfigSnapshotHash || '').trim() === identity.statConfigSnapshotHash
        && String(data.projectionHash || '').trim() === identity.projectionHash
        && isRecord(data.stats)
        && isRecord(data.observedStats)
        && isRecord(data.derivedStats)
        && isRecord(data.observedDerivedStats)
        && isRecord(data.statCoverage)
        && isRecord(data.coverage)
    );
}

export function resolveDiamondManagerTeamStatDocument({
    game,
    privateDocument = null,
    loadStatus = 'complete'
} = {}) {
    const identity = getDiamondProjectionIdentity(game);
    const unavailable = (reason, status = 'unavailable') => Object.freeze({
        requestedVisibility: DIAMOND_MANAGER_STAT_VISIBILITY,
        appliedVisibility: 'public',
        status,
        reason,
        document: null,
        identity
    });
    if (!identity) return unavailable('authoritative-head-unavailable');
    if (loadStatus !== 'complete') return unavailable('private-read-incomplete', 'partial');
    if (!isRecord(privateDocument)) return unavailable('private-read-empty', 'partial');
    if (
        privateDocument.trackingEngine !== DIAMOND_TRACKING_ENGINE
        || privateDocument.complete !== true
        || privateDocument.projectionSchemaVersion !== 1
        || !['home', 'away'].includes(privateDocument.side)
        || String(privateDocument.instanceId || '').trim() !== identity.instanceId
        || String(privateDocument.diamondScorebookInstanceId || '').trim() !== identity.instanceId
        || String(privateDocument.projectionGeneration || '').trim() !== identity.instanceId
        || toRevision(privateDocument.sourceRevision) !== identity.sourceRevision
        || String(privateDocument.checkpointHash || '').trim() !== identity.checkpointHash
        || String(privateDocument.statConfigSnapshotHash || '').trim() !== identity.statConfigSnapshotHash
        || String(privateDocument.projectionHash || '').trim() !== identity.projectionHash
        || !isRecord(privateDocument.stats)
        || !isRecord(privateDocument.observedStats)
        || !isRecord(privateDocument.statCoverage)
        || !isRecord(privateDocument.coverage)
    ) return unavailable('private-document-mismatch', 'partial');
    return Object.freeze({
        requestedVisibility: DIAMOND_MANAGER_STAT_VISIBILITY,
        appliedVisibility: DIAMOND_MANAGER_STAT_VISIBILITY,
        status: 'complete',
        reason: null,
        document: privateDocument,
        identity
    });
}

/**
 * Validates a private-player-stat collection as one indivisible generation.
 * Callers must keep their public result when this returns anything except
 * `complete`; a partial/empty/denied read is never evidence that private
 * values are absent.
 */
export function resolveDiamondManagerStatDocuments({
    game,
    expectedPlayerIds = [],
    privateDocuments = [],
    loadStatus = 'complete'
} = {}) {
    const identity = getDiamondProjectionIdentity(game);
    const expectedIds = [...new Set((Array.isArray(expectedPlayerIds) ? expectedPlayerIds : [])
        .map((value) => String(value || '').trim())
        .filter(Boolean))].sort();
    const documents = normalizeStatDocuments(privateDocuments);
    const unavailable = (reason, status = 'unavailable') => Object.freeze({
        requestedVisibility: DIAMOND_MANAGER_STAT_VISIBILITY,
        appliedVisibility: 'public',
        status,
        reason,
        documents: Object.freeze([]),
        identity
    });

    if (!identity) return unavailable('authoritative-head-unavailable');
    if (loadStatus !== 'complete') return unavailable('private-read-incomplete', 'partial');
    if (expectedIds.length === 0 || documents.length === 0) return unavailable('private-read-empty', 'partial');
    const byId = new Map();
    for (const entry of documents) {
        if (byId.has(entry.id)) return unavailable('private-read-duplicate', 'partial');
        byId.set(entry.id, entry);
    }
    if (
        byId.size !== expectedIds.length
        || expectedIds.some((playerId) => !byId.has(playerId))
        || [...byId.keys()].some((playerId) => !expectedIds.includes(playerId))
    ) return unavailable('private-read-partial', 'partial');
    const accepted = expectedIds.map((playerId) => byId.get(playerId));
    if (accepted.some((entry) => !isFullManagerStatDocument(entry, identity))) {
        return unavailable('private-document-mismatch', 'partial');
    }
    return Object.freeze({
        requestedVisibility: DIAMOND_MANAGER_STAT_VISIBILITY,
        appliedVisibility: DIAMOND_MANAGER_STAT_VISIBILITY,
        status: 'complete',
        reason: null,
        documents: Object.freeze(accepted.map((entry) => Object.freeze(entry))),
        identity
    });
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
    setRatio(
        'obp',
        'batting',
        Number(stats.h || 0) + Number(stats.bb || 0) + Number(stats.ibb || 0) + Number(stats.hbp || 0),
        Number(stats.ab || 0) + Number(stats.bb || 0) + Number(stats.ibb || 0) + Number(stats.hbp || 0) + Number(stats.sf || 0)
    );
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

/**
 * Sums already validated team-stat documents across authoritative Diamond
 * game heads. Missing or stale documents make every otherwise-complete season
 * counter partial; they are never interpreted as a zero-value game.
 */
export function aggregateCoverageAwareTeamStats({ diamondGames = [], allowedStatIds = [] } = {}) {
    const catalogIds = new Set(DIAMOND_TEAM_STAT_CATALOG.map(({ id }) => id));
    const statIds = [...new Set((Array.isArray(allowedStatIds) ? allowedStatIds : [])
        .map(normalizeStatKey)
        .filter((id) => id && catalogIds.has(id)))].sort();
    const entries = Array.isArray(diamondGames) ? diamondGames : [];
    const totals = {};
    const hasValueById = {};
    const statusesById = Object.fromEntries(statIds.map((id) => [id, []]));
    const sourceRevisions = [];
    let projectionPending = false;

    entries.forEach(({ game = {}, document = null }) => {
        if (!isRecord(document)) {
            projectionPending = true;
            return;
        }
        const view = readCoverageAwareStatDocument(document, game);
        projectionPending ||= view.projection.pending;
        if (view.sourceRevision !== null) sourceRevisions.push(view.sourceRevision);
        statIds.forEach((id) => {
            const status = view.statCoverage[id] || 'not_collected';
            statusesById[id].push(status);
            if (!Object.hasOwn(view.values, id)) return;
            const value = Number(view.values[id]);
            if (!Number.isFinite(value)) return;
            totals[id] = (Number(totals[id]) || 0) + value;
            hasValueById[id] = true;
        });
    });

    const statCoverage = {};
    statIds.forEach((id) => {
        const statuses = statusesById[id];
        const allGamesAccountedFor = statuses.length === entries.length;
        let status = allGamesAccountedFor && statuses.length > 0 && statuses.every((candidate) => candidate === 'complete')
            ? 'complete'
            : statuses.some((candidate) => candidate === 'partial') || hasValueById[id]
                ? 'partial'
                : 'not_collected';
        if (projectionPending && status === 'complete') status = 'partial';
        statCoverage[id] = status;
    });
    const observedStatKeys = statIds.filter((id) => statCoverage[id] === 'partial' && hasValueById[id]);
    const unavailableStatKeys = statIds.filter((id) => !hasValueById[id]);
    const presentation = Object.freeze({
        isDiamond: true,
        statCoverage: Object.freeze(statCoverage),
        observedStatKeys: Object.freeze(observedStatKeys),
        unavailableStatKeys: Object.freeze(unavailableStatKeys),
        projectionPending,
        sourceRevision: null,
        projection: Object.freeze({
            isDiamond: true,
            status: projectionPending ? 'pending' : 'current',
            pending: projectionPending,
            authoritativeRevision: null,
            sourceRevisions: Object.freeze([...new Set(sourceRevisions)].sort((left, right) => left - right))
        })
    });
    const stats = Object.freeze(Object.fromEntries(
        Object.entries(totals).filter(([id]) => hasValueById[id])
    ));
    return Object.freeze({
        stats,
        completeStats: Object.freeze(Object.fromEntries(
            Object.entries(stats).filter(([id]) => statCoverage[id] === 'complete')
        )),
        presentation,
        projection: Object.freeze({
            hasDiamond: entries.length > 0,
            pending: projectionPending,
            sourceRevisions: presentation.projection.sourceRevisions
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
