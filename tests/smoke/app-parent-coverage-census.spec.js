import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import {
    buildParentCoverageOutcome,
    buildSanitizedParentCoverageFailureError,
    classifyParentCoverageError,
    parentCoverageEvidenceScope,
    REPORT_SCHEMA_VERSION,
    readValidatedCatalog,
    readValidatedContract,
    stableFailureSignature
} from '../../scripts/parent-coverage-contract.mjs';
import {
    createParentCoverageRuntime,
    executeParentCoverageCleanup
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
            cleanupFailures.push(...await executeParentCoverageCleanup(runtime, contract.cleanupSteps));
        }
        await runtime?.close();
    }

    // Never serialize Playwright messages: assertion failures can embed arbitrary
    // production DOM text. Reports retain only a bounded failure classification.
    const sanitizedCleanupFailures = cleanupFailures.map(({ action, error: cleanupFailure }) => ({
        action,
        summary: classifyParentCoverageError(cleanupFailure)
    }));
    const outcome = buildParentCoverageOutcome({
        workflowId: contract.workflowId,
        setupSummary: setupError ? classifyParentCoverageError(setupError) : '',
        productSummary: productError ? classifyParentCoverageError(productError) : '',
        productAction,
        cleanupFailures: sanitizedCleanupFailures,
        cleanupRequired: contract.cleanupRequired
    });
    const report = {
        schemaVersion: REPORT_SCHEMA_VERSION,
        runId: String(process.env.GITHUB_RUN_ID || process.env.PARENT_CENSUS_RUN_MARKER || 'local'),
        workflowId: contract.workflowId,
        workflowTitle: contract.title,
        evidenceScope: parentCoverageEvidenceScope(contract.workflowId),
        contractDigest,
        testSha: String(process.env.PARENT_CENSUS_TEST_SHA || ''),
        deployedSha: String(process.env.PARENT_CENSUS_DEPLOYED_SHA || ''),
        startedAt,
        completedAt: new Date().toISOString(),
        ...outcome,
        signature: outcome.status === 'failed'
            ? stableFailureSignature({
                workflowId: contract.workflowId,
                failureClass: outcome.failureClass,
                sourceArea: outcome.sourceArea
            })
            : '',
        cleanupFailures: sanitizedCleanupFailures
    };
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    await testInfo.attach('parent-coverage-report', {
        body: Buffer.from(JSON.stringify(report)),
        contentType: 'application/json'
    });
    if (outcome.status === 'failed') throw buildSanitizedParentCoverageFailureError(report);
});
