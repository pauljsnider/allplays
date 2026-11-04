import { DomainError } from './core.js';
import { ID, createRevisionCommands } from './directRevisionCommand.js';
import { createDirectCommandStore } from './directCommandStore.js';
import { assignmentEventPath, assignmentClaimPath, assignmentEventPattern, assignmentClaimPattern,
    assignmentRoleValid, boundedAssignmentText, canonicalAssignments, canonicalAssignmentClaim } from './directAssignments.js';

const TOOL = 'mcp_direct_own_assignment_claim';
const exactIds = (args) => [args.teamId, args.eventId].every((id) => typeof id === 'string' && ID.test(id));
function assertParent(profile, teamId) {
    if (!profile.exists || !profile.version || !Array.isArray(profile.data.parentTeamIds) || !profile.data.parentTeamIds.includes(teamId)) {
        throw new DomainError('permission_denied', 'Current canonical linked-parent access to this team is required. Legacy-only links require app review.');
    }
}
// The parent flow cannot use manager-only team proposals. Its private personal
// proposal contains the requested role and only the actor's own display name,
// never other claimants, the assignment array, team metadata or contact fields.
export function createDirectAssignmentClaimStore(options) {
    const base = createDirectCommandStore(options, {
        read: (path) => path === `users/${options.uid}` || assignmentEventPattern.test(path) || assignmentClaimPattern.test(path),
        write: (path) => assignmentClaimPattern.test(path), delete: (path) => assignmentClaimPattern.test(path)
    });
    const proposal = new RegExp(`^users/${options.uid}/privateAiPendingActions/direct_[a-f0-9-]{36}$`);
    return { ...base, transaction: (callback, settings) => base.transaction((tx) => callback({ ...tx, set: (path, record) => {
        if (!proposal.test(path)) return tx.set(path, record);
        if (record.userId !== options.uid || record.toolName !== TOOL || record.status !== 'completed') throw new DomainError('invalid_argument', 'Only this actor’s completed claim receipt may be saved.');
        const { userId, toolName, teamId, eventId, digest, status, completedAt } = record;
        tx.set(path, { userId, toolName, teamId, eventId, digest, status, completedAt, receiptOnly: true });
    } }), settings) };
}
export function createDirectAssignmentClaimCommands(dependencies) {
    const { uid, store, getContext } = dependencies;
    const authorize = async (context, actor, args) => {
        if (context.uid !== actor || !context.teams.get(args.teamId)?.roles?.has('parent')) throw new DomainError('permission_denied', 'Current linked-parent access is required.');
        assertParent(await store.get(`users/${uid}`), args.teamId);
    };
    const commands = createRevisionCommands(dependencies, {
        toolName: TOOL,
        args: ({ teamId, eventId, role, action }) => {
            if (!exactIds({ teamId, eventId }) || !assignmentRoleValid(role) || !['claim', 'release'].includes(action)) throw new DomainError('invalid_argument', 'Use exact team/event IDs, a supported exact role, and claim/release.');
            return { teamId, eventId, role, action };
        }, authorize, validateReceipt: exactIds,
        result: ({ teamId, eventId }) => ({ teamId, eventId }),
        readTarget: async (reader, args) => {
            const profile = await reader.get(`users/${uid}`); assertParent(profile, args.teamId);
            const event = await reader.get(assignmentEventPath(args));
            if (!event.exists || !event.version) throw new DomainError('not_found', 'The event is unavailable.');
            const rows = canonicalAssignments(event.data); const slot = rows.find((row) => row.role === args.role);
            if (!slot || !slot.claimable || slot.value !== '') throw new DomainError('unsupported_assignment', 'Choose an exact open-signup slot; fixed or missing slots require app review.');
            const claim = await reader.get(assignmentClaimPath(args)); const value = canonicalAssignmentClaim(claim);
            if (args.action === 'claim' && claim.exists) throw new DomainError('conflict', 'This slot is already claimed. No existing claim will be overwritten.');
            if (args.action === 'release' && (!value || value.claimedByUserId !== uid)) throw new DomainError('permission_denied', 'Only your own existing claim may be released.');
            const displayName = args.action === 'release' ? value.claimedByName : profile.data.displayName || profile.data.fullName;
            if (!boundedAssignmentText(displayName, 100) || !displayName) throw new DomainError('unsupported_profile', 'Set a supported display name in the app first. Email addresses are not used as a fallback.');
            return { profile, event, claim, displayName };
        },
        revisions: ({ profile, event, claim }) => ({ profile: profile.version, event: event.version, claim: claim.version }),
        preview: ({ displayName }, args) => ({ action: `${args.action} my volunteer assignment`, teamId: args.teamId, eventId: args.eventId,
            role: args.role, actorId: uid, displayName,
            effect: args.action === 'claim' ? 'Publishes this name and your account ID as this slot’s claimant to team members. Changes no other slots, grants no access and sends no messages.'
                : 'Removes only your own claim and reopens this slot. Changes no other slots, grants no access and sends no messages.' }),
        apply: (tx, { displayName }, args, { now }) => {
            if (args.action === 'claim') tx.set(assignmentClaimPath(args), { claimedByUserId: uid, claimedByName: displayName, claimedAt: new Date(now()) });
            else tx.delete(assignmentClaimPath(args));
        }
    });
    return { ...commands, async discover(args) {
        if (!exactIds(args)) throw new DomainError('invalid_argument', 'Use exact team and event IDs.');
        await authorize(await getContext(), uid, args);
        const event = await store.get(assignmentEventPath(args));
        if (!event.exists) throw new DomainError('not_found', 'The event is unavailable.');
        const slots = canonicalAssignments(event.data);
        const result = await Promise.all(slots.map(async (slot) => {
            if (!slot.claimable) return { role: slot.role, state: 'fixed' };
            const claim = await store.get(assignmentClaimPath(args, slot.role)); const value = canonicalAssignmentClaim(claim);
            return { role: slot.role, state: !value ? 'open' : value.claimedByUserId === uid ? 'mine' : 'claimed' };
        }));
        await authorize(await getContext(), uid, args);
        return { teamId: args.teamId, eventId: args.eventId, slots: result, message: 'Exact role names and current signup states only. Preparation rechecks the event and selected claim.' };
    } };
}
