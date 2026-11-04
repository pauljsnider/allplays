"use strict";
// Private backend route adapter only; not registered in functions/index.js.
// verifyWorkloadIdentity must perform actual platform token signature/issuer/
// audience verification; decoding claims is never sufficient. The broker's
// signed command is verified separately by channel.handle.
async function readBoundedBody(req, timeoutMs, now) {
    const startedAt = now(); let timer;
    try {
        return await Promise.race([
            (async () => {
                const chunks = []; let bytes = 0;
                for await (const chunk of req) {
                    bytes += chunk.length;
                    if (bytes > 49152) throw Object.assign(new Error('Body rejected'), { status: 413 });
                    if (now() - startedAt >= timeoutMs) throw Object.assign(new Error('Body rejected'), { status: 408 });
                    chunks.push(chunk);
                }
                if (now() - startedAt >= timeoutMs) throw Object.assign(new Error('Body rejected'), { status: 408 });
                return JSON.parse(Buffer.concat(chunks).toString('utf8'));
            })(),
            new Promise((_, reject) => {
                timer = setTimeout(() => {
                    reject(Object.assign(new Error('Body rejected'), { status: 408 }));
                    req.destroy(); // stop retaining a stalled request stream
                }, timeoutMs);
            })
        ]);
    } finally { clearTimeout(timer); }
}

function createScheduleBrokerHttpHandler({ channel, verifyWorkloadIdentity, takeRateLimit, audience, allowedPrincipals, allowedHosts, bodyReadTimeoutMs = 10000, now = Date.now }) {
    if (![channel?.handle, verifyWorkloadIdentity, takeRateLimit].every((fn) => typeof fn === 'function') || !audience
        || !Array.isArray(allowedPrincipals) || !allowedPrincipals.length || !Array.isArray(allowedHosts) || !allowedHosts.length
        || !Number.isInteger(bodyReadTimeoutMs) || bodyReadTimeoutMs <= 0 || bodyReadTimeoutMs > 30000) throw new Error('Explicit private ingress policy and a bounded body deadline are required.');
    return async (req, res) => {
        const reply = (status, value) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(value)); };
        const denied = (status = 403) => reply(status, { error: 'Command outcome unavailable.' });
        try {
            if (req.method !== 'POST' || req.url !== '/internal/v1/schedule-command') return denied(405);
            if (!allowedHosts.includes(req.headers.host) || req.headers.origin || req.headers['content-type'] !== 'application/json') return denied();
            const authorization = req.headers.authorization;
            if (typeof authorization !== 'string' || !/^Bearer [A-Za-z0-9._~-]{1,8192}$/.test(authorization)) return denied(401);
            const identity = await verifyWorkloadIdentity(authorization.slice(7), { audience });
            const { principal, expiresAt, audience: verifiedAudience } = identity || {};
            const currentWorkload = () => verifiedAudience === audience && typeof principal === 'string' && allowedPrincipals.includes(principal)
                && Number.isSafeInteger(expiresAt) && expiresAt > now();
            if (!currentWorkload()) return denied();
            if (await takeRateLimit(principal) !== true) return denied(429);
            if (!currentWorkload()) return denied();
            const payload = await readBoundedBody(req, bodyReadTimeoutMs, now);
            // No await between this final ingress check and channel invocation.
            // The channel separately verifies signed-command/user/session state.
            if (!currentWorkload()) return denied();
            const result = await channel.handle(payload);
            if (!result || !/^[a-f0-9]{64}$/.test(result.operationId || '') || !['not_started', 'committed', 'unverified'].includes(result.status)) return denied(503);
            return reply(200, { operationId: result.operationId, status: result.status });
        } catch (error) { return denied([408, 413].includes(error?.status) ? error.status : 403); }
    };
}
module.exports = { createScheduleBrokerHttpHandler };
