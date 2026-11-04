import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DomainError } from './core.js';
import { createDirectFavoriteCommands } from './directFavorite.js';

// A transport-bound prototype, deliberately absent from server.js. The caller
// must bind this instance to one authenticated actor, and authenticate every
// incoming protocol message (including elicitation responses) as that actor.
// No connection permission, access token, or refresh grant is created here.
export function createDirectFavoriteMcpSession(dependencies) {
    const server = new McpServer({ name: 'allplays-direct-favorite-prototype', version: '0.1.0' });
    const commands = createDirectFavoriteCommands(dependencies);
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
    server.registerTool('prepare_team_drill_favorite', {
        description: 'Prepare one reversible team-drill favorite change for current manager review. Does not apply it. Use exact IDs and reuse the proposal UUID after interruptions.',
        inputSchema: z.object({ proposalId: id, teamId: resourceId, drillId: resourceId, favorite: z.boolean() }).strict(),
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    }, run(commands.prepare));
    server.registerTool('confirm_team_drill_favorite', {
        description: 'Ask the user to explicitly approve the exact prepared favorite change through MCP form elicitation, then reauthorize and apply it once. A conversational yes or tool argument cannot substitute for the approval response.',
        inputSchema: z.object({ proposalId: id }).strict(),
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    }, run((args, extra) => commands.confirm(args, async (preview) => {
        if (!server.server.getClientCapabilities()?.elicitation?.form) {
            throw new DomainError('confirmation_unavailable', 'This client does not support the required explicit approval. Use the app review workflow.');
        }
        const elicit = (approvedPreview, options = {}) => server.server.elicitInput({
            mode: 'form',
            message: `Approve this one change only? No ongoing write permission is granted.\n${JSON.stringify(approvedPreview, null, 2)}`,
            requestedSchema: { type: 'object', properties: { approve: { type: 'boolean', title: 'Apply this exact team-drill favorite change once', default: false } }, required: ['approve'] }
        }, { timeout: 120000, ...options });
        return dependencies.authorizeAction
            ? dependencies.authorizeAction(preview, elicit, extra.signal)
            : elicit(preview, { signal: extra.signal });
    })));
    server.registerTool('get_team_drill_favorite_action', {
        description: 'Check the durable outcome of this account’s favorite proposal. A prepared proposal is not an applied change.',
        inputSchema: z.object({ proposalId: id }).strict(),
        annotations: { readOnlyHint: true }
    }, run(commands.status));
    return server;
}
