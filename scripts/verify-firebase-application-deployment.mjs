export const FIREBASE_APPLICATION_EVIDENCE_SCHEMA_VERSION = 1;
export const FIREBASE_APPLICATION_FUNCTIONS_TARGET_TYPE = 'firebase-application-functions';
export const FIREBASE_FUNCTION_TARGET_TYPE = 'firebase-function';
export const FIREBASE_APPLICATION_DEPLOY_TARGETS = 'hosting,functions';
export const FIREBASE_APPLICATION_DEPLOY_LABEL = 'application';

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const PROJECT_ID_PATTERN = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const EXPECTED_APPLICATION_DEPLOYMENT_FIELDS = Object.freeze([
    'artifactSha',
    'deployLabel',
    'deployTargets',
    'projectId'
]);
const EXPECTED_FUNCTION_DEPLOYMENT_FIELDS = Object.freeze([
    'artifactSha',
    'deploymentId',
    'functionTarget',
    'projectId'
]);
const APPLICATION_EVIDENCE_FIELDS = Object.freeze([
    'artifactSha',
    'deployLabel',
    'deployTargets',
    'projectId',
    'schemaVersion',
    'status',
    'targetType'
]);
const FUNCTION_ARTIFACT_EVIDENCE_FIELDS = Object.freeze([
    'artifactSha',
    'functionTarget',
    'projectId',
    'schemaVersion',
    'status',
    'targetType'
]);
const FUNCTION_DEPLOYMENT_EVIDENCE_FIELDS = Object.freeze([
    'deploymentId',
    'functionTarget',
    'projectId',
    'schemaVersion',
    'status',
    'targetType'
]);
const FUNCTION_UPDATED_EVIDENCE_FIELDS = Object.freeze([
    'artifactSha',
    'deploymentId',
    'functionTarget',
    'projectId',
    'schemaVersion',
    'status',
    'targetType'
]);

function fail(message) {
    throw new Error(`Firebase application deployment evidence is invalid: ${message}`);
}

function isPlainObject(value) {
    return value !== null
        && typeof value === 'object'
        && !Array.isArray(value)
        && Object.getPrototypeOf(value) === Object.prototype;
}

function requirePlainObject(value, label) {
    if (!isPlainObject(value)) {
        fail(`${label} must be a plain object.`);
    }
}

function hasExactFields(value, expectedFields) {
    const actualFields = Object.keys(value).sort();
    const sortedExpectedFields = [...expectedFields].sort();
    return actualFields.length === sortedExpectedFields.length
        && actualFields.every((field, index) => field === sortedExpectedFields[index]);
}

function requireExactFields(value, expectedFields, label) {
    if (!hasExactFields(value, expectedFields)) {
        const sortedExpectedFields = [...expectedFields].sort();
        fail(`${label} fields must exactly match: ${sortedExpectedFields.join(', ')}.`);
    }
}

function requireNonEmptyString(value, label) {
    if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
        fail(`${label} must be a non-empty exact string.`);
    }
    return value;
}

function requireProjectId(value, label) {
    const projectId = requireNonEmptyString(value, label);
    if (!PROJECT_ID_PATTERN.test(projectId)) {
        fail(`${label} must be a valid Firebase project ID.`);
    }
    return projectId;
}

function requireArtifactSha(value, label) {
    if (typeof value !== 'string' || !SHA_PATTERN.test(value)) {
        fail(`${label} must be a full lowercase Git commit SHA.`);
    }
    return value;
}

function validateExpectedApplicationDeployment(expectedDeployment) {
    requirePlainObject(expectedDeployment, 'expected deployment');
    requireExactFields(
        expectedDeployment,
        EXPECTED_APPLICATION_DEPLOYMENT_FIELDS,
        'expected deployment'
    );

    const projectId = requireProjectId(
        expectedDeployment.projectId,
        'expected deployment projectId'
    );
    const artifactSha = requireArtifactSha(
        expectedDeployment.artifactSha,
        'expected deployment artifactSha'
    );
    if (expectedDeployment.deployTargets !== FIREBASE_APPLICATION_DEPLOY_TARGETS) {
        fail(
            `expected deployment deployTargets must be ${FIREBASE_APPLICATION_DEPLOY_TARGETS}.`
        );
    }
    if (expectedDeployment.deployLabel !== FIREBASE_APPLICATION_DEPLOY_LABEL) {
        fail(
            `expected deployment deployLabel must be ${FIREBASE_APPLICATION_DEPLOY_LABEL}.`
        );
    }

    return {
        projectId,
        deployTargets: expectedDeployment.deployTargets,
        deployLabel: expectedDeployment.deployLabel,
        artifactSha
    };
}

function validateExpectedFunctionDeployment(expectedDeployment) {
    requirePlainObject(expectedDeployment, 'expected deployment');
    requireExactFields(
        expectedDeployment,
        EXPECTED_FUNCTION_DEPLOYMENT_FIELDS,
        'expected deployment'
    );

    return {
        projectId: requireProjectId(
            expectedDeployment.projectId,
            'expected deployment projectId'
        ),
        functionTarget: requireNonEmptyString(
            expectedDeployment.functionTarget,
            'expected deployment functionTarget'
        ),
        artifactSha: requireArtifactSha(
            expectedDeployment.artifactSha,
            'expected deployment artifactSha'
        ),
        deploymentId: requireNonEmptyString(
            expectedDeployment.deploymentId,
            'expected deployment deploymentId'
        )
    };
}

function requireMatchingIdentity(evidence, expectedDeployment, field) {
    if (evidence[field] !== expectedDeployment[field]) {
        fail(`evidence ${field} does not match the expected deployment.`);
    }
}

function validateEvidenceEnvelope(evidence, expectedTargetType, expectedStatus) {
    if (evidence.schemaVersion !== FIREBASE_APPLICATION_EVIDENCE_SCHEMA_VERSION) {
        fail(
            `schemaVersion must be ${FIREBASE_APPLICATION_EVIDENCE_SCHEMA_VERSION}.`
        );
    }
    if (evidence.targetType !== expectedTargetType) {
        fail(`targetType must be ${expectedTargetType}.`);
    }
    if (evidence.status !== expectedStatus) {
        fail(`status must be ${expectedStatus}.`);
    }
}

function verifyApplicationDeployment(evidence, expectedDeployment) {
    const expected = validateExpectedApplicationDeployment(expectedDeployment);

    requirePlainObject(evidence, 'evidence');
    requireExactFields(evidence, APPLICATION_EVIDENCE_FIELDS, 'evidence');
    validateEvidenceEnvelope(
        evidence,
        FIREBASE_APPLICATION_FUNCTIONS_TARGET_TYPE,
        'current'
    );

    requireProjectId(evidence.projectId, 'evidence projectId');
    requireNonEmptyString(evidence.deployTargets, 'evidence deployTargets');
    requireNonEmptyString(evidence.deployLabel, 'evidence deployLabel');
    requireArtifactSha(evidence.artifactSha, 'evidence artifactSha');

    for (const field of EXPECTED_APPLICATION_DEPLOYMENT_FIELDS) {
        requireMatchingIdentity(evidence, expected, field);
    }

    return Object.freeze({
        status: evidence.status,
        targetType: evidence.targetType,
        projectId: evidence.projectId,
        deployTargets: evidence.deployTargets,
        deployLabel: evidence.deployLabel,
        artifactSha: evidence.artifactSha
    });
}

function verifyFunctionDeployment(evidence, expectedDeployment) {
    const expected = validateExpectedFunctionDeployment(expectedDeployment);

    requirePlainObject(evidence, 'evidence');
    const hasArtifactIdentity = hasExactFields(
        evidence,
        FUNCTION_ARTIFACT_EVIDENCE_FIELDS
    );
    const hasDeploymentIdentity = hasExactFields(
        evidence,
        FUNCTION_DEPLOYMENT_EVIDENCE_FIELDS
    );
    const hasUpdatedIdentity = hasExactFields(
        evidence,
        FUNCTION_UPDATED_EVIDENCE_FIELDS
    );
    if (
        (evidence.status === 'updated' && !hasUpdatedIdentity)
        || (
            evidence.status !== 'updated'
            && !hasArtifactIdentity
            && !hasDeploymentIdentity
        )
    ) {
        fail(
            'evidence fields must exactly match a supported individual function evidence shape.'
        );
    }

    const expectedStatus = hasUpdatedIdentity ? 'updated' : 'current';
    validateEvidenceEnvelope(evidence, FIREBASE_FUNCTION_TARGET_TYPE, expectedStatus);
    requireProjectId(evidence.projectId, 'evidence projectId');
    requireNonEmptyString(evidence.functionTarget, 'evidence functionTarget');
    requireMatchingIdentity(evidence, expected, 'projectId');
    requireMatchingIdentity(evidence, expected, 'functionTarget');

    if (hasUpdatedIdentity) {
        requireArtifactSha(evidence.artifactSha, 'evidence artifactSha');
        requireNonEmptyString(evidence.deploymentId, 'evidence deploymentId');
        requireMatchingIdentity(evidence, expected, 'artifactSha');
        requireMatchingIdentity(evidence, expected, 'deploymentId');

        return Object.freeze({
            status: evidence.status,
            targetType: evidence.targetType,
            projectId: evidence.projectId,
            functionTarget: evidence.functionTarget,
            artifactSha: evidence.artifactSha,
            deploymentId: evidence.deploymentId
        });
    }

    const identityField = hasArtifactIdentity ? 'artifactSha' : 'deploymentId';
    if (identityField === 'artifactSha') {
        requireArtifactSha(evidence.artifactSha, 'evidence artifactSha');
    } else {
        requireNonEmptyString(evidence.deploymentId, 'evidence deploymentId');
    }
    requireMatchingIdentity(evidence, expected, identityField);

    return Object.freeze({
        status: evidence.status,
        targetType: evidence.targetType,
        projectId: evidence.projectId,
        functionTarget: evidence.functionTarget,
        [identityField]: evidence[identityField]
    });
}

function isFunctionDeploymentRequest(evidence, expectedDeployment) {
    return (
        isPlainObject(evidence)
        && evidence.targetType === FIREBASE_FUNCTION_TARGET_TYPE
    ) || (
        isPlainObject(expectedDeployment)
        && Object.prototype.hasOwnProperty.call(expectedDeployment, 'functionTarget')
    );
}

export function verifyFirebaseApplicationDeployment({
    evidence,
    expectedDeployment
}) {
    if (isFunctionDeploymentRequest(evidence, expectedDeployment)) {
        return verifyFunctionDeployment(evidence, expectedDeployment);
    }
    return verifyApplicationDeployment(evidence, expectedDeployment);
}
