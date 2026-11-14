// MCP prepares a review request; only the authenticated app can prepare and
// confirm the existing private-AI action. Never execute browser mutations here.
import { createHash } from 'node:crypto';
import catalog from './writeCatalog.json' with { type: 'json' };
import { APP_BASE_URL, DomainError } from './core.js';

export const writeCatalog = catalog;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const LIFETIME_MS = 30 * 60 * 1000;

async function readRequest(db, path) {
    try {
        return await db.doc(path).get();
    } catch (error) {
        if (error instanceof DomainError) throw error;
        throw new DomainError('unavailable', 'Review request state could not be verified. Retry with the same requestId.');
    }
}

export function normalizeReviewArguments(value) {
    let nodes = 0;
    const visit = (input, depth) => {
        if (++nodes > 10000 || depth > 12) throw new DomainError('invalid_argument', 'Review request is too complex.');
        if (input === null || typeof input === 'boolean' || typeof input === 'string') return input;
        if (typeof input === 'number' && Number.isFinite(input)) return input;
        if (Array.isArray(input)) return input.map((item) => visit(item, depth + 1));
        if (!input || typeof input !== 'object' || Object.getPrototypeOf(input) !== Object.prototype) {
            throw new DomainError('invalid_argument', 'Use JSON arguments.');
        }
        return Object.fromEntries(Object.keys(input).sort().map((key) => {
            if (key.startsWith('__') || ['constructor', 'prototype', 'confirmedWriteToken', 'preparedWrite', 'preparedArtifact', 'authorization', 'password', 'refreshToken', 'idToken', 'file', 'photoFile'].includes(key)) {
                throw new DomainError('invalid_argument', 'Credentials, files, and internal execution fields are not accepted.');
            }
            return [key, visit(input[key], depth + 1)];
        }));
    };
    if (!value || Array.isArray(value) || typeof value !== 'object') throw new DomainError('invalid_argument', 'Arguments must be an object.');
    const normalized = visit(value, 0);
    if (Buffer.byteLength(JSON.stringify(normalized)) > 200000) throw new DomainError('invalid_argument', 'Review request exceeds 200 KB.');
    return normalized;
}

function requestPath(context, requestId) {
    if (!context.uid || !SAFE_ID.test(context.uid) || !UUID.test(requestId)) throw new DomainError('invalid_argument', 'Use a UUID v4 requestId.');
    return `users/${context.uid}/privateAiPendingActions/mcp_${requestId}`;
}

function requireScope(context, definition, args) {
    if (!definition.teamScoped) return;
    const teamId = args.teamId;
    const roles = context.teams.get(teamId)?.roles;
    if (!SAFE_ID.test(teamId || '') || !(roles?.has('owner') || roles?.has('admin'))) {
        throw new DomainError('permission_denied', 'Provide an exact teamId you currently manage from get_profile.');
    }
}

function reviewStatus(record, requestId, now) {
    return {
        requestId,
        action: record.requestTool,
        status: ['completed', 'partial', 'failed', 'executing'].includes(record.reviewStatus)
            ? record.reviewStatus
            : Date.parse(record.expiresAt) <= now ? 'expired' : record.reviewStatus,
        requiresAppConfirmation: true,
        reviewUrl: `${APP_BASE_URL}/app/#/ai/mcp/${requestId}`,
        expiresAt: record.expiresAt,
        message: 'This is a review request, not an applied change. Open the app, review the prepared details, then explicitly confirm. Do not report completion unless status is completed.'
    };
}

export async function prepareWriteReview(db, context, { action, requestId, arguments: input }, now = Date.now()) {
    const definition = catalog.find((tool) => tool.name === action);
    if (!definition) throw new DomainError('invalid_argument', 'Unsupported action.');
    const args = normalizeReviewArguments(input);
    requireScope(context, definition, args);
    const path = requestPath(context, requestId);
    const digest = createHash('sha256').update(JSON.stringify({ action, args })).digest('hex');
    const existing = await readRequest(db, path);
    const resolveExisting = (snapshot) => {
        const record = snapshot.data();
        if (record?.requestDigest !== digest || record?.userId !== context.uid || record?.toolName !== 'mcp_review_request') {
            throw new DomainError('conflict', 'This requestId is already bound to another request.');
        }
        return reviewStatus(record, requestId, now);
    };
    if (existing.exists) return resolveExisting(existing);
    const expiresAt = new Date(now + LIFETIME_MS).toISOString();
    const record = {
        schemaVersion: 1, userId: context.uid, toolName: 'mcp_review_request',
        requestTool: action, requestDigest: digest, reviewStatus: 'requested',
        status: 'mcp_request', expiresAt, createdAt: new Date(now),
        payloadScope: definition.teamScoped ? 'team' : 'user',
        teamId: definition.teamScoped ? args.teamId : '',
        args: definition.teamScoped ? {} : args
    };
    const documents = [{ path, data: record }];
    if (definition.teamScoped) documents.push({
        path: `teams/${args.teamId}/privateAiPendingActions/mcp_${requestId}`,
        data: { ...record, args, status: 'pending', expiresAtAt: new Date(expiresAt) }
    });
    try {
        await db.createReviewRequest(documents);
    } catch {
        // A lost response or a concurrent same-key call may already have committed.
        // Never create a replacement key or replay a business mutation.
        const saved = await readRequest(db, path);
        if (saved.exists) return resolveExisting(saved);
        throw new DomainError('unavailable', 'Review request was not verified. Retry with the SAME requestId; no business action was executed.');
    }
    return reviewStatus(record, requestId, now);
}

export async function getWriteReviewStatus(db, context, { requestId }, now = Date.now()) {
    const snapshot = await readRequest(db, requestPath(context, requestId));
    const record = snapshot.exists ? snapshot.data() : null;
    if (!record || record.userId !== context.uid || record.toolName !== 'mcp_review_request') {
        throw new DomainError('not_found', 'Review request not found for this account.');
    }
    const definition = catalog.find((tool) => tool.name === record.requestTool);
    if (!definition) throw new DomainError('invalid_argument', 'Unsupported action.');
    requireScope(context, definition, { teamId: record.teamId });
    return reviewStatus(record, requestId, now);
}
