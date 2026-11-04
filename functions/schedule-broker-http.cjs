"use strict";
// Private backend route adapter only; not registered in functions/index.js.
// verifyWorkloadIdentity must perform actual platform token signature/issuer/
// audience verification; decoding claims is never sufficient. The broker's
// signed command is verified separately by channel.handle.
function createScheduleBrokerHttpHandler({ channel, verifyWorkloadIdentity, takeRateLimit, audience, allowedPrincipals, allowedHosts, now = Date.now }) {
    if (![channel?.handle, verifyWorkloadIdentity, takeRateLimit].every((fn) => typeof fn === 'function') || !audience
        || !Array.isArray(allowedPrincipals) || !allowedPrincipals.length || !Array.isArray(allowedHosts) || !allowedHosts.length) throw new Error('Explicit private ingress policy is required.');
    return async (req, res) => {
        const reply = (status, value) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(value)); };
        const denied = (status = 403) => reply(status, { error: 'Command outcome unavailable.' });
        try {
            if (req.method !== 'POST' || req.url !== '/internal/v1/schedule-command') return denied(405);
            if (!allowedHosts.includes(req.headers.host) || req.headers.origin || req.headers['content-type'] !== 'application/json') return denied();
            const authorization = req.headers.authorization;
            if (typeof authorization !== 'string' || !/^Bearer [A-Za-z0-9._~-]{1,8192}$/.test(authorization)) return denied(401);
            const identity = await verifyWorkloadIdentity(authorization.slice(7), { audience });
            if (!identity || identity.audience !== audience || !allowedPrincipals.includes(identity.principal)
                || !Number.isSafeInteger(identity.expiresAt) || identity.expiresAt <= now()) return denied();
            if (await takeRateLimit(identity.principal) !== true) return denied(429);
            const chunks = []; let bytes = 0;
            for await (const chunk of req) {
                bytes += chunk.length; if (bytes > 49152) return denied(413); chunks.push(chunk);
            }
            const result = await channel.handle(JSON.parse(Buffer.concat(chunks).toString('utf8')));
            if (!result || !/^[a-f0-9]{64}$/.test(result.operationId || '') || !['not_started', 'committed', 'unverified'].includes(result.status)) return denied(503);
            return reply(200, { operationId: result.operationId, status: result.status });
        } catch { return denied(); }
    };
}
module.exports = { createScheduleBrokerHttpHandler };
