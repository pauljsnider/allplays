import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const allowedAdvisory = 'https://github.com/advisories/GHSA-qwww-vcr4-c8h2';
const exceptionExpiresAt = new Date('2026-08-08T00:00:00Z');
const severityRank = new Map([
    ['low', 1],
    ['moderate', 2],
    ['high', 3],
    ['critical', 4]
]);

export function validateAppAuditReport(report, now = new Date()) {
    if (
        report?.auditReportVersion !== 2
        || !report.vulnerabilities
        || typeof report.vulnerabilities !== 'object'
        || !report.metadata?.vulnerabilities
    ) {
        throw new Error('npm audit returned an invalid or error-shaped report.');
    }

    const relevant = Object.values(report?.vulnerabilities || {})
        .filter((entry) => (severityRank.get(entry?.severity) || 0) >= severityRank.get('moderate'));

    if (relevant.length === 0) return;
    if (now >= exceptionExpiresAt) {
        throw new Error(`The temporary React Router RSC advisory exception expired on ${exceptionExpiresAt.toISOString()}.`);
    }

    const router = relevant.find((entry) => entry.name === 'react-router');
    const routerDom = relevant.find((entry) => entry.name === 'react-router-dom');
    const directAdvisories = router?.via?.filter((entry) => typeof entry === 'object') || [];
    const onlyExpectedPackages = relevant.every((entry) =>
        entry.name === 'react-router' || entry.name === 'react-router-dom'
    );
    const onlyExpectedAdvisory = directAdvisories.length === 1
        && directAdvisories[0].url === allowedAdvisory
        && directAdvisories[0].title?.includes('RSC Mode');
    const onlyExpectedDependency = routerDom?.via?.length === 1
        && routerDom.via[0] === 'react-router';

    if (!router || !routerDom || !onlyExpectedPackages || !onlyExpectedAdvisory || !onlyExpectedDependency) {
        throw new Error('App dependency audit contains a moderate-or-higher vulnerability outside the reviewed React Router RSC exception.');
    }

    console.warn(
        `Temporarily allowing ${allowedAdvisory}: AllPlays uses React Router in client-only HashRouter mode, not RSC mode.`
    );
}

export function validateAppAuditResult(result, now = new Date()) {
    if (result.error) {
        throw new Error(`npm audit could not start: ${result.error.message}`);
    }
    if (result.signal || (result.status !== 0 && result.status !== 1)) {
        throw new Error(`npm audit failed unexpectedly${result.signal ? ` with signal ${result.signal}` : ` with status ${result.status}`}.`);
    }
    if (!result.stdout) {
        throw new Error(result.stderr || 'npm audit returned no JSON report.');
    }

    let report;
    try {
        report = JSON.parse(result.stdout);
    } catch {
        throw new Error(`npm audit returned invalid JSON: ${result.stderr || result.stdout}`);
    }

    validateAppAuditReport(report, now);
}

function runAudit() {
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const result = spawnSync(
        'npm',
        ['--prefix', 'apps/app', 'audit', '--audit-level=moderate', '--json'],
        { cwd: repositoryRoot, encoding: 'utf8' }
    );
    validateAppAuditResult(result);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        runAudit();
    } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    }
}
