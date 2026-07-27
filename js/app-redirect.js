const firebaseActionParameterNames = [
    'mode',
    'oobCode',
    'apiKey',
    'continueUrl',
    'lang',
    'tenantId'
];

function normalizeLegacyPage(page) {
    return String(page || '')
        .trim()
        .toLowerCase()
        .replace(/\.html$/, '');
}

function readLegacyHashParams(hash) {
    const value = String(hash || '').replace(/^#/, '');
    if (!value || value === 'signup') return new URLSearchParams();
    const queryIndex = value.indexOf('?');
    return new URLSearchParams(queryIndex >= 0 ? value.slice(queryIndex + 1) : value);
}

function isSafeNextRoute(value) {
    const route = String(value || '').trim();
    if (!route || route.length > 500 || !route.startsWith('/') || route.startsWith('//') || route.includes('\\')) {
        return false;
    }
    try {
        return new URL(route, 'https://allplays.local').origin === 'https://allplays.local';
    } catch {
        return false;
    }
}

function copyParam(sourceParams, targetParams, name) {
    const value = sourceParams.get(name);
    if (value && !targetParams.has(name)) targetParams.set(name, value);
}

export function buildLegacyAuthRedirectUrl(page, href) {
    const source = new URL(href);
    const pageName = normalizeLegacyPage(page || source.pathname.split('/').pop());
    const hashParams = readLegacyHashParams(source.hash);
    const targetParams = new URLSearchParams();
    let route = '/auth';

    if (pageName === 'accept-invite') {
        route = '/accept-invite';
        ['code', 'type', ...firebaseActionParameterNames].forEach((name) => {
            copyParam(source.searchParams, targetParams, name);
            copyParam(hashParams, targetParams, name);
        });
    } else if (pageName === 'reset-password') {
        route = '/reset-password';
        firebaseActionParameterNames.forEach((name) => {
            copyParam(source.searchParams, targetParams, name);
            copyParam(hashParams, targetParams, name);
        });
    } else if (pageName === 'verify-pending') {
        const mode = source.searchParams.get('mode') || hashParams.get('mode') || '';
        route = mode ? '/reset-password' : '/verify-pending';
        firebaseActionParameterNames.forEach((name) => {
            copyParam(source.searchParams, targetParams, name);
            copyParam(hashParams, targetParams, name);
        });
    } else {
        ['code', 'type'].forEach((name) => {
            copyParam(source.searchParams, targetParams, name);
            copyParam(hashParams, targetParams, name);
        });
        const requestedMode = source.searchParams.get('mode');
        if (requestedMode === 'login' || requestedMode === 'signup') {
            targetParams.set('mode', requestedMode);
        } else if (source.hash.replace(/^#/, '') === 'signup') {
            targetParams.set('mode', 'signup');
        }
    }

    const next = source.searchParams.get('next') || hashParams.get('next') || '';
    if (isSafeNextRoute(next)) targetParams.set('next', next);

    const destination = new URL('/app/', source.origin);
    const query = targetParams.toString();
    destination.hash = `${route}${query ? `?${query}` : ''}`;
    return destination.toString();
}

export function redirectLegacyAuthPage(page, locationObject = window.location) {
    const destination = buildLegacyAuthRedirectUrl(page, locationObject.href);
    if (destination !== locationObject.href) {
        locationObject.replace(destination);
    }
    return destination;
}
