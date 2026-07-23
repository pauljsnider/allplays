import { isDeepStrictEqual } from 'node:util';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { getPublicSmokePages } from '../tests/smoke/page-registry.js';

const widgetPath = '/widget-scoreboard.html';
const runtimeConfigPath = '/.well-known/allplays-runtime-config.json';

export function loadJson(fileUrl, label, { readFile = readFileSync } = {}) {
    try {
        return JSON.parse(readFile(fileUrl, 'utf8'));
    } catch (error) {
        throw new Error(`Failed to load ${label}: ${error.message}`);
    }
}

const firebaseConfig = loadJson(
    new URL('../firebase.json', import.meta.url),
    'firebase.json'
);
const fallbackRuntimeConfig = loadJson(
    new URL(`..${runtimeConfigPath}`, import.meta.url),
    runtimeConfigPath
);

export function getExpectedRuntimeConfig({
    siteKey = process.env.ALLPLAYS_APP_CHECK_RECAPTCHA_ENTERPRISE_SITE_KEY,
    fallback = fallbackRuntimeConfig
} = {}) {
    const normalizedSiteKey = typeof siteKey === 'string' ? siteKey.trim() : '';
    if (!/^[A-Za-z0-9_-]{10,200}$/.test(normalizedSiteKey)) return fallback;

    return {
        appCheck: {
            enabled: true,
            recaptchaEnterpriseSiteKey: normalizedSiteKey,
            isTokenAutoRefreshEnabled: true
        }
    };
}

export function configuredHeadersFor(path, config = firebaseConfig) {
    const headers = new Map();
    const rules = config?.hosting?.headers;
    if (!Array.isArray(rules)) return headers;

    for (const rule of rules) {
        if (rule.source !== '**' && rule.source !== path) continue;
        for (const header of rule.headers || []) {
            headers.set(header.key, header.value);
        }
    }
    return headers;
}

export function normalizeCandidateOrigin(candidateOrigin) {
    let url;
    try {
        url = new URL(String(candidateOrigin).trim());
    } catch {
        throw new Error(`Invalid candidate origin: ${candidateOrigin}`);
    }
    if (url.protocol !== 'https:') {
        throw new Error(`Candidate origin must use HTTPS: ${candidateOrigin}`);
    }
    if (url.username || url.password) {
        throw new Error('Candidate origin must not include credentials.');
    }
    return url.origin;
}

export function getCandidateHostChecks() {
    const pages = [
        ...getPublicSmokePages(),
        {
            name: 'scoreboard widget',
            path: widgetPath,
            titlePatterns: [/ALL PLAYS Scoreboard Widget/i],
            readySelectors: ['#scoreboard-widget']
        }
    ];
    const checks = pages.map((page) => ({
        ...page,
        expectedHeaders: configuredHeadersFor(page.path)
    }));
    checks.push({
        path: runtimeConfigPath,
        expectedHeaders: configuredHeadersFor(runtimeConfigPath)
    });
    return checks;
}

function fail(url, message) {
    throw new Error(`${url}: ${message}`);
}

function validateHeaders(url, response, expectedHeaders) {
    for (const [name, expected] of expectedHeaders) {
        const observed = response.headers.get(name)?.trim() ?? '<missing>';
        if (observed !== expected) {
            fail(
                url,
                `header "${name}" expected "${expected}" but observed "${observed}"`
            );
        }
    }
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function htmlContainsSelector(html, selector) {
    if (/^#[A-Za-z][\w:-]*$/.test(selector)) {
        const id = escapeRegExp(selector.slice(1));
        return new RegExp(`\\bid\\s*=\\s*["']${id}["']`, 'i').test(html);
    }
    if (/^[A-Za-z][\w-]*$/.test(selector)) {
        return new RegExp(`<${escapeRegExp(selector)}\\b`, 'i').test(html);
    }
    throw new Error(`Unsupported candidate host readiness selector: ${selector}`);
}

async function validateHtmlContent(url, response, { titlePatterns, readySelectors }) {
    const html = await response.text();
    const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]
        .replace(/\s+/g, ' ')
        .trim() ?? '<missing>';
    if (!titlePatterns.some((pattern) => pattern.test(title))) {
        fail(
            url,
            `title expected ${titlePatterns.map(String).join(' or ')} but observed "${title}"`
        );
    }
    if (!readySelectors.some((selector) => htmlContainsSelector(html, selector))) {
        fail(
            url,
            `expected at least one readiness selector: ${readySelectors.join(', ')}`
        );
    }
}

async function validateRuntimeConfig(url, response, expectedRuntimeConfig) {
    let observed;
    try {
        observed = await response.json();
    } catch {
        fail(url, 'runtime configuration expected valid JSON but observed an invalid JSON response');
    }
    if (!isDeepStrictEqual(observed, expectedRuntimeConfig)) {
        fail(
            url,
            `runtime configuration expected ${JSON.stringify(expectedRuntimeConfig)} but observed ${JSON.stringify(observed)}`
        );
    }
}

export async function smokeCandidateHost(
    candidateOrigin,
    {
        fetchImpl = fetch,
        expectedRuntimeConfig = getExpectedRuntimeConfig()
    } = {}
) {
    const origin = normalizeCandidateOrigin(candidateOrigin);
    const verifiedUrls = [];

    for (const check of getCandidateHostChecks()) {
        const { path, expectedHeaders } = check;
        const url = new URL(path, `${origin}/`).toString();
        const response = await fetchImpl(url, {
            redirect: 'follow',
            headers: { 'Cache-Control': 'no-cache' }
        });

        if (!response.ok) {
            fail(url, `expected HTTP 200 but observed HTTP ${response.status}`);
        }
        if (response.url && new URL(response.url).origin !== origin) {
            fail(url, `expected candidate origin "${origin}" but observed redirect "${response.url}"`);
        }

        validateHeaders(url, response, expectedHeaders);
        if (path === runtimeConfigPath) {
            await validateRuntimeConfig(url, response, expectedRuntimeConfig);
        } else {
            await validateHtmlContent(url, response, check);
        }
        verifiedUrls.push(url);
    }

    return verifiedUrls;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const candidateOrigin = process.argv[2] ?? process.env.CANDIDATE_HOST_URL;
    if (!candidateOrigin) {
        console.error('Usage: npm run smoke:candidate-host -- https://candidate.example');
        process.exitCode = 1;
    } else {
        try {
            const verifiedUrls = await smokeCandidateHost(candidateOrigin);
            console.log(`Candidate host smoke passed for ${verifiedUrls.length} URLs:`);
            for (const url of verifiedUrls) console.log(`- ${url}`);
        } catch (error) {
            console.error(`Candidate host smoke failed: ${error.message}`);
            process.exitCode = 1;
        }
    }
}
