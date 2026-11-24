export const FIREBASE_APPLICATION_EVIDENCE_SCHEMA_VERSION = 1;
export const FIREBASE_APPLICATION_FUNCTIONS_TARGET_TYPE = 'firebase-application-functions';
export const FIREBASE_APPLICATION_DEPLOY_TARGETS = 'hosting,functions';
export const FIREBASE_APPLICATION_DEPLOY_LABEL = 'application';

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const PROJECT_ID_PATTERN = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const EXPECTED_DEPLOYMENT_FIELDS = Object.freeze([
    'artifactSha',
    'deployLabel',
    'deployTargets',
    'projectId'
]);
const EVIDENCE_FIELDS = Object.freeze([
    'artifactSha',
    'deployLabel',
    'deployTargets',
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

function requireExactFields(value, expectedFields, label) {
    const actualFields = Object.keys(value).sort();
    const sortedExpectedFields = [...expectedFields].sort();
    if (
        actualFields.length !== sortedExpectedFields.length
        || actualFields.some((field, index) => field !== sortedExpectedFields[index])
    ) {
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

function validateExpectedDeployment(expectedDeployment) {
    requirePlainObject(expectedDeployment, 'expected deployment');
    requireExactFields(
        expectedDeployment,
        EXPECTED_DEPLOYMENT_FIELDS,
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

function requireMatchingIdentity(evidence, expectedDeployment, field) {
    if (evidence[field] !== expectedDeployment[field]) {
        fail(`evidence ${field} does not match the expected deployment.`);
    }
}

export function verifyFirebaseApplicationDeployment({
    evidence,
    expectedDeployment
}) {
    const expected = validateExpectedDeployment(expectedDeployment);

    requirePlainObject(evidence, 'evidence');
    requireExactFields(evidence, EVIDENCE_FIELDS, 'evidence');

    if (evidence.schemaVersion !== FIREBASE_APPLICATION_EVIDENCE_SCHEMA_VERSION) {
        fail(
            `schemaVersion must be ${FIREBASE_APPLICATION_EVIDENCE_SCHEMA_VERSION}.`
        );
    }
    if (evidence.targetType !== FIREBASE_APPLICATION_FUNCTIONS_TARGET_TYPE) {
        fail(`targetType must be ${FIREBASE_APPLICATION_FUNCTIONS_TARGET_TYPE}.`);
    }
    if (evidence.status !== 'current') {
        fail('status must be current.');
    }

    requireProjectId(evidence.projectId, 'evidence projectId');
    requireNonEmptyString(evidence.deployTargets, 'evidence deployTargets');
    requireNonEmptyString(evidence.deployLabel, 'evidence deployLabel');
    requireArtifactSha(evidence.artifactSha, 'evidence artifactSha');

    for (const field of EXPECTED_DEPLOYMENT_FIELDS) {
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
