"use strict";
// Shared unmounted private ingress. Workload verification must validate actual
// platform signatures, issuer and audience; decoding claims is insufficient.
async function readBoundedBody(req, timeoutMs, maxBodyBytes, now) {
    const startedAt = now(); let timer;
    try {
        return await Promise.race([
            (async () => {
                const chunks = []; let bytes = 0;
                for await (const chunk of req) {
                    bytes += chunk.length;
                    if (bytes > maxBodyBytes) throw Object.assign(new Error('Body rejected'), { status: 413 });
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

function createPrivateBrokerHttpHandler({ path, handle, verifyWorkloadIdentity, takeRateLimit, audience, allowedPrincipals, allowedHosts, maxBodyBytes = 49152, bodyReadTimeoutMs = 10000, now = Date.now }) {
    if (![handle, verifyWorkloadIdentity, takeRateLimit].every((fn) => typeof fn === 'function') || !audience
        || typeof path !== 'string' || !/^\/internal\/v1\/[a-z-]+$/.test(path) || !Number.isInteger(maxBodyBytes) || maxBodyBytes <= 0 || maxBodyBytes > 49152
        || !Array.isArray(allowedPrincipals) || !allowedPrincipals.length || !Array.isArray(allowedHosts) || !allowedHosts.length
        || !Number.isInteger(bodyReadTimeoutMs) || bodyReadTimeoutMs <= 0 || bodyReadTimeoutMs > 30000) throw new Error('Explicit private ingress policy and a bounded body deadline are required.');
    return async (req, res) => {
        const reply = (status, value) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(value)); };
        const denied = (status = 403) => reply(status, { error: 'Command outcome unavailable.' });
        try {
            if (req.method !== 'POST' || req.url !== path) return denied(405);
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
            const payload = await readBoundedBody(req, bodyReadTimeoutMs, maxBodyBytes, now);
            // No await between this final ingress check and channel invocation.
            // The channel separately verifies signed-command/user/session state.
            if (!currentWorkload()) return denied();
            const result = await handle(payload);
            if (!currentWorkload()) return denied();
            return reply(200, result);
        } catch (error) { return denied([408, 413, 503].includes(error?.status) ? error.status : 403); }
    };
}
function createPrivateBrokerJsonClient({ url, audience, getWorkloadToken, validateResult, fetchImpl = fetch, deadlineMs = 5000, now = Date.now }) {
    let target; try { target = new URL(url); } catch { throw new Error('A fixed private HTTPS endpoint is required.'); }
    if (target.protocol !== 'https:' || target.username || target.password || target.search || target.hash || !/^\/internal\/v1\/[a-z-]+$/.test(target.pathname)
        || typeof audience !== 'string' || !audience || [getWorkloadToken, validateResult, fetchImpl].some((fn) => typeof fn !== 'function')
        || !Number.isInteger(deadlineMs) || deadlineMs <= 0 || deadlineMs > 10000) throw new Error('Explicit bounded private transport is required.');
    return async (payload) => {
        const controller = new AbortController(); const startedAt = now(); let timer;
        const fail = () => { throw new Error('Private broker response unavailable.'); };
        const current = () => { if (controller.signal.aborted || now() - startedAt >= deadlineMs) fail(); };
        try {
            const body = JSON.stringify(payload); if (Buffer.byteLength(body) > 49152) fail();
            return await Promise.race([
                (async () => {
                    const token = await getWorkloadToken({ audience }); current();
                    if (typeof token !== 'string' || !/^[A-Za-z0-9._~-]{1,8192}$/.test(token)) fail();
                    const response = await fetchImpl(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body, redirect: 'error', signal: controller.signal });
                    current(); if (!response.ok || !response.body) fail();
                    const chunks = []; let bytes = 0;
                    for await (const chunk of response.body) { bytes += chunk.length; if (bytes > 4096) { controller.abort(); fail(); } current(); chunks.push(chunk); }
                    current(); return validateResult(JSON.parse(Buffer.concat(chunks).toString('utf8')), payload);
                })(),
                new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Private broker response unavailable.')); }, deadlineMs); })
            ]);
        } catch { fail(); } finally { clearTimeout(timer); }
    };
}
module.exports = { createPrivateBrokerHttpHandler, createPrivateBrokerJsonClient };
