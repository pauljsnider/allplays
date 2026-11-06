import { DomainError } from './core.js';
import { ID, fingerprint, createRevisionCommands } from './directRevisionCommand.js';
import { createDirectCommandStore } from './directCommandStore.js';

const TOOL = 'mcp_direct_private_incentive';
const safeId = (value) => typeof value === 'string' && ID.test(value);
const ruleId = (value) => safeId(value) && !value.startsWith('_cap_');
const money = (value) => Number.isSafeInteger(value) && value >= 0 && value <= 1000000;
const text = (value) => typeof value === 'string' && value.length > 0 && value.length <= 120 && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value);
const date = (value) => value instanceof Date && Number.isFinite(value.getTime());
const statKey = (value) => typeof value === 'string' && /^[a-z][a-z0-9_]{0,39}$/.test(value);
const ruleFields = ['teamId', 'playerId', 'playerName', 'statKey', 'type', 'amountCents', 'threshold', 'thresholdOp', 'active', 'createdAt', 'updatedAt', 'effectiveFrom', 'effectiveTo', 'supersedesRuleId'];
const statAliases = { PTS: 'pts', POINTS: 'pts', REB: 'reb', REBOUNDS: 'reb', AST: 'ast', ASSISTS: 'ast', STL: 'stl', STEALS: 'stl', BLK: 'blk', BLOCKS: 'blk', TO: 'to', TOV: 'to', TURNOVERS: 'to', FOULS: 'fouls', FLS: 'fouls' };
const invalid = (message) => { throw new DomainError('unsupported_incentive', message); };
const currentFields = (data) => Object.fromEntries(['statKey', 'type', 'amountCents', 'threshold', 'thresholdOp', 'active'].map((key) => [key, data[key]]));
function validTerms(data) {
    return data && statKey(data.statKey) && ['per_unit', 'threshold'].includes(data.type) && money(data.amountCents) && data.amountCents > 0 && typeof data.active === 'boolean'
        && (data.type === 'per_unit' ? data.threshold === null && data.thresholdOp === null
            : Number.isSafeInteger(data.threshold) && data.threshold >= 0 && data.threshold <= 1000000 && ['gt', 'gte'].includes(data.thresholdOp));
}
function assertParent(profile, args) {
    const keys = profile.data?.parentPlayerKeys;
    if (!profile.exists || !profile.version || !Array.isArray(profile.data.parentTeamIds) || !profile.data.parentTeamIds.includes(args.teamId) || !Array.isArray(keys)
        || !keys.includes(`${args.teamId}::${args.playerId}`) || keys.some((key) => typeof key === 'string' && key.endsWith(`::${args.playerId}`) && key !== `${args.teamId}::${args.playerId}`)) {
        throw new DomainError('permission_denied', 'A current exact parent link without cross-team player-ID ambiguity is required. Use app review for legacy links.');
    }
}
function validateRule(row, args) {
    const data = row.data;
    if (!row.exists || !row.version || !data || Object.keys(data).some((key) => !ruleFields.includes(key)) || data.teamId !== args.teamId || data.playerId !== args.playerId
        || !text(data.playerName) || !validTerms(data) || !date(data.createdAt) || !date(data.updatedAt) || !date(data.effectiveFrom)
        || !(data.effectiveTo === null || date(data.effectiveTo)) || data.effectiveFrom < data.createdAt || data.updatedAt < data.createdAt
        || (data.effectiveTo !== null && data.effectiveTo < data.effectiveFrom)
        || (data.supersedesRuleId !== undefined && !ruleId(data.supersedesRuleId))) return invalid('An incentive rule is legacy, extended, negative-valued or inconsistent. Use app review; no history is rewritten.');
}
function validateCap(row, args) {
    if (row.exists && (!row.version || !row.data || Object.keys(row.data).sort().join(',') !== 'maxPerGameCents,playerId,teamId,updatedAt'
        || row.data.teamId !== args.teamId || row.data.playerId !== args.playerId || !money(row.data.maxPerGameCents) || !date(row.data.updatedAt))) return invalid('This cap has a legacy or cross-team shape. Review it in the app before changing it.');
}
export function createDirectIncentiveStore(options) {
    const ownRule = new RegExp(`^users/${options.uid}/incentiveRules/[A-Za-z0-9_-]{1,128}$`);
    const cap = new RegExp(`^users/${options.uid}/incentiveRules/_cap_[A-Za-z0-9_-]{1,128}$`);
    const base = createDirectCommandStore(options, {
        read: (path) => path === `users/${options.uid}` || ownRule.test(path) || /^teams\/[A-Za-z0-9_-]{1,128}\/players\/[A-Za-z0-9_-]{1,128}$/.test(path),
        write: (path) => ownRule.test(path), delete: (path) => cap.test(path),
        serverTimestamps: (path, data) => ownRule.test(path) ? ['createdAt', 'updatedAt', 'effectiveFrom', 'effectiveTo'].filter((field) => date(data[field])) : [],
        patch: (path, data) => ownRule.test(path) && !cap.test(path) && Object.keys(data).sort().join(',') === 'effectiveTo,updatedAt' && date(data.effectiveTo) && date(data.updatedAt),
        query: (path, args) => path === `users/${options.uid}/incentiveRules` && safeId(args.playerId)
            ? { fields: [...ruleFields, 'maxPerGameCents'], limit: 101, where: { field: 'playerId', value: args.playerId } }
            : /^teams\/[A-Za-z0-9_-]{1,128}\/statTrackerConfigs$/.test(path) ? { fields: ['columns', 'baseType'], limit: 101 } : null
    });
    const proposal = new RegExp(`^users/${options.uid}/privateAiPendingActions/direct_[a-f0-9-]{36}$`);
    return { ...base, transaction: (callback, settings) => base.transaction((tx) => callback({ ...tx, set: (path, record) => {
        if (!proposal.test(path)) return tx.set(path, record);
        if (record.toolName !== TOOL || record.userId !== options.uid || record.status !== 'completed') throw new DomainError('invalid_argument', 'Only a completed private incentive receipt may be saved.');
        const { userId, toolName, teamId, playerId, resultId, digest, status, completedAt } = record;
        tx.set(path, { userId, toolName, teamId, playerId, resultId, digest, status, completedAt, receiptOnly: true });
    } }), settings) };
}
export function createDirectIncentiveCommands(dependencies) {
    const { uid, store, getContext, now = Date.now } = dependencies; const path = (id) => `users/${uid}/incentiveRules/${id}`;
    const authorize = async (context, actor, args) => {
        if (context.uid !== actor || !context.teams.get(args.teamId)?.roles?.has('parent')) throw new DomainError('permission_denied', 'This connected parent’s current player link is required.');
        assertParent(await store.get(`users/${uid}`), args);
    };
    const loadScope = async (reader, args) => {
        const profile = await reader.get(`users/${uid}`); assertParent(profile, args); const player = await reader.get(`teams/${args.teamId}/players/${args.playerId}`);
        if (!player.exists || !player.version || player.data.active === false || !text(player.data.name)) return invalid('Choose an exact active linked player.');
        const cap = await reader.get(path(`_cap_${args.playerId}`)); validateCap(cap, args);
        const rows = await reader.list(`users/${uid}/incentiveRules`, { playerId: args.playerId });
        if (rows.length > 100) return invalid('The bounded rule history exceeds 100 records. Review it in the app.');
        for (const row of rows.filter((item) => item.id.startsWith('_cap_'))) {
            if (row.id !== `_cap_${args.playerId}`) return invalid('Ambiguous cap record; review it in the app.');
            validateCap(row, args);
        }
        const rules = rows.filter((row) => !row.id.startsWith('_cap_')); for (const row of rules) validateRule(row, args);
        const configs = await reader.list(`teams/${args.teamId}/statTrackerConfigs`);
        if (configs.length > 100) return invalid('The stat configuration list exceeds the supported bound.');
        const stats = new Set();
        for (const config of configs) {
            if (config.data.columns !== undefined && !Array.isArray(config.data.columns)) return invalid('Review malformed stat configuration columns in the app.');
            for (const column of config.data.columns || []) {
                if (typeof column !== 'string') return invalid('Review unsupported stat configuration columns in the app.');
                const key = statAliases[column.toUpperCase()] || column.toLowerCase(); if (!statKey(key)) return invalid('Review unsupported stat keys in the app.'); stats.add(key);
            }
            if (config.data.baseType === 'Basketball') stats.add('fouls');
        }
        if (!stats.size) for (const key of ['pts', 'reb', 'ast', 'stl', 'blk', 'to', 'fouls']) stats.add(key);
        return { profile, player, cap, rows, configs, rules, stats: [...stats].sort() };
    };
    const commands = createRevisionCommands(dependencies, {
        toolName: TOOL,
        args: ({ teamId, playerId, mode, sourceId, resultId, terms, active, maxPerGameCents }) => {
            if (![teamId, playerId, resultId].every(safeId) || !['create', 'revise', 'set_active', 'retire', 'cap'].includes(mode)) throw new DomainError('invalid_argument', 'Use exact IDs and a supported incentive operation.');
            if (mode === 'cap') {
                if (resultId !== `_cap_${playerId}` || !(maxPerGameCents === null || money(maxPerGameCents))) throw new DomainError('invalid_argument', 'Specify an integer cap from 0 to 1000000 cents, or explicit null to clear it.');
                return { teamId, playerId, mode, resultId, maxPerGameCents };
            }
            if (!ruleId(resultId) || (mode !== 'create' && !ruleId(sourceId)) || (['revise', 'set_active'].includes(mode) && sourceId === resultId)) throw new DomainError('invalid_argument', 'A current rule and a distinct new version ID are required.');
            if (mode === 'set_active' && typeof active !== 'boolean') throw new DomainError('invalid_argument', 'Explicitly select active true or false.');
            if (mode === 'retire' && resultId !== sourceId) throw new DomainError('invalid_argument', 'Retirement must target the exact current rule.');
            if (['create', 'revise'].includes(mode) && (!validTerms(terms) || Object.keys(terms).sort().join(',') !== 'active,amountCents,statKey,threshold,thresholdOp,type')) throw new DomainError('invalid_argument', 'Supply complete supported positive-value terms using integer cents and an explicit active state.');
            return { teamId, playerId, mode, resultId, ...(mode !== 'create' ? { sourceId } : {}), ...(['create', 'revise'].includes(mode) ? { terms: { ...terms } } : {}), ...(mode === 'set_active' ? { active } : {}) };
        }, authorize,
        validateReceipt: (record) => [record.teamId, record.playerId, record.resultId].every(safeId),
        result: ({ teamId, playerId, resultId }) => ({ teamId, playerId, resultId, paymentEffect: 'none' }),
        readTarget: async (reader, args) => {
            const scope = await loadScope(reader, args); const target = await reader.get(path(args.resultId));
            const source = args.sourceId ? await reader.get(path(args.sourceId)) : null;
            if (source) { validateRule(source, args); if (source.data.effectiveTo !== null || source.data.effectiveFrom.getTime() > now()) return invalid('Choose a current non-future rule version. Historical versions are immutable through these tools.'); }
            if (args.mode !== 'cap' && args.mode !== 'retire' && target.exists) throw new DomainError('conflict', 'The proposed rule version already exists. Reuse the original proposal or prepare a new ID.');
            const after = args.terms || (args.mode === 'set_active' ? { ...currentFields(source.data), active: args.active } : null);
            if (after && !scope.stats.includes(after.statKey)) return invalid('Choose a current configured stat key from discovery.');
            if (args.mode === 'set_active' && source.data.active === args.active) throw new DomainError('conflict', 'The current rule already has that active state.');
            return { ...scope, source, target, after };
        },
        revisions: ({ profile, player, cap, rows, configs, source, target }) => ({ profile: profile.version, player: player.version, cap: cap.version, source: source?.version || null, target: target.version,
            rules: fingerprint(rows.map((row) => [row.id, row.version])), configs: fingerprint(configs.map((row) => [row.id, row.version])) }),
        preview: ({ player, cap, source, after, rules }, args) => ({ action: `${args.mode} private player incentive`, teamId: args.teamId, playerId: args.playerId, playerName: player.data.name,
            before: source ? currentFields(source.data) : null, after, currentCapCents: cap.exists ? cap.data.maxPerGameCents : null,
            ...(args.mode === 'cap' ? { requestedCapCents: args.maxPerGameCents } : {}), currentRuleCount: rules.filter((row) => row.data.effectiveTo === null).length,
            requiredAcknowledgements: ['incentiveTerms'], effect: args.mode === 'cap'
                ? 'Changes this parent’s private per-game cap. The cap is global, not versioned: changing or clearing it can change displayed earnings for past and future games. Does not transfer money, mark anything paid or send messages.'
                : 'Changes this parent’s private incentive terms from execution time onward. Revisions/active-state changes close the old version and create a new one atomically; retirement closes the current version. Other rules remain additive. Does not transfer money, mark anything paid or send messages.' }),
        apply: (tx, { source, after, target, player }, args) => {
            const timestamp = new Date(now());
            if (args.mode === 'cap') {
                if (args.maxPerGameCents === null) { if (target.exists) tx.delete(path(args.resultId)); }
                else tx.set(path(args.resultId), { teamId: args.teamId, playerId: args.playerId, maxPerGameCents: args.maxPerGameCents, updatedAt: timestamp });
                return;
            }
            if (source) tx.patch(path(args.sourceId), { effectiveTo: timestamp, updatedAt: timestamp });
            if (args.mode !== 'retire') tx.set(path(args.resultId), { teamId: args.teamId, playerId: args.playerId, playerName: player.data.name, ...after,
                createdAt: timestamp, updatedAt: timestamp, effectiveFrom: timestamp, effectiveTo: null, ...(source ? { supersedesRuleId: args.sourceId } : {}) });
        }
    });
    return { ...commands, async discover(args) {
        if (![args.teamId, args.playerId].every(safeId)) throw new DomainError('invalid_argument', 'Use exact team/player IDs.');
        await authorize(await getContext(), uid, args); const scope = await loadScope(store, args); await authorize(await getContext(), uid, args);
        return { teamId: args.teamId, playerId: args.playerId, statKeys: scope.stats, capCents: scope.cap.exists ? scope.cap.data.maxPerGameCents : null,
            rules: scope.rules.filter((row) => row.data.effectiveTo === null).map((row) => ({ id: row.id, ...currentFields(row.data) })),
            message: 'Private current rules for this parent only. Select exact IDs; every change requires a separate incentive-effects acknowledgement. No payment tools are exposed.' };
    } };
}
