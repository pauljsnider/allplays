import { isDeepStrictEqual } from 'node:util';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { getPublicSmokePages } from '../tests/smoke/page-registry.js';

const widgetPath = '/widget-scoreboard.html';
const runtimeConfigPath = '/.well-known/allplays-runtime-config.json';
const firebaseConfig = JSON.parse(
    readFileSync(new URL('../firebase.json', import.meta.url), 'utf8')
);
const expectedRuntimeConfig = JSON.parse(
    readFileSync(new URL(`..${runtimeConfigPath}`, import.meta.url), 'utf8')
);

function configuredHeadersFor(path) {
    const headers = new Map();
    for (const rule of firebaseConfig.hosting.headers) {
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
    const paths = [
        ...getPublicSmokePages().map(({ path }) => path),
        widgetPath,
        runtimeConfigPath
    ];
    return [...new Set(paths)].map((path) => ({
        path,
        expectedHeaders: configuredHeadersFor(path)
    }));
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

async function validateRuntimeConfig(url, response) {
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

export async function smokeCandidateHost(candidateOrigin, { fetchImpl = fetch } = {}) {
    const origin = normalizeCandidateOrigin(candidateOrigin);
    const verifiedUrls = [];

    for (const { path, expectedHeaders } of getCandidateHostChecks()) {
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
            await validateRuntimeConfig(url, response);
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
