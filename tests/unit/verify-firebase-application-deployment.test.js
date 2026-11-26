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

function validFunctionArtifactEvidence(expected = expectedFunctionDeployment) {
    return {
        schemaVersion: FIREBASE_APPLICATION_EVIDENCE_SCHEMA_VERSION,
        targetType: FIREBASE_FUNCTION_TARGET_TYPE,
        status: 'current',
        projectId: expected.projectId,
        functionTarget: expected.functionTarget,
        artifactSha: expected.artifactSha
    };
}

function validFunctionDeploymentEvidence(expected = expectedFunctionDeployment) {
    return {
        schemaVersion: FIREBASE_APPLICATION_EVIDENCE_SCHEMA_VERSION,
        targetType: FIREBASE_FUNCTION_TARGET_TYPE,
        status: 'current',
        projectId: expected.projectId,
        functionTarget: expected.functionTarget,
        deploymentId: expected.deploymentId
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

function validFunctionUnchangedEvidence(expected = expectedFunctionDeployment) {
    return {
        schemaVersion: FIREBASE_APPLICATION_EVIDENCE_SCHEMA_VERSION,
        targetType: FIREBASE_FUNCTION_TARGET_TYPE,
        status: 'unchanged',
        projectId: expected.projectId,
        functionTarget: expected.functionTarget,
        artifactSha: expected.artifactSha,
        deploymentId: expected.deploymentId
    };
}

function verifyFunction(evidence, expected = expectedFunctionDeployment) {
    return verifyFirebaseApplicationDeployment({ evidence, expectedDeployment: expected });
}

function verifyFunctions(evidence, expectedDeployment, previousEvidence) {
    return verifyFirebaseApplicationDeployment({
        evidence,
        expectedDeployment,
        previousEvidence
    });
}

function captureVerificationError(callback) {
    try {
        callback();
    } catch (error) {
        return error;
    }
    throw new Error('Expected Firebase application deployment verification to fail.');
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

describe('individual Firebase function explicitly unchanged evidence', () => {
    it('accepts evidence binding the intended artifact to the current deployment', () => {
        expect(verifyFunction(validFunctionUnchangedEvidence())).toEqual({
            status: 'unchanged',
            targetType: FIREBASE_FUNCTION_TARGET_TYPE,
            projectId: expectedFunctionDeployment.projectId,
            functionTarget: expectedFunctionDeployment.functionTarget,
            artifactSha: expectedFunctionDeployment.artifactSha,
            deploymentId: expectedFunctionDeployment.deploymentId
        });
    });

    it.each([
        ['artifact identity only', validFunctionArtifactEvidence],
        ['deployment identity only', validFunctionDeploymentEvidence]
    ])('rejects unsupported unchanged evidence with %s', (_label, buildEvidence) => {
        expect(() => verifyFunction({ ...buildEvidence(), status: 'unchanged' }))
            .toThrow(/supported individual function evidence shape/);
    });

    it.each([
        ['artifactSha', 'b'.repeat(40)],
        ['deploymentId', 'another-deployment']
    ])('rejects unchanged evidence with mismatched %s', (field, value) => {
        expect(() => verifyFunction({
            ...validFunctionUnchangedEvidence(),
            [field]: value
        })).toThrow(/does not match the expected deployment/);
    });
});

describe('aggregate Firebase function deployment evidence', () => {
    const expectedDeployments = [
        expectedFunctionDeployment,
        {
            ...expectedFunctionDeployment,
            functionTarget: 'sendTeamEmail',
            deploymentId: 'projects/game-flow-c6311/locations/us-central1/functions/sendTeamEmail/versions/7'
        },
        {
            ...expectedFunctionDeployment,
            functionTarget: 'syncTeamNotificationTargets',
            deploymentId: 'projects/game-flow-c6311/locations/us-central1/functions/syncTeamNotificationTargets/versions/9'
        }
    ];

    function mixedAuthoritativeEvidence() {
        return [
            validFunctionUnchangedEvidence(expectedDeployments[2]),
            validFunctionUnchangedEvidence(expectedDeployments[0]),
            validFunctionUpdatedEvidence(expectedDeployments[1])
        ];
    }

    it('accepts mixed authoritative evidence for every intended target', () => {
        expect(verifyFunctions(
            mixedAuthoritativeEvidence(),
            expectedDeployments
        )).toEqual([
            {
                status: 'unchanged',
                targetType: FIREBASE_FUNCTION_TARGET_TYPE,
                projectId: expectedDeployments[0].projectId,
                functionTarget: expectedDeployments[0].functionTarget,
                artifactSha,
                deploymentId: expectedDeployments[0].deploymentId
            },
            {
                status: 'updated',
                targetType: FIREBASE_FUNCTION_TARGET_TYPE,
                projectId: expectedDeployments[1].projectId,
                functionTarget: expectedDeployments[1].functionTarget,
                artifactSha,
                deploymentId: expectedDeployments[1].deploymentId
            },
            {
                status: 'unchanged',
                targetType: FIREBASE_FUNCTION_TARGET_TYPE,
                projectId: expectedDeployments[2].projectId,
                functionTarget: expectedDeployments[2].functionTarget,
                artifactSha,
                deploymentId: expectedDeployments[2].deploymentId
            }
        ]);
    });

    it('preserves complete target evidence when retrying the same exact artifact', () => {
        const previousEvidence = mixedAuthoritativeEvidence();
        const previousResult = verifyFunctions(previousEvidence, expectedDeployments);
        const retryEvidence = expectedDeployments.map(validFunctionUnchangedEvidence);

        expect(verifyFunctions(
            retryEvidence,
            expectedDeployments,
            previousEvidence
        )).toEqual(previousResult);
        expect(verifyFunctions(
            retryEvidence,
            expectedDeployments,
            previousEvidence
        )).toEqual(previousResult);
    });

    it('rejects terminal retry evidence from a different artifact', () => {
        const previousEvidence = mixedAuthoritativeEvidence();
        const retryEvidence = expectedDeployments.map(validFunctionUnchangedEvidence);
        retryEvidence[1] = {
            ...retryEvidence[1],
            artifactSha: 'b'.repeat(40)
        };

        expect(() => verifyFunctions(
            retryEvidence,
            expectedDeployments,
            previousEvidence
        )).toThrow(/artifactSha does not match the expected deployment/);
    });

    it('keeps a partial quota retry incomplete without new authoritative evidence', () => {
        const partialEvidence = [
            validFunctionUpdatedEvidence(expectedDeployments[0]),
            validFunctionUnchangedEvidence(expectedDeployments[2])
        ];
        const firstError = captureVerificationError(
            () => verifyFunctions(partialEvidence, expectedDeployments)
        );
        const retryError = captureVerificationError(
            () => verifyFunctions(
                [],
                expectedDeployments,
                partialEvidence
            )
        );

        expect(retryError).toMatchObject({
            code: firstError.code,
            metadata: firstError.metadata
        });
        expect(retryError.metadata).toEqual({
            incompleteTargets: ['sendTeamEmail']
        });
    });

    it('fills a partial retry gap only with new authoritative target evidence', () => {
        const previousEvidence = [
            validFunctionUpdatedEvidence(expectedDeployments[0]),
            validFunctionUnchangedEvidence(expectedDeployments[2])
        ];
        const identityOnlyRetry = [
            validFunctionArtifactEvidence(expectedDeployments[1])
        ];

        const incompleteError = captureVerificationError(
            () => verifyFunctions(
                identityOnlyRetry,
                expectedDeployments,
                previousEvidence
            )
        );
        expect(incompleteError.metadata).toEqual({
            incompleteTargets: ['sendTeamEmail']
        });

        expect(verifyFunctions(
            [validFunctionUpdatedEvidence(expectedDeployments[1])],
            expectedDeployments,
            previousEvidence
        )).toEqual([
            verifyFunction(
                validFunctionUpdatedEvidence(expectedDeployments[0]),
                expectedDeployments[0]
            ),
            verifyFunction(
                validFunctionUpdatedEvidence(expectedDeployments[1]),
                expectedDeployments[1]
            ),
            verifyFunction(
                validFunctionUnchangedEvidence(expectedDeployments[2]),
                expectedDeployments[2]
            )
        ]);
    });

    it('rejects identity-only evidence as an incomplete deployment target', () => {
        const evidence = mixedAuthoritativeEvidence();
        evidence[1] = validFunctionArtifactEvidence(expectedDeployments[0]);

        const error = captureVerificationError(
            () => verifyFunctions(evidence, expectedDeployments)
        );

        expect(error).toMatchObject({
            code: 'firebase-functions-incomplete-targets',
            metadata: {
                incompleteTargets: ['sendNotification']
            }
        });
    });

    it('rejects a quota-pressure partial deployment and records only safe metadata', () => {
        const evidence = [
            validFunctionUpdatedEvidence(expectedDeployments[0]),
            validFunctionUnchangedEvidence(expectedDeployments[2])
        ];

        const error = captureVerificationError(
            () => verifyFunctions(evidence, expectedDeployments)
        );

        expect(error).toMatchObject({
            code: 'firebase-functions-incomplete-targets',
            metadata: {
                incompleteTargets: ['sendTeamEmail']
            }
        });
        expect(Object.keys(error.metadata)).toEqual(['incompleteTargets']);

        const serializedMetadata = JSON.stringify(error.metadata);
        expect(serializedMetadata).not.toContain(expectedDeployments[0].projectId);
        expect(serializedMetadata).not.toContain(artifactSha);
        expect(serializedMetadata).not.toContain(expectedDeployments[1].deploymentId);
        expect(serializedMetadata).not.toMatch(/projectId|artifactSha|deploymentId|credential/i);
    });

    it('rejects duplicate evidence for one intended target', () => {
        const evidence = mixedAuthoritativeEvidence();
        evidence[2] = validFunctionDeploymentEvidence(expectedDeployments[0]);

        expect(() => verifyFunctions(evidence, expectedDeployments))
            .toThrow(/duplicate evidence for function target sendNotification/);
    });

    it('rejects evidence for an unexpected function target', () => {
        const unexpected = {
            ...expectedFunctionDeployment,
            functionTarget: 'unexpectedFunction',
            deploymentId: 'projects/game-flow-c6311/locations/us-central1/functions/unexpectedFunction/versions/1'
        };

        expect(() => verifyFunctions(
            [...mixedAuthoritativeEvidence(), validFunctionArtifactEvidence(unexpected)],
            expectedDeployments
        )).toThrow(/unexpected function target unexpectedFunction/);
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
