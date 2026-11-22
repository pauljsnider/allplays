import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

const workflow = parseYaml(readFileSync(resolve('.github/workflows/deploy-prod.yml'), 'utf8'));
const deployScript = workflow.jobs.deploy.steps.find((step) => step.name === 'Deploy Firebase production').run;
const pattern = deployScript.match(/^transient_pattern='[^']+'$/m)?.[0];
const retryFunction = deployScript.match(/^retry_firebase_deploy\(\) \{[\s\S]*?^\}/m)?.[0];
const directories = [];

afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function runDeploy(error, failures) {
    expect(pattern).toBeTruthy();
    expect(retryFunction).toBeTruthy();
    const directory = mkdtempSync(join(tmpdir(), 'firebase-deploy-retry-'));
    directories.push(directory);
    const result = spawnSync('/bin/bash', ['-c', `
set -euo pipefail
${pattern}
${retryFunction}
firebase_config="$RUNNER_TEMP/firebase.json"
firebase_cli="$RUNNER_TEMP/firebase.js"
retry_enabled_inventory_producer_target=functions:indexCertificateLegacySignaturesOnDefaultsWrite
retry_enabled_cleanup_compatibility_target=functions:cleanupCertificateSignature
retry_enabled_function_targets=functions:otherReviewedFunction
node() {
    local count=0
    if [[ -f "$RUNNER_TEMP/attempts" ]]; then read -r count < "$RUNNER_TEMP/attempts"; fi
    count=$((count + 1))
    printf '%s\\n' "$count" > "$RUNNER_TEMP/attempts"
    printf '%s\\n' "$*" >> "$RUNNER_TEMP/arguments"
    if (( count <= TEST_FAILURES )); then
        printf '%s\\n' "$TEST_ERROR" >&2
        return 17
    fi
}
sleep() { printf '%s\\n' "$1" >> "$RUNNER_TEMP/delays"; }
retry_firebase_deploy "$retry_enabled_inventory_producer_target" inventory-producer 3 15 true
`], {
        env: { ...process.env, RUNNER_TEMP: directory, FIREBASE_PRODUCTION_BUNDLE: directory, TEST_ERROR: error, TEST_FAILURES: String(failures) },
        encoding: 'utf8',
        timeout: 10000
    });
    const read = (name) => {
        try { return readFileSync(join(directory, name), 'utf8').trim(); } catch { return ''; }
    };
    return { ...result, attempts: Number(read('attempts')), arguments: read('arguments').split('\n'), delays: read('delays').split('\n').filter(Boolean).map(Number) };
}

const regionOutage = 'Error: The following Cloud Functions regions are currently unreachable:\n\tus-central1\nThis deployment contains functions in those regions. Please try again in a few minutes, or exclude these regions from your deployment.';

describe('production Firebase deployment retry behavior', () => {
    it('recovers from the region outage reported by Firebase without changing deployment arguments', () => {
        const result = runDeploy(regionOutage, 1);
        expect(result.status, result.stdout + result.stderr).toBe(0);
        expect(result.attempts).toBe(2);
        expect(new Set(result.arguments).size).toBe(1);
        expect(result.arguments[0]).toContain('--only functions:indexCertificateLegacySignaturesOnDefaultsWrite');
        expect(result.arguments[0]).toContain('--project game-flow-c6311');
        expect(result.arguments[0]).toContain('--non-interactive --force');
        expect(result.delays).toHaveLength(1);
        expect(result.delays[0]).toBeGreaterThanOrEqual(15);
        expect(result.delays[0]).toBeLessThanOrEqual(30);
    });

    it.each([
        ...[429, 500, 502, 503, 504].map((status) => `Error: HTTP Error: ${status}, request failed`),
        'Error: HTTP Error: 409, Requested entity already exists',
        'Error: Service unavailable',
        'Error: ECONNRESET',
        'Error: Connection reset',
        'Error: Network reset',
        'Error: ETIMEDOUT',
        'Error: Request timed out',
        'Error: Request timeout'
    ])('preserves recovery for existing transient failures: %s', (error) => {
        const result = runDeploy(error, 1);
        expect(result.status, result.stdout + result.stderr).toBe(0);
        expect(result.attempts).toBe(2);
        expect(result.delays).toHaveLength(1);
    });

    it('preserves the failure after three attempts when the region remains unreachable', () => {
        const result = runDeploy(regionOutage, 10);
        expect(result.status).toBe(17);
        expect(result.attempts).toBe(3);
        expect(result.delays).toHaveLength(2);
        expect(result.stderr).toContain('failed after 3 transient attempts');
    });

    it.each([
        'Error: HTTP Error: 403, Permission denied on Cloud Functions.',
        'Error: HTTP Error: 409, Conflicting deployment configuration',
        'Error: Required configuration is unreachable because its path is invalid.'
    ])('does not retry unrelated permanent failures: %s', (error) => {
        const result = runDeploy(error, 10);
        expect(result.status).toBe(17);
        expect(result.attempts).toBe(1);
        expect(result.delays).toEqual([]);
        expect(result.stderr).toContain('non-transient error; not retrying');
    });
});
