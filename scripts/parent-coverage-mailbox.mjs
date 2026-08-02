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

function receiverAuthenticationResults(message) {
    const headers = message?.payload?.headers || [];
    const returnPathIndex = headers.findIndex((header) => String(header?.name || '').trim().toLowerCase() === 'return-path');
    const boundary = returnPathIndex === -1 ? headers.length : returnPathIndex;
    const receiverHeader = headers.slice(0, boundary).find((header) =>
        String(header?.name || '').trim().toLowerCase() === 'authentication-results' &&
        /^\s*mx\.google\.com\s*;/i.test(String(header?.value || ''))
    );
    return String(receiverHeader?.value || '').toLowerCase();
}

function extractAddress(value) {
    return String(value || '').toLowerCase().match(/<?([a-z0-9._%+-]+@[a-z0-9.-]+)>?/)?.[1] || '';
}

function trustedMessageSource(message, recipient, afterEpoch) {
    const headers = messageHeaders(message);
    const sender = extractAddress(headers.get('from'));
    if (!trustedSenderAddresses.has(sender)) return false;
    const senderDomain = sender.split('@')[1];
    // Gmail prepends its receiver-authenticated result before Return-Path.  Do not
    // concatenate sender-supplied Authentication-Results or trust ARC results:
    // validating an ARC chain is outside this mailbox boundary.
    const authentication = receiverAuthenticationResults(message);
    const alignedDkim = new RegExp(`dkim=pass\\b[^;]*(?:header\\.i|header\\.d)=@?${senderDomain.replaceAll('.', '\\.')}(?:\\s|;|$)`).test(authentication);
    const alignedSpf = new RegExp(`spf=pass\\b[^;]*smtp\\.mailfrom=[^;@\\s]*@${senderDomain.replaceAll('.', '\\.')}(?:\\s|;|$)`).test(authentication);
    const recipients = `${headers.get('delivered-to') || ''},${headers.get('to') || ''}`
        .split(',')
        .map(extractAddress)
        .filter(Boolean);
    const internalEpoch = Math.floor(Number(message?.internalDate || 0) / 1000);
    return (alignedDkim || alignedSpf) &&
        recipients.includes(String(recipient || '').trim().toLowerCase()) &&
        internalEpoch >= Math.max(0, Number(afterEpoch) || 0);
}

function readHashRoute(url) {
    const [route = '', query = ''] = url.hash.replace(/^#/, '').split('?', 2);
    return { route, params: new URLSearchParams(query) };
}

function hasOnlyParams(params, allowed) {
    const keys = [...params.keys()];
    return keys.every((key) => allowed.has(key)) && new Set(keys).size === keys.length;
}

function validateContinueUrl(value, action) {
    if (!value) return;
    const continueUrl = new URL(value);
    if (
        continueUrl.protocol !== 'https:' ||
        !allowedAllPlaysHosts.has(continueUrl.hostname) ||
        !['/app', '/app/'].includes(continueUrl.pathname) ||
        continueUrl.search ||
        continueUrl.username ||
        continueUrl.password ||
        continueUrl.port
    ) {
        throw new Error('mailbox action continue URL is outside the exact AllPlays app path');
    }
    const { route, params } = readHashRoute(continueUrl);
    const expectedRoute = action === 'verifyEmail' ? '/verify-pending' : '/reset-password';
    if (route !== expectedRoute || [...params.keys()].length > 0) {
        throw new Error('mailbox action continue URL does not match the expected app route');
    }
}

export function validateParentMailboxActionUrl(value, action, { allowConsumed = false, requireAppRoute = false } = {}) {
    const expectedMode = modeByAction[action];
    if (!(action in modeByAction)) throw new Error('unsupported mailbox action');
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || url.port || url.username || url.password) {
        throw new Error('mailbox action URL is not a secure allowlisted destination');
    }
    if (allowedFirebaseActionHosts.has(url.hostname)) {
        if (
            requireAppRoute ||
            action === 'invite' ||
            url.pathname !== '/__/auth/action' ||
            url.searchParams.get('mode') !== expectedMode ||
            !url.searchParams.get('oobCode') ||
            !hasOnlyParams(url.searchParams, new Set(['apiKey', 'mode', 'oobCode', 'continueUrl', 'lang']))
        ) {
            throw new Error('mailbox action URL does not match the expected Firebase action');
        }
        validateContinueUrl(url.searchParams.get('continueUrl'), action);
        return url.toString();
    }
    if (
        !allowedAllPlaysHosts.has(url.hostname) ||
        !['/app', '/app/'].includes(url.pathname) ||
        url.search
    ) {
        throw new Error('mailbox action URL is outside the exact AllPlays app path');
    }
    const { route, params } = readHashRoute(url);
    if (action === 'invite') {
        if (
            route !== '/accept-invite' ||
            !/^[A-Z0-9]{8}$/.test(String(params.get('code') || '').toUpperCase()) ||
            !['friend', 'household', 'parent', 'coparent'].includes(String(params.get('type') || '').toLowerCase()) ||
            !hasOnlyParams(params, new Set(['code', 'type']))
        ) {
            throw new Error('mailbox invite URL does not contain an exact supported invite route');
        }
        return url.toString();
    }
    const consumedRouteAllowed = action === 'verifyEmail'
        ? route === '/verify-pending'
        : route === '/reset-password';
    if (!consumedRouteAllowed) throw new Error('mailbox action URL does not match the expected app route');
    const mode = params.get('mode') || '';
    const oobCode = params.get('oobCode') || '';
    if (!allowConsumed || mode || oobCode) {
        if (mode !== expectedMode || !oobCode) {
            throw new Error('mailbox action URL is missing the expected action parameters');
        }
    }
    if (!hasOnlyParams(params, new Set(['mode', 'oobCode', 'apiKey', 'lang', 'next']))) {
        throw new Error('mailbox action URL contains unsupported action parameters');
    }
    if (params.has('next') && (action !== 'verifyEmail' || params.get('next') !== '/verify-pending')) {
        throw new Error('mailbox action URL contains an unexpected continuation route');
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
    try {
        return await response.json();
    } catch {
        throw new Error(`${label} returned an invalid response`);
    }
}

async function safeFetch(fetchImpl, url, options, label) {
    try {
        return await fetchImpl(url, options);
    } catch {
        throw new Error(`${label} request failed`);
    }
}

async function authorizeMailbox({ clientId, clientSecret, refreshToken, fetchImpl }) {
    if (!clientId || !clientSecret || !refreshToken) {
        throw new Error('protected parent census mailbox configuration is incomplete');
    }
    const tokenResponse = await safeFetch(fetchImpl, 'https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: refreshToken,
            grant_type: 'refresh_token'
        })
    }, 'mailbox authorization');
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
    const profile = await jsonResponse(await safeFetch(fetchImpl,
        'https://gmail.googleapis.com/gmail/v1/users/me/profile',
        { headers: { authorization: `Bearer ${accessToken}` } },
        'mailbox profile'
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
    const normalizedRecipient = String(recipient || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedRecipient)) {
        throw new Error('protected parent census mailbox configuration is incomplete');
    }
    const accessToken = await authorizeMailbox({ clientId, clientSecret, refreshToken, fetchImpl });
    const senderQuery = [...trustedSenderAddresses].map((sender) => `from:${sender}`).join(' ');
    const query = `to:${normalizedRecipient} after:${Math.max(0, Number(afterEpoch) || 0)} {${senderQuery}}`;
    const headers = { authorization: `Bearer ${accessToken}` };
    const listUrl = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
    listUrl.searchParams.set('q', query);
    listUrl.searchParams.set('maxResults', '10');
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const list = await jsonResponse(
            await safeFetch(fetchImpl, listUrl, { headers }, 'mailbox search'),
            'mailbox search'
        );
        for (const row of list.messages || []) {
            const messageUrl = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(row.id)}`);
            messageUrl.searchParams.set('format', 'full');
            const message = await jsonResponse(
                await safeFetch(fetchImpl, messageUrl, { headers }, 'mailbox message'),
                'mailbox message'
            );
            if (!trustedMessageSource(message, normalizedRecipient, afterEpoch)) continue;
            const links = extractSafeUrls(message, action);
            if (links.length > 0) return links[0].replace(/[),.;]+$/, '');
        }
        if (attempt < maxAttempts) await new Promise((resolve) => setTimeout(resolve, pollDelayMs));
    }
    throw new Error(`no recent ${action} message was found for the lifecycle fixture`);
}
