#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

export const EXPECTED_RECOVERY_REPOSITORY = 'pauljsnider/allplays';
export const EXPECTED_RECOVERY_REPOSITORY_ID = '1106220007';
export const EXPECTED_RECOVERY_REPOSITORY_OWNER_ID = '211066188';
export const EXPECTED_RECOVERY_REF = 'refs/heads/master';
export const EXPECTED_RECOVERY_WORKFLOW_REF = `${EXPECTED_RECOVERY_REPOSITORY}/.github/workflows/firestore-recovery-health.yml@${EXPECTED_RECOVERY_REF}`;
export const EXPECTED_RECOVERY_PROJECT_ID = 'game-flow-c6311';
export const EXPECTED_RECOVERY_PROVIDER = 'projects/982493478258/locations/global/workloadIdentityPools/github-actions/providers/allplays-recovery';
export const EXPECTED_RECOVERY_SERVICE_ACCOUNT = 'allplays-firestore-recovery@game-flow-c6311.iam.gserviceaccount.com';

const PROVIDER_PATTERN = /^projects\/(\d+)\/locations\/global\/workloadIdentityPools\/([a-z][a-z0-9-]{3,31})\/providers\/([a-z][a-z0-9-]{3,31})$/;
const SERVICE_ACCOUNT_PATTERN = /^([a-z][a-z0-9-]{4,28}[a-z0-9])@([a-z][a-z0-9-]{4,28}[a-z0-9])\.iam\.gserviceaccount\.com$/;

function required(environment, name, failures) {
    const value = String(environment[name] || '').trim();
    if (!value) failures.push(`${name} is not configured.`);
    return value;
}

export function evaluateRecoveryWorkflowIdentity(environment = process.env) {
    const failures = [];
    const projectId = required(environment, 'FIREBASE_PROJECT_ID', failures);
    const workloadIdentityProvider = required(
        environment,
        'FIRESTORE_RECOVERY_WORKLOAD_IDENTITY_PROVIDER',
        failures
    );
    const serviceAccount = required(environment, 'FIRESTORE_RECOVERY_SERVICE_ACCOUNT', failures);
    const repository = required(environment, 'GITHUB_REPOSITORY', failures);
    const repositoryId = required(environment, 'GITHUB_REPOSITORY_ID', failures);
    const repositoryOwnerId = required(environment, 'GITHUB_REPOSITORY_OWNER_ID', failures);
    const ref = required(environment, 'GITHUB_REF', failures);
    const workflowRef = required(environment, 'GITHUB_WORKFLOW_REF', failures);

    const providerMatch = workloadIdentityProvider.match(PROVIDER_PATTERN);
    if (workloadIdentityProvider && !providerMatch) {
        failures.push('FIRESTORE_RECOVERY_WORKLOAD_IDENTITY_PROVIDER is not a canonical provider resource name.');
    } else if (providerMatch && workloadIdentityProvider !== EXPECTED_RECOVERY_PROVIDER) {
        failures.push(`FIRESTORE_RECOVERY_WORKLOAD_IDENTITY_PROVIDER must be ${EXPECTED_RECOVERY_PROVIDER}.`);
    }

    const serviceAccountMatch = serviceAccount.match(SERVICE_ACCOUNT_PATTERN);
    if (serviceAccount && !serviceAccountMatch) {
        failures.push('FIRESTORE_RECOVERY_SERVICE_ACCOUNT is not a valid service-account email.');
    } else if (serviceAccountMatch && projectId && serviceAccountMatch[2] !== projectId) {
        failures.push('FIRESTORE_RECOVERY_SERVICE_ACCOUNT does not belong to FIREBASE_PROJECT_ID.');
    } else if (serviceAccountMatch && serviceAccount !== EXPECTED_RECOVERY_SERVICE_ACCOUNT) {
        failures.push(`FIRESTORE_RECOVERY_SERVICE_ACCOUNT must be ${EXPECTED_RECOVERY_SERVICE_ACCOUNT}.`);
    }

    if (projectId && projectId !== EXPECTED_RECOVERY_PROJECT_ID) {
        failures.push(`FIREBASE_PROJECT_ID must be ${EXPECTED_RECOVERY_PROJECT_ID}.`);
    }

    if (repository && repository !== EXPECTED_RECOVERY_REPOSITORY) {
        failures.push(`Recovery verification may run only in ${EXPECTED_RECOVERY_REPOSITORY}.`);
    }
    if (repositoryId && repositoryId !== EXPECTED_RECOVERY_REPOSITORY_ID) {
        failures.push(`Recovery verification requires immutable repository ID ${EXPECTED_RECOVERY_REPOSITORY_ID}.`);
    }
    if (repositoryOwnerId && repositoryOwnerId !== EXPECTED_RECOVERY_REPOSITORY_OWNER_ID) {
        failures.push(`Recovery verification requires immutable repository-owner ID ${EXPECTED_RECOVERY_REPOSITORY_OWNER_ID}.`);
    }
    if (ref && ref !== EXPECTED_RECOVERY_REF) {
        failures.push(`Recovery verification may run only from ${EXPECTED_RECOVERY_REF}.`);
    }
    if (workflowRef && workflowRef !== EXPECTED_RECOVERY_WORKFLOW_REF) {
        failures.push(`Recovery verification must use ${EXPECTED_RECOVERY_WORKFLOW_REF}.`);
    }

    return {
        healthy: failures.length === 0,
        failures,
        projectId,
        workloadIdentityProvider,
        serviceAccount,
        repositoryId,
        repositoryOwnerId,
        providerProjectNumber: providerMatch?.[1] || null
    };
}

export function verifyRecoveryWorkflowIdentity(environment = process.env) {
    const result = evaluateRecoveryWorkflowIdentity(environment);
    if (!result.healthy) {
        throw new Error([
            'Firestore recovery OIDC preflight failed:',
            ...result.failures.map((failure) => `- ${failure}`),
            'Configure the production environment variables and the exact GitHub-to-Google trust described in docs/firestore-recovery-runbook.md.'
        ].join('\n'));
    }

    console.log(JSON.stringify({
        healthy: true,
        projectId: result.projectId,
        providerProjectNumber: result.providerProjectNumber,
        repositoryId: result.repositoryId,
        repositoryOwnerId: result.repositoryOwnerId,
        serviceAccount: result.serviceAccount
    }, null, 2));
    return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        verifyRecoveryWorkflowIdentity();
    } catch (error) {
        console.error(error?.message || 'Firestore recovery OIDC preflight failed.');
        process.exitCode = 1;
    }
}
