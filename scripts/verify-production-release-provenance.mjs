import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const shaPattern = /^[0-9a-f]{40}$/;

function deploymentSha(deployment) {
    const candidate = String(deployment?.sha || deployment?.ref || '');
    return shaPattern.test(candidate) ? candidate : '';
}

function hasSuccessfulStatus(statusesByDeployment, deploymentId) {
    const statuses = statusesByDeployment?.[String(deploymentId)];
    return Array.isArray(statuses) && statuses[0]?.state === 'success';
}

function isTypedArtifactDeployment(deployment, sha) {
    const payload = deployment?.payload;
    return payload
        && typeof payload === 'object'
        && !Array.isArray(payload)
        && payload.release_kind === 'deploy'
        && payload.artifact_sha === sha;
}

export function selectLatestSuccessfulArtifact(deployments, statusesByDeployment) {
    if (!Array.isArray(deployments)) throw new Error('Production artifact deployments are unavailable.');
    for (const deployment of deployments) {
        if (deployment?.environment !== 'production-artifact') continue;
        const sha = deploymentSha(deployment);
        if (sha
            && isTypedArtifactDeployment(deployment, sha)
            && Number.isInteger(deployment?.id)
            && hasSuccessfulStatus(statusesByDeployment, deployment.id)) {
            return { deploymentId: deployment.id, artifactSha: sha };
        }
    }
    throw new Error('No successful production-artifact marker is available.');
}

export function verifyProductionReleaseProvenance({
    releaseSha,
    releaseDeployments,
    artifactDeployments,
    statusesByDeployment
}) {
    if (!shaPattern.test(String(releaseSha || ''))) throw new Error('Release SHA is invalid.');
    if (!Array.isArray(releaseDeployments)) throw new Error('Production release deployments are unavailable.');

    const release = releaseDeployments.find((deployment) => (
        deployment?.environment === 'production-release'
        && deploymentSha(deployment) === releaseSha
        && Number.isInteger(deployment?.id)
        && hasSuccessfulStatus(statusesByDeployment, deployment.id)
    ));
    if (!release) throw new Error('A successful exact-SHA production-release marker is unavailable.');

    const payload = release.payload && typeof release.payload === 'object' && !Array.isArray(release.payload)
        ? release.payload
        : {};
    const releaseKind = payload.release_kind;
    const artifactSha = String(payload.artifact_sha || '');
    if (!['deploy', 'no-op'].includes(releaseKind) || !shaPattern.test(artifactSha)) {
        throw new Error('Production release marker has invalid typed provenance.');
    }
    if (releaseKind === 'deploy' && artifactSha !== releaseSha) {
        throw new Error('Deployed release must bind its own SHA as the production artifact.');
    }
    if (releaseKind === 'no-op' && artifactSha === releaseSha) {
        throw new Error('No-op release must retain a prior production artifact SHA.');
    }
    const validatedHeadSha = String(payload.validated_head_sha || '');
    if (releaseKind === 'no-op' && !shaPattern.test(validatedHeadSha)) {
        throw new Error('No-op release must identify its validated pull-request head SHA.');
    }

    const artifact = (Array.isArray(artifactDeployments) ? artifactDeployments : []).find((deployment) => (
        deployment?.environment === 'production-artifact'
        && deploymentSha(deployment) === artifactSha
        && isTypedArtifactDeployment(deployment, artifactSha)
        && Number.isInteger(deployment?.id)
        && hasSuccessfulStatus(statusesByDeployment, deployment.id)
    ));
    if (!artifact) throw new Error('Release artifact SHA lacks a successful production-artifact marker.');

    return {
        releaseKind,
        releaseSha,
        artifactSha,
        validatedHeadSha: releaseKind === 'no-op' ? validatedHeadSha : null,
        releaseDeploymentId: release.id,
        artifactDeploymentId: artifact.id
    };
}

function parseArgs(values) {
    const args = {};
    for (let index = 0; index < values.length; index += 2) {
        const key = values[index];
        const value = values[index + 1];
        if (!key?.startsWith('--') || value === undefined) throw new Error(`Invalid argument ${key || ''}`.trim());
        args[key.slice(2)] = value;
    }
    return args;
}

function readJson(filePath) {
    return JSON.parse(readFileSync(filePath, 'utf8'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const args = parseArgs(process.argv.slice(2));
    let result;
    if (args.mode === 'latest-artifact') {
        result = selectLatestSuccessfulArtifact(
            readJson(args['artifact-deployments']),
            readJson(args.statuses)
        );
    } else if (args.mode === 'verify-release') {
        result = verifyProductionReleaseProvenance({
            releaseSha: args['release-sha'],
            releaseDeployments: readJson(args['release-deployments']),
            artifactDeployments: readJson(args['artifact-deployments']),
            statusesByDeployment: readJson(args.statuses)
        });
    } else {
        throw new Error('Mode must be latest-artifact or verify-release.');
    }
    process.stdout.write(`${JSON.stringify(result)}\n`);
}
