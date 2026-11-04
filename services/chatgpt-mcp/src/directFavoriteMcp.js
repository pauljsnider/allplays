import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DomainError } from './core.js';
import { createDirectFavoriteCommands } from './directFavorite.js';
import { createDirectStatConfigurationCommands } from './directStatConfiguration.js';
import { createDirectDiscovery } from './directDiscovery.js';
import { createDirectRosterCommands } from './directRoster.js';

// The authenticated router composes bounded domains here. Production server.js
// never imports it. No generic document writer or model-controlled approval.
export function createDirectFavoriteMcpSession(dependencies) {
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
            requestedSchema: { type: 'object', properties: { approve: { type: 'boolean', title: 'Apply this exact displayed change once', default: false } }, required: ['approve'] }
        }, { timeout: 120000, ...options });
        return dependencies.authorizeAction
            ? dependencies.authorizeAction(preview, elicit, extra.signal)
            : elicit(preview, { signal: extra.signal });
    };
    const mutation = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
    const registerOutcome = (suffix, commands) => {
        server.registerTool(`confirm_${suffix}`, {
            description: 'Request explicit form approval of this exact prepared change, reauthorize and apply once. A conversational yes or confirmed argument cannot substitute. Decline/cancel has no effect. After an uncertain outcome, check this same proposal ID.',
            inputSchema: z.object({ proposalId: id }).strict(), annotations: mutation
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
    if (dependencies.getDb) {
        const discovery = createDirectDiscovery(dependencies);
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
