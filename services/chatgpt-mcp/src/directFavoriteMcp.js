import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DomainError } from './core.js';
import { confirmationFields } from './directConfirmation.js';
import { createDirectFavoriteCommands } from './directFavorite.js';
import { createDirectStatPresentationCommands } from './directStatPresentation.js';
import { createDirectStatConfigurationCommands } from './directStatConfiguration.js';
import { createDirectDiscovery } from './directDiscovery.js';
import { createDirectScheduleCommands } from './directSchedule.js';
import { createDirectRsvpCommands } from './directRsvp.js';
import { createScheduleReviewCommands } from './scheduleReview.js';
import { createDirectRosterBatchCommands } from './directRosterBatch.js';
import { createDirectTrackingBatchCommands, createDirectTrackingLifecycleCommands } from './directTrackingOperations.js';
import { createDirectTrackingStatusCommands } from './directTrackingStatus.js';
import { ASSIGNMENT_ROLE, createDirectAssignmentCommands } from './directAssignments.js';
import { createDirectAssignmentClaimCommands } from './directAssignmentClaims.js';
import { createDirectAssignmentBatchCommands } from './directAssignmentBatch.js';
import { createDirectPlayerProfileCommands } from './directPlayerProfile.js';
import { createDirectFamilyRsvpCommands } from './directFamilyRsvp.js';
import { createDirectPracticeAttendanceCommands } from './directPracticeAttendance.js';
import { createDirectIncentiveCommands } from './directIncentives.js';
import { createDirectTeamSetupCommands, TEAM_SETUP_PRESET_IDS } from './directTeamSetup.js';
import { createDirectTrackingItemCommands } from './directTrackingItem.js';
import { createDirectRosterLifecycleCommands } from './directRosterLifecycle.js';
import { createDirectRosterCommands } from './directRoster.js';
import { createDirectPracticeTimelineCommands } from './directPracticeTimeline.js';

// The authenticated router composes bounded domains here. Production server.js
// never imports it. No generic document writer or model-controlled approval.
export function createDirectFavoriteMcpSession(dependencies) {
    if (typeof dependencies?.authorizeAction !== 'function') throw new DomainError('confirmation_unavailable', 'A session-bound one-action approval authority is required.');
    if (dependencies.scheduleCommands && (!dependencies.scheduleStore || !['prepare', 'confirm', 'status'].every((key) => typeof dependencies.scheduleCommands[key] === 'function'))) {
        throw new DomainError('confirmation_unavailable', 'An explicit complete schedule execution path is required.');
    }
    const server = new McpServer({ name: 'allplays-direct-command-prototype', version: '0.2.0' });
    const id = z.string().uuid();
    const resourceId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
    const run = (handler) => async (args, extra) => {
        try {
            const result = await handler(args, extra);
            return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
        } catch (error) {
            return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: error instanceof DomainError ? error.code : 'unavailable', message: error instanceof DomainError ? error.message : 'The command could not be verified. No automatic retry was attempted.' }) }] };
        }
    };
    const approval = (extra) => async (preview) => {
        if (!server.server.getClientCapabilities()?.elicitation?.form) {
            throw new DomainError('confirmation_unavailable', 'This client does not support the required explicit approval. Use the app review workflow.');
        }
        const elicit = (approvedPreview, options = {}) => server.server.elicitInput({
            mode: 'form',
            message: `Approve this one change only? No ongoing write permission is granted.\n${JSON.stringify(approvedPreview, null, 2)}`,
            requestedSchema: { type: 'object', properties: confirmationFields(approvedPreview), required: Object.keys(confirmationFields(approvedPreview)) }
        }, { timeout: 120000, ...options });
        return dependencies.authorizeAction(preview, elicit, extra.signal);
    };
    const mutation = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
    const registerOutcome = (suffix, commands, annotations = mutation) => {
        server.registerTool(`confirm_${suffix}`, {
            description: 'Request explicit form approval of this exact prepared change, reauthorize and apply once. A conversational yes or confirmed argument cannot substitute. Decline/cancel has no effect. After an uncertain outcome, check this same proposal ID.',
            inputSchema: z.object({ proposalId: id }).strict(), annotations
        }, run((args, extra) => commands.confirm(args, approval(extra))));
        server.registerTool(`get_${suffix}_action`, {
            description: 'Read this account’s durable proposal outcome. Prepared does not mean applied.',
            inputSchema: z.object({ proposalId: id }).strict(), annotations: { readOnlyHint: true }
        }, run(commands.status));
    };
    const favorite = createDirectFavoriteCommands(dependencies);
    server.registerTool('prepare_team_drill_favorite', {
        description: 'Prepare one reversible team-drill favorite change for manager review. Does not apply it. Use exact IDs and reuse the proposal UUID after interruptions.',
        inputSchema: z.object({ proposalId: id, teamId: resourceId, drillId: resourceId, favorite: z.boolean() }).strict(), annotations: mutation
    }, run(favorite.prepare));
    registerOutcome('team_drill_favorite', favorite);

    if (dependencies.statPresentationStore) {
        const commands = createDirectStatPresentationCommands({ ...dependencies, store: dependencies.statPresentationStore });
        const changes = z.array(z.object({ statId: resourceId, format: z.enum(['number', 'percentage']).optional(), precision: z.number().int().min(0).max(6).optional(), rankingOrder: z.enum(['asc', 'desc']).optional() }).strict()).min(1).max(20);
        server.registerTool('prepare_customized_stat_preset', {
            description: 'Prepare a new reviewed sport preset with selected display format, precision and ranking changes. Requires public-metadata and historical-display acknowledgements. No formulas, IDs, visibility, scoring or game references change.',
            inputSchema: z.object({ proposalId: id, teamId: resourceId, presetId: z.enum(TEAM_SETUP_PRESET_IDS), name: z.string().min(1).max(120), changes }).strict(), annotations: mutation
        }, run((args) => commands.prepare({ ...args, mode: 'create', configId: `mcp_${args.proposalId}` })));
        server.registerTool('prepare_stat_presentation_update', {
            description: 'Prepare selected display format, precision or ranking changes on an existing reviewed preset schema. Public metadata and historical displays may change; formulas, stat identities and visibility are preserved. Extended/custom/Diamond schemas require app review.',
            inputSchema: z.object({ proposalId: id, teamId: resourceId, configId: resourceId, changes }).strict(), annotations: mutation
        }, run((args) => commands.prepare({ ...args, mode: 'update' })));
        registerOutcome('stat_presentation', commands);
        server.registerTool('get_stat_presentation_options', {
            description: 'Read supported stat IDs, labels and current display settings from either an exact managed-team config or one reviewed preset. Choose exactly one configId or presetId.',
            inputSchema: z.object({ teamId: resourceId, configId: resourceId.optional(), presetId: z.enum(TEAM_SETUP_PRESET_IDS).optional() }).strict(), annotations: { readOnlyHint: true }
        }, run(commands.discover));
    }
    if (dependencies.statConfigurationStore) {
        const commands = createDirectStatConfigurationCommands({ ...dependencies, store: dependencies.statConfigurationStore });
        const name = z.string().min(1).max(120);
        server.registerTool('prepare_clone_stat_configuration', {
            description: 'Prepare creating one configuration by copying an existing configuration in the same managed team, with a new name. Exact schema is shown for approval. Does not attach it to games. Reuse the proposal UUID after interruptions.',
            inputSchema: z.object({ proposalId: id, teamId: resourceId, sourceConfigId: resourceId, name }).strict(), annotations: mutation
        }, run(({ proposalId, ...args }) => commands.prepare({ ...args, proposalId, configId: `mcp_${proposalId}`, mode: 'clone' })));
        server.registerTool('prepare_rename_stat_configuration', {
            description: 'Prepare changing only an existing managed-team configuration name. Scoring, formulas, stat visibility and game references are preserved. Reuse the proposal UUID after interruptions.',
            inputSchema: z.object({ proposalId: id, teamId: resourceId, configId: resourceId, name }).strict(), annotations: mutation
        }, run((args) => commands.prepare({ ...args, mode: 'rename' })));
        registerOutcome('stat_configuration', commands);
    }
    if (dependencies.teamSetupStore) {
        const commands = createDirectTeamSetupCommands({ ...dependencies, store: dependencies.teamSetupStore });
        server.registerTool('prepare_team_details', {
            description: 'Prepare changing only a managed team name and/or ZIP. Preserves visibility, sport, access, links and media. Names may appear with shared games. ZIP is five/nine digits or explicit empty to clear.',
            inputSchema: z.object({ proposalId: id, teamId: resourceId, changes: z.object({ name: z.string().min(1).max(120).optional(), zip: z.string().regex(/^(?:[0-9]{5}|[0-9]{9})?$/).optional() }).strict() }).strict(), annotations: mutation
        }, run((args) => commands.prepare({ ...args, mode: 'details' })));
        server.registerTool('prepare_stat_configuration_preset', {
            description: 'Prepare a new configuration from an exact reviewed app preset. Requires distinct approval of public metadata and possible automatic analytics display changes, even for private teams. Does not attach it to games, change recorded stats or enable Diamond.',
            inputSchema: z.object({ proposalId: id, teamId: resourceId, presetId: z.enum(TEAM_SETUP_PRESET_IDS), name: z.string().min(1).max(120) }).strict(), annotations: mutation
        }, run((args) => commands.prepare({ ...args, mode: 'preset', configId: `mcp_${args.proposalId}` })));
        registerOutcome('team_setup', commands);
        server.registerTool('list_team_setup_options', {
            description: 'Read the current manager-visible name/ZIP, supported preset IDs and existing configuration IDs/names. No contacts, credentials or membership lists are returned.',
            inputSchema: z.object({ teamId: resourceId }).strict(), annotations: { readOnlyHint: true }
        }, run(commands.discover));
    }
    if (dependencies.incentiveStore) {
        const commands = createDirectIncentiveCommands({ ...dependencies, store: dependencies.incentiveStore });
        const scope = { proposalId: id, teamId: resourceId, playerId: resourceId };
        const terms = z.object({ statKey: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), type: z.enum(['per_unit', 'threshold']),
            amountCents: z.number().int().min(1).max(1000000), threshold: z.number().int().min(0).max(1000000).nullable(),
            thresholdOp: z.enum(['gt', 'gte']).nullable(), active: z.boolean() }).strict();
        for (const mode of ['create', 'revise']) server.registerTool(`prepare_${mode}_player_incentive_rule`, {
            description: 'Prepare private positive-value incentive terms for one exactly linked child. Revision closes the current version and creates a replacement from execution time. Requires a separate incentive-effects acknowledgement; no payment or messaging occurs.',
            inputSchema: z.object({ ...scope, terms, ...(mode === 'revise' ? { ruleId: resourceId } : {}) }).strict(), annotations: mutation
        }, run(({ ruleId, ...args }) => commands.prepare({ ...args, mode, sourceId: ruleId, resultId: `mcp_${args.proposalId}` })));
        server.registerTool('prepare_set_player_incentive_active', {
            description: 'Prepare an explicit active true/false state by versioning a current private incentive rule. Historical versions remain unchanged apart from closing the current interval. No payment occurs.',
            inputSchema: z.object({ ...scope, ruleId: resourceId, active: z.boolean() }).strict(), annotations: mutation
        }, run(({ ruleId, ...args }) => commands.prepare({ ...args, mode: 'set_active', sourceId: ruleId, resultId: `mcp_${args.proposalId}` })));
        server.registerTool('prepare_retire_player_incentive_rule', {
            description: 'Prepare closing one current private incentive rule from execution time. Does not delete its history, transfer money or change paid records.',
            inputSchema: z.object({ ...scope, ruleId: resourceId }).strict(), annotations: mutation
        }, run(({ ruleId, ...args }) => commands.prepare({ ...args, mode: 'retire', sourceId: ruleId, resultId: ruleId })));
        server.registerTool('prepare_player_incentive_cap', {
            description: 'Prepare setting integer cents or explicit null to clear the private per-game cap. This global cap can change displayed past and future earnings. Requires a distinct incentive-effects acknowledgement; no payment occurs.',
            inputSchema: z.object({ ...scope, maxPerGameCents: z.number().int().min(0).max(1000000).nullable() }).strict(), annotations: mutation
        }, run((args) => commands.prepare({ ...args, mode: 'cap', resultId: `_cap_${args.playerId}` })));
        registerOutcome('player_incentive', commands, { ...mutation, destructiveHint: true });
        server.registerTool('list_my_player_incentives', {
            description: 'Discover this parent’s own current private rules, cap and configured stat keys for an exactly linked child. No other parent’s rules or payment records are exposed.',
            inputSchema: z.object({ teamId: resourceId, playerId: resourceId }).strict(), annotations: { readOnlyHint: true }
        }, run(commands.discover));
    }
    if (dependencies.practiceAttendanceStore) {
        const commands = createDirectPracticeAttendanceCommands({ ...dependencies, store: dependencies.practiceAttendanceStore });
        server.registerTool('prepare_practice_attendance', {
            description: 'Prepare present/late/absent changes for 1–20 active players in an ordinary draft practice session without a packet. Preserves existing notes and other players; refreshes attendance totals. Notes, clearing records and legacy attendance require app review.',
            inputSchema: z.object({ proposalId: id, teamId: resourceId, eventId: resourceId, sessionId: resourceId,
                changes: z.array(z.object({ playerId: resourceId, status: z.enum(['present', 'late', 'absent']) }).strict()).min(1).max(20) }).strict(), annotations: mutation
        }, run(commands.prepare));
        registerOutcome('practice_attendance', commands);
    }
    if (dependencies.playerProfileStore) {
        const commands = createDirectPlayerProfileCommands({ ...dependencies, store: dependencies.playerProfileStore });
        server.registerTool('prepare_linked_player_private_profile', {
            description: 'Prepare selected emergency contact name/phone or medical text for one exactly linked active child. Explicit empty text clears only that field. Separate confirmation discloses access by all linked parents and authorized team owners/admins. Prior private text is never returned. Photos, household contacts and access changes require app review.',
            inputSchema: z.object({ proposalId: id, teamId: resourceId, playerId: resourceId, changes: z.object({
                emergencyContactName: z.string().max(120).optional(), emergencyContactPhone: z.string().max(60).optional(), medicalInfo: z.string().max(2000).optional()
            }).strict() }).strict(), annotations: mutation
        }, run(commands.prepare));
        registerOutcome('linked_player_private_profile', commands, { ...mutation, destructiveHint: true });
    }
    if (dependencies.familyRsvpNoteStore) {
        const commands = createDirectFamilyRsvpCommands({ ...dependencies, store: dependencies.familyRsvpNoteStore }, { staffNotes: true });
        const shared = { proposalId: id, teamId: resourceId, eventId: resourceId, response: z.enum(['going', 'maybe', 'not_going']), note: z.string().max(2000) };
        server.registerTool('prepare_linked_child_rsvp_with_staff_note', {
            description: 'Prepare one linked child response with an explicit staff-only note. Empty note clears its text. Requires separate note-audience confirmation; no messages are sent. Team-visible or legacy notes require app review.',
            inputSchema: z.object({ ...shared, playerId: resourceId }).strict(), annotations: mutation
        }, run(({ playerId, ...args }) => commands.prepare({ ...args, playerIds: [playerId] })));
        server.registerTool('prepare_linked_children_rsvps_with_staff_note', {
            description: 'Prepare an atomic response and the same exact staff-only note for 1–10 selected linked children. Explicit empty note clears each selected note. Requires separate confirmation; base records, audiences and other authors stay unchanged.',
            inputSchema: z.object({ ...shared, playerIds: z.array(resourceId).min(1).max(10) }).strict(), annotations: mutation
        }, run(commands.prepare));
        registerOutcome('family_rsvp_staff_note', commands, { ...mutation, destructiveHint: true });
    }
    if (dependencies.familyRsvpStore) {
        const commands = createDirectFamilyRsvpCommands({ ...dependencies, store: dependencies.familyRsvpStore });
        const response = z.enum(['going', 'maybe', 'not_going']);
        server.registerTool('prepare_linked_child_rsvp', {
            description: 'Prepare one currently linked active child’s response on an ordinary event. Preserves notes and other responders. Base/family RSVP reconciliation requires app review. Enforces cutoff; cached totals are not refreshed.',
            inputSchema: z.object({ proposalId: id, teamId: resourceId, eventId: resourceId, playerId: resourceId, response }).strict(), annotations: mutation
        }, run(({ playerId, ...args }) => commands.prepare({ ...args, playerIds: [playerId] })));
        server.registerTool('prepare_linked_children_rsvps', {
            description: 'Prepare an atomic response for 1–10 explicitly selected currently linked active children on one ordinary event. Does not write a base family RSVP, change access, notes or other responders, send messages or refresh cached totals.',
            inputSchema: z.object({ proposalId: id, teamId: resourceId, eventId: resourceId, playerIds: z.array(resourceId).min(1).max(10), response }).strict(), annotations: mutation
        }, run(commands.prepare));
        registerOutcome('linked_children_rsvps', commands);
        server.registerTool('list_my_linked_rsvp_children', {
            description: 'Discover exact currently linked player IDs, names and active state for this account only. No contacts or unrelated roster players are returned.',
            inputSchema: z.object({ teamId: resourceId }).strict(), annotations: { readOnlyHint: true }
        }, run(commands.discover));
    }
    if (dependencies.assignmentStore) {
        const commands = createDirectAssignmentCommands({ ...dependencies, store: dependencies.assignmentStore });
        const role = z.string().regex(ASSIGNMENT_ROLE);
        server.registerTool('prepare_manage_schedule_assignment', {
            description: 'Prepare creating, replacing or removing one ordinary event assignment. Update uses the exact current role and a complete replacement slot. Shows any claims to remove atomically. Other slots and event fields are preserved; no messages are sent.',
            inputSchema: z.object({ proposalId: id, teamId: resourceId, eventId: resourceId, action: z.enum(['create', 'update', 'remove']), role,
                assignment: z.object({ role, value: z.string().max(100), claimable: z.boolean() }).strict().optional() }).strict(), annotations: mutation
        }, run(commands.prepare));
        registerOutcome('schedule_assignment', commands, { ...mutation, destructiveHint: true });
        server.registerTool('list_managed_event_assignments', {
            description: 'List supported ordinary-event slots for a current manager. Does not return event notes or unrelated fields.',
            inputSchema: z.object({ teamId: resourceId, eventId: resourceId }).strict(), annotations: { readOnlyHint: true }
        }, run(commands.discover));
    }
    if (dependencies.assignmentBatchStore) {
        const commands = createDirectAssignmentBatchCommands({ ...dependencies, store: dependencies.assignmentBatchStore });
        const role = z.string().regex(ASSIGNMENT_ROLE);
        server.registerTool('prepare_schedule_assignment_batch', {
            description: 'Prepare 1–20 creates/updates on one ordinary event. Use exact current roles and complete replacement slots; swaps, chained edits and removals are unsupported. All changes apply atomically after a separate acknowledgement of displayed claim removals and no volunteer notification. Discover existing slots with list_managed_event_assignments.',
            inputSchema: z.object({ proposalId: id, teamId: resourceId, eventId: resourceId, operations: z.array(z.object({
                action: z.enum(['create', 'update']), role, assignment: z.object({ role, value: z.string().max(100), claimable: z.boolean() }).strict()
            }).strict()).min(1).max(20) }).strict(), annotations: mutation
        }, run(commands.prepare));
        registerOutcome('schedule_assignment_batch', commands, { ...mutation, destructiveHint: true });
    }
    if (dependencies.assignmentClaimStore) {
        const commands = createDirectAssignmentClaimCommands({ ...dependencies, store: dependencies.assignmentClaimStore });
        for (const action of ['claim', 'release']) server.registerTool(`prepare_${action}_schedule_assignment`, {
            description: action === 'claim' ? 'Prepare claiming one open slot for the connected linked parent. Publishes the current profile display name and account ID to the team; no messages or access changes.'
                : 'Prepare releasing only this connected linked parent’s own claim. Other people’s claims cannot be released.',
            inputSchema: z.object({ proposalId: id, teamId: resourceId, eventId: resourceId, role: z.string().regex(ASSIGNMENT_ROLE) }).strict(), annotations: mutation
        }, run((args) => commands.prepare({ ...args, action })));
        registerOutcome('own_schedule_assignment', commands, { ...mutation, destructiveHint: true });
        server.registerTool('list_my_event_assignment_slots', {
            description: 'List supported slots as open, mine, claimed or fixed for a current linked parent. Does not expose other claimant names or profile contacts.',
            inputSchema: z.object({ teamId: resourceId, eventId: resourceId }).strict(), annotations: { readOnlyHint: true }
        }, run(commands.discover));
    }
    if (dependencies.trackingBatchStore) {
        const commands = createDirectTrackingBatchCommands({ ...dependencies, store: dependencies.trackingBatchStore });
        server.registerTool('prepare_player_tracking_batch', {
            description: 'Prepare one atomic private tracking update for 1–20 explicitly selected active players. Use mixed complete booleans if needed. Refuses legacy/extended status records, preserves other players and sends no messages.',
            inputSchema: z.object({ proposalId: id, teamId: resourceId, itemId: resourceId, changes: z.array(z.object({ playerId: resourceId, complete: z.boolean() }).strict()).min(1).max(20) }).strict(), annotations: mutation
        }, run(commands.prepare));
        registerOutcome('player_tracking_batch', commands);
    }
    if (dependencies.trackingLifecycleStore) {
        const commands = createDirectTrackingLifecycleCommands({ ...dependencies, store: dependencies.trackingLifecycleStore });
        server.registerTool('prepare_private_tracking_active', {
            description: 'Prepare archiving (active false) or reactivating (active true) one private tracking requirement. Separate confirmation explains that all completion records are retained, including later authorized edits. No deletion, publication, access change or messages.',
            inputSchema: z.object({ proposalId: id, teamId: resourceId, itemId: resourceId, active: z.boolean() }).strict(), annotations: mutation
        }, run(commands.prepare));
        registerOutcome('private_tracking_active', commands, { ...mutation, destructiveHint: true });
    }
    if (dependencies.trackingStatusStore) {
        const commands = createDirectTrackingStatusCommands({ ...dependencies, store: dependencies.trackingStatusStore });
        server.registerTool('prepare_player_tracking_status', {
            description: 'Prepare one explicit complete/incomplete status for an exact active player and private active tracking item. Shows current status before approval. Public, archived and legacy items/statuses require app review; no messages or access changes.',
            inputSchema: z.object({ proposalId: id, teamId: resourceId, itemId: resourceId, playerId: resourceId, complete: z.boolean() }).strict(), annotations: mutation
        }, run(commands.prepare));
        registerOutcome('player_tracking_status', commands);
    }
    if (dependencies.trackingItemStore) {
        const commands = createDirectTrackingItemCommands({ ...dependencies, store: dependencies.trackingItemStore });
        const changes = z.object({ name: z.string().min(1).max(120).optional(), description: z.string().max(2000).optional() }).strict();
        server.registerTool('prepare_create_tracking_item', {
            description: 'Prepare one private active staff tracking item with a name and optional description. Checks all bounded tracking items for duplicate names. No publication, completion statuses, invitations or messages. Reuse the proposal UUID after interruption.',
            inputSchema: z.object({ proposalId: id, teamId: resourceId, changes: changes.extend({ name: z.string().min(1).max(120) }) }).strict(), annotations: mutation
        }, run(({ proposalId, ...args }) => commands.prepare({ ...args, proposalId, itemId: `mcp_${proposalId}`, mode: 'create' })));
        server.registerTool('prepare_update_tracking_item', {
            description: 'Prepare only name/description changes to an exact private active tracking item. Missing fields are preserved; an empty description clears it. Public, archived and legacy items require app review. No player status changes.',
            inputSchema: z.object({ proposalId: id, teamId: resourceId, itemId: resourceId, changes }).strict(), annotations: mutation
        }, run((args) => commands.prepare({ ...args, mode: 'update' })));
        registerOutcome('tracking_item', commands);
    }
    if (dependencies.rosterLifecycleStore) {
        const commands = createDirectRosterLifecycleCommands({ ...dependencies, store: dependencies.rosterLifecycleStore });
        server.registerTool('prepare_roster_player_active', {
            description: 'Prepare deactivating or reactivating one exact roster player. Separate confirmation explains active views, retained family links/history, existing RSVP-link usability and future communication eligibility. No deletion, invitations or link/token edits.',
            inputSchema: z.object({ proposalId: id, teamId: resourceId, playerId: resourceId, active: z.boolean() }).strict(), annotations: mutation
        }, run(({ playerId, active, ...args }) => commands.prepare({ ...args, changes: [{ playerId, active }] })));
        server.registerTool('prepare_roster_lifecycle_batch', {
            description: 'Prepare 1–20 distinct player deactivation/reactivation changes atomically. Mixed active booleans are allowed. Separate confirmation is required; no history, family links or other roster fields are rewritten.',
            inputSchema: z.object({ proposalId: id, teamId: resourceId, changes: z.array(z.object({ playerId: resourceId, active: z.boolean() }).strict()).min(1).max(20) }).strict(), annotations: mutation
        }, run(commands.prepare));
        registerOutcome('roster_lifecycle', commands, { ...mutation, destructiveHint: true });
    }
    if (dependencies.rosterStore) {
        const commands = createDirectRosterCommands({ ...dependencies, store: dependencies.rosterStore });
        const fields = z.object({ name: z.string().min(1).max(120).optional(), number: z.string().max(20).optional(), position: z.string().max(60).optional() }).strict();
        server.registerTool('prepare_create_roster_player', {
            description: 'Prepare one player with a name and optional number/position. Checks the complete bounded active/inactive roster for duplicate names. No contacts, invitations or custom fields. Reuse the same proposal UUID after interruptions.',
            inputSchema: z.object({ proposalId: id, teamId: resourceId, fields: fields.extend({ name: z.string().min(1).max(120) }) }).strict(), annotations: mutation
        }, run(({ proposalId, ...args }) => commands.prepare({ ...args, proposalId, mode: 'create', playerId: `mcp_${proposalId}` })));
        server.registerTool('prepare_update_roster_player', {
            description: 'Prepare changes only to the exact player’s name, number or position. Missing fields are preserved; empty number/position explicitly clears that field. Contacts, private fields, roster status and access require app review.',
            inputSchema: z.object({ proposalId: id, teamId: resourceId, playerId: resourceId, fields }).strict(), annotations: mutation
        }, run((args) => commands.prepare({ ...args, mode: 'update' })));
        registerOutcome('roster_player', commands);
    }
    if (dependencies.rosterBatchStore) {
        const commands = createDirectRosterBatchCommands({ ...dependencies, store: dependencies.rosterBatchStore });
        const fields = z.object({ name: z.string().min(1).max(120).optional(), number: z.string().max(20).optional(), position: z.string().max(60).optional() }).strict();
        server.registerTool('prepare_roster_batch', {
            description: 'Prepare 1–20 basic roster creates/updates for one atomic explicit approval. Creates require names; updates require exact player IDs. Checks the complete active/inactive roster and all resulting names. No contacts, invitations, custom fields or status changes. Reuse the same proposal UUID after interruptions.',
            inputSchema: z.object({ proposalId: id, teamId: resourceId, operations: z.array(z.discriminatedUnion('mode', [
                z.object({ mode: z.literal('create'), fields: fields.extend({ name: z.string().min(1).max(120) }) }).strict(),
                z.object({ mode: z.literal('update'), playerId: resourceId, fields }).strict()
            ])).min(1).max(20) }).strict(), annotations: mutation
        }, run(commands.prepare));
        registerOutcome('roster_batch', commands);
    }
    if (dependencies.practiceTimelineStore) {
        const commands = createDirectPracticeTimelineCommands({ ...dependencies, store: dependencies.practiceTimelineStore });
        server.registerTool('prepare_edit_practice_blocks', {
            description: 'Prepare draft timeline duration/order edits using current block indices. Durations refer to indices before reordering. Order must include every existing index exactly once. Preserves drill content and notes; historical logs or extended blocks require app review.',
            inputSchema: z.object({ proposalId: id, teamId: resourceId, eventId: resourceId, sessionId: resourceId,
                blockDurations: z.array(z.object({ order: z.number().int().min(0), duration: z.number().int().min(1).max(120) }).strict()).min(1).max(30).optional(),
                blockOrder: z.array(z.number().int().min(0)).min(1).max(100).optional() }).strict(), annotations: mutation
        }, run(({ blockDurations, blockOrder, ...args }) => commands.prepare({ ...args, mode: 'update', changes: {
            ...(blockDurations ? { blockDurations } : {}), ...(blockOrder ? { blockOrder } : {}) } })));
        const block = z.object({ drillId: resourceId.optional(), title: z.string().min(1).max(120).optional(),
            duration: z.number().int().min(1).max(120), type: z.string().min(1).max(60).optional(), description: z.string().max(2000).optional() }).strict();
        const blocks = z.array(block).min(1).max(30);
        server.registerTool('prepare_replace_or_remove_practice_blocks', {
            description: 'Prepare replacing/removing up to 30 draft plan blocks using their original indices. Replacement is a complete custom block or an exact available drill plus duration. Shows all discarded/replacement content; requires separate confirmation. Selected coaching notes, historical logs and extended blocks require app review. At least one block must remain.',
            inputSchema: z.object({ proposalId: id, teamId: resourceId, eventId: resourceId, sessionId: resourceId,
                blockReplacements: z.array(z.object({ order: z.number().int().min(0).max(99), block }).strict()).min(1).max(30).optional(),
                removeBlocks: z.array(z.number().int().min(0).max(99)).min(1).max(30).optional() }).strict(), annotations: mutation
        }, run(({ blockReplacements, removeBlocks, ...args }) => commands.prepare({ ...args, mode: 'update', changes: {
            ...(blockReplacements ? { blockReplacements } : {}), ...(removeBlocks ? { removeBlocks } : {}) } })));
        server.registerTool('prepare_create_practice_timeline', {
            description: 'Prepare a draft timeline for one existing non-recurring practice event without a timeline. Supply custom block titles or exact drill IDs and explicit durations. Does not create schedule events, packets, messages or attendance.',
            inputSchema: z.object({ proposalId: id, teamId: resourceId, eventId: resourceId,
                changes: z.object({ title: z.string().min(1).max(120), location: z.string().max(200).optional(), blocks }).strict() }).strict(), annotations: mutation
        }, run(({ proposalId, ...args }) => commands.prepare({ ...args, proposalId, mode: 'create', sessionId: `mcp_${proposalId}` })));
        server.registerTool('prepare_update_practice_timeline', {
            description: 'Prepare a draft timeline title/location change or append blocks. Exact event/session IDs required. Existing blocks, notes and attendance are preserved. Packet-assigned and recurring practices require app review.',
            inputSchema: z.object({ proposalId: id, teamId: resourceId, eventId: resourceId, sessionId: resourceId,
                changes: z.object({ title: z.string().min(1).max(120).optional(), location: z.string().max(200).optional(), appendBlocks: blocks.optional() }).strict() }).strict(), annotations: mutation
        }, run((args) => commands.prepare({ ...args, mode: 'update' })));
        registerOutcome('practice_timeline', commands, { ...mutation, destructiveHint: true });
    }
    if (dependencies.scheduleStore) {
        const commands = dependencies.scheduleCommands || createDirectScheduleCommands({ ...dependencies, store: dependencies.scheduleStore });
        const changes = z.object({ startDate: z.string().optional(), endDate: z.string().optional(), arrivalTime: z.string().optional(),
            location: z.string().max(200).optional(), title: z.string().min(1).max(120).optional(), opponent: z.string().min(1).max(120).optional(), isHome: z.boolean().optional() }).strict();
        server.registerTool('prepare_create_schedule_event', {
            description: 'Prepare one ordinary scheduled game/practice with explicit UTC offsets. Does not save yet. Execution requires separate approval of the save and possible team notifications; delivery cannot be verified. Reuse the proposal UUID after interruptions.',
            inputSchema: z.object({ proposalId: id, teamId: resourceId, eventType: z.enum(['game', 'practice']), changes }).strict(), annotations: mutation
        }, run(({ proposalId, ...args }) => commands.prepare({ ...args, proposalId, eventId: `mcp_${proposalId}`, mode: 'create' })));
        server.registerTool('prepare_update_schedule_event', {
            description: 'Prepare only ordinary date/time, location, opponent/title or home/away changes. Exact IDs required; recurrence, linked games, imports, active games and special engines require app review. Explicit separate notification approval is required.',
            inputSchema: z.object({ proposalId: id, teamId: resourceId, eventId: resourceId, eventType: z.enum(['game', 'practice']), changes }).strict(), annotations: mutation
        }, run((args) => commands.prepare({ ...args, mode: 'update' })));
        registerOutcome('schedule_event', commands, { ...mutation, openWorldHint: true });
    }
    if (dependencies.rsvpStore) {
        const commands = createDirectRsvpCommands({ ...dependencies, store: dependencies.rsvpStore });
        server.registerTool('prepare_staff_rsvp_override', {
            description: 'Prepare this manager’s going/maybe/not_going override for one exact active player and ordinary event. Rechecks availability cutoff. Does not edit notes, family/base responses or access; no messages. Cached aggregate totals are not refreshed.',
            inputSchema: z.object({ proposalId: id, teamId: resourceId, eventId: resourceId, playerId: resourceId, response: z.enum(['going', 'maybe', 'not_going']) }).strict(), annotations: mutation
        }, run(commands.prepare));
        registerOutcome('staff_rsvp_override', commands);
    }
    if (dependencies.getDb) {
        const discovery = createDirectDiscovery(dependencies);
        const schedule = createScheduleReviewCommands(dependencies);
        server.registerTool('list_team_schedule_events', {
            description: 'Discover exact event IDs and ordinary schedule fields, with app-review eligibility. Fetch every page before resolving names. Contacts, notes and attendance are excluded.',
            inputSchema: z.object({ teamId: resourceId, cursor: resourceId.optional(), limit: z.number().int().min(1).max(50).optional() }).strict(), annotations: { readOnlyHint: true }
        }, run(discovery.schedule));
        server.registerTool('prepare_schedule_event_review', {
            description: 'Stage ordinary game/practice creation or update for final review and confirmation in All Plays. Returns an advisory preview and review URL; DOES NOT execute a schedule change here. Schedule changes may notify the team independently of reminder settings. Use explicit UTC offsets and the same request UUID on retries.',
            inputSchema: z.object({ requestId: id, mode: z.enum(['create', 'update']), teamId: resourceId, eventId: resourceId.optional(), eventType: z.enum(['game', 'practice']),
                changes: z.object({ startDate: z.string().optional(), endDate: z.string().optional(), arrivalTime: z.string().optional(),
                    location: z.string().max(200).optional(), title: z.string().min(1).max(120).optional(), opponent: z.string().min(1).max(120).optional(), isHome: z.boolean().optional() }).strict() }).strict(), annotations: mutation
        }, run(schedule.prepare));
        server.registerTool('get_schedule_event_review', {
            description: 'Read the same account’s app review status. Requested/prepared does not mean the schedule change was applied.',
            inputSchema: z.object({ requestId: id }).strict(), annotations: { readOnlyHint: true }
        }, run(schedule.status));
        if (dependencies.practiceTimelineStore) {
            server.registerTool('list_practice_block_outline', {
                description: 'Read a managed practice session’s block indices, titles and durations for explicit edits. Notes, descriptions and attendance are omitted.',
                inputSchema: z.object({ teamId: resourceId, sessionId: resourceId }).strict(), annotations: { readOnlyHint: true }
            }, run(discovery.practiceBlocks));
            const paging = { teamId: resourceId, cursor: resourceId.optional(), limit: z.number().int().min(1).max(50).optional() };
            server.registerTool('list_team_practices', {
                description: 'Page through managed-team practice event IDs, titles and dates, indicating eligibility for a direct draft timeline. Schedule changes remain in the app.',
                inputSchema: z.object(paging).strict(), annotations: { readOnlyHint: true }
            }, run(discovery.practices));
            server.registerTool('list_practice_timelines', {
                description: 'Find timeline IDs linked to an exact managed-team event. Multiple matches require app review; notes and attendance are excluded.',
                inputSchema: z.object({ teamId: resourceId, eventId: resourceId }).strict(), annotations: { readOnlyHint: true }
            }, run(discovery.timelines));
            server.registerTool('list_practice_drill_options', {
                description: 'Page through community, published or team drill IDs, titles, types and suggested durations. Fetch needed pages and choose exact IDs; prepare shows current descriptions.',
                inputSchema: z.object({ ...paging, scope: z.enum(['community', 'published', 'team']) }).strict(), annotations: { readOnlyHint: true }
            }, run(discovery.drills));
        }
        if (dependencies.trackingItemStore) server.registerTool('list_team_tracking_items', {
            description: 'Page through managed-team tracking item IDs, names, visibility and status before selecting an exact item. Descriptions and player completions are excluded. Preparation verifies private state and current revisions for the selected text, completion or lifecycle workflow.',
            inputSchema: z.object({ teamId: resourceId, cursor: resourceId.optional(), limit: z.number().int().min(1).max(50).optional() }).strict(), annotations: { readOnlyHint: true }
        }, run(discovery.trackingItems));
        if (dependencies.rosterStore) server.registerTool('get_team_roster', {
            description: 'Discover exact active/inactive player IDs, names, numbers and positions before preparing a player update. Fetch all pages before matching names. Private contact/profile fields are excluded.',
            inputSchema: z.object({ teamId: resourceId, cursor: resourceId.optional(), limit: z.number().int().min(1).max(100).optional() }).strict(), annotations: { readOnlyHint: true }
        }, run(discovery.roster));
        server.registerTool('list_managed_teams', {
            description: 'Discover exact IDs and names of currently managed teams for direct proposal preparation.',
            inputSchema: z.object({}).strict(), annotations: { readOnlyHint: true }
        }, run(discovery.teams));
        server.registerTool('list_team_stat_configurations', {
            description: 'Page through a managed team’s configuration IDs and names. Fetch all pages before resolving duplicate names; exact content and revisions are reviewed at preparation.',
            inputSchema: z.object({ teamId: resourceId, cursor: resourceId.optional(), limit: z.number().int().min(1).max(50).optional() }).strict(), annotations: { readOnlyHint: true }
        }, run(discovery.configurations));
    }
    return server;
}
