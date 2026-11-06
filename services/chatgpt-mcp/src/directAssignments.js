import { DomainError } from './core.js';
import { ID, createRevisionCommands } from './directRevisionCommand.js';
import { validateManager } from './directCommandAccess.js';
import { createTeamProposalStore } from './directTeamProposalStore.js';
import { ordinaryScheduleEvent, scheduleSummary } from './scheduleReview.js';

export const ASSIGNMENT_ROLE = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,79}$/;
export const assignmentEventPath = ({ teamId, eventId }) => `teams/${teamId}/games/${eventId}`;
export const assignmentClaimPath = (args, role = args.role) => `${assignmentEventPath(args)}/assignmentClaims/${role}`;
export const assignmentEventPattern = /^teams\/[A-Za-z0-9_-]{1,128}\/games\/[A-Za-z0-9_-]{1,128}$/;
export const assignmentClaimPattern = /^teams\/[A-Za-z0-9_-]{1,128}\/games\/[A-Za-z0-9_-]{1,128}\/assignmentClaims\/[A-Za-z0-9][A-Za-z0-9 _-]{0,79}$/;
export const boundedAssignmentText = (value, max) => typeof value === 'string' && value === value.trim() && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
export const assignmentRoleValid = (role) => typeof role === 'string' && ASSIGNMENT_ROLE.test(role) && role === role.trim();
const invalid = (message) => { throw new DomainError('unsupported_assignment', message); };
export function canonicalAssignments(event) {
    if (!ordinaryScheduleEvent(event)) return invalid('Use an ordinary scheduled event. Imported, linked, recurring, cancelled and active events require app review.');
    const rows = event.assignments === undefined ? [] : event.assignments;
    if (!Array.isArray(rows) || rows.length > 50 || rows.some((row) => !row || typeof row !== 'object'
        || Object.keys(row).some((key) => !['role', 'value', 'claimable'].includes(key))
        || !assignmentRoleValid(row.role) || !boundedAssignmentText(row.value, 100) || typeof row.claimable !== 'boolean'
        || (row.claimable && row.value !== '')) || new Set(rows.map((row) => row.role.toLowerCase())).size !== rows.length) {
        return invalid('Use at most 50 canonical unique assignment slots. Legacy, extended or ambiguous slots require app review; no fields will be discarded.');
    }
    return rows;
}
export function canonicalAssignmentClaim(snapshot) {
    if (!snapshot.exists) return null;
    const data = snapshot.data;
    if (!snapshot.version || !data || Object.keys(data).some((key) => !['claimedByUserId', 'claimedByName', 'claimedAt'].includes(key))
        || typeof data.claimedByUserId !== 'string' || !ID.test(data.claimedByUserId)
        || !boundedAssignmentText(data.claimedByName, 100) || !data.claimedByName
        || !(data.claimedAt instanceof Date) || !Number.isFinite(data.claimedAt.getTime())) return invalid('The existing claim is malformed or extended. Use app review; it will not be overwritten.');
    return data;
}
const TOOL = 'mcp_direct_assignment_management';
export function createDirectAssignmentStore(options) {
    return createTeamProposalStore(options, { toolName: TOOL, receiptFields: ['teamId', 'eventId'], policy: {
        read: (path) => assignmentEventPattern.test(path) || assignmentClaimPattern.test(path) || /^teams\/[A-Za-z0-9_-]{1,128}$/.test(path),
        write: (path) => assignmentEventPattern.test(path) || assignmentClaimPattern.test(path),
        delete: (path) => assignmentClaimPattern.test(path),
        patch: (path, data) => assignmentEventPattern.test(path) && Object.keys(data).length === 1 && Array.isArray(data.assignments)
    } });
}
export function createDirectAssignmentCommands(dependencies) {
    const commands = createRevisionCommands(dependencies, {
        toolName: TOOL,
        args: ({ teamId, eventId, action, role, assignment }) => {
            if (![teamId, eventId].every((id) => typeof id === 'string' && ID.test(id)) || !['create', 'update', 'remove'].includes(action)
                || !assignmentRoleValid(role)) throw new DomainError('invalid_argument', 'Use exact team/event IDs, a supported exact role and create/update/remove.');
            if (action === 'remove') {
                if (assignment !== undefined) throw new DomainError('invalid_argument', 'A removal does not accept replacement fields.');
                return { teamId, eventId, action, role };
            }
            if (!assignment || Object.keys(assignment).sort().join(',') !== 'claimable,role,value' || !assignmentRoleValid(assignment.role)
                || typeof assignment.claimable !== 'boolean' || !boundedAssignmentText(assignment.value, 100)
                || (assignment.claimable && assignment.value !== '') || (action === 'create' && role !== assignment.role)) throw new DomainError('invalid_argument', 'Supply the complete role/value/claimable slot; an open slot has an empty value.');
            return { teamId, eventId, action, role, assignment: { role: assignment.role, value: assignment.value, claimable: assignment.claimable } };
        },
        authorize: (context, uid, args) => validateManager(context, uid, args.teamId),
        validateReceipt: (record) => [record.teamId, record.eventId].every((id) => typeof id === 'string' && ID.test(id)),
        result: ({ teamId, eventId }) => ({ teamId, eventId }),
        readTarget: async (reader, args) => {
            const team = await reader.get(`teams/${args.teamId}`); const event = await reader.get(assignmentEventPath(args));
            if (!team.exists || !team.version || !event.exists || !event.version) return invalid('The managed team or event is unavailable.');
            const rows = canonicalAssignments(event.data); const index = rows.findIndex((row) => row.role === args.role);
            if (args.action === 'create' ? rows.some((row) => row.role.toLowerCase() === args.role.toLowerCase()) || rows.length === 50 : index < 0) return invalid('The exact slot is missing, duplicated, or the event has reached the slot limit.');
            if (args.assignment && rows.some((row, i) => i !== index && row.role.toLowerCase() === args.assignment.role.toLowerCase())) return invalid('Another slot already uses the requested name.');
            const touchedRoles = [...new Set([args.role, ...(args.assignment ? [args.assignment.role] : [])])];
            const claims = await Promise.all(touchedRoles.map(async (role) => ({ role, snapshot: await reader.get(assignmentClaimPath(args, role)) })));
            for (const { snapshot } of claims) canonicalAssignmentClaim(snapshot);
            const clearRoles = args.action !== 'update' || args.role !== args.assignment.role || !args.assignment.claimable || args.assignment.value
                ? touchedRoles : [];
            const after = args.action === 'create' ? [...rows, args.assignment] : args.action === 'remove' ? rows.filter((_, i) => i !== index) : rows.map((row, i) => i === index ? args.assignment : row);
            return { team, event, rows, index, claims, clearRoles, after };
        },
        revisions: ({ team, event, claims }) => ({ team: team.version, event: event.version, claims: claims.map(({ role, snapshot }) => ({ role, version: snapshot.version })) }),
        preview: ({ team, event, rows, index, claims, clearRoles }, args) => ({ action: `${args.action} schedule assignment`, teamId: args.teamId,
            teamName: String(team.data.name || args.teamId), event: scheduleSummary(args.eventId, event.data), before: index < 0 ? null : rows[index], after: args.assignment || null,
            removedClaims: claims.filter(({ role, snapshot }) => clearRoles.includes(role) && snapshot.exists).map(({ role, snapshot }) => ({ role, claimedByUserId: snapshot.data.claimedByUserId, claimedByName: snapshot.data.claimedByName })),
            effect: 'Changes this slot and atomically removes exactly the claims shown. Other slots and claims, event timing, access and notification settings remain unchanged. No messages are sent.' }),
        apply: (tx, { after, claims, clearRoles }, args) => {
            tx.patch(assignmentEventPath(args), { assignments: after });
            for (const { role, snapshot } of claims) if (clearRoles.includes(role) && snapshot.exists) tx.delete(assignmentClaimPath(args, role));
        }
    });
    return { ...commands, async discover({ teamId, eventId }) {
        if (![teamId, eventId].every((id) => typeof id === 'string' && ID.test(id))) throw new DomainError('invalid_argument', 'Use exact team and event IDs.');
        validateManager(await dependencies.getContext(), dependencies.uid, teamId);
        const event = await dependencies.store.get(assignmentEventPath({ teamId, eventId }));
        if (!event.exists) return invalid('The event is unavailable.');
        const slots = canonicalAssignments(event.data);
        validateManager(await dependencies.getContext(), dependencies.uid, teamId);
        return { teamId, eventId, slots, message: 'Preparation rechecks the exact slot and any associated claim before approval.' };
    } };
}
