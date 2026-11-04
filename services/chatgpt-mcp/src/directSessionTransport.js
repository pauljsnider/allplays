import { randomUUID } from 'node:crypto';
import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { DomainError } from './core.js';
import { createDirectFavoriteMcpSession } from './directFavoriteMcp.js';
import { createOneActionApproval } from './directActionApproval.js';

const binding = (actor) => JSON.stringify([actor.uid, actor.clientId, actor.grantKey]);
const validActor = (actor, now) => typeof actor?.uid === 'string' && typeof actor.clientId === 'string'
    && typeof actor.grantKey === 'string' && actor.uid && actor.clientId && actor.grantKey
    && Number.isFinite(actor.expiresAt) && actor.expiresAt > now;

// Opt-in composition module only: server.js never mounts this router. Sessions
// are bounded, in memory, and never represent a persistent execution grant.
export function createDirectSessionRouter({
    authenticate, createDependencies, now = Date.now, sessionLifetimeMs = 600000,
    approvalLifetimeMs = 120000, maxSessions = 100, maxSessionsPerActor = 5,
    allowedHosts = ['localhost', '127.0.0.1'], allowedOrigins = []
}) {
    if (![sessionLifetimeMs, approvalLifetimeMs, maxSessions, maxSessionsPerActor].every((value) => Number.isInteger(value) && value > 0)
        || sessionLifetimeMs > 1800000 || approvalLifetimeMs > 120000 || maxSessions > 1000) {
        throw new Error('Use bounded session/approval lifetimes and session capacity.');
    }
    const router = express.Router();
    const sessions = new Map();
    router.use(express.json({ limit: '16kb' }));
    const reject = (res, status, message) => res.status(status).json({ jsonrpc: '2.0', error: { code: -32001, message }, id: null });
    async function dispose(session) {
        if (session.closed) return;
        session.closed = true;
        clearTimeout(session.timer);
        sessions.delete(session.id);
        await session.server.close().catch(() => {});
    }
    async function handle(req, res) {
        let session;
        let initializing = false;
        try {
            if (!allowedHosts.includes(req.hostname) || (req.headers.origin && !allowedOrigins.includes(req.headers.origin))) {
                return reject(res, 403, 'Origin or host is not allowed.');
            }
            const actor = await authenticate(req.headers.authorization);
            if (!validActor(actor, now())) {
                return reject(res, 401, 'An authenticated connection is required.');
            }
            for (const candidate of sessions.values()) if (candidate.expiresAt <= now()) await dispose(candidate);
            const sessionId = req.headers['mcp-session-id'];
            if (sessionId) {
                session = sessions.get(sessionId);
                if (!session) return reject(res, 404, 'Session expired or unavailable. Reinitialize; check the existing proposal ID before retrying.');
                if (binding(actor) !== session.binding) return reject(res, 403, 'This session belongs to another authenticated connection.');
            } else if (req.method === 'POST' && isInitializeRequest(req.body)) {
                if (sessions.size >= maxSessions || [...sessions.values()].filter((entry) => entry.uid === actor.uid).length >= maxSessionsPerActor) return reject(res, 503, 'The session limit was reached.');
                const authorization = req.headers.authorization;
                initializing = true;
                session = { id: randomUUID(), uid: actor.uid, binding: binding(actor), expiresAt: Math.min(actor.expiresAt, now() + sessionLifetimeMs), closed: false };
                const getCurrentActor = async () => {
                    if (session.closed || session.expiresAt <= now()) throw new DomainError('confirmation_expired', 'The connected session expired or disconnected.');
                    const current = await authenticate(authorization);
                    if (session.closed || session.expiresAt <= now() || !validActor(current, now()) || binding(current) !== session.binding) {
                        throw new DomainError('unauthenticated', 'The authenticated connection changed.');
                    }
                    return current;
                };
                session.server = createDirectFavoriteMcpSession({
                    ...createDependencies(actor, getCurrentActor),
                    authorizeAction: createOneActionApproval({ getActor: getCurrentActor, now, lifetimeMs: approvalLifetimeMs })
                });
                session.transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => session.id });
                const currentSession = session;
                session.transport.onclose = () => {
                    currentSession.closed = true;
                    clearTimeout(currentSession.timer);
                    sessions.delete(currentSession.id);
                };
                sessions.set(session.id, session);
                session.timer = setTimeout(() => { void dispose(currentSession); }, Math.max(1, session.expiresAt - now()));
                session.timer.unref?.();
                await session.server.connect(session.transport);
            } else {
                return reject(res, 400, 'Initialize an authenticated session first.');
            }
            // A disconnected approval stream cannot later resume execution.
            // A completed HTTP response is normal and does not close the session.
            const currentSession = session;
            res.on('close', () => { if (!res.writableEnded) void dispose(currentSession); });
            await session.transport.handleRequest(req, res, req.body);
            if (initializing && res.statusCode >= 400) await dispose(session);
            if (req.method === 'DELETE') await dispose(session);
        } catch (error) {
            if (initializing && session?.server) await dispose(session);
            if (!res.headersSent) {
                const status = error?.code === 'insufficient_scope' || error?.code === 'permission_denied' ? 403
                    : error?.code === 'unauthenticated' ? 401 : 503;
                reject(res, status, 'The authenticated protocol request could not be completed. No automatic execution retry was attempted.');
            }
        }
    }
    router.post('/', handle);
    router.get('/', handle);
    router.delete('/', handle);
    return { router, close: async () => { await Promise.all([...sessions.values()].map(dispose)); }, sessionCount: () => sessions.size };
}
