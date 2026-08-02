const allowedAllPlaysHosts = new Set([
    'allplays.ai',
    'www.allplays.ai'
]);
const allowedFirebaseActionHosts = new Set([
    'game-flow-c6311.firebaseapp.com',
    'game-flow-c6311.web.app'
]);
const trustedSenderAddresses = new Set([
    'noreply@mail.allplays.ai',
    'noreply@allplays.ai',
    'noreply@game-flow-c6311.firebaseapp.com'
]);
const modeByAction = {
    verifyEmail: 'verifyEmail',
    resetPassword: 'resetPassword',
    invite: ''
};

function decodeBase64Url(value) {
    return Buffer.from(String(value || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function flattenParts(payload) {
    if (!payload) return [];
    return [payload, ...(payload.parts || []).flatMap(flattenParts)];
}

function messageHeaders(message) {
    const values = new Map();
    for (const header of message?.payload?.headers || []) {
        const name = String(header?.name || '').trim().toLowerCase();
        if (!name) continue;
        values.set(name, `${values.get(name) || ''} ${String(header?.value || '')}`.trim());
    }
    return values;
}

function trustedMessageSource(message) {
    const headers = messageHeaders(message);
    const from = String(headers.get('from') || '').toLowerCase();
    const sender = from.match(/<?([a-z0-9._%+-]+@[a-z0-9.-]+)>?/)?.[1] || '';
    if (!trustedSenderAddresses.has(sender)) return false;
    const senderDomain = sender.split('@')[1];
    const authentication = `${headers.get('authentication-results') || ''} ${headers.get('arc-authentication-results') || ''}`.toLowerCase();
    return /(?:dkim|spf)=pass\b/.test(authentication) && authentication.includes(senderDomain);
}

function readHashRoute(url) {
    const [route = '', query = ''] = url.hash.replace(/^#/, '').split('?', 2);
    return { route, params: new URLSearchParams(query) };
}

export function validateParentMailboxActionUrl(value, action, { allowConsumed = false } = {}) {
    const expectedMode = modeByAction[action];
    if (!(action in modeByAction)) throw new Error('unsupported mailbox action');
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || url.port || url.username || url.password) {
        throw new Error('mailbox action URL is not a secure allowlisted destination');
    }
    if (allowedFirebaseActionHosts.has(url.hostname)) {
        if (
            action === 'invite' ||
            url.pathname !== '/__/auth/action' ||
            url.searchParams.get('mode') !== expectedMode ||
            !url.searchParams.get('oobCode')
        ) {
            throw new Error('mailbox action URL does not match the expected Firebase action');
        }
        return url.toString();
    }
    if (!allowedAllPlaysHosts.has(url.hostname) || !['/app', '/app/'].includes(url.pathname)) {
        throw new Error('mailbox action URL is outside the exact AllPlays app path');
    }
    const { route, params } = readHashRoute(url);
    if (action === 'invite') {
        if (
            route !== '/accept-invite' ||
            !/^[A-Z0-9]{8}$/.test(String(params.get('code') || '').toUpperCase()) ||
            !['friend', 'household', 'parent', 'coparent'].includes(String(params.get('type') || '').toLowerCase())
        ) {
            throw new Error('mailbox invite URL does not contain an exact supported invite route');
        }
        return url.toString();
    }
    const consumedRouteAllowed = action === 'verifyEmail'
        ? ['/reset-password', '/verify-pending', '/auth'].includes(route)
        : route === '/reset-password';
    if (!consumedRouteAllowed) throw new Error('mailbox action URL does not match the expected app route');
    const mode = params.get('mode') || '';
    const oobCode = params.get('oobCode') || '';
    if (!allowConsumed || mode || oobCode) {
        if (mode !== expectedMode || !oobCode) {
            throw new Error('mailbox action URL is missing the expected action parameters');
        }
    }
    return url.toString();
}

function extractSafeUrls(message, action) {
    const text = flattenParts(message.payload)
        .filter((part) => ['text/plain', 'text/html'].includes(part.mimeType))
        .map((part) => decodeBase64Url(part.body?.data))
        .join('\n')
        .replaceAll('&amp;', '&');
    const candidates = text.match(/https:\/\/[^\s<>"']+/g) || [];
    return candidates.flatMap((candidate) => {
        try {
            return [validateParentMailboxActionUrl(candidate.replace(/[),.;]+$/, ''), action)];
        } catch {
            return [];
        }
    });
}

async function jsonResponse(response, label) {
    if (!response.ok) throw new Error(`${label} failed with status ${response.status}`);
    return response.json();
}

async function authorizeMailbox({ clientId, clientSecret, refreshToken, fetchImpl }) {
    if (!clientId || !clientSecret || !refreshToken) {
        throw new Error('protected parent census mailbox configuration is incomplete');
    }
    const tokenResponse = await fetchImpl('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: refreshToken,
            grant_type: 'refresh_token'
        })
    });
    const token = await jsonResponse(tokenResponse, 'mailbox authorization');
    if (!token.access_token) throw new Error('mailbox authorization returned no access token');
    return token.access_token;
}

export async function auditParentCoverageMailboxAccess({
    clientId,
    clientSecret,
    refreshToken,
    fetchImpl = fetch
}) {
    const accessToken = await authorizeMailbox({ clientId, clientSecret, refreshToken, fetchImpl });
    const profile = await jsonResponse(await fetchImpl(
        'https://gmail.googleapis.com/gmail/v1/users/me/profile',
        { headers: { authorization: `Bearer ${accessToken}` } }
    ), 'mailbox profile');
    if (!profile.emailAddress) throw new Error('mailbox profile returned no identity');
    return true;
}

export async function findLatestParentMailboxActionLink({
    action,
    recipient,
    clientId,
    clientSecret,
    refreshToken,
    afterEpoch,
    maxAttempts = 12,
    pollDelayMs = 5_000,
    fetchImpl = fetch
}) {
    if (!(action in modeByAction)) throw new Error('unsupported mailbox action');
    if (!recipient) {
        throw new Error('protected parent census mailbox configuration is incomplete');
    }
    const accessToken = await authorizeMailbox({ clientId, clientSecret, refreshToken, fetchImpl });
    const senderQuery = [...trustedSenderAddresses].map((sender) => `from:${sender}`).join(' ');
    const query = `to:${recipient} after:${Math.max(0, Number(afterEpoch) || 0)} {${senderQuery}}`;
    const headers = { authorization: `Bearer ${accessToken}` };
    const listUrl = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
    listUrl.searchParams.set('q', query);
    listUrl.searchParams.set('maxResults', '10');
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const list = await jsonResponse(await fetchImpl(listUrl, { headers }), 'mailbox search');
        for (const row of list.messages || []) {
            const messageUrl = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(row.id)}`);
            messageUrl.searchParams.set('format', 'full');
            const message = await jsonResponse(await fetchImpl(messageUrl, { headers }), 'mailbox message');
            if (!trustedMessageSource(message)) continue;
            const links = extractSafeUrls(message, action);
            if (links.length > 0) return links[0].replace(/[),.;]+$/, '');
        }
        if (attempt < maxAttempts) await new Promise((resolve) => setTimeout(resolve, pollDelayMs));
    }
    throw new Error(`no recent ${action} message was found for the lifecycle fixture`);
}
