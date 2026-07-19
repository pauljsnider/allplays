// AllPlays ChatGPT MCP service — Streamable HTTP entry point.
//
// Credential-free by design: the service holds no service account. Each
// request's bearer token (Firebase refresh token or ID token) is resolved to
// the user's ID token, and all Firestore access happens AS THAT USER over the
// REST API — the same security rules that protect the AllPlays web/app clients
// authorize every read here.
//
// Tool names mirror the in-app private AI registry (apps/app/src/lib/
// privateAiService.ts) so the ChatGPT surface and the app assistant stay one
// catalog as the shared service layer is extracted.

import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import {
    DomainError,
    resolveUserContext,
    listMyTeams,
    getFamilySchedule,
    getGameSummary
} from './core.js';
import { createIdentityResolver } from './identity.js';
import { createUserDb } from './firestoreRest.js';

const PORT = Number(process.env.PORT) || 8787;
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'game-flow-c6311';
// Public web API key (client-side key; security is enforced by Firestore
// rules — see js/firebase-runtime-config.js and CLAUDE.md).
const WEB_API_KEY = process.env.FIREBASE_WEB_API_KEY || 'AIzaSyDoixIoKJuUVWdmImwjYRTthjKOv2mU0Jc';

const resolveIdentity = createIdentityResolver({ apiKey: WEB_API_KEY });

// Dev-only fallback for ChatGPT's "No Auth" connector mode: requests without
// an Authorization header authenticate as this token's user. Anyone who can
// reach the endpoint gets that user's (rules-scoped) data — use only with a
// test account behind a private tunnel, never in production.
const FALLBACK_BEARER = process.env.NODE_ENV === 'production' ? '' : (process.env.DEV_FALLBACK_BEARER || '');
if (process.env.NODE_ENV === 'production' && process.env.DEV_FALLBACK_BEARER) {
    throw new Error('DEV_FALLBACK_BEARER must not be set in production.');
}
if (FALLBACK_BEARER) {
    console.warn('[chatgpt-mcp] DEV_FALLBACK_BEARER is set: unauthenticated requests act as that user. Dev/test only.');
}

function toolResult(payload) {
    return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }], structuredContent: payload };
}

function toolError(error) {
    const code = error instanceof DomainError ? error.code : 'internal';
    const message = error instanceof DomainError ? error.message : 'Internal error.';
    if (!(error instanceof DomainError)) console.error('[chatgpt-mcp] tool failure:', error);
    return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: code, message }) }] };
}

function buildServer(identity) {
    const server = new McpServer({ name: 'allplays', version: '0.2.0' });
    const db = createUserDb({ projectId: PROJECT_ID, idToken: identity.idToken });

    const run = (handler) => async (args) => {
        try {
            const context = await resolveUserContext(db, identity);
            return toolResult(await handler(context, args));
        } catch (error) {
            return toolError(error);
        }
    };

    server.registerTool('get_profile', {
        title: 'Get profile',
        description: 'Account roles, linked teams, and linked players for the signed-in AllPlays user.',
        inputSchema: {},
        annotations: { readOnlyHint: true }
    }, run((context) => listMyTeams(db, context)));

    server.registerTool('list_schedule', {
        title: 'List schedule',
        description: 'Games and practices in a date range (default: next 7 days) across the user\'s teams, with RSVP state for linked players and deep links into AllPlays.',
        inputSchema: {
            startDate: z.string().optional().describe('ISO date, inclusive. Defaults to today.'),
            endDate: z.string().optional().describe('ISO date, inclusive. Defaults to startDate + 7 days.')
        },
        annotations: { readOnlyHint: true }
    }, run((context, args) => getFamilySchedule(db, context, args)));

    server.registerTool('get_game_summary', {
        title: 'Get game summary',
        description: 'Score, status, summary, and aggregated player statistics for one game on a team the user belongs to.',
        inputSchema: {
            teamId: z.string().describe('Team id from get_profile'),
            gameId: z.string().describe('Game id from list_schedule')
        },
        annotations: { readOnlyHint: true }
    }, run((context, args) => getGameSummary(db, context, args)));

    return server;
}

const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/healthz', (req, res) => res.json({ ok: true }));

app.post('/mcp', async (req, res) => {
    let identity;
    try {
        const authHeader = req.headers.authorization
            || (FALLBACK_BEARER ? `Bearer ${FALLBACK_BEARER}` : undefined);
        identity = await resolveIdentity(authHeader);
    } catch (error) {
        const message = error instanceof DomainError ? error.message : 'Unauthorized.';
        res.status(401).json({
            jsonrpc: '2.0',
            error: { code: -32001, message },
            id: null
        });
        return;
    }

    try {
        const server = buildServer(identity);
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        res.on('close', () => {
            transport.close();
            server.close();
        });
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
    } catch (error) {
        console.error('[chatgpt-mcp] request failure:', error);
        if (!res.headersSent) {
            res.status(500).json({
                jsonrpc: '2.0',
                error: { code: -32603, message: 'Internal server error' },
                id: null
            });
        }
    }
});

// Stateless server: no SSE notification stream or session teardown to serve.
app.get('/mcp', (req, res) => res.status(405).json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed.' },
    id: null
}));
app.delete('/mcp', (req, res) => res.status(405).json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed.' },
    id: null
}));

app.listen(PORT, () => {
    console.log(`[chatgpt-mcp] listening on :${PORT} (POST /mcp) — project ${PROJECT_ID}, user-credentialed Firestore access`);
});
