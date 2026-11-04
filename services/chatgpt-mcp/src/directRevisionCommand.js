// Isolated direct-command prototype. Not registered by the production server.
import { createHash } from 'node:crypto';
import { DomainError } from './core.js';
import { approvedContent } from './directConfirmation.js';

export const ID = /^[A-Za-z0-9_-]{1,128}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const canonical = (value) => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object'
        ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
        : value;
export const fingerprint = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const proposalPath = (uid, id) => `users/${uid}/privateAiPendingActions/direct_${id}`;
export function createRevisionCommands({ uid, store, getContext, now = Date.now }, domain) {
    if (!ID.test(uid)) throw new Error('A verified actor is required.');
    const pathFor = (id) => {
        if (!UUID.test(id)) throw new DomainError('invalid_argument', 'Use a UUID v4 proposalId.');
        return proposalPath(uid, id);
    };
    const result = (id, record) => ({ proposalId: id, status: record.status, ...domain.result(record) });
    const validateProposal = (record) => {
        if (record?.receiptOnly === true && domain.validateReceipt) {
            if (record.userId !== uid || record.toolName !== domain.toolName || record.status !== 'completed'
                || !/^[a-f0-9]{64}$/.test(record.digest || '') || !domain.validateReceipt(record)) {
                throw new DomainError('not_found', 'No completed receipt is available for this account.');
            }
            return;
        }
        if (!record || record.userId !== uid || record.toolName !== domain.toolName
            || !Number.isFinite(Date.parse(record.expiresAt))
            || record.digest !== fingerprint({ uid, ...domain.args(record) })) {
            throw new DomainError('not_found', 'No proposal is available for this account.');
        }
    };
    const authorize = async (args) => domain.authorize(await getContext(), uid, args);

    async function load(id) {
        const snapshot = await store.get(pathFor(id));
        validateProposal(snapshot.data);
        await authorize(snapshot.data);
        return snapshot;
    }

    return {
        async prepare({ proposalId, ...input }) {
            const path = pathFor(proposalId);
            const args = domain.args(input);
            await authorize(args);
            const digest = fingerprint({ uid, ...args });
            const existing = await store.get(path);
            if (existing.exists) {
                validateProposal(existing.data);
                if (existing.data.digest !== digest) throw new DomainError('conflict', 'This proposal ID already describes another change.');
                return { ...result(proposalId, existing.data), preview: existing.data.preview, expiresAt: existing.data.expiresAt };
            }
            const target = await domain.readTarget(store, args);
            const preview = domain.preview(target, args);
            const record = {
                userId: uid, toolName: domain.toolName, status: 'prepared', ...args, digest,
                preview, revisions: domain.revisions(target), expiresAt: new Date(now() + 5 * 60 * 1000).toISOString()
            };
            // Creation is idempotent by proposal ID; do not replace a competing proposal.
            try { await store.create(path, record); }
            catch (error) {
                const saved = await store.get(path);
                if (!saved.exists || saved.data.digest !== digest) throw error;
                validateProposal(saved.data);
                return { ...result(proposalId, saved.data), preview: saved.data.preview, expiresAt: saved.data.expiresAt };
            }
            return { ...result(proposalId, record), preview, expiresAt: record.expiresAt };
        },

        async status({ proposalId }) {
            return result(proposalId, (await load(proposalId)).data);
        },

        // approve is supplied only by the MCP protocol adapter, never by tool args.
        async confirm({ proposalId }, approve) {
            const before = await load(proposalId);
            if (before.data.status === 'completed') return result(proposalId, before.data);
            if (before.data.status !== 'prepared' || Date.parse(before.data.expiresAt) <= now()) throw new DomainError('conflict', 'Prepare a fresh proposal before confirming.');
            const targetBeforeApproval = await domain.readTarget(store, before.data);
            if (fingerprint(before.data.revisions) !== fingerprint(domain.revisions(targetBeforeApproval))
                || fingerprint(before.data.preview) !== fingerprint(domain.preview(targetBeforeApproval, before.data))) {
                throw new DomainError('conflict', 'The displayed proposal no longer matches current data. Prepare it again.');
            }
            if (typeof approve !== 'function') throw new DomainError('confirmation_unavailable', 'A bound approval authority is required.');
            const approval = await approve(before.data.preview);
            if (!approvedContent(before.data.preview, approval)) {
                return { proposalId, status: approval?.action === 'decline' ? 'declined' : 'cancelled', applied: false };
            }
            if (typeof approval.consume !== 'function') throw new DomainError('confirmation_unavailable', 'A one-use session-bound approval is required before execution.');
            await authorize(before.data);
            try {
                return await store.transaction(async (transaction) => {
                    const current = await transaction.get(pathFor(proposalId));
                    validateProposal(current.data);
                    if (current.data.digest === before.data.digest && current.data.status === 'completed') return result(proposalId, current.data);
                    if (current.version !== before.version || current.data.status !== 'prepared' || Date.parse(current.data.expiresAt) <= now()) {
                        throw new DomainError('conflict', 'The proposal changed or expired. Review a fresh proposal.');
                    }
                    const target = await domain.readTarget(transaction, current.data);
                    if (fingerprint(domain.revisions(target)) !== fingerprint(current.data.revisions)) {
                        throw new DomainError('conflict', 'The target changed after preparation. Review a fresh proposal.');
                    }
                    await domain.apply(transaction, target, current.data, { uid, now });
                    const completed = { ...current.data, status: 'completed', completedAt: new Date(now()).toISOString(), approvalMethod: 'mcp-form-elicitation', approvedBy: uid };
                    transaction.set(pathFor(proposalId), completed);
                    return result(proposalId, completed);
                }, { beforeCommit: async () => {
                    await approval.consume();
                    if (Date.parse(before.data.expiresAt) <= now()) throw new DomainError('confirmation_expired', 'The proposal expired before execution.');
                    await domain.beforeCommit?.(targetBeforeApproval, before.data);
                } });
            } catch (error) {
                // A lost commit response is reconciled from the atomic receipt.
                // Never retry a business mutation automatically.
                const saved = await store.get(pathFor(proposalId)).catch(() => null);
                if (saved?.data?.digest === before.data.digest && saved.data.status === 'completed') {
                    validateProposal(saved.data);
                    return result(proposalId, saved.data);
                }
                if (!(error instanceof DomainError) || error.code === 'unavailable') {
                    throw new DomainError('outcome_unknown', 'The outcome could not be verified. Check this same proposal ID; do not create a replacement or assume the change failed.');
                }
                throw error;
            }
        }
    };
}
