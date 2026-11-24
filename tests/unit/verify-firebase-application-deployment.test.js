import { describe, expect, it } from 'vitest';

import {
    FIREBASE_APPLICATION_DEPLOY_LABEL,
    FIREBASE_APPLICATION_DEPLOY_TARGETS,
    FIREBASE_APPLICATION_EVIDENCE_SCHEMA_VERSION,
    FIREBASE_APPLICATION_FUNCTIONS_TARGET_TYPE,
    FIREBASE_FUNCTION_TARGET_TYPE,
    verifyFirebaseApplicationDeployment
} from '../../scripts/verify-firebase-application-deployment.mjs';

const artifactSha = 'a'.repeat(40);
const expectedDeployment = Object.freeze({
    projectId: 'game-flow-c6311',
    deployTargets: FIREBASE_APPLICATION_DEPLOY_TARGETS,
    deployLabel: FIREBASE_APPLICATION_DEPLOY_LABEL,
    artifactSha
});
const expectedFunctionDeployment = Object.freeze({
    projectId: 'game-flow-c6311',
    functionTarget: 'sendNotification',
    artifactSha,
    deploymentId: 'projects/game-flow-c6311/locations/us-central1/functions/sendNotification/versions/42'
});

function validCurrentEvidence() {
    return {
        schemaVersion: FIREBASE_APPLICATION_EVIDENCE_SCHEMA_VERSION,
        targetType: FIREBASE_APPLICATION_FUNCTIONS_TARGET_TYPE,
        status: 'current',
        projectId: expectedDeployment.projectId,
        deployTargets: expectedDeployment.deployTargets,
        deployLabel: expectedDeployment.deployLabel,
        artifactSha: expectedDeployment.artifactSha
    };
}

function verify(evidence, expected) {
    return verifyFirebaseApplicationDeployment({
        evidence,
        expectedDeployment: arguments.length === 1 ? expectedDeployment : expected
    });
}

function validFunctionArtifactEvidence() {
    return {
        schemaVersion: FIREBASE_APPLICATION_EVIDENCE_SCHEMA_VERSION,
        targetType: FIREBASE_FUNCTION_TARGET_TYPE,
        status: 'current',
        projectId: expectedFunctionDeployment.projectId,
        functionTarget: expectedFunctionDeployment.functionTarget,
        artifactSha: expectedFunctionDeployment.artifactSha
    };
}

function validFunctionDeploymentEvidence() {
    return {
        schemaVersion: FIREBASE_APPLICATION_EVIDENCE_SCHEMA_VERSION,
        targetType: FIREBASE_FUNCTION_TARGET_TYPE,
        status: 'current',
        projectId: expectedFunctionDeployment.projectId,
        functionTarget: expectedFunctionDeployment.functionTarget,
        deploymentId: expectedFunctionDeployment.deploymentId
    };
}

function validFunctionUpdatedEvidence(expected = expectedFunctionDeployment) {
    return {
        schemaVersion: FIREBASE_APPLICATION_EVIDENCE_SCHEMA_VERSION,
        targetType: FIREBASE_FUNCTION_TARGET_TYPE,
        status: 'updated',
        projectId: expected.projectId,
        functionTarget: expected.functionTarget,
        artifactSha: expected.artifactSha,
        deploymentId: expected.deploymentId
    };
}

function verifyFunction(evidence, expected = expectedFunctionDeployment) {
    return verifyFirebaseApplicationDeployment({ evidence, expectedDeployment: expected });
}

describe('Firebase application deployment evidence', () => {
    it('accepts complete current evidence for the production application Functions target', () => {
        expect(verify(validCurrentEvidence())).toEqual({
            status: 'current',
            targetType: FIREBASE_APPLICATION_FUNCTIONS_TARGET_TYPE,
            projectId: 'game-flow-c6311',
            deployTargets: 'hosting,functions',
            deployLabel: 'application',
            artifactSha
        });
    });

    it.each([
        ['undefined', undefined],
        ['null', null],
        ['array', []],
        ['string', 'current']
    ])('rejects %s application evidence', (_label, evidence) => {
        expect(() => verify(evidence)).toThrow(/evidence must be a plain object/);
    });

    it.each([
        'schemaVersion',
        'targetType',
        'status',
        'projectId',
        'deployTargets',
        'deployLabel',
        'artifactSha'
    ])('rejects evidence missing %s', (field) => {
        const evidence = validCurrentEvidence();
        delete evidence[field];

        expect(() => verify(evidence)).toThrow(/fields must exactly match/);
    });

    it.each([
        ['schemaVersion', '1'],
        ['targetType', 1],
        ['status', true],
        ['projectId', ''],
        ['deployTargets', ['hosting', 'functions']],
        ['deployLabel', ''],
        ['artifactSha', 'not-a-sha']
    ])('rejects malformed %s evidence', (field, value) => {
        const evidence = { ...validCurrentEvidence(), [field]: value };

        expect(() => verify(evidence)).toThrow();
    });

    it.each([
        ['schema version', { schemaVersion: 2 }],
        ['Hosting target', { targetType: 'firebase-hosting' }],
        ['updated state', { status: 'updated' }],
        ['unchanged state', { status: 'unchanged' }],
        ['partial state', { status: 'partial' }]
    ])('rejects unsupported %s', (_label, mutation) => {
        expect(() => verify({ ...validCurrentEvidence(), ...mutation })).toThrow();
    });

    it.each([
        ['projectId', 'another-project'],
        ['deployTargets', 'functions'],
        ['deployLabel', 'targeted-function'],
        ['artifactSha', 'b'.repeat(40)]
    ])('rejects current evidence with inconsistent %s identity', (field, value) => {
        expect(() => verify({
            ...validCurrentEvidence(),
            [field]: value
        })).toThrow(/does not match the expected deployment/);
    });

    it.each([
        ['quota metadata', { quotaPressure: true }],
        ['retry metadata', { retryAttempt: 2 }],
        ['updated metadata', { updatedFunctions: ['sendNotification'] }],
        ['unchanged metadata', { unchangedFunctions: ['sendNotification'] }],
        ['Hosting metadata', { hostingRelease: 'sites/game-flow-c6311/releases/1' }]
    ])('rejects unsupported %s fields', (_label, extra) => {
        expect(() => verify({ ...validCurrentEvidence(), ...extra }))
            .toThrow(/fields must exactly match/);
    });

    it.each([
        ['missing expected deployment', undefined],
        ['malformed expected deployment', []],
        ['unsupported expected target', {
            ...expectedDeployment,
            deployTargets: 'functions'
        }],
        ['invalid expected artifact SHA', {
            ...expectedDeployment,
            artifactSha: 'a'.repeat(39)
        }]
    ])('rejects %s', (_label, expected) => {
        expect(() => verify(validCurrentEvidence(), expected)).toThrow();
    });
});

describe('individual Firebase function explicitly updated evidence', () => {
    const supportedTargets = [
        expectedFunctionDeployment,
        {
            ...expectedFunctionDeployment,
            functionTarget: 'sendTeamEmail',
            deploymentId: 'projects/game-flow-c6311/locations/us-central1/functions/sendTeamEmail/versions/7'
        }
    ];

    it.each(supportedTargets)(
        'accepts explicit updated evidence for $functionTarget',
        (expected) => {
            expect(verifyFunction(validFunctionUpdatedEvidence(expected), expected)).toEqual({
                status: 'updated',
                targetType: FIREBASE_FUNCTION_TARGET_TYPE,
                projectId: expected.projectId,
                functionTarget: expected.functionTarget,
                artifactSha: expected.artifactSha,
                deploymentId: expected.deploymentId
            });
        }
    );

    it('rejects every missing updated-evidence field', () => {
        for (const field of Object.keys(validFunctionUpdatedEvidence())) {
            const evidence = validFunctionUpdatedEvidence();
            delete evidence[field];

            expect(() => verifyFunction(evidence), `missing ${field}`)
                .toThrow(/fields must exactly match/);
        }
    });

    it.each([
        ['schemaVersion', '1'],
        ['targetType', 1],
        ['status', true],
        ['projectId', ''],
        ['functionTarget', ''],
        ['artifactSha', 'not-a-sha'],
        ['deploymentId', '']
    ])('rejects malformed updated %s evidence', (field, value) => {
        expect(() => verifyFunction({
            ...validFunctionUpdatedEvidence(),
            [field]: value
        })).toThrow();
    });

    it.each([
        ['schema version', { schemaVersion: 2 }],
        ['Hosting target', { targetType: 'firebase-hosting' }],
        ['current state', { status: 'current' }],
        ['unchanged state', { status: 'unchanged' }],
        ['partial state', { status: 'partial' }],
        ['extra metadata', { retryAttempt: 2 }]
    ])('rejects unsupported updated-evidence %s', (_label, mutation) => {
        expect(() => verifyFunction({
            ...validFunctionUpdatedEvidence(),
            ...mutation
        })).toThrow();
    });

    it.each([
        ['projectId', 'another-project'],
        ['functionTarget', 'sendTeamEmail'],
        ['artifactSha', 'b'.repeat(40)],
        ['deploymentId', 'another-deployment']
    ])('rejects updated evidence with mismatched %s', (field, value) => {
        expect(() => verifyFunction({
            ...validFunctionUpdatedEvidence(),
            [field]: value
        })).toThrow(/does not match the expected deployment/);
    });
});

describe('individual Firebase function current evidence', () => {
    it('accepts evidence identifying the expected current artifact commit', () => {
        expect(verifyFunction(validFunctionArtifactEvidence())).toEqual({
            status: 'current',
            targetType: FIREBASE_FUNCTION_TARGET_TYPE,
            projectId: expectedFunctionDeployment.projectId,
            functionTarget: expectedFunctionDeployment.functionTarget,
            artifactSha
        });
    });

    it('accepts evidence identifying the expected current deployment identity', () => {
        expect(verifyFunction(validFunctionDeploymentEvidence())).toEqual({
            status: 'current',
            targetType: FIREBASE_FUNCTION_TARGET_TYPE,
            projectId: expectedFunctionDeployment.projectId,
            functionTarget: expectedFunctionDeployment.functionTarget,
            deploymentId: expectedFunctionDeployment.deploymentId
        });
    });

    it.each([
        ['undefined', undefined],
        ['null', null],
        ['array', []],
        ['string', 'current']
    ])('rejects %s individual function evidence', (_label, evidence) => {
        expect(() => verifyFunction(evidence)).toThrow(/evidence must be a plain object/);
    });

    it.each([
        ['artifact shape', validFunctionArtifactEvidence],
        ['deployment identity shape', validFunctionDeploymentEvidence]
    ])('rejects every missing field in the %s', (_label, buildEvidence) => {
        for (const field of Object.keys(buildEvidence())) {
            const evidence = buildEvidence();
            delete evidence[field];

            expect(() => verifyFunction(evidence), `missing ${field}`)
                .toThrow(/fields must exactly match/);
        }
    });

    it.each([
        ['schemaVersion', '1', validFunctionArtifactEvidence],
        ['targetType', 1, validFunctionArtifactEvidence],
        ['status', true, validFunctionArtifactEvidence],
        ['projectId', '', validFunctionArtifactEvidence],
        ['functionTarget', '', validFunctionArtifactEvidence],
        ['artifactSha', 'not-a-sha', validFunctionArtifactEvidence],
        ['deploymentId', '', validFunctionDeploymentEvidence]
    ])('rejects malformed %s evidence', (field, value, buildEvidence) => {
        expect(() => verifyFunction({ ...buildEvidence(), [field]: value })).toThrow();
    });

    it.each([
        ['schema version', validFunctionArtifactEvidence, { schemaVersion: 2 }],
        ['Hosting target', validFunctionArtifactEvidence, { targetType: 'firebase-hosting' }],
        ['updated state', validFunctionArtifactEvidence, { status: 'updated' }],
        ['unchanged state', validFunctionArtifactEvidence, { status: 'unchanged' }],
        ['partial state', validFunctionArtifactEvidence, { status: 'partial' }],
        ['extra metadata', validFunctionArtifactEvidence, { quotaPressure: true }],
        ['mixed identities', validFunctionArtifactEvidence, {
            deploymentId: expectedFunctionDeployment.deploymentId
        }]
    ])('rejects unsupported %s', (_label, buildEvidence, mutation) => {
        expect(() => verifyFunction({ ...buildEvidence(), ...mutation })).toThrow();
    });

    it.each([
        ['projectId', 'another-project', validFunctionArtifactEvidence],
        ['functionTarget', 'sendTeamEmail', validFunctionArtifactEvidence],
        ['artifactSha', 'b'.repeat(40), validFunctionArtifactEvidence],
        ['deploymentId', 'another-deployment', validFunctionDeploymentEvidence]
    ])('rejects current evidence with mismatched %s', (field, value, buildEvidence) => {
        expect(() => verifyFunction({ ...buildEvidence(), [field]: value }))
            .toThrow(/does not match the expected deployment/);
    });
});
