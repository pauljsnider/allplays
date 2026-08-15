import { describe, expect, it } from 'vitest';

import {
    selectNoopReleaseBaseline,
    selectLatestSuccessfulArtifact,
    verifyProductionReleaseProvenance
} from '../../scripts/verify-production-release-provenance.mjs';

const releaseSha = 'a'.repeat(40);
const artifactSha = 'b'.repeat(40);

function deployment(id, environment, sha, payload = {}) {
    return { id, environment, sha, ref: sha, payload };
}

function artifactDeployment(id, sha) {
    return deployment(id, 'production-artifact', sha, {
        release_kind: 'deploy',
        artifact_sha: sha
    });
}

describe('production release provenance', () => {
    it('selects the newest successful artifact and ignores incomplete markers', () => {
        const deployments = [
            deployment(3, 'production-artifact', 'c'.repeat(40)),
            artifactDeployment(2, artifactSha),
            artifactDeployment(1, 'd'.repeat(40))
        ];
        expect(selectLatestSuccessfulArtifact(deployments, {
            3: [{ state: 'success' }],
            2: [{ state: 'success' }],
            1: [{ state: 'success' }]
        })).toEqual({ deploymentId: 2, artifactSha });
    });

    it('permits a no-op only when the latest prior production run proves the current artifact', () => {
        expect(selectNoopReleaseBaseline({
            repository: 'pauljsnider/allplays',
            currentRunId: 200,
            workflowRuns: { workflow_runs: [{
                id: 199,
                status: 'completed',
                conclusion: 'success',
                head_sha: releaseSha
            }] },
            releaseDeployments: [deployment(10, 'production-release', releaseSha, {
                release_kind: 'no-op',
                artifact_sha: artifactSha,
                validated_head_sha: 'c'.repeat(40)
            })],
            artifactDeployments: [artifactDeployment(9, artifactSha)],
            statusesByDeployment: {
                10: [{
                    state: 'success',
                    log_url: 'https://github.com/pauljsnider/allplays/actions/runs/199'
                }],
                9: [{ state: 'success' }]
            }
        })).toEqual({ deploymentId: 9, artifactSha });
    });

    it('blocks a no-op after the latest prior production run failed', () => {
        expect(() => selectNoopReleaseBaseline({
            repository: 'pauljsnider/allplays',
            currentRunId: 200,
            workflowRuns: { workflow_runs: [{
                id: 199,
                status: 'completed',
                conclusion: 'failure',
                head_sha: releaseSha
            }] },
            releaseDeployments: [],
            artifactDeployments: [artifactDeployment(9, artifactSha)],
            statusesByDeployment: { 9: [{ state: 'success' }] }
        })).toThrow('latest prior production run did not complete successfully');
    });

    it('verifies a typed no-op release against its prior successful artifact', () => {
        expect(verifyProductionReleaseProvenance({
            releaseSha,
            releaseDeployments: [deployment(10, 'production-release', releaseSha, {
                release_kind: 'no-op',
                artifact_sha: artifactSha,
                validated_head_sha: 'c'.repeat(40)
            })],
            artifactDeployments: [artifactDeployment(9, artifactSha)],
            statusesByDeployment: {
                10: [{ state: 'success' }],
                9: [{ state: 'success' }]
            }
        })).toMatchObject({ releaseKind: 'no-op', releaseSha, artifactSha });
    });

    it.each([
        ['missing typed payload', {}, artifactSha],
        ['self-referential no-op', { release_kind: 'no-op', artifact_sha: releaseSha }, artifactSha],
        ['mismatched deploy artifact', { release_kind: 'deploy', artifact_sha: artifactSha }, artifactSha]
    ])('rejects %s', (_label, payload, markedArtifactSha) => {
        expect(() => verifyProductionReleaseProvenance({
            releaseSha,
            releaseDeployments: [deployment(10, 'production-release', releaseSha, payload)],
            artifactDeployments: [artifactDeployment(9, markedArtifactSha)],
            statusesByDeployment: {
                10: [{ state: 'success' }],
                9: [{ state: 'success' }]
            }
        })).toThrow();
    });

    it('rejects an artifact marker whose latest status is not successful', () => {
        expect(() => verifyProductionReleaseProvenance({
            releaseSha,
            releaseDeployments: [deployment(10, 'production-release', releaseSha, {
                release_kind: 'no-op',
                artifact_sha: artifactSha,
                validated_head_sha: 'c'.repeat(40)
            })],
            artifactDeployments: [artifactDeployment(9, artifactSha)],
            statusesByDeployment: {
                10: [{ state: 'success' }],
                9: [{ state: 'inactive' }, { state: 'success' }]
            }
        })).toThrow('lacks a successful');
    });

    it('rejects no-op evidence without a validated head or typed artifact marker', () => {
        const releaseDeployments = [deployment(10, 'production-release', releaseSha, {
            release_kind: 'no-op',
            artifact_sha: artifactSha
        })];
        expect(() => verifyProductionReleaseProvenance({
            releaseSha,
            releaseDeployments,
            artifactDeployments: [artifactDeployment(9, artifactSha)],
            statusesByDeployment: {
                10: [{ state: 'success' }],
                9: [{ state: 'success' }]
            }
        })).toThrow('validated pull-request head');

        releaseDeployments[0].payload.validated_head_sha = 'c'.repeat(40);
        expect(() => verifyProductionReleaseProvenance({
            releaseSha,
            releaseDeployments,
            artifactDeployments: [deployment(9, 'production-artifact', artifactSha)],
            statusesByDeployment: {
                10: [{ state: 'success' }],
                9: [{ state: 'success' }]
            }
        })).toThrow('lacks a successful');
    });
});
