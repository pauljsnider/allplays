"use strict";
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const validId = (value) => typeof value === 'string' && ID.test(value);
const validToken = (value) => typeof value === 'string' && value.length > 0 && value.length <= 8192;
const fail = () => { throw Object.assign(new Error('The verified broker identity is unavailable.'), { code: 'broker_identity_denied' }); };
const milliseconds = (seconds) => Number.isSafeInteger(seconds) && seconds >= 0 && Number.isSafeInteger(seconds * 1000) ? seconds * 1000 : NaN;

// Backend-only SDK composition, intentionally unmounted. The host supplies a
// project-bound Firebase Auth instance; no credentials are loaded or created.
// This is not an application-data Admin client and never replaces REST rules.
function createFirebaseScheduleUserVerifier({ auth, projectId, now = Date.now }) {
    if (typeof projectId !== 'string' || !/^[a-z][a-z0-9-]{3,62}$/.test(projectId) || ![auth?.verifyIdToken, auth?.getUser].every((fn) => typeof fn === 'function')) throw new Error('A project-bound Firebase Auth verifier is required.');
    return async (token) => {
        try {
            if (!validToken(token)) fail();
            const claims = await auth.verifyIdToken(token, true); // never allow the caller to disable revocation checks
            if (!validId(claims?.uid) || claims.sub !== claims.uid || claims.aud !== projectId || claims.iss !== `https://securetoken.google.com/${projectId}`
                || claims.email_verified !== true || typeof claims.email !== 'string' || !claims.email) fail();
            const account = await auth.getUser(claims.uid);
            const expiresAt = milliseconds(claims.exp); const issuedAt = milliseconds(claims.iat); const authenticatedAt = milliseconds(claims.auth_time);
            const validAfter = account?.tokensValidAfterTime === undefined ? 0 : Date.parse(account.tokensValidAfterTime);
            if (account?.uid !== claims.uid || account.disabled !== false || account.emailVerified !== true || account.email !== claims.email
                || ![expiresAt, issuedAt, authenticatedAt, validAfter].every(Number.isSafeInteger)
                || authenticatedAt > issuedAt || issuedAt > now() || expiresAt <= now() || authenticatedAt < validAfter) fail();
            return { uid: claims.uid, disabled: false, emailVerified: true, expiresAt };
        } catch { fail(); } // SDK errors can contain account/token details
    };
}

// Supply an actual OAuth2Client. verifyIdToken verifies Google certificates,
// signature, issuer, audience and token times; parsing JWT claims is insufficient.
// The ingress handler still enforces its explicit service-account allowlist.
function createGoogleScheduleWorkloadVerifier({ oauthClient, audience, now = Date.now }) {
    let target;
    try { target = new URL(audience); } catch { throw new Error('A fixed HTTPS workload audience is required.'); }
    if (typeof oauthClient?.verifyIdToken !== 'function' || target.protocol !== 'https:' || target.username || target.password || target.search || target.hash) throw new Error('A fixed HTTPS audience and Google ID-token verifier are required.');
    return async (token, context) => {
        try {
            if (!validToken(token) || context?.audience !== audience) fail();
            const ticket = await oauthClient.verifyIdToken({ idToken: token, audience });
            const claims = ticket?.getPayload(); const expiresAt = milliseconds(claims?.exp); const issuedAt = milliseconds(claims?.iat);
            if (!['accounts.google.com', 'https://accounts.google.com'].includes(claims?.iss) || claims.aud !== audience
                || typeof claims.sub !== 'string' || !/^[0-9]{1,128}$/.test(claims.sub)
                || claims.email_verified !== true || typeof claims.email !== 'string' || !/^[a-z0-9._-]+@[a-z0-9.-]+\.gserviceaccount\.com$/.test(claims.email)
                || ![expiresAt, issuedAt].every(Number.isSafeInteger) || issuedAt > now() || expiresAt <= now()) fail();
            return { principal: claims.email, subject: claims.sub, audience, expiresAt };
        } catch { fail(); }
    };
}
module.exports = { createFirebaseScheduleUserVerifier, createGoogleScheduleWorkloadVerifier };
