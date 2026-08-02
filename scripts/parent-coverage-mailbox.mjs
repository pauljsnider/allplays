const allowedActionHosts = new Set([
    'allplays.ai',
    'www.allplays.ai',
    'game-flow-c6311.firebaseapp.com',
    'game-flow-c6311.web.app'
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

function extractSafeUrls(message, action) {
    const expectedMode = modeByAction[action];
    const text = flattenParts(message.payload)
        .filter((part) => ['text/plain', 'text/html'].includes(part.mimeType))
        .map((part) => decodeBase64Url(part.body?.data))
        .join('\n')
        .replaceAll('&amp;', '&');
    const candidates = text.match(/https:\/\/[^\s<>"']+/g) || [];
    return candidates.filter((candidate) => {
        try {
            const url = new URL(candidate.replace(/[),.;]+$/, ''));
            if (!allowedActionHosts.has(url.hostname)) return false;
            if (!expectedMode) return /invite|access|household/i.test(`${url.pathname}${url.search}${url.hash}`);
            return url.searchParams.get('mode') === expectedMode || url.hash.includes(`mode=${expectedMode}`);
        } catch {
            return false;
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
    const query = `to:${recipient} after:${Math.max(0, Number(afterEpoch) || 0)}`;
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
            const links = extractSafeUrls(message, action);
            if (links.length > 0) return links[0].replace(/[),.;]+$/, '');
        }
        if (attempt < maxAttempts) await new Promise((resolve) => setTimeout(resolve, pollDelayMs));
    }
    throw new Error(`no recent ${action} message was found for the lifecycle fixture`);
}
