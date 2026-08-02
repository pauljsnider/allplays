import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import {
    buildSanitizedParentCoverageFailureError,
    REPORT_SCHEMA_VERSION,
    readValidatedCatalog,
    readValidatedContract,
    redactParentCoverageValue,
    stableFailureSignature
} from '../../scripts/parent-coverage-contract.mjs';
import {
    createParentCoverageRuntime,
    getParentCoverageSecrets
} from './helpers/parent-coverage-runner.js';

const enabled = process.env.SMOKE_SUITE === 'parent-coverage-census';
const appBaseUrl = String(process.env.SMOKE_APP_BASE_URL || '');
const catalogPath = String(process.env.PARENT_CENSUS_CATALOG_PATH || 'tests/parent-census/workflows.json');
const contractPath = String(process.env.PARENT_CENSUS_CONTRACT_PATH || '');
const expectedWorkflowId = String(process.env.PARENT_CENSUS_WORKFLOW_ID || '');
const reportPath = String(process.env.PARENT_CENSUS_REPORT_PATH || 'test-results/parent-census/parent-qa-report.json');

test.skip(!enabled, 'Parent census contracts run only through the protected production workflow');
test.describe.configure({ mode: 'serial' });

test('executes one validated parent workflow contract', async ({ browser }, testInfo) => {
    test.setTimeout(240_000);
    expect(appBaseUrl, 'SMOKE_APP_BASE_URL is required').toBeTruthy();
    expect(contractPath, 'PARENT_CENSUS_CONTRACT_PATH is required').toBeTruthy();
    expect(expectedWorkflowId, 'PARENT_CENSUS_WORKFLOW_ID is required').toMatch(/^P\d{2}$/);

    const catalog = await readValidatedCatalog(catalogPath);
    const contract = await readValidatedContract(contractPath, catalog, expectedWorkflowId);
    const contractDigest = createHash('sha256').update(await readFile(contractPath)).digest('hex');
    const startedAt = new Date().toISOString();
    let runtime = null;
    let currentAction = 'setup';
    let productAction = '';
    let setupError = null;
    let productError = null;
    const cleanupFailures = [];

    try {
        runtime = await createParentCoverageRuntime(browser, contract, appBaseUrl);
        for (const step of contract.steps) {
            currentAction = step.action;
            await runtime.executeStep(step);
        }
        const runtimeIssues = runtime.runtimeIssues();
        expect(runtimeIssues.map((issue) => runtime.redact(issue))).toEqual([]);
    } catch (error) {
        if (!runtime) {
            setupError = error;
        } else {
            productError = error;
            productAction = currentAction;
        }
    } finally {
        if (runtime && contract.cleanupSteps?.length) {
            for (const step of contract.cleanupSteps) {
                currentAction = step.action;
                try {
                    await runtime.executeStep(step);
                } catch (error) {
                    cleanupFailures.push({ action: currentAction, error });
                }
            }
        }
        await runtime?.close();
    }

    const cleanupError = cleanupFailures[0]?.error || null;
    const error = cleanupError || setupError || productError;
    let failureClass = 'none';
    if (cleanupError) failureClass = 'cleanup-failure';
    else if (setupError) failureClass = 'fixture-setup';
    else if (productError) failureClass = 'product-assertion';
    const reportPhase = cleanupError ? 'cleanup' : setupError ? 'setup' : productError ? 'execution' : 'complete';
    const failureAction = cleanupError
        ? cleanupFailures.map(({ action }) => action).join('+').slice(0, 180)
        : setupError
            ? 'setup'
            : productError
                ? productAction
                : 'complete';
    const sourceArea = `contract/${contract.workflowId}/${failureAction}`;
    const redact = runtime
        ? (value) => runtime.redact(value)
        : (value) => redactParentCoverageValue(value, getParentCoverageSecrets());
    const cleanup = setupError
        ? 'not-started'
        : contract.cleanupRequired
            ? (cleanupError ? 'failed' : 'completed')
            : 'not-required';
    const failureSummary = cleanupError
        ? cleanupFailures
            .map(({ action, error: cleanupFailure }) => `${action}: ${redact(cleanupFailure?.message || cleanupFailure)}`)
            .join('; ')
            .slice(0, 1200)
        : error
            ? redact(error?.message || error)
            : 'Contract completed successfully.';
    const report = {
        schemaVersion: REPORT_SCHEMA_VERSION,
        runId: String(process.env.GITHUB_RUN_ID || process.env.PARENT_CENSUS_RUN_MARKER || 'local'),
        workflowId: contract.workflowId,
        workflowTitle: contract.title,
        contractDigest,
        testSha: String(process.env.PARENT_CENSUS_TEST_SHA || ''),
        deployedSha: String(process.env.PARENT_CENSUS_DEPLOYED_SHA || ''),
        startedAt,
        completedAt: new Date().toISOString(),
        status: error ? 'failed' : 'passed',
        phase: reportPhase,
        failureClass,
        sourceArea,
        signature: error ? stableFailureSignature({ workflowId: contract.workflowId, failureClass, sourceArea }) : '',
        summary: failureSummary,
        cleanup
    };
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    await testInfo.attach('parent-coverage-report', {
        body: Buffer.from(JSON.stringify(report)),
        contentType: 'application/json'
    });
    if (error) throw buildSanitizedParentCoverageFailureError(report);
});
