import { DomainError } from './core.js';
import { ID, fingerprint } from './directRevisionCommand.js';
import { createDirectCommandStore } from './directCommandStore.js';

// Shared privacy boundary for team-only action content. The personal journal
// keeps opaque identifiers and completion state, never previews or field values.
export function createTeamProposalStore(options, { toolName, receiptFields, policy }) {
    const { uid } = options;
    if (!ID.test(uid) || !receiptFields.includes('teamId')) throw new Error('A verified actor and team-scoped receipt are required.');
    const userProposal = new RegExp(`^users/${uid}/privateAiPendingActions/direct_([a-f0-9-]{36})$`);
    const teamProposal = new RegExp(`^teams/[A-Za-z0-9_-]{1,128}/privateAiPendingActions/direct_${uid}_[a-f0-9-]{36}$`);
    const base = createDirectCommandStore(options, {
        ...policy,
        read: (path) => teamProposal.test(path) || policy.read(path),
        write: (path) => teamProposal.test(path) || policy.write(path),
        prepare: (path) => teamProposal.test(path),
        delete: (path) => teamProposal.test(path)
    });
    const companionPath = (path, record) => {
        const match = userProposal.exec(path);
        if (!match || !ID.test(record?.teamId || '')) throw new DomainError('invalid_argument', 'Invalid team proposal.');
        return `teams/${record.teamId}/privateAiPendingActions/direct_${uid}_${match[1]}`;
    };
    const metadata = (record, completed = false) => ({
        userId: uid, toolName, ...Object.fromEntries(receiptFields.map((field) => [field, record[field]])),
        digest: record.digest, expiresAt: record.expiresAt, status: completed ? 'completed' : 'prepared',
        ...(completed ? { receiptOnly: true, completedAt: record.completedAt } : {})
    });
    const read = async (reader, path) => {
        const header = await reader.get(path);
        if (!userProposal.test(path) || !header.exists || header.data.receiptOnly === true) return header;
        if (header.data.userId !== uid || header.data.toolName !== toolName || header.data.status !== 'prepared') throw new DomainError('not_found', 'No proposal is available for this command.');
        const content = await reader.get(companionPath(path, header.data));
        if (!content.exists || content.data.userId !== uid || content.data.toolName !== toolName
            || content.data.status !== 'pending' || content.data.digest !== header.data.digest
            || receiptFields.some((field) => fingerprint({ value: header.data[field] }) !== fingerprint({ value: content.data[field] })) || header.data.expiresAt !== content.data.expiresAt) {
            throw new DomainError('conflict', 'The team proposal is unavailable or changed.');
        }
        return { exists: true, version: `${header.version}:${content.version}`, data: { ...content.data, status: 'prepared' } };
    };
    return {
        get: (path) => read(base, path),
        list: base.list,
        create: (path, record) => base.create(path, metadata(record), [{
            path: companionPath(path, record),
            data: { ...record, status: 'pending', expiresAtAt: new Date(record.expiresAt) }
        }]),
        transaction: (callback, settings) => base.transaction((tx) => callback({
            get: (path) => read(tx, path), list: tx.list, patch: tx.patch, append: tx.append,
            set: (path, record) => {
                if (!userProposal.test(path)) return tx.set(path, record);
                if (record.status !== 'completed' || record.toolName !== toolName || record.userId !== uid) throw new DomainError('invalid_argument', 'Only a completed domain receipt may be saved.');
                tx.set(path, metadata(record, true));
                tx.delete(companionPath(path, record));
            }
        }), settings)
    };
}
