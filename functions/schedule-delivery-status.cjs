"use strict";
const { scheduleDeliveryFingerprint: hash } = require('./schedule-delivery-coordinator.cjs');
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const HASH = /^[a-f0-9]{64}$/;

// Framework-neutral HTTP adapter. No deployment or route registration. The host
// must configure a small JSON parser; this handler also bounds parsed payloads.
function createScheduleDeliveryStatusHandler({ authenticate, verifyAppCheck, takeRateLimit, coordinator,
    allowedHosts = ['127.0.0.1', 'localhost'], allowedOrigins = [], allowedAppIds, now = Date.now }) {
    if ([authenticate, verifyAppCheck, takeRateLimit, coordinator?.status].some((fn) => typeof fn !== 'function')
        || !Array.isArray(allowedAppIds) || !allowedAppIds.length) throw new Error('Authenticated status, App Check allowlist and durable rate limiting are required.');
    return async (req, res) => {
        res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
        const reject = (status) => res.status(status).json({ error: 'Delivery status is unavailable for this authenticated request.' });
        try {
            if (req.method !== 'POST') return reject(405);
            if (typeof req.headers.host !== 'string' || !/^[A-Za-z0-9.-]+(?::\d{1,5})?$/.test(req.headers.host)) return reject(403);
            const host = new URL(`http://${req.headers.host || ''}`).hostname;
            if (!allowedHosts.includes(host) || (req.headers.origin && !allowedOrigins.includes(req.headers.origin))) return reject(403);
            if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) return reject(415);
            const body = req.body;
            if (!body || Object.getPrototypeOf(body) !== Object.prototype || JSON.stringify(body).length > 2048
                || Object.keys(body).some((key) => !['teamId', 'bindingId', 'reconcile'].includes(key))
                || !ID.test(body.teamId || '') || !HASH.test(body.bindingId || '') || (body.reconcile !== undefined && typeof body.reconcile !== 'boolean')) return reject(400);
            const authorization = req.headers.authorization;
            if (typeof authorization !== 'string' || !/^Bearer [A-Za-z0-9._~-]{1,8192}$/.test(authorization)) return reject(401);
            const actor = await authenticate(authorization);
            if (!actor || !ID.test(actor.uid || '') || !ID.test(actor.clientId || '') || !HASH.test(actor.grantKey || '')
                || actor.reviewRequests !== true || !Number.isSafeInteger(actor.expiresAt) || actor.expiresAt <= now()) return reject(401);
            const token = req.headers['x-firebase-appcheck'];
            if (typeof token !== 'string' || !token || token.length > 8192) return reject(403);
            const app = await verifyAppCheck(token, { consume: body.reconcile === true });
            if (!app || !allowedAppIds.includes(app.appId) || app.alreadyConsumed === true || (body.reconcile === true && app.alreadyConsumed !== false)) return reject(403);
            if (await takeRateLimit({ key: hash({ uid: actor.uid, clientId: actor.clientId }), limit: 30, windowMs: 60000 }) !== true) return reject(429);
            const value = await coordinator.status(authorization, { teamId: body.teamId, bindingId: body.bindingId }, { reconcile: body.reconcile === true });
            const counts = ['plannedTargetCount', 'accepted', 'uncertain', 'suppressed', 'pending', 'failed'];
            if (value?.bindingId !== body.bindingId || !['not_started', 'recorded'].includes(value.status) || value.deviceDelivery !== 'unverified'
                || !counts.every((key) => Number.isSafeInteger(value[key]) && value[key] >= 0 && value[key] <= 100)
                || counts.slice(1).reduce((sum, key) => sum + value[key], 0) !== value.plannedTargetCount) return reject(503);
            return res.status(200).json({ bindingId: value.bindingId, status: value.status, ...Object.fromEntries(counts.map((key) => [key, value[key]])), deviceDelivery: 'unverified' });
        } catch { return reject(403); } // no raw token, provider or existence details
    };
}

function createFirestoreStatusRateLimit({ firestore, now = Date.now }) {
    if (!firestore?.doc || !firestore?.runTransaction) throw new Error('A server-private rate-limit store is required.');
    return async ({ key, limit, windowMs }) => {
        if (!HASH.test(key || '') || limit !== 30 || windowMs !== 60000 || !Number.isSafeInteger(now()) || now() < 0) return false;
        const window = Math.floor(now() / windowMs);
        try {
            return await firestore.runTransaction(async (transaction) => {
                const reference = firestore.doc(`mcpStatusRateLimits/${key}`);
                const snapshot = await transaction.get(reference); const row = snapshot.exists ? snapshot.data() : null;
                if (row && (!Number.isSafeInteger(row.window) || !Number.isSafeInteger(row.count) || row.count < 0 || row.window > window)) return false;
                const count = row?.window === window ? row.count : 0;
                if (count >= limit) return false;
                transaction.set(reference, { window, count: count + 1 });
                return true;
            }) === true;
        } catch { return false; } // uncertain counters never authorize excess work
    };
}

module.exports = { createScheduleDeliveryStatusHandler, createFirestoreStatusRateLimit };
