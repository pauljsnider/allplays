// Isolated manager batch; not imported by the production server.
import { DomainError } from './core.js';
import { ID, createRevisionCommands } from './directRevisionCommand.js';
import { validateManager } from './directCommandAccess.js';
import { scheduleSummary } from './scheduleReview.js';
import { canonicalAssignments, canonicalAssignmentClaim, normalizeAssignmentOperation,
    assignmentEventPath, assignmentClaimPath, assignmentEventPattern, assignmentClaimPattern, createAssignmentDomainStore } from './directAssignments.js';

const TOOL = 'mcp_direct_assignment_batch';
const safeId = (value) => typeof value === 'string' && ID.test(value);
const fail = (message) => { throw new DomainError('unsupported_assignment', message); };
const fold = (role) => role.toLowerCase();
export function createDirectAssignmentBatchStore(options) {
    const base = createAssignmentDomainStore(options, TOOL);
    return { ...base, transaction: (callback, settings) => base.transaction((tx) => callback({ ...tx, set: (path, data) => {
        if (assignmentEventPattern.test(path) || assignmentClaimPattern.test(path)) throw new DomainError('permission_denied', 'Batch assignment changes use only a slot-array patch and exact claim deletions.');
        return tx.set(path, data);
    } }), settings) };
}
export function createDirectAssignmentBatchCommands(dependencies) {
    return createRevisionCommands(dependencies, {
        toolName: TOOL,
        args: ({ teamId, eventId, operations }) => {
            if (![teamId, eventId].every(safeId) || !Array.isArray(operations) || !operations.length || operations.length > 20) {
                throw new DomainError('invalid_argument', 'Use exact team/event IDs and 1–20 explicit slot creations or updates.');
            }
            const touched = new Set();
            const normalized = operations.map((operation) => {
                if (!operation || Object.getPrototypeOf(operation) !== Object.prototype
                    || Object.keys(operation).sort().join(',') !== 'action,assignment,role' || !['create', 'update'].includes(operation.action)) {
                    throw new DomainError('invalid_argument', 'Each operation needs only action=create|update, the current exact role, and a complete replacement slot.');
                }
                const entry = normalizeAssignmentOperation(operation);
                for (const key of new Set([fold(entry.role), fold(entry.assignment.role)])) {
                    if (touched.has(key)) throw new DomainError('invalid_argument', 'Every source and destination role must belong to one operation only. Swaps and chained edits require separate reviews.');
                    touched.add(key);
                }
                return entry;
            });
            return { teamId, eventId, operations: normalized };
        },
        authorize: (context, uid, args) => validateManager(context, uid, args.teamId),
        validateReceipt: (record) => [record.teamId, record.eventId].every(safeId),
        result: ({ teamId, eventId }) => ({ teamId, eventId }),
        readTarget: async (reader, args) => {
            const team = await reader.get(`teams/${args.teamId}`); const event = await reader.get(assignmentEventPath(args));
            if (!team.exists || !team.version || team.data.active === false || team.data.archived === true || !event.exists || !event.version) fail('The current managed team or event is unavailable.');
            const rows = canonicalAssignments(event.data);
            if (rows.length + args.operations.filter((entry) => entry.action === 'create').length > 50) fail('The resulting event may have at most 50 slots.');
            const edits = args.operations.map((entry) => {
                const index = rows.findIndex((row) => row.role === entry.role);
                if (entry.action === 'create' ? rows.some((row) => fold(row.role) === fold(entry.role)) : index < 0) fail('A new role already exists, or an exact update role is missing.');
                if (rows.some((row, i) => i !== index && fold(row.role) === fold(entry.assignment.role))) fail('A destination role is already occupied. Swaps require app review.');
                if (index >= 0 && ['role', 'value', 'claimable'].every((key) => rows[index][key] === entry.assignment[key])) fail('A selected slot already matches. Remove unchanged rows and review again.');
                const clear = entry.action === 'create' || entry.role !== entry.assignment.role || !entry.assignment.claimable || Boolean(entry.assignment.value);
                return { ...entry, index, before: index < 0 ? null : rows[index], clear };
            });
            const roles = [...new Set(edits.flatMap((entry) => [entry.role, entry.assignment.role]))];
            const claims = await Promise.all(roles.map(async (role) => ({ role, snapshot: await reader.get(assignmentClaimPath(args, role)) })));
            for (const { snapshot } of claims) canonicalAssignmentClaim(snapshot);
            const clearRoles = new Set(edits.filter((entry) => entry.clear).flatMap((entry) => [entry.role, entry.assignment.role]));
            if (edits.some((entry) => !entry.clear && entry.before?.claimable !== true && claims.some(({ role, snapshot }) => role === entry.role && snapshot.exists))) {
                fail('A fixed slot has a stale claim. Reopening it requires app review; this batch will not silently reactivate that claim.');
            }
            const after = rows.map((row, index) => edits.find((entry) => entry.index === index)?.assignment || row);
            after.push(...edits.filter((entry) => entry.action === 'create').map((entry) => entry.assignment));
            return { team, event, edits, claims, clearRoles, after };
        },
        revisions: ({ team, event, claims }) => ({ team: team.version, event: event.version,
            claims: claims.map(({ role, snapshot }) => ({ role, version: snapshot.version })) }),
        preview: ({ team, event, edits, claims, clearRoles, after }, args) => ({
            action: 'Create or update schedule assignments atomically', teamId: args.teamId,
            teamName: String(team.data.name || args.teamId), event: scheduleSummary(args.eventId, event.data),
            changes: edits.map(({ action, before, assignment }) => ({ action, before, after: assignment })),
            resultingSlotCount: after.length, requiredAcknowledgements: ['assignmentChanges'],
            removedClaims: claims.filter(({ role, snapshot }) => clearRoles.has(role) && snapshot.exists)
                .map(({ role, snapshot }) => ({ role, claimedByUserId: snapshot.data.claimedByUserId, claimedByName: snapshot.data.claimedByName })),
            effect: 'Saves all displayed slots together and removes exactly the listed claims, including any stale destination claims. Slot labels and fixed assignee text are visible to authorized event readers. Unselected slots, their claims and all other event fields are preserved. No notifications are sent; affected volunteers are not notified by this change.'
        }),
        apply: (tx, { after, claims, clearRoles }, args) => {
            tx.patch(assignmentEventPath(args), { assignments: after });
            for (const { role, snapshot } of claims) if (clearRoles.has(role) && snapshot.exists) tx.delete(assignmentClaimPath(args, role));
        }
    });
}
