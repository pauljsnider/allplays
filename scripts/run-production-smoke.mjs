import { spawn } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Only the observed empty-runtime-issues assertion is eligible. Do not infer
// infrastructure trouble from a timeout, a test title, or a 503 in a stack trace.
export function isAsset503Assertion(error) {
    if (typeof error?.message !== 'string') return false;
    const message = error.message.replace(/\u001b\[[0-9;]*m/g, '');
    const match = message.match(/^Error: expect\(received\)\.toEqual\(expected\)[^\n]*\n[\s\S]*?- Array \[\]\n\+ Array \[\n((?:\+   .*\n)+)\+ \]/);
    if (!match) return false;
    let issues;
    try {
        issues = match[1].trimEnd().split('\n').map(line => JSON.parse(line.slice(4).replace(/,$/, '')));
    } catch {
        return false;
    }
    const responses = issues.filter(issue => typeof issue === 'string' && issue.startsWith('response:503:'));
    if (!responses.length) return false;
    const urls = responses.map(issue => issue.slice('response:503:'.length));
    if (!urls.every(url => /^https:\/\/allplays\.ai\/app\/assets\/[A-Za-z0-9_-]+\.(?:js|css)$/.test(url))) return false;
    if (!issues.includes('console:Failed to load resource: the server responded with a status of 503 ()')
        || !urls.every(url => issues.includes(`asset:net::ERR_ABORTED:${url}`))) return false;
    return issues.every(issue => responses.includes(issue)
        || issue === 'console:Failed to load resource: the server responded with a status of 503 ()'
        || urls.some(url => issue === `asset:net::ERR_ABORTED:${url}`));
}

function reportTests(report) {
    const tests = [];
    const visit = suites => {
        if (!Array.isArray(suites)) throw new Error('missing suites');
        for (const suite of suites) {
            if (!Array.isArray(suite.specs)) throw new Error('missing specs');
            for (const spec of suite.specs) {
                if (!Array.isArray(spec.tests)) throw new Error('missing tests');
                tests.push(...spec.tests);
            }
            if (suite.suites) visit(suite.suites);
        }
    };
    visit(report.suites);
    const stats = report.stats;
    if (!stats || !['expected', 'unexpected', 'flaky', 'skipped'].every(key => Number.isSafeInteger(stats[key]) && stats[key] >= 0)
        || stats.expected + stats.unexpected + stats.flaky + stats.skipped !== tests.length
        || !tests.length || stats.skipped !== 0 || !Array.isArray(report.errors) || report.errors.length) {
        throw new Error('incomplete report');
    }
    const counts = { expected: 0, unexpected: 0, flaky: 0 };
    for (const test of tests) {
        if (test.expectedStatus !== 'passed' || !Object.hasOwn(counts, test.status)
            || !Array.isArray(test.results) || !test.results.length) throw new Error('incomplete test');
        counts[test.status]++;
    }
    if (Object.keys(counts).some(key => counts[key] !== stats[key])) throw new Error('inconsistent report');
    return tests;
}

export function isOnlyAsset503Failure(report) {
    try {
        const tests = reportTests(report);
        let failures = 0;
        for (const test of tests) {
            let failed = false;
            for (const result of test.results) {
                if (!Array.isArray(result.errors)) return false;
                if (result.status === 'passed' && result.errors.length === 0) continue;
                if (result.status !== 'failed' || !result.errors.length || !result.errors.every(isAsset503Assertion)) return false;
                failed = true;
                failures++;
            }
            const last = test.results.at(-1).status;
            if (test.status === 'expected' && failed) return false;
            if (test.status === 'flaky' && (!failed || last !== 'passed')) return false;
            if (test.status === 'unexpected' && (!failed || last !== 'failed')) return false;
        }
        return failures > 0;
    } catch {
        return false;
    }
}

export function isCleanSmokeReport(report) {
    try {
        return reportTests(report).every(test => test.status === 'expected'
            && test.results.every(result => result.status === 'passed' && Array.isArray(result.errors) && result.errors.length === 0));
    } catch {
        return false;
    }
}

export async function runProductionSmoke({ run, wait, production, log = console.log }) {
    const first = await run(1);
    if (first.code === 0) return isCleanSmokeReport(first.report) ? 0 : 1;
    if (first.code !== 1 || !production || !isOnlyAsset503Failure(first.report)) return first.code || 1;
    log('Production smoke observed only canonical asset HTTP 503 failures; retrying the complete suite once after 15 seconds.');
    await wait(15000);
    const second = await run(2);
    // The second complete pass must be clean, including no flaky tests. Its
    // failure never triggers another retry, regardless of classification.
    return second.code === 0 && isCleanSmokeReport(second.report) ? 0 : second.code || 1;
}

async function main() {
    const args = process.argv.slice(2);
    if (!args.includes('--fail-on-flaky-tests') || !args.includes('--retries=1')
        || args.some(arg => arg.startsWith('--reporter'))) throw new Error('strict smoke flags required; reporter is owned by this runner');
    const directory = await mkdtemp(path.join(tmpdir(), 'production-smoke-'));
    const cli = path.resolve('node_modules/@playwright/test/cli.js');
    const run = async attempt => {
        const reportFile = path.join(directory, `attempt-${attempt}.json`);
        const code = await new Promise(resolve => {
            const child = spawn(process.execPath, [cli, 'test', ...args, '--reporter=line,json'], {
                stdio: 'inherit',
                env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: reportFile }
            });
            child.once('error', () => resolve(2));
            child.once('exit', (status, signal) => resolve(signal ? 2 : status ?? 2));
        });
        let report;
        try { report = JSON.parse(await readFile(reportFile, 'utf8')); } catch { /* Missing evidence fails closed. */ }
        return { code, report };
    };
    process.exitCode = await runProductionSmoke({ run, production: process.env.SMOKE_SUITE === 'production', wait: ms => new Promise(resolve => setTimeout(resolve, ms)) });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch(() => { console.error('Production smoke runner failed; release remains blocked.'); process.exitCode = 2; });
}
