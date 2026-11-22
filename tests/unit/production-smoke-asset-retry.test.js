import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isAsset503Assertion, isOnlyAsset503Failure, isCleanSmokeReport, runProductionSmoke } from '../../scripts/run-production-smoke.mjs';

const asset = 'https://allplays.ai/app/assets/searchService-HBOjdAeA.js';
const issues = [
    `response:503:${asset}`,
    'console:Failed to load resource: the server responded with a status of 503 ()',
    `asset:net::ERR_ABORTED:${asset}`
];
const assertion = values => ({ message: `Error: expect(received).toEqual(expected) // deep equality\n\n- Expected  - 1\n+ Received  + 5\n\n- Array []\n+ Array [\n${values.map(value => `+   ${JSON.stringify(value)},\n`).join('')}+ ]\n\n    at withAuthenticatedPage (app-authenticated-core.spec.js:78:87)` });
const passed = () => ({ status: 'passed', errors: [] });
const failed = () => ({ status: 'failed', errors: [assertion(issues)] });
const report = (results = [failed(), passed()], status = 'flaky') => ({
    errors: [],
    stats: { expected: status === 'expected' ? 1 : 0, unexpected: status === 'unexpected' ? 1 : 0, flaky: status === 'flaky' ? 1 : 0, skipped: 0 },
    suites: [{ specs: [{ tests: [{ expectedStatus: 'passed', status, results }] }] }]
});
const clean = () => report([passed()], 'expected');
const directories = [];
afterEach(() => directories.splice(0).forEach(directory => rmSync(directory, { recursive: true, force: true })));

describe('complete production smoke asset-outage evidence', () => {
    it('recognizes the observed asset response, console error and matching aborted request', () => {
        expect(isAsset503Assertion(assertion(issues))).toBe(true);
        expect(isOnlyAsset503Failure(report())).toBe(true);
        expect(isOnlyAsset503Failure(report([failed()], 'unexpected'))).toBe(true);
    });

    it.each([
        ['response:401:https://allplays.ai/app/assets/searchService-HBOjdAeA.js'],
        ['response:503:https://allplays.ai.evil.test/app/assets/main.js'],
        ['response:503:https://allplays.ai/api/private'],
        ['response:503:https://allplays.ai/app/assets/main.js?token=secret'],
        ['response:503:https://allplays.ai/app/assets/main.js#fragment'],
        ['console:Failed to load resource: the server responded with a status of 503 ()'],
        [`response:503:${asset}`],
        [`response:503:${asset}`, `asset:net::ERR_ABORTED:${asset}`],
        [`response:503:${asset}`, issues[1]],
        [...issues, 'response:503:https://allplays.ai/app/assets/other.js'],
        [...issues, 'pageerror:TypeError: broken application'],
        [...issues, 'response:403:https://allplays.ai/private'],
        [...issues, 'asset:net::ERR_ABORTED:https://allplays.ai/app/assets/other.js']
    ])('rejects unrelated or mixed failure evidence %j', (...values) => {
        expect(isAsset503Assertion(assertion(values))).toBe(false);
    });

    it('requires an aborted request for every accepted asset response', () => {
        const other = 'https://allplays.ai/app/assets/other.js';
        expect(isAsset503Assertion(assertion([...issues, `response:503:${other}`, `asset:net::ERR_ABORTED:${other}`]))).toBe(true);
    });

    it.each([
        value => { value.errors.push({ message: 'worker crashed' }); },
        value => { value.stats.skipped = 1; },
        value => { value.stats.flaky = 0; },
        value => { delete value.stats; },
        value => { delete value.errors; },
        value => { value.suites[0].specs[0].tests[0].results[0].status = 'timedOut'; },
        value => { value.suites[0].specs[0].tests[0].results[0].errors = []; },
        value => { value.suites[0].specs[0].tests[0].results[0].errors.push({ message: 'Expected button visible' }); },
        value => { value.suites[0].specs[0].tests[0].results[1].errors.push({ message: 'late crash' }); },
        value => { value.suites[0].specs[0].tests[0].expectedStatus = 'failed'; }
    ])('rejects incomplete, interrupted, mixed or inconsistent reports', mutate => {
        const value = report();
        mutate(value);
        expect(isOnlyAsset503Failure(value)).toBe(false);
    });

    it('does not accept a 503 mentioned only in an unrelated assertion', () => {
        expect(isAsset503Assertion({ message: `Error: expected page visible; diagnostics response:503:${asset}` })).toBe(false);
    });

    it('requires a complete fresh clean pass', () => {
        expect(isCleanSmokeReport(clean())).toBe(true);
        expect(isCleanSmokeReport(report())).toBe(false);
        expect(isCleanSmokeReport({ errors: [], stats: { expected: 0, unexpected: 0, flaky: 0, skipped: 0 }, suites: [] })).toBe(false);
    });

    it('reads real Playwright JSON from the observed empty-issues assertion and flaky retry', () => {
        const directory = mkdtempSync(path.join(tmpdir(), 'asset-outage-reporter-'));
        directories.push(directory);
        const output = path.join(directory, 'report.json');
        writeFileSync(path.join(directory, 'playwright.config.cjs'), 'module.exports = { testDir: ".", testMatch: "*.spec.mjs", workers: 1 };');
        const moduleUrl = pathToFileURL(path.resolve('node_modules/@playwright/test/index.mjs')).href;
        writeFileSync(path.join(directory, 'outage.spec.mjs'), `import { test, expect } from ${JSON.stringify(moduleUrl)};\ntest('runtime issues', ({}, info) => { expect(info.retry ? [] : ${JSON.stringify(issues)}).toEqual([]); });\n`);
        const result = spawnSync(process.execPath, [path.resolve('node_modules/@playwright/test/cli.js'), 'test', '--config', path.join(directory, 'playwright.config.cjs'), '--retries=1', '--fail-on-flaky-tests', '--reporter=json'], { encoding: 'utf8', env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: output }, timeout: 15000 });
        expect(result.status, result.stderr).toBe(1);
        const evidence = JSON.parse(readFileSync(output, 'utf8'));
        expect(evidence.stats.flaky).toBe(1);
        expect(isOnlyAsset503Failure(evidence), JSON.stringify(evidence.suites)).toBe(true);
    }, 20000);
});

describe('one bounded full-suite recovery', () => {
    it('waits, reruns the whole suite and requires clean second evidence', async () => {
        const run = vi.fn().mockResolvedValueOnce({ code: 1, report: report() }).mockResolvedValueOnce({ code: 0, report: clean() });
        const wait = vi.fn();
        expect(await runProductionSmoke({ run, wait, production: true, log: vi.fn() })).toBe(0);
        expect(run.mock.calls).toEqual([[1], [2]]);
        expect(wait).toHaveBeenCalledWith(15000);
    });

    it.each([
        { code: 1, report: report() },
        { code: 0, report: report() },
        { code: 0 },
        { code: 2, report: clean() }
    ])('never retries a second failure or accepts incomplete/flaky success', async second => {
        const run = vi.fn().mockResolvedValueOnce({ code: 1, report: report() }).mockResolvedValueOnce(second);
        expect(await runProductionSmoke({ run, wait: vi.fn(), production: true, log: vi.fn() })).not.toBe(0);
        expect(run).toHaveBeenCalledTimes(2);
    });

    it.each([
        { code: 2, report: report(), production: true },
        { code: 1, report: undefined, production: true },
        { code: 1, report: report(), production: false },
        { code: 0, report: clean(), production: true }
    ])('preserves ordinary results without a recovery attempt', async first => {
        const run = vi.fn().mockResolvedValue(first);
        const wait = vi.fn();
        expect(await runProductionSmoke({ run, wait, production: first.production, log: vi.fn() })).toBe(first.code);
        expect(run).toHaveBeenCalledTimes(1);
        expect(wait).not.toHaveBeenCalled();
    });

    it('keeps strict workflow assertions and routes only the two canonical suites through recovery', () => {
        const workflow = readFileSync('.github/workflows/post-deploy-smoke.yml', 'utf8');
        expect(workflow.match(/node scripts\/run-production-smoke\.mjs/g)).toHaveLength(2);
        expect(workflow.match(/--fail-on-flaky-tests/g)).toHaveLength(2);
        expect(workflow).toContain('npx playwright test tests/smoke/candidate-host-auth.spec.js');
    });
});
