import { describe, expect, it } from 'vitest';

import {
    evaluateRecoveryWorkflowIdentity,
    EXPECTED_RECOVERY_REF,
    EXPECTED_RECOVERY_REPOSITORY,
    EXPECTED_RECOVERY_REPOSITORY_ID,
    EXPECTED_RECOVERY_REPOSITORY_OWNER_ID,
    EXPECTED_RECOVERY_WORKFLOW_REF,
    verifyRecoveryWorkflowIdentity
} from '../../scripts/verify-firestore-recovery-identity.mjs';

function healthyEnvironment() {
    return {
        FIREBASE_PROJECT_ID: 'game-flow-c6311',
        FIRESTORE_RECOVERY_WORKLOAD_IDENTITY_PROVIDER: 'projects/982493478258/locations/global/workloadIdentityPools/github-actions/providers/allplays-recovery',
        FIRESTORE_RECOVERY_SERVICE_ACCOUNT: 'allplays-firestore-recovery@game-flow-c6311.iam.gserviceaccount.com',
        GITHUB_REPOSITORY: EXPECTED_RECOVERY_REPOSITORY,
        GITHUB_REPOSITORY_ID: EXPECTED_RECOVERY_REPOSITORY_ID,
        GITHUB_REPOSITORY_OWNER_ID: EXPECTED_RECOVERY_REPOSITORY_OWNER_ID,
        GITHUB_REF: EXPECTED_RECOVERY_REF,
        GITHUB_WORKFLOW_REF: EXPECTED_RECOVERY_WORKFLOW_REF
    };
}

describe('Firestore recovery workflow identity preflight', () => {
    it('accepts only the exact configured keyless identity boundary', () => {
        expect(evaluateRecoveryWorkflowIdentity(healthyEnvironment())).toMatchObject({
            healthy: true,
            failures: [],
            projectId: 'game-flow-c6311',
            providerProjectNumber: '982493478258',
            repositoryId: '1106220007',
            repositoryOwnerId: '211066188',
            serviceAccount: 'allplays-firestore-recovery@game-flow-c6311.iam.gserviceaccount.com'
        });
    });

    it('fails closed and names every missing input', () => {
        expect(evaluateRecoveryWorkflowIdentity({})).toMatchObject({
            healthy: false,
            failures: expect.arrayContaining([
                'FIREBASE_PROJECT_ID is not configured.',
                'FIRESTORE_RECOVERY_WORKLOAD_IDENTITY_PROVIDER is not configured.',
                'FIRESTORE_RECOVERY_SERVICE_ACCOUNT is not configured.',
                'GITHUB_REPOSITORY is not configured.',
                'GITHUB_REPOSITORY_ID is not configured.',
                'GITHUB_REPOSITORY_OWNER_ID is not configured.',
                'GITHUB_REF is not configured.',
                'GITHUB_WORKFLOW_REF is not configured.'
            ])
        });
    });

    it.each([
        ['projects/not-a-number/locations/global/workloadIdentityPools/github-actions/providers/allplays-recovery'],
        ['projects/982493478258/locations/us/workloadIdentityPools/github-actions/providers/allplays-recovery'],
        ['projects/982493478258/locations/global/workloadIdentityPools/x/providers/allplays-recovery'],
        ['projects/982493478258/locations/global/workloadIdentityPools/github-actions/providers/../other']
    ])('rejects a non-canonical provider resource %s', (provider) => {
        const environment = healthyEnvironment();
        environment.FIRESTORE_RECOVERY_WORKLOAD_IDENTITY_PROVIDER = provider;
        expect(evaluateRecoveryWorkflowIdentity(environment).failures).toContain(
            'FIRESTORE_RECOVERY_WORKLOAD_IDENTITY_PROVIDER is not a canonical provider resource name.'
        );
    });

    it('rejects an invalid service-account email and a valid account from another project', () => {
        const invalid = healthyEnvironment();
        invalid.FIRESTORE_RECOVERY_SERVICE_ACCOUNT = 'not-an-account';
        expect(evaluateRecoveryWorkflowIdentity(invalid).failures).toContain(
            'FIRESTORE_RECOVERY_SERVICE_ACCOUNT is not a valid service-account email.'
        );

        const crossProject = healthyEnvironment();
        crossProject.FIRESTORE_RECOVERY_SERVICE_ACCOUNT = 'allplays-firestore-recovery@other-project.iam.gserviceaccount.com';
        expect(evaluateRecoveryWorkflowIdentity(crossProject).failures).toContain(
            'FIRESTORE_RECOVERY_SERVICE_ACCOUNT does not belong to FIREBASE_PROJECT_ID.'
        );
    });

    it('rejects canonical but unexpected project, provider, and same-project service account values', () => {
        const unexpectedProvider = healthyEnvironment();
        unexpectedProvider.FIRESTORE_RECOVERY_WORKLOAD_IDENTITY_PROVIDER = 'projects/999999999999/locations/global/workloadIdentityPools/github-actions/providers/allplays-recovery';
        expect(evaluateRecoveryWorkflowIdentity(unexpectedProvider).failures).toEqual([
            expect.stringMatching(/must be projects\/982493478258/)
        ]);

        const unexpectedAccount = healthyEnvironment();
        unexpectedAccount.FIRESTORE_RECOVERY_SERVICE_ACCOUNT = 'another-firestore-reader@game-flow-c6311.iam.gserviceaccount.com';
        expect(evaluateRecoveryWorkflowIdentity(unexpectedAccount).failures).toEqual([
            expect.stringMatching(/must be allplays-firestore-recovery@/)
        ]);

        const unexpectedProject = healthyEnvironment();
        unexpectedProject.FIREBASE_PROJECT_ID = 'another-project';
        unexpectedProject.FIRESTORE_RECOVERY_SERVICE_ACCOUNT = 'allplays-firestore-recovery@another-project.iam.gserviceaccount.com';
        expect(evaluateRecoveryWorkflowIdentity(unexpectedProject).failures).toEqual(expect.arrayContaining([
            expect.stringMatching(/SERVICE_ACCOUNT must be allplays-firestore-recovery@game-flow-c6311/),
            'FIREBASE_PROJECT_ID must be game-flow-c6311.'
        ]));
    });

    it.each([
        ['GITHUB_REPOSITORY', 'attacker/fork', /only in pauljsnider\/allplays/],
        ['GITHUB_REPOSITORY_ID', '999999999', /immutable repository ID 1106220007/],
        ['GITHUB_REPOSITORY_OWNER_ID', '999999999', /immutable repository-owner ID 211066188/],
        ['GITHUB_REF', 'refs/heads/feature', /only from refs\/heads\/master/],
        ['GITHUB_WORKFLOW_REF', 'pauljsnider/allplays/.github/workflows/other.yml@refs/heads/master', /must use pauljsnider\/allplays/]
    ])('rejects a mismatched %s claim', (name, value, message) => {
        const environment = healthyEnvironment();
        environment[name] = value;
        expect(evaluateRecoveryWorkflowIdentity(environment).failures).toEqual([
            expect.stringMatching(message)
        ]);
    });

    it('throws an actionable aggregate error instead of continuing to authentication', () => {
        expect(() => verifyRecoveryWorkflowIdentity({})).toThrow(/OIDC preflight failed:[\s\S]*production environment variables/);
    });
});
