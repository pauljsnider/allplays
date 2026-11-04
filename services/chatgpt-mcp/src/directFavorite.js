// Isolated direct-command prototype. Not registered by the production server.
import { createHash } from 'node:crypto';
import { DomainError } from './core.js';

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const TOOL = 'mcp_direct_favorite';
const canonical = (value) => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object'
        ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
        : value;
const fingerprint = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const proposalPath = (uid, id) => `users/${uid}/privateAiPendingActions/direct_${id}`;
const favoritePath = ({ teamId, drillId }) => `teams/${teamId}/drillFavorites/${drillId}`;

function validateActor(context, uid, teamId) {
    if (context.uid !== uid || !ID.test(uid)) throw new DomainError('permission_denied', 'The connected account changed.');
    const roles = context.teams.get(teamId)?.roles;
    if (!(roles?.has('owner') || roles?.has('admin'))) throw new DomainError('permission_denied', 'Current team-manager access is required.');
}

function validateProposal(record, uid) {
    if (!record || record.userId !== uid || record.toolName !== TOOL || !ID.test(record.teamId) || !ID.test(record.drillId)
        || typeof record.favorite !== 'boolean' || !Number.isFinite(Date.parse(record.expiresAt))
        || record.digest !== fingerprint({ uid, teamId: record.teamId, drillId: record.drillId, favorite: record.favorite })) {
        throw new DomainError('not_found', 'No proposal is available for this account.');
    }
}

async function readTarget(reader, args) {
    const team = await reader.get(`teams/${args.teamId}`);
    const drill = await reader.get(`drillLibrary/${args.drillId}`);
    const favorite = await reader.get(favoritePath(args));
    if (!team.exists || !drill.exists) throw new DomainError('not_found', 'The team or drill is unavailable.');
    if (!team.version || !drill.version || (favorite.exists && !favorite.version)) throw new DomainError('unavailable', 'Target revisions could not be verified.');
    return { team, drill, favorite };
}

function revisions(target) {
    return { team: target.team.version, drill: target.drill.version, favorite: target.favorite.version || null };
}

function previewFor(target, { teamId, drillId, favorite }) {
    return {
        action: favorite ? 'Add team drill favorite' : 'Remove team drill favorite',
        teamId, teamName: String(target.team.data.name || teamId),
        drillId, drillTitle: String(target.drill.data.title || drillId),
        wasFavorite: target.favorite.exists, favorite
    };
}

export function createDirectFavoriteCommands({ uid, store, getContext, now = Date.now }) {
    if (!ID.test(uid)) throw new Error('A verified actor is required.');
    const pathFor = (id) => {
        if (!UUID.test(id)) throw new DomainError('invalid_argument', 'Use a UUID v4 proposalId.');
        return proposalPath(uid, id);
    };
    const result = (id, record) => ({ proposalId: id, status: record.status, teamId: record.teamId, drillId: record.drillId, favorite: record.favorite });

    async function load(id) {
        const snapshot = await store.get(pathFor(id));
        validateProposal(snapshot.data, uid);
        await getContext().then((context) => validateActor(context, uid, snapshot.data.teamId));
        return snapshot;
    }

    return {
        async prepare({ proposalId, teamId, drillId, favorite }) {
            const path = pathFor(proposalId);
            if (!ID.test(teamId || '') || !ID.test(drillId || '') || typeof favorite !== 'boolean') {
                throw new DomainError('invalid_argument', 'Provide exact team/drill IDs and an explicit favorite boolean.');
            }
            validateActor(await getContext(), uid, teamId);
            const digest = fingerprint({ uid, teamId, drillId, favorite });
            const existing = await store.get(path);
            if (existing.exists) {
                validateProposal(existing.data, uid);
                if (existing.data.digest !== digest) throw new DomainError('conflict', 'This proposal ID already describes another change.');
                return { ...result(proposalId, existing.data), preview: existing.data.preview, expiresAt: existing.data.expiresAt };
            }
            const target = await readTarget(store, { teamId, drillId });
            const preview = previewFor(target, { teamId, drillId, favorite });
            const record = {
                userId: uid, toolName: TOOL, status: 'prepared', teamId, drillId, favorite, digest,
                preview, revisions: revisions(target), expiresAt: new Date(now() + 5 * 60 * 1000).toISOString()
            };
            // Creation is idempotent by proposal ID; do not replace a competing proposal.
            try { await store.create(path, record); }
            catch (error) {
                const saved = await store.get(path);
                if (!saved.exists || saved.data.digest !== digest) throw error;
                validateProposal(saved.data, uid);
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
            const targetBeforeApproval = await readTarget(store, before.data);
            if (fingerprint(before.data.revisions) !== fingerprint(revisions(targetBeforeApproval))
                || fingerprint(before.data.preview) !== fingerprint(previewFor(targetBeforeApproval, before.data))) {
                throw new DomainError('conflict', 'The displayed proposal no longer matches current data. Prepare it again.');
            }
            const approval = await approve(before.data.preview);
            if (approval?.action !== 'accept' || approval.content?.approve !== true) {
                return { proposalId, status: approval?.action === 'decline' ? 'declined' : 'cancelled', applied: false };
            }
            validateActor(await getContext(), uid, before.data.teamId);
            try {
                return await store.transaction(async (transaction) => {
                    const current = await transaction.get(pathFor(proposalId));
                    validateProposal(current.data, uid);
                    if (current.data.digest === before.data.digest && current.data.status === 'completed') return result(proposalId, current.data);
                    if (current.version !== before.version || current.data.status !== 'prepared' || Date.parse(current.data.expiresAt) <= now()) {
                        throw new DomainError('conflict', 'The proposal changed or expired. Review a fresh proposal.');
                    }
                    const target = await readTarget(transaction, current.data);
                    if (fingerprint(revisions(target)) !== fingerprint(current.data.revisions)) {
                        throw new DomainError('conflict', 'The team, drill, or favorite changed after preparation. Review a fresh proposal.');
                    }
                    if (current.data.favorite && !target.favorite.exists) {
                        transaction.set(favoritePath(current.data), { addedBy: uid, addedAt: new Date(now()) });
                    } else if (!current.data.favorite && target.favorite.exists) {
                        transaction.delete(favoritePath(current.data));
                    }
                    const completed = { ...current.data, status: 'completed', completedAt: new Date(now()).toISOString(), approvalMethod: 'mcp-form-elicitation', approvedBy: uid };
                    transaction.set(pathFor(proposalId), completed);
                    return result(proposalId, completed);
                }, { beforeCommit: async () => {
                    await approval.consume?.();
                    if (Date.parse(before.data.expiresAt) <= now()) throw new DomainError('confirmation_expired', 'The proposal expired before execution.');
                } });
            } catch (error) {
                // A lost commit response is reconciled from the atomic receipt.
                // Never retry a business mutation automatically.
                const saved = await store.get(pathFor(proposalId)).catch(() => null);
                if (saved?.data?.digest === before.data.digest && saved.data.status === 'completed') return result(proposalId, saved.data);
                if (!(error instanceof DomainError) || error.code === 'unavailable') {
                    throw new DomainError('outcome_unknown', 'The outcome could not be verified. Check this same proposal ID; do not create a replacement or assume the change failed.');
                }
                throw error;
            }
        }
    };
}
