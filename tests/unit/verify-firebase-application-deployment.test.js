import { describe, expect, it } from 'vitest';

import {
    FIREBASE_APPLICATION_DEPLOY_LABEL,
    FIREBASE_APPLICATION_DEPLOY_TARGETS,
    FIREBASE_APPLICATION_EVIDENCE_SCHEMA_VERSION,
    FIREBASE_APPLICATION_FUNCTIONS_TARGET_TYPE,
    verifyFirebaseApplicationDeployment
} from '../../scripts/verify-firebase-application-deployment.mjs';

const artifactSha = 'a'.repeat(40);
const expectedDeployment = Object.freeze({
    projectId: 'game-flow-c6311',
    deployTargets: FIREBASE_APPLICATION_DEPLOY_TARGETS,
    deployLabel: FIREBASE_APPLICATION_DEPLOY_LABEL,
    artifactSha
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
        ['individual function target', { targetType: 'firebase-function' }],
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
