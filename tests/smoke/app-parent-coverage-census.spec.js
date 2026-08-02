import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import {
    REPORT_SCHEMA_VERSION,
    readValidatedCatalog,
    readValidatedContract,
    stableFailureSignature
} from '../../scripts/parent-coverage-contract.mjs';
import { createParentCoverageRuntime } from './helpers/parent-coverage-runner.js';

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
    const runtime = await createParentCoverageRuntime(browser, contract, appBaseUrl);
    let currentAction = 'setup';
    let productAction = '';
    let cleanupAction = '';
    let productError = null;
    let cleanupError = null;

    try {
        for (const step of contract.steps) {
            currentAction = step.action;
            await runtime.executeStep(step);
        }
        const runtimeIssues = runtime.runtimeIssues();
        expect(runtimeIssues.map((issue) => runtime.redact(issue))).toEqual([]);
    } catch (error) {
        productError = error;
        productAction = currentAction;
    } finally {
        if (contract.cleanupSteps?.length) {
            for (const step of contract.cleanupSteps) {
                currentAction = step.action;
                try {
                    await runtime.executeStep(step);
                } catch (error) {
                    cleanupError = error;
                    cleanupAction = currentAction;
                    break;
                }
            }
        }
        await runtime.close();
    }

    const error = cleanupError || productError;
    const failureClass = cleanupError
        ? 'cleanup-failure'
        : productError
            ? 'product-assertion'
            : 'none';
    const reportPhase = cleanupError ? 'cleanup' : productError ? 'execution' : 'complete';
    const failureAction = cleanupError ? cleanupAction : productError ? productAction : 'complete';
    const sourceArea = `contract/${contract.workflowId}/${failureAction}`;
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
        summary: error ? runtime.redact(error?.message || error) : 'Contract completed successfully.',
        cleanup: contract.cleanupRequired
            ? (cleanupError ? 'failed' : 'completed')
            : 'not-required'
    };
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    await testInfo.attach('parent-coverage-report', {
        body: Buffer.from(JSON.stringify(report)),
        contentType: 'application/json'
    });
    if (error) throw error;
});
