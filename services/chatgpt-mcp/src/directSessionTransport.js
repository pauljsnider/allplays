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
    authenticate, createDependencies, createExecutionEvidence, createScheduleBroker, now = Date.now, sessionLifetimeMs = 600000,
    approvalLifetimeMs = 120000, maxSessions = 100, maxSessionsPerActor = 5,
    allowedHosts = ['localhost', '127.0.0.1'], allowedOrigins = []
}) {
    if ((createExecutionEvidence && createScheduleBroker) || (createScheduleBroker !== undefined && typeof createScheduleBroker !== 'function')) {
        throw new Error('Choose one schedule execution path with an explicit broker factory.');
    }
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
        session.scheduleBroker?.close();
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
                    return { ...current, expiresAt: Math.min(current.expiresAt, session.expiresAt) };
                };
                session.getCurrentActor = getCurrentActor;
                const dependencies = createDependencies(actor, getCurrentActor);
                const scheduleBroker = createScheduleBroker?.({ dependencies, getActor: getCurrentActor, sessionId: session.id });
                if (createScheduleBroker && (!scheduleBroker || !['captureForm', 'close'].every((key) => typeof scheduleBroker[key] === 'function')
                    || !['prepare', 'confirm', 'status'].every((key) => typeof scheduleBroker.commands?.[key] === 'function'))) throw new Error('A complete signed schedule broker is required.');
                session.scheduleBroker = scheduleBroker;
                const executionEvidence = createExecutionEvidence?.({ getActor: getCurrentActor, sessionId: session.id });
                session.server = createDirectFavoriteMcpSession({
                    ...dependencies,
                    ...(scheduleBroker ? { scheduleCommands: scheduleBroker.commands } : {}),
                    ...(executionEvidence ? { executionEvidence } : {}),
                    authorizeAction: createOneActionApproval({ getActor: getCurrentActor, now, lifetimeMs: approvalLifetimeMs, captureForm: scheduleBroker?.captureForm || executionEvidence?.captureForm })
                });
                session.transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => session.id });
                const currentSession = session;
                session.transport.onclose = () => {
                    currentSession.closed = true;
                    currentSession.scheduleBroker?.close();
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
    // Host-only callback for an independently workload-authenticated endpoint.
    // Never registered as an MCP tool or exposed by the public session router.
    const introspectSession = async (input) => {
        const keys = ['uid', 'clientId', 'grantKey', 'sessionId', 'expiresAt', 'purpose'];
        if (!input || Object.keys(input).length !== keys.length || !keys.every((key) => Object.hasOwn(input, key))
            || !['uid', 'sessionId'].every((key) => typeof input[key] === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(input[key]))
            || typeof input.clientId !== 'string' || !/^[A-Za-z0-9._~-]{1,256}$/.test(input.clientId)
            || typeof input.grantKey !== 'string' || !/^[a-f0-9]{64}$/.test(input.grantKey)
            || !['schedule.execute', 'schedule.status'].includes(input.purpose) || !Number.isSafeInteger(input.expiresAt)
            || input.expiresAt <= now() || input.expiresAt - now() > 120000) throw new DomainError('unauthenticated', 'The bound session is unavailable.');
        const session = sessions.get(input.sessionId);
        if (!session || session.closed || binding(input) !== session.binding) throw new DomainError('unauthenticated', 'The bound session is unavailable.');
        const current = await session.getCurrentActor();
        const expiresAt = Math.min(current.expiresAt, session.expiresAt);
        if (session.closed || sessions.get(input.sessionId) !== session || current.reviewRequests !== true || binding(current) !== session.binding
            || now() >= input.expiresAt || expiresAt < input.expiresAt) throw new DomainError('unauthenticated', 'The bound session is unavailable.');
        return { uid: current.uid, clientId: current.clientId, grantKey: current.grantKey, sessionId: session.id, reviewRequests: true, connected: true, expiresAt };
    };
    return { router, introspectSession, close: async () => { await Promise.all([...sessions.values()].map(dispose)); }, sessionCount: () => sessions.size };
}
