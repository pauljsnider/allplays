import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    buildParentCoverageOutcome,
    buildSanitizedParentCoverageFailureError,
    CONTRACT_SCHEMA_VERSION,
    interpolateTemplate,
    redactParentCoverageValue,
    stableFailureSignature,
    validateCatalog,
    validateContract,
    workflowRouteAllowed
} from '../../scripts/parent-coverage-contract.mjs';

const catalog = JSON.parse(readFileSync('tests/parent-census/workflows.json', 'utf8'));

function validContract({ steps, ...overrides } = {}) {
    return {
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        workflowId: 'P01',
        title: catalog.workflows[0].title,
        actors: ['anonymous'],
        viewport: 'mobile',
        mutatesProduction: false,
        cleanupRequired: false,
        lifecycleTransition: false,
        steps: steps ? [...steps, {
            action: 'expectVisible',
            target: { kind: 'role', role: 'heading', name: 'Workflow outcome', exact: true }
        }] : [
            { action: 'goto', route: '/accept-invite' },
            {
                action: 'expectVisible',
                target: { kind: 'role', role: 'heading', name: 'Sign in', exact: true }
            }
        ],
        cleanupSteps: [],
        ...overrides
    };
}

describe('parent coverage contract boundary', () => {
    it('locks a unique ordered catalog of every initial parent workflow', () => {
        const validated = validateCatalog(catalog);
        expect(validated.workflows).toHaveLength(37);
        expect(new Set(validated.workflows.map(({ id }) => id)).size).toBe(37);
        expect(validated.workflows.at(0).id).toBe('P01');
        expect(validated.workflows.at(-1).id).toBe('P37');
    });

    it('accepts a safe app-relative declarative contract', () => {
        expect(validateContract(validContract(), catalog, 'P01').workflowId).toBe('P01');
    });

    it('rejects executable fields external routes and undeclared actors', () => {
        expect(() => validateContract({ ...validContract(), shell: 'env' }, catalog)).toThrow(/unsupported key shell/);
        expect(() => validateContract({
            ...validContract(),
            steps: [{ action: 'goto', route: 'https://attacker.example/' }]
        }, catalog)).toThrow(/safe text|app-relative route/);
        expect(() => validateContract({
            ...validContract(),
            steps: [{ action: 'login', actor: 'primary' }]
        }, catalog)).toThrow(/undeclared actor/);
    });

    it('requires bounded cleanup for every production mutation', () => {
        expect(() => validateContract({
            ...validContract({
                workflowId: 'P12',
                title: catalog.workflows[11].title,
                actors: ['primary'],
                steps: [{ action: 'goto', actor: 'primary', route: '/profile/settings' }]
            }),
            mutatesProduction: true,
            cleanupRequired: true,
            cleanupSteps: []
        }, catalog)).toThrow(/must provide cleanupSteps/);
        expect(() => validateContract({
            ...validContract(),
            cleanupSteps: [{ action: 'goto', route: '/home' }]
        }, catalog)).toThrow(/read-only contracts cannot provide cleanupSteps/);
    });

    it('enforces trusted per-workflow actions routes and cleanup capabilities', () => {
        expect(() => validateContract({
            ...validContract(),
            steps: [{ action: 'click', target: { kind: 'role', role: 'button', name: 'Delete account' } }]
        }, catalog, 'P01')).toThrow(/action click is not allowed for P01/);
        expect(() => validateContract({
            ...validContract(),
            steps: [{ action: 'goto', route: '/profile/settings' }]
        }, catalog, 'P01')).toThrow(/outside the trusted P01 capability/);

        const reversible = validContract({
            workflowId: 'P13',
            title: catalog.workflows[12].title,
            actors: ['primary'],
            mutatesProduction: true,
            cleanupRequired: true,
            steps: [{ action: 'click', target: { kind: 'role', role: 'button', name: 'Photo', exact: true }, mutationId: 'profile-photo' }],
            cleanupSteps: [{ action: 'uploadSyntheticImage', target: { kind: 'label', name: 'Profile image', exact: true }, mutationId: 'profile-photo' }]
        });
        expect(() => validateContract(reversible, catalog, 'P13')).toThrow(/cleanup action uploadSyntheticImage is not allowed/);
    });

    it('allows credential fills without putting credentials in the contract', () => {
        const signup = validContract({
            workflowId: 'P02',
            title: catalog.workflows[1].title,
            actors: ['lifecycle'],
            mutatesProduction: true,
            cleanupRequired: false,
            lifecycleTransition: true,
            steps: [
                { action: 'fillActorEmail', actor: 'lifecycle', target: { kind: 'label', name: 'Email', exact: true } },
                { action: 'fillActorPassword', actor: 'lifecycle', target: { kind: 'label', name: 'Password', exact: true } },
                { action: 'click', actor: 'lifecycle', target: { kind: 'role', role: 'button', name: 'Create account', exact: true } }
            ],
            cleanupSteps: []
        });
        expect(validateContract(signup, catalog, 'P02').steps).toHaveLength(4);
        expect(() => validateContract({
            ...signup,
            steps: [{
                action: 'fillActorPassword',
                actor: 'lifecycle',
                target: { kind: 'label', name: 'Password', exact: true },
                value: 'embedded-password'
            }]
        }, catalog, 'P02')).toThrow(/unsupported key value/);
    });

    it('restricts the checkout popup primitive to the two checkout workflows', () => {
        const target = { kind: 'role', role: 'button', name: 'Pay fee', exact: true };
        expect(() => validateContract({
            ...validContract(),
            steps: [{ action: 'clickAndExpectStripeCheckout', target }]
        }, catalog, 'P01')).toThrow(/restricted to P30 and P31/);

        const checkout = validContract({
            workflowId: 'P30',
            title: catalog.workflows[29].title,
            actors: ['primary'],
            steps: [{ action: 'clickAndExpectStripeCheckout', actor: 'primary', target }]
        });
        expect(validateContract(checkout, catalog, 'P30').steps).toHaveLength(2);
    });

    it('replaces read-only generic clicks with target-bound download assertions', () => {
        const calendar = validContract({
            workflowId: 'P29',
            title: catalog.workflows[28].title,
            actors: ['primary'],
            steps: [{
                action: 'clickAndExpectDownload',
                actor: 'primary',
                target: { kind: 'role', role: 'button', name: 'Download calendar', exact: true }
            }]
        });
        expect(validateContract(calendar, catalog, 'P29').steps).toHaveLength(2);
        expect(() => validateContract({
            ...calendar,
            steps: [{
                action: 'click',
                actor: 'primary',
                target: { kind: 'role', role: 'button', name: 'Delete calendar' }
            }]
        }, catalog, 'P29')).toThrow(/action click is not allowed for P29/);
    });

    it('binds mutation policy to the trusted workflow capability', () => {
        expect(() => validateContract({
            ...validContract(),
            mutatesProduction: true,
            lifecycleTransition: true
        }, catalog, 'P01')).toThrow(/mutation flags do not match/);
    });

    it('requires paired control-state keys for reversible fixture edits', () => {
        const reversible = validContract({
            workflowId: 'P12',
            title: catalog.workflows[11].title,
            actors: ['primary'],
            mutatesProduction: true,
            cleanupRequired: true,
            steps: [
                { action: 'rememberControl', target: { kind: 'label', name: 'Name', exact: true }, option: 'profile-name' },
                { action: 'fill', target: { kind: 'label', name: 'Name', exact: true }, value: '{RUN_MARKER}', mutationId: 'profile-name' }
            ],
            cleanupSteps: [
                { action: 'restoreControl', target: { kind: 'label', name: 'Name', exact: true }, option: 'profile-name', mutationId: 'profile-name' }
            ]
        });
        expect(validateContract(reversible, catalog, 'P12').cleanupSteps).toHaveLength(1);
        expect(() => validateContract({
            ...reversible,
            cleanupSteps: [{
                action: 'restoreControl',
                target: { kind: 'label', name: 'Name', exact: true },
                option: 'Bad Key',
                mutationId: 'profile-name'
            }]
        }, catalog, 'P12')).toThrow(/stable lowercase state key/);
        expect(() => validateContract({
            ...reversible,
            cleanupSteps: []
        }, catalog, 'P12')).toThrow(/must provide cleanupSteps/);
        expect(() => validateContract({
            ...reversible,
            cleanupSteps: [{
                action: 'restoreControl',
                target: { kind: 'label', name: 'Name', exact: true },
                option: 'different-key',
                mutationId: 'profile-name'
            }]
        }, catalog, 'P12')).toThrow(/exactly match one remembered control|exact mutated control/);
        expect(() => validateContract({
            ...reversible,
            cleanupSteps: [{
                action: 'restoreControl',
                target: { kind: 'label', name: 'Phone', exact: true },
                option: 'profile-name',
                mutationId: 'profile-name'
            }]
        }, catalog, 'P12')).toThrow(/exactly match one remembered control|exact mutated control/);
    });

    it('binds reversible mutations to actor-specific targets and cleanup mutation ids', () => {
        const reversible = validContract({
            workflowId: 'P12',
            title: catalog.workflows[11].title,
            actors: ['primary'],
            mutatesProduction: true,
            cleanupRequired: true,
            steps: [
                { action: 'rememberControl', target: { kind: 'label', name: 'Name', exact: true }, option: 'profile-name' },
                {
                    action: 'fill',
                    target: { kind: 'label', name: 'Name', exact: true },
                    value: '{RUN_MARKER}',
                    mutationId: 'profile-name'
                }
            ],
            cleanupSteps: [{
                action: 'restoreControl',
                target: { kind: 'label', name: 'Name', exact: true },
                option: 'profile-name',
                mutationId: 'profile-name'
            }]
        });
        expect(validateContract(reversible, catalog, 'P12').steps).toHaveLength(3);
        expect(() => validateContract({
            ...reversible,
            steps: [reversible.steps[0], {
                ...reversible.steps[1],
                target: { kind: 'role', role: 'button', name: 'Delete account' }
            }]
        }, catalog, 'P12')).toThrow(/outside the trusted P12\/primary mutation capability/);
        expect(() => validateContract({
            ...reversible,
            cleanupSteps: [{ ...reversible.cleanupSteps[0], mutationId: 'other-change' }]
        }, catalog, 'P12')).toThrow(/same mutationId/);
        const crossActorCleanup = validContract({
            workflowId: 'P20',
            title: catalog.workflows[19].title,
            actors: ['primary', 'peer'],
            mutatesProduction: true,
            cleanupRequired: true,
            steps: [{
                action: 'click',
                actor: 'primary',
                target: { kind: 'role', role: 'button', name: 'Claim', exact: true },
                mutationId: 'task-claim'
            }],
            cleanupSteps: [{
                action: 'click',
                actor: 'peer',
                target: { kind: 'role', role: 'button', name: 'Release', exact: true },
                mutationId: 'task-claim'
            }]
        });
        expect(() => validateContract(crossActorCleanup, catalog, 'P20')).toThrow(/one actor/);
        expect(() => validateContract({
            ...reversible,
            cleanupSteps: [{
                action: 'fill',
                target: { kind: 'label', name: 'Name', exact: true },
                value: 'Unverified replacement value',
                mutationId: 'profile-name'
            }]
        }, catalog, 'P12')).toThrow(/restore remembered state or invoke a bounded inverse action/);
    });

    it('requires target-specific inverse actions and exact control restoration', () => {
        const claimAndRelease = validContract({
            workflowId: 'P20', title: catalog.workflows[19].title, actors: ['primary', 'peer'],
            mutatesProduction: true, cleanupRequired: true,
            steps: [{ action: 'click', target: { kind: 'role', role: 'button', name: 'Claim', exact: true }, mutationId: 'task-claim' }],
            cleanupSteps: [{ action: 'click', target: { kind: 'role', role: 'button', name: 'Release', exact: true }, mutationId: 'task-claim' }]
        });
        expect(validateContract(claimAndRelease, catalog, 'P20').workflowId).toBe('P20');
        expect(() => validateContract({
            ...claimAndRelease,
            cleanupSteps: [{ action: 'click', target: { kind: 'role', role: 'button', name: 'Claim', exact: true }, mutationId: 'task-claim' }]
        }, catalog, 'P20')).toThrow(/target-specific inverse/);

        const changedControl = validContract({
            workflowId: 'P12', title: catalog.workflows[11].title, actors: ['primary'],
            mutatesProduction: true, cleanupRequired: true,
            steps: [
                { action: 'rememberControl', target: { kind: 'label', name: 'Name', exact: true }, option: 'profile-name' },
                { action: 'fill', target: { kind: 'label', name: 'Name', exact: true }, value: '{RUN_MARKER}', mutationId: 'profile-name' }
            ],
            cleanupSteps: [{ action: 'restoreControl', target: { kind: 'label', name: 'Name', exact: true }, option: 'profile-name', mutationId: 'profile-name' }]
        });
        expect(() => validateContract({
            ...changedControl,
            cleanupSteps: [{ action: 'restoreControl', target: { kind: 'label', name: 'Phone', exact: true }, option: 'profile-name', mutationId: 'profile-name' }]
        }, catalog, 'P12')).toThrow(/exact mutated control|exactly match/);
    });

    it('requires each catalogued workflow to exercise its trusted behavior', () => {
        const signupWithoutSubmission = validContract({
            workflowId: 'P02', title: catalog.workflows[1].title, actors: ['lifecycle'],
            mutatesProduction: true, cleanupRequired: false, lifecycleTransition: true,
            steps: [
                { action: 'fillActorEmail', target: { kind: 'label', name: 'Email', exact: true } },
                { action: 'fillActorPassword', target: { kind: 'label', name: 'Password', exact: true } }
            ]
        });
        expect(() => validateContract(signupWithoutSubmission, catalog, 'P02')).toThrow(/must exercise the trusted P02 click workflow behavior/);
        expect(() => validateContract({
            ...signupWithoutSubmission,
            steps: [...signupWithoutSubmission.steps.filter((step) => step.action !== 'expectVisible'), {
                action: 'click', target: { kind: 'role', role: 'button', name: 'Create account', exact: true }
            }]
        }, catalog, 'P02')).toThrow(/must assert an observable trusted P02 workflow outcome/);
    });

    it('requires exact semantic targets for every untrusted production interaction', () => {
        const signup = validContract({
            workflowId: 'P02',
            title: catalog.workflows[1].title,
            actors: ['lifecycle'],
            mutatesProduction: true,
            cleanupRequired: false,
            lifecycleTransition: true,
            steps: [{
                action: 'click',
                target: { kind: 'text', name: 'Create account' }
            }]
        });
        expect(() => validateContract(signup, catalog, 'P02')).toThrow(/exact semantic buttons or links/);
        const remembered = validContract({
            workflowId: 'P12',
            title: catalog.workflows[11].title,
            actors: ['primary'],
            mutatesProduction: true,
            cleanupRequired: true,
            steps: [
                { action: 'rememberControl', target: { kind: 'text', name: 'Name' }, option: 'profile-name' },
                { action: 'fill', target: { kind: 'label', name: 'Name', exact: true }, value: '{RUN_MARKER}', mutationId: 'profile-name' }
            ],
            cleanupSteps: [{
                action: 'restoreControl',
                target: { kind: 'text', name: 'Name' },
                option: 'profile-name',
                mutationId: 'profile-name'
            }]
        });
        expect(() => validateContract(remembered, catalog, 'P12')).toThrow(/remembered controls must use exact/);
    });

    it('does not let a lifecycle declaration transfer another actor mutation authority', () => {
        const household = validContract({
            workflowId: 'P27',
            title: catalog.workflows[26].title,
            actors: ['primary', 'lifecycle'],
            mutatesProduction: true,
            cleanupRequired: false,
            lifecycleTransition: true,
            steps: [{
                action: 'click',
                actor: 'primary',
                target: { kind: 'role', role: 'button', name: 'Accept invite' }
            }],
            cleanupSteps: []
        });
        expect(() => validateContract(household, catalog, 'P27')).toThrow(
            /outside the trusted P27\/primary mutation capability/
        );
    });

    it('binds lifecycle inputs and cleanup targets to the disposable fixture', () => {
        const signup = validContract({
            workflowId: 'P02',
            title: catalog.workflows[1].title,
            actors: ['lifecycle'],
            mutatesProduction: true,
            cleanupRequired: false,
            lifecycleTransition: true,
            steps: [{
                action: 'fill',
                target: { kind: 'label', name: 'Email', exact: true },
                value: 'someone-else@example.com'
            }]
        });
        expect(() => validateContract(signup, catalog, 'P02')).toThrow(/protected lifecycle actor/);

        const household = validContract({
            workflowId: 'P27',
            title: catalog.workflows[26].title,
            actors: ['primary', 'lifecycle'],
            mutatesProduction: true,
            cleanupRequired: false,
            lifecycleTransition: true,
            steps: [
                { action: 'openLatestMailboxLink', actor: 'lifecycle', option: 'invite' },
                {
                    action: 'click', actor: 'primary',
                    target: { kind: 'role', role: 'button', name: 'Revoke access', exact: true }
                }
            ]
        });
        expect(() => validateContract(household, catalog, 'P27')).toThrow(/outside the trusted P27\/primary mutation capability/);
        expect(validateContract({
            ...household,
            steps: [
                household.steps[0],
                {
                    ...household.steps[1],
                    target: {
                        kind: 'role',
                        role: 'button',
                        name: 'Revoke access for {LIFECYCLE_EMAIL}',
                        exact: true
                    }
                },
                household.steps[2]
            ]
        }, catalog, 'P27').steps).toHaveLength(3);
    });

    it('rejects routes and actions outside each trusted workflow capability', () => {
        expect(() => validateContract({
            ...validContract(),
            steps: [{ action: 'goto', route: '/profile/settings' }]
        }, catalog, 'P01')).toThrow(/outside the trusted P01 capability/);
        expect(() => validateContract({
            ...validContract(),
            steps: [{
                action: 'click',
                target: { kind: 'role', role: 'button', name: 'Delete account', exact: true }
            }]
        }, catalog, 'P01')).toThrow(/action click is not allowed for P01/);
        expect(workflowRouteAllowed('P11', '/teams/team-123', true)).toBe(true);
        expect(workflowRouteAllowed('P11', '/teams/team-123')).toBe(false);
    });

    it('allows only known encoded route templates', () => {
        expect(interpolateTemplate('/teams/{TEAM_ID}', { TEAM_ID: 'team/a' })).toBe('/teams/team%2Fa');
        expect(() => interpolateTemplate('/teams/{EVIL}', { EVIL: 'x' })).toThrow(/unsupported template/);
    });

    it('redacts identities secrets and action tokens from reports', () => {
        const secret = 'correct-horse-battery-staple';
        const value = 'qa-parent@example.com ' + secret +
            ' https://allplays.ai/app/?oobCode=secret-code&token=another-secret-token-value-123456789';
        const redacted = redactParentCoverageValue(value, [secret]);
        expect(redacted).not.toContain('qa-parent@example.com');
        expect(redacted).not.toContain(secret);
        expect(redacted).not.toContain('secret-code');
        expect(redacted).not.toContain('another-secret');
    });

    it('produces stable signatures from normalized failure identity', () => {
        const first = stableFailureSignature({
            workflowId: 'P10',
            failureClass: 'Product Assertion',
            sourceArea: 'contract/P10/expectText'
        });
        const second = stableFailureSignature({
            workflowId: 'p10',
            failureClass: 'product assertion',
            sourceArea: 'contract/p10/expecttext'
        });
        expect(first).toBe(second);
        expect(first).toMatch(/^[a-f0-9]{64}$/);
    });

    it('never carries report summaries or raw action URLs into the thrown CI error', () => {
        const rawUrl = 'https://game-flow-c6311.firebaseapp.com/__/auth/action?oobCode=secret-code';
        const error = buildSanitizedParentCoverageFailureError({
            workflowId: 'P05',
            signature: 'a'.repeat(64),
            summary: rawUrl
        });
        expect(error.message).toContain('P05');
        expect(error.message).toContain('a'.repeat(64));
        expect(error.message).not.toContain(rawUrl);
        expect(error.message).not.toContain('oobCode');
    });

    it('retains product and cleanup failures while keeping the product regression primary', () => {
        const outcome = buildParentCoverageOutcome({
            workflowId: 'P23',
            productSummary: 'Message did not appear for the peer parent.',
            productAction: 'expectText',
            cleanupFailures: [{ action: 'click', summary: 'Synthetic message could not be removed.' }],
            cleanupRequired: true
        });
        expect(outcome).toMatchObject({
            status: 'failed',
            phase: 'execution',
            failureClass: 'product-assertion',
            sourceArea: 'contract/P23/expectText',
            cleanup: 'failed'
        });
        expect(outcome.summary).toContain('Product: Message did not appear');
        expect(outcome.summary).toContain('Cleanup: click: Synthetic message could not be removed');
    });
});
