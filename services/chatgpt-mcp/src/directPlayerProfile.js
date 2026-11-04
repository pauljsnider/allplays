import { DomainError } from './core.js';
import { ID, createRevisionCommands } from './directRevisionCommand.js';
import { createDirectCommandStore } from './directCommandStore.js';

const TOOL = 'mcp_direct_linked_player_profile';
const fields = ['emergencyContactName', 'emergencyContactPhone', 'medicalInfo'];
const limits = { emergencyContactName: 120, emergencyContactPhone: 60, medicalInfo: 2000 };
const pathFor = ({ teamId, playerId }) => `teams/${teamId}/players/${playerId}/private/profile`;
const safeId = (value) => typeof value === 'string' && ID.test(value);
const plain = (value) => value && Object.getPrototypeOf(value) === Object.prototype;
const text = (key, value) => typeof value === 'string' && value === value.trim() && value.length <= limits[key]
    && !(key === 'medicalInfo' ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/).test(value);
const validChanges = (changes) => plain(changes) && Object.keys(changes).length > 0
    && Object.entries(changes).every(([key, value]) => fields.includes(key) && text(key, value));
const payload = (changes, time) => {
    const data = { updatedAt: new Date(time) };
    if (Object.hasOwn(changes, 'medicalInfo')) data.medicalInfo = changes.medicalInfo;
    for (const [key, nested] of [['emergencyContactName', 'name'], ['emergencyContactPhone', 'phone']]) {
        if (Object.hasOwn(changes, key)) (data.emergencyContact ||= {})[nested] = changes[key];
    }
    return data;
};
const maskFor = (data) => [...(Object.hasOwn(data, 'medicalInfo') ? ['medicalInfo'] : []),
    ...Object.keys(data.emergencyContact || {}).map((key) => `emergencyContact.${key}`), 'updatedAt'].sort();
function validPayload(data) {
    if (!plain(data) || !(data.updatedAt instanceof Date) || !Number.isFinite(data.updatedAt.getTime())
        || Object.keys(data).some((key) => !['medicalInfo', 'emergencyContact', 'updatedAt'].includes(key))) return false;
    const changes = {};
    if (Object.hasOwn(data, 'medicalInfo')) changes.medicalInfo = data.medicalInfo;
    if (Object.hasOwn(data, 'emergencyContact')) {
        if (!plain(data.emergencyContact) || !Object.keys(data.emergencyContact).length || Object.keys(data.emergencyContact).some((key) => !['name', 'phone'].includes(key))) return false;
        for (const [key, field] of [['name', 'emergencyContactName'], ['phone', 'emergencyContactPhone']]) if (Object.hasOwn(data.emergencyContact, key)) changes[field] = data.emergencyContact[key];
    }
    return validChanges(changes);
}
function assertLinks(profile, args) {
    if (!profile.exists || !profile.version || !Array.isArray(profile.data.parentTeamIds) || !profile.data.parentTeamIds.includes(args.teamId)
        || !Array.isArray(profile.data.parentPlayerKeys) || !profile.data.parentPlayerKeys.includes(`${args.teamId}::${args.playerId}`)) {
        throw new DomainError('permission_denied', 'A current exact team/player parent link is required. Legacy links and staff-only access require app review.');
    }
}
export function createDirectPlayerProfileStore(options) {
    const profile = /^teams\/[A-Za-z0-9_-]{1,128}\/players\/[A-Za-z0-9_-]{1,128}\/private\/profile$/;
    const base = createDirectCommandStore(options, {
        read: (path) => path === `users/${options.uid}` || profile.test(path) || /^teams\/[A-Za-z0-9_-]{1,128}(\/players\/[A-Za-z0-9_-]{1,128})?$/.test(path),
        write: (path) => profile.test(path),
        patchFields: (path, data, mask) => profile.test(path) && validPayload(data) && Array.isArray(mask)
            && JSON.stringify([...mask].sort()) === JSON.stringify(maskFor(data))
    });
    const proposal = new RegExp(`^users/${options.uid}/privateAiPendingActions/direct_[a-f0-9-]{36}$`);
    return { ...base, transaction: (callback, settings) => base.transaction((tx) => {
        const missing = new Set();
        return callback({ ...tx, get: async (path) => { const row = await tx.get(path); if (!row.exists && profile.test(path)) missing.add(path); return row; },
            set: (path, record) => {
                if (!proposal.test(path)) {
                    if (!profile.test(path) || !missing.delete(path) || !validPayload(record)) throw new DomainError('permission_denied', 'Only a verified missing private profile may be created. Existing profiles require exact field masks.');
                    return tx.set(path, record);
                }
                if (record.userId !== options.uid || record.toolName !== TOOL || record.status !== 'completed') throw new DomainError('permission_denied', 'Only this actor’s completed profile receipt may be saved.');
                const { userId, toolName, teamId, playerId, digest, status, completedAt } = record;
                tx.set(path, { userId, toolName, teamId, playerId, digest, status, completedAt, receiptOnly: true });
            }
        });
    }, settings) };
}
export function createDirectPlayerProfileCommands(dependencies) {
    const { uid, store } = dependencies;
    return createRevisionCommands(dependencies, {
        toolName: TOOL,
        args: ({ teamId, playerId, changes }) => {
            if (![teamId, playerId].every(safeId) || !validChanges(changes)) throw new DomainError('invalid_argument', 'Choose one exact linked child and explicit trimmed emergency contact name/phone or medical text. Empty text clears only that field; photos and household access require app review.');
            return { teamId, playerId, changes: { ...changes } };
        },
        authorize: async (context, actor, args) => {
            if (context.uid !== actor || !context.teams.get(args.teamId)?.roles?.has('parent')) throw new DomainError('permission_denied', 'Current linked-parent access is required.');
            assertLinks(await store.get(`users/${uid}`), args);
        },
        validateReceipt: (record) => [record.teamId, record.playerId].every(safeId),
        result: ({ teamId, playerId }) => ({ teamId, playerId, message: 'Outcome covers only the explicitly selected private profile text. Prepared is not applied. No invitations, messages or access changes occur.' }),
        readTarget: async (reader, args) => {
            const parent = await reader.get(`users/${uid}`); assertLinks(parent, args);
            const team = await reader.get(`teams/${args.teamId}`); const player = await reader.get(`teams/${args.teamId}/players/${args.playerId}`);
            if (!team.exists || !team.version || team.data.active === false || team.data.archived === true || !player.exists || !player.version || player.data.active === false) throw new DomainError('unsupported_player', 'Choose an active linked player on an available team.');
            const profile = await reader.get(pathFor(args));
            if (profile.exists) {
                if (!profile.version || !plain(profile.data)) throw new DomainError('unsupported_profile', 'The existing private profile could not be verified.');
                for (const key of Object.keys(args.changes)) {
                    const contact = profile.data.emergencyContact;
                    if (key !== 'medicalInfo' && contact != null && !plain(contact)) throw new DomainError('unsupported_profile', 'Legacy emergency contact data requires app review.');
                    const previous = key === 'medicalInfo' ? profile.data.medicalInfo : contact?.[key === 'emergencyContactName' ? 'name' : 'phone'];
                    if (previous != null && typeof previous !== 'string') throw new DomainError('unsupported_profile', 'A selected legacy field requires app review. No previous private text is copied into the proposal.');
                }
            }
            return { parent, team, player, profile };
        },
        revisions: ({ parent, team, player, profile }) => ({ parent: parent.version, team: team.version, player: player.version, profile: profile.version }),
        preview: ({ profile }, args) => ({ action: profile.exists ? 'Update selected private player profile fields' : 'Create selected private player profile fields',
            teamId: args.teamId, playerId: args.playerId, changes: args.changes, requiredAcknowledgements: ['privatePlayerProfile'],
            audience: 'Current authorized team owners/admins and every parent currently linked to this exact player',
            effect: 'Only the supplied fields are replaced, or cleared with explicit empty text. Omitted fields, photos, household contacts and public roster fields are preserved. Previous private text is not copied into this proposal. No messages are sent.' }),
        apply: (tx, { profile }, args, { now }) => {
            const data = payload(args.changes, now());
            if (profile.exists) tx.patchFields(pathFor(args), data, maskFor(data));
            else tx.set(pathFor(args), data);
        }
    });
}
