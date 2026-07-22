import { pathToFileURL } from 'node:url';

const minimumHstsMaxAge = 31536000;
const requiredSecurityHeaders = [
    'Content-Security-Policy',
    'Strict-Transport-Security',
    'X-Content-Type-Options',
    'Referrer-Policy',
    'Permissions-Policy'
];
const baselinePaths = ['/', '/app/', '/app/teams'];
const widgetPath = '/widget-scoreboard.html';
const runtimeConfigPath = '/.well-known/allplays-runtime-config.json';

function fail(path, message) {
    throw new Error(`${path}: ${message}`);
}

function requireHeader(response, path, name) {
    const value = response.headers.get(name)?.trim();
    if (!value) {
        fail(path, `missing ${name} response header`);
    }
    return value;
}

function cspDirectives(policy) {
    return new Map(policy.split(';').map((directive) => directive.trim()).filter(Boolean).map((directive) => {
        const [name, ...values] = directive.split(/\s+/);
        return [name.toLowerCase(), values];
    }));
}

function directiveIncludes(directives, name, value) {
    return directives.get(name)?.includes(value) ?? false;
}

function validateCommonHeaders(response, path) {
    const headers = new Map(requiredSecurityHeaders.map((name) => [
        name,
        requireHeader(response, path, name)
    ]));
    const hsts = headers.get('Strict-Transport-Security');
    const maxAge = Number.parseInt(/(?:^|;)\s*max-age=(\d+)(?:;|$)/i.exec(hsts)?.[1] ?? '', 10);
    if (!Number.isSafeInteger(maxAge) || maxAge < minimumHstsMaxAge) {
        fail(path, `Strict-Transport-Security max-age must be at least ${minimumHstsMaxAge} seconds`);
    }
    if (headers.get('X-Content-Type-Options').toLowerCase() !== 'nosniff') {
        fail(path, 'X-Content-Type-Options must be nosniff');
    }
    return headers;
}

function validateBaselinePolicy(response, path) {
    const headers = validateCommonHeaders(response, path);
    const csp = headers.get('Content-Security-Policy');
    const directives = cspDirectives(csp);

    if (!directiveIncludes(directives, 'default-src', "'self'")) {
        fail(path, "baseline CSP must include default-src 'self'");
    }
    if (!directiveIncludes(directives, 'object-src', "'none'")) {
        fail(path, "baseline CSP must include object-src 'none'");
    }
    if (directiveIncludes(directives, 'frame-ancestors', '*')) {
        fail(path, 'baseline CSP must not allow frame-ancestors *');
    }
    if (!directiveIncludes(directives, 'frame-ancestors', "'self'")) {
        fail(path, "baseline CSP must include frame-ancestors 'self'");
    }
    if (csp.includes("'unsafe-eval'")) {
        fail(path, "baseline CSP must not allow 'unsafe-eval'");
    }
    if (!directives.has('upgrade-insecure-requests')) {
        fail(path, 'baseline CSP must include upgrade-insecure-requests');
    }
    if (headers.get('Referrer-Policy').toLowerCase() !== 'strict-origin-when-cross-origin') {
        fail(path, 'Referrer-Policy must be strict-origin-when-cross-origin');
    }
}

function validateWidgetPolicy(response) {
    const headers = validateCommonHeaders(response, widgetPath);
    const csp = headers.get('Content-Security-Policy');
    const directives = cspDirectives(csp);

    if (!directiveIncludes(directives, 'frame-ancestors', '*')) {
        fail(widgetPath, 'widget CSP must allow frame-ancestors *');
    }
    if (directiveIncludes(directives, 'frame-ancestors', "'self'")) {
        fail(widgetPath, "widget CSP must not include frame-ancestors 'self'");
    }
    for (const requiredSource of [
        'https://www.gstatic.com',
        'https://*.firebaseapp.com',
        'https://recaptcha.google.com'
    ]) {
        if (!csp.includes(requiredSource)) {
            fail(widgetPath, `widget CSP must preserve ${requiredSource}`);
        }
    }
    if (csp.includes("'unsafe-eval'")) {
        fail(widgetPath, "widget CSP must not allow 'unsafe-eval'");
    }
}

function validateRuntimeConfigPolicy(response) {
    const headers = validateCommonHeaders(response, runtimeConfigPath);
    const csp = headers.get('Content-Security-Policy');
    const directives = cspDirectives(csp);
    const cacheControl = requireHeader(response, runtimeConfigPath, 'Cache-Control');

    if (!cacheControl.split(',').some((directive) => directive.trim().toLowerCase() === 'no-store')) {
        fail(runtimeConfigPath, 'Cache-Control must include no-store');
    }
    if (!directiveIncludes(directives, 'default-src', "'none'")) {
        fail(runtimeConfigPath, "runtime CSP must include default-src 'none'");
    }
    if (!directiveIncludes(directives, 'frame-ancestors', "'none'")) {
        fail(runtimeConfigPath, "runtime CSP must include frame-ancestors 'none'");
    }
    if (headers.get('Referrer-Policy').toLowerCase() !== 'no-referrer') {
        fail(runtimeConfigPath, 'Referrer-Policy must be no-referrer');
    }
}

function normalizeCandidateOrigin(candidateUrl) {
    let url;
    try {
        url = new URL(candidateUrl);
    } catch {
        throw new Error(`Invalid candidate URL: ${candidateUrl}`);
    }
    if (url.protocol !== 'https:') {
        throw new Error('Candidate URL must use HTTPS.');
    }
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
        throw new Error('Candidate URL must contain only an HTTPS origin.');
    }
    return url.origin;
}

async function fetchPath(origin, path, fetchImpl) {
    const response = await fetchImpl(new URL(path, origin), {
        redirect: 'follow',
        headers: { 'Cache-Control': 'no-cache' }
    });
    if (!response.ok) {
        fail(path, `expected HTTP 200 but received ${response.status}`);
    }
    if (response.status !== 200) {
        fail(path, `expected HTTP 200 but received ${response.status}`);
    }
    if (response.url && new URL(response.url).origin !== origin) {
        fail(path, `redirected outside candidate origin to ${response.url}`);
    }
    return response;
}

function discoverAppAssetPath(appHtml, origin) {
    for (const match of appHtml.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
        const assetUrl = new URL(match[1], `${origin}/app/`);
        if (assetUrl.origin === origin && assetUrl.pathname.startsWith('/app/assets/')) {
            return assetUrl.pathname;
        }
    }
    fail('/app/', 'no /app/assets/ URL was found in the React shell');
}

export async function verifyResponseHeaders(candidateUrl, { fetchImpl = fetch } = {}) {
    const origin = normalizeCandidateOrigin(candidateUrl);
    const verifiedPaths = [];
    let appHtml;

    for (const path of baselinePaths) {
        const response = await fetchPath(origin, path, fetchImpl);
        validateBaselinePolicy(response, path);
        verifiedPaths.push(path);
        if (path === '/app/') {
            appHtml = await response.text();
        }
    }

    const assetPath = discoverAppAssetPath(appHtml, origin);
    const assetResponse = await fetchPath(origin, assetPath, fetchImpl);
    validateBaselinePolicy(assetResponse, assetPath);
    verifiedPaths.push(assetPath);

    const widgetResponse = await fetchPath(origin, widgetPath, fetchImpl);
    validateWidgetPolicy(widgetResponse);
    verifiedPaths.push(widgetPath);

    const runtimeResponse = await fetchPath(origin, runtimeConfigPath, fetchImpl);
    validateRuntimeConfigPolicy(runtimeResponse);
    verifiedPaths.push(runtimeConfigPath);

    return verifiedPaths;
}

async function verifyWithRetry(candidateUrl, attempts = 3) {
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            return await verifyResponseHeaders(candidateUrl);
        } catch (error) {
            lastError = error;
            if (attempt < attempts) {
                const delayMs = attempt * 2000;
                console.error(`Candidate header verification attempt ${attempt} failed: ${error.message}`);
                await new Promise((resolve) => setTimeout(resolve, delayMs));
            }
        }
    }
    throw lastError;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const candidateUrl = process.argv[2] ?? process.env.CANDIDATE_HOST_URL;
    if (!candidateUrl) {
        console.error('Usage: node scripts/verify-response-headers.mjs https://candidate.example');
        process.exitCode = 1;
    } else {
        try {
            const paths = await verifyWithRetry(candidateUrl);
            console.log(`Verified candidate response headers on ${paths.length} paths at ${candidateUrl}:`);
            for (const path of paths) console.log(`- ${path}`);
        } catch (error) {
            console.error(`Candidate response header verification failed: ${error.message}`);
            process.exitCode = 1;
        }
    }
}
