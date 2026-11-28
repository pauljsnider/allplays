import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import {
    FIREBASE_APPLICATION_EVIDENCE_SCHEMA_VERSION,
    FIREBASE_FUNCTION_TARGET_TYPE,
    verifyFirebaseApplicationDeployment
} from './verify-firebase-application-deployment.mjs';

const ANSI_ESCAPE_PATTERN = /\x1b\[[0-?]*[ -\/]*[@-~]/g;
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const PROJECT_ID_PATTERN = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const FUNCTION_TARGET_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;

function fail(message) {
    throw new Error(`Firebase Functions deploy log evidence is invalid: ${message}`);
}

function parseTargets(value) {
    if (typeof value !== 'string' || value.length === 0) {
        fail('targets must be a non-empty comma-separated string.');
    }
    const targets = value.split(',').map((entry) => {
        const match = /^functions:([A-Za-z][A-Za-z0-9_]*)$/.exec(entry);
        if (!match) {
            fail(`unsupported target ${entry}.`);
        }
        return match[1];
    });
    if (new Set(targets).size !== targets.length) {
        fail('targets must not contain duplicates.');
    }
    return targets;
}

export function verifyFirebaseFunctionsDeployLog({
    deployLog,
    targets,
    artifactSha,
    projectId
}) {
    if (typeof deployLog !== 'string') {
        fail('deployLog must be a string.');
    }
    if (!SHA_PATTERN.test(artifactSha)) {
        fail('artifactSha must be a full lowercase Git commit SHA.');
    }
    if (!PROJECT_ID_PATTERN.test(projectId)) {
        fail('projectId must be a valid Firebase project ID.');
    }

    const intendedTargets = parseTargets(targets);
    const expectedByTarget = new Map(intendedTargets.map((functionTarget) => [
        functionTarget,
        {
            projectId,
            functionTarget,
            artifactSha,
            deploymentId: `firebase-cli-result:${functionTarget}`
        }
    ]));
    const evidence = [];
    const normalizedLog = deployLog.replace(ANSI_ESCAPE_PATTERN, '');
    const resultPattern = /^.*functions\[([A-Za-z][A-Za-z0-9_]*)\([^\]\r\n]+\)\]\s+(Successful (?:create|update) operation\.|Skipped \(No changes detected\))\s*$/gm;

    for (const match of normalizedLog.matchAll(resultPattern)) {
        const functionTarget = match[1];
        const expected = expectedByTarget.get(functionTarget);
        if (!expected) {
            continue;
        }
        evidence.push({
            schemaVersion: FIREBASE_APPLICATION_EVIDENCE_SCHEMA_VERSION,
            targetType: FIREBASE_FUNCTION_TARGET_TYPE,
            status: match[2].startsWith('Successful') ? 'updated' : 'unchanged',
            ...expected
        });
    }

    return verifyFirebaseApplicationDeployment({
        evidence,
        expectedDeployment: intendedTargets.map((target) => expectedByTarget.get(target))
    });
}

function parseArguments(argv) {
    const values = {};
    for (let index = 0; index < argv.length; index += 2) {
        const name = argv[index];
        const value = argv[index + 1];
        if (!name?.startsWith('--') || value === undefined) {
            fail('arguments must be provided as --name value pairs.');
        }
        values[name.slice(2)] = value;
    }
    return values;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    const args = parseArguments(process.argv.slice(2));
    const verified = verifyFirebaseFunctionsDeployLog({
        deployLog: readFileSync(args['deploy-log'], 'utf8'),
        targets: args.targets,
        artifactSha: args['artifact-sha'],
        projectId: args['project-id']
    });
    process.stdout.write(`${JSON.stringify(verified)}\n`);
}
