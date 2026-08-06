import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    buildParentCoverageOutcome,
    buildSanitizedParentCoverageFailureError,
    assertParentCoverageStepCapability,
    classifyParentCoverageError,
    CONTRACT_SCHEMA_VERSION,
    interpolateTemplate,
    parentCoverageAuthoringContext,
    parentCoverageEvidenceScope,
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

function validP12Contract() {
    const name = { kind: 'label', name: 'Full name', exact: true };
    const phone = { kind: 'label', name: 'Phone', exact: true };
    const save = { kind: 'role', role: 'button', name: 'Save', exact: true };
    return validContract({
        workflowId: 'P12',
        title: catalog.workflows[11].title,
        actors: ['primary'],
        mutatesProduction: true,
        cleanupRequired: true,
        steps: [
            { action: 'rememberControl', target: name, option: 'profile-name' },
            { action: 'rememberControl', target: phone, option: 'profile-phone' },
            { action: 'fill', target: name, value: '{RUN_MARKER}', mutationId: 'profile-fields' },
            { action: 'fill', target: phone, value: '5550101234', mutationId: 'profile-fields' },
            { action: 'click', target: save, mutationId: 'profile-fields', commitMutation: true },
            { action: 'expectText', target: { kind: 'text', name: '{RUN_MARKER}', exact: true }, value: '{RUN_MARKER}' }
        ],
        cleanupSteps: [
            { action: 'restoreControl', target: name, option: 'profile-name', mutationId: 'profile-fields' },
            { action: 'restoreControl', target: phone, option: 'profile-phone', mutationId: 'profile-fields' },
            { action: 'click', target: save, mutationId: 'profile-fields' }
        ]
    });
}

function validP20Contract() {
    const signUp = { kind: 'role', role: 'button', name: 'Sign up', exact: true };
    const release = { kind: 'role', role: 'button', name: 'Release', exact: true };
    return validContract({
        workflowId: 'P20', title: catalog.workflows[19].title, actors: ['primary', 'peer'],
        mutatesProduction: true, cleanupRequired: true,
        steps: [
            { action: 'click', actor: 'primary', target: signUp, mutationId: 'task-claim', scope: 'Snacks', commitMutation: true },
            { action: 'expectText', actor: 'primary', target: { kind: 'text', name: 'You', exact: true }, value: 'You' },
            { action: 'expectHidden', actor: 'peer', target: signUp }
        ],
        cleanupSteps: [
            { action: 'click', actor: 'primary', target: release, mutationId: 'task-claim', scope: 'Snacks' }
        ]
    });
}

function validP21Contract() {
    const button = (name) => ({ kind: 'role', role: 'button', name, exact: true });
    return validContract({
        workflowId: 'P21', title: catalog.workflows[20].title, actors: ['primary'],
        mutatesProduction: true, cleanupRequired: true,
        steps: [
            {
                action: 'fill', target: { kind: 'label', name: 'Note', exact: true },
                value: '{RUN_MARKER}', mutationId: 'ride-create'
            },
            { action: 'click', target: button('Create offer'), mutationId: 'ride-create', commitMutation: true },
            { action: 'click', target: button('Close offer'), mutationId: 'ride-close', scope: '{RUN_MARKER}', commitMutation: true },
            { action: 'click', target: button('Reopen offer'), mutationId: 'ride-reopen', scope: '{RUN_MARKER}', commitMutation: true },
            { action: 'expectText', target: { kind: 'text', name: '{RUN_MARKER}', exact: true }, value: '{RUN_MARKER}' }
        ],
        cleanupSteps: [
            { action: 'click', target: button('Close offer'), mutationId: 'ride-reopen', scope: '{RUN_MARKER}' },
            { action: 'click', target: button('Reopen offer'), mutationId: 'ride-close', scope: '{RUN_MARKER}' },
            { action: 'click', target: button('Cancel'), mutationId: 'ride-create', scope: '{RUN_MARKER}' }
        ]
    });
}

function validP23Contract() {
    const button = (name) => ({ kind: 'role', role: 'button', name, exact: true });
    return validContract({
        workflowId: 'P23', title: catalog.workflows[22].title, actors: ['primary', 'peer'],
        mutatesProduction: true, cleanupRequired: true,
        steps: [
            {
                action: 'fill', actor: 'primary',
                target: { kind: 'placeholder', name: 'Message', exact: false },
                value: '{RUN_MARKER}', mutationId: 'team-message'
            },
            {
                action: 'click', actor: 'primary', target: button('Send message'),
                mutationId: 'team-message', commitMutation: true
            },
            {
                action: 'expectText', actor: 'peer',
                target: { kind: 'text', name: '{RUN_MARKER}', exact: true }, value: '{RUN_MARKER}'
            },
            {
                action: 'expectText', actor: 'primary',
                target: { kind: 'text', name: 'Read', exact: true }, value: 'Read'
            },
            {
                action: 'click', actor: 'peer', target: button('Mute notifications'),
                mutationId: 'team-mute', scope: '{TEAM_ID}', commitMutation: true
            },
            {
                action: 'expectVisible', actor: 'peer',
                target: button('Unmute notifications')
            }
        ],
        cleanupSteps: [
            {
                action: 'click', actor: 'primary', target: button('Delete'),
                mutationId: 'team-message', scope: '{RUN_MARKER}'
            },
            {
                action: 'click', actor: 'peer', target: button('Unmute notifications'),
                mutationId: 'team-mute', scope: '{TEAM_ID}'
            }
        ]
    });
}

function validP28Contract() {
    return validContract({
        workflowId: 'P28', title: catalog.workflows[27].title, actors: ['primary', 'anonymous'],
        mutatesProduction: true, cleanupRequired: true,
        steps: [
            {
                action: 'fill', actor: 'primary',
                target: { kind: 'placeholder', name: 'Label, like Grandma or babysitter', exact: true },
                value: '{RUN_MARKER}', mutationId: 'family-share'
            },
            {
                action: 'click', actor: 'primary',
                target: { kind: 'role', role: 'button', name: 'Create share', exact: true },
                mutationId: 'family-share', commitMutation: true
            },
            { action: 'openRunScopedShareLink', actor: 'anonymous', option: 'primary' },
            {
                action: 'expectVisible', actor: 'anonymous',
                target: { kind: 'text', name: 'Family', exact: true }
            },
            {
                action: 'expectHidden', actor: 'anonymous',
                target: { kind: 'text', name: 'Private', exact: true }
            }
        ],
        cleanupSteps: [{
            action: 'click', actor: 'primary',
            target: { kind: 'role', role: 'button', name: 'Revoke share', exact: true },
            mutationId: 'family-share', scope: '{RUN_MARKER}'
        }]
    });
}

function validP13Contract() {
    const save = { kind: 'role', role: 'button', name: 'Save', exact: true };
    const remove = { kind: 'role', role: 'button', name: 'Remove image', exact: true };
    return validContract({
        workflowId: 'P13', title: catalog.workflows[12].title, actors: ['primary'],
        mutatesProduction: true, cleanupRequired: true,
        steps: [
            { action: 'expectHidden', target: remove },
            {
                action: 'uploadSyntheticImage', target: { kind: 'label', name: 'Profile image', exact: true },
                mutationId: 'profile-image', commitMutation: true
            },
            { action: 'click', target: save, mutationId: 'profile-image' },
            { action: 'expectVisible', target: remove }
        ],
        cleanupSteps: [
            { action: 'click', target: remove, mutationId: 'profile-image', scope: '{RUN_MARKER}' },
            { action: 'click', target: save, mutationId: 'profile-image' }
        ]
    });
}

describe('parent coverage contract boundary', () => {
    it('exports JSON-safe workflow-specific authoring constraints', () => {
        const context = parentCoverageAuthoringContext('P21');
        expect(context).toMatchObject({
            schemaVersion: 'parent-coverage-authoring-context-v1',
            workflowId: 'P21',
            mode: 'reversible',
            routes: ['/schedule/{TEAM_ID}/{EVENT_ID}']
        });
        expect(context.allowedActions).toContain('click');
        expect(context.actionFields.click).toContain('mutationId');
        expect(context.actionConstraints.click).toMatchObject({
            phases: ['execution', 'cleanup'],
            target: { kinds: ['role'], roles: ['button', 'link'], exact: true }
        });
        expect(new RegExp(
            context.mutationTargetPatterns.primary.pattern,
            context.mutationTargetPatterns.primary.flags
        ).test('Create offer')).toBe(true);
        expect(context.orderedEvidence.map(({ action }) => action).filter(Boolean)).toEqual([
            'fill', 'click', 'click', 'click', 'click'
        ]);
        expect(context.reversibleClickInverses).toContainEqual(['create offer', 'cancel']);
        expect(() => parentCoverageAuthoringContext('P99')).toThrow(/unknown parent coverage workflow/);
        expect(JSON.parse(JSON.stringify(context))).toEqual(context);

        const profile = parentCoverageAuthoringContext('P12');
        expect(profile.actionConstraints.rememberControl).toMatchObject({
            phases: ['execution'],
            target: { kinds: ['label', 'testId'], exact: true }
        });
        expect(profile.actionConstraints.restoreControl).toMatchObject({
            phases: ['cleanup'],
            target: { kinds: ['label', 'testId'], exact: true }
        });
        const profileTargets = new RegExp(
            profile.mutationTargetPatterns.primary.pattern,
            profile.mutationTargetPatterns.primary.flags
        );
        expect(profileTargets.test('Full name')).toBe(true);
        expect(profileTargets.test('Name')).toBe(false);

        const rideRequest = parentCoverageAuthoringContext('P22');
        const primaryRideTargets = new RegExp(
            rideRequest.mutationTargetPatterns.primary.pattern,
            rideRequest.mutationTargetPatterns.primary.flags
        );
        const peerRideTargets = new RegExp(
            rideRequest.mutationTargetPatterns.peer.pattern,
            rideRequest.mutationTargetPatterns.peer.flags
        );
        expect(primaryRideTargets.test('Confirm')).toBe(true);
        expect(primaryRideTargets.test('Approve')).toBe(false);
        expect(peerRideTargets.test('Request spot')).toBe(true);
        expect(peerRideTargets.test('Request ride')).toBe(false);
        expect(rideRequest.reversibleClickInverses).toContainEqual(['request spot', 'cancel']);

        const taskClaim = parentCoverageAuthoringContext('P20');
        const primaryTaskTargets = new RegExp(
            taskClaim.mutationTargetPatterns.primary.pattern,
            taskClaim.mutationTargetPatterns.primary.flags
        );
        expect(primaryTaskTargets.test('Sign up')).toBe(true);
        expect(primaryTaskTargets.test('Claim')).toBe(false);
        expect(taskClaim.orderedEvidence.map(({ action, actions }) => action || actions.join('|'))).toEqual([
            'click', 'expectText', 'expectHidden', 'click'
        ]);
        expect(taskClaim.reversibleClickInverses).toContainEqual(['sign up', 'release']);

        const image = parentCoverageAuthoringContext('P13');
        expect(image.actionConstraints.uploadSyntheticImage).toMatchObject({
            phases: ['execution'],
            target: { kinds: ['label', 'testId'], exact: true }
        });

        const privateAi = parentCoverageAuthoringContext('P36');
        expect(privateAi.actionConstraints.uploadSyntheticImage.target).toMatchObject({
            kinds: ['label'],
            exact: true,
            name: 'Attach image, CSV, or PDF'
        });
        expect(privateAi.actionConstraints.uploadSyntheticDocument.target.name)
            .toBe('Attach image, CSV, or PDF');

        const privateAiText = parentCoverageAuthoringContext('P35');
        expect(privateAiText.actionConstraints.fill.target).toMatchObject({
            kinds: ['placeholder'],
            exact: true,
            name: 'Ask ALL PLAYS...'
        });

        const familyShare = parentCoverageAuthoringContext('P28');
        expect(familyShare.actionConstraints.fill.target).toMatchObject({
            kinds: ['placeholder'],
            exact: true,
            name: 'Label, like Grandma or babysitter'
        });

        const socialPost = parentCoverageAuthoringContext('P34');
        expect(socialPost.actionConstraints.fill.target.byActor.primary).toEqual({
            kind: 'label',
            name: 'Write one short note',
            exact: true
        });

        const notifications = parentCoverageAuthoringContext('P25');
        expect(notifications.actionConstraints.fill.target).toMatchObject({
            kinds: ['placeholder'],
            name: 'Message',
            exact: false
        });
        const notificationTargets = new RegExp(
            notifications.mutationTargetPatterns.primary.pattern,
            notifications.mutationTargetPatterns.primary.flags
        );
        expect(notificationTargets.test('Send message')).toBe(true);
        expect(notificationTargets.test('Send')).toBe(false);

        const teamChat = parentCoverageAuthoringContext('P23');
        expect(teamChat.actionConstraints.fill.target).toMatchObject({
            kinds: ['placeholder'],
            name: 'Message',
            exact: false
        });
        const primaryChatTargets = new RegExp(
            teamChat.mutationTargetPatterns.primary.pattern,
            teamChat.mutationTargetPatterns.primary.flags
        );
        const peerChatTargets = new RegExp(
            teamChat.mutationTargetPatterns.peer.pattern,
            teamChat.mutationTargetPatterns.peer.flags
        );
        expect(primaryChatTargets.test('Send message')).toBe(true);
        expect(primaryChatTargets.test('Send')).toBe(false);
        expect(peerChatTargets.test('Mute notifications')).toBe(true);
        expect(peerChatTargets.test('Mute')).toBe(false);
        expect(teamChat.reversibleClickInverses).toEqual([
            ['send message', 'delete'],
            ['mute notifications', 'unmute notifications']
        ]);
    });

    it('rejects the stale P12 Name locator at the trusted contract boundary', () => {
        const contract = validP12Contract();
        expect(validateContract(contract, catalog, 'P12').workflowId).toBe('P12');

        const staleTarget = { kind: 'label', name: 'Name', exact: true };
        expect(() => validateContract({
            ...contract,
            steps: contract.steps.map((step) => step.target?.name === 'Full name'
                ? { ...step, target: staleTarget }
                : step),
            cleanupSteps: contract.cleanupSteps.map((step) => step.target?.name === 'Full name'
                ? { ...step, target: staleTarget }
                : step)
        }, catalog, 'P12')).toThrow(/outside the trusted P12\/primary mutation capability/);
    });

    it('rejects the stale P20 Claim and Claimed contract at the trusted boundary', () => {
        const contract = validP20Contract();
        expect(validateContract(contract, catalog, 'P20').workflowId).toBe('P20');

        expect(() => validateContract({
            ...contract,
            steps: contract.steps.map((step, index) => index === 0 ? {
                ...step,
                target: { kind: 'role', role: 'button', name: 'Claim', exact: true }
            } : step)
        }, catalog, 'P20')).toThrow(/outside the trusted P20\/primary mutation capability/);

        expect(() => validateContract({
            ...contract,
            steps: [
                contract.steps[0],
                {
                    action: 'expectText', actor: 'primary',
                    target: { kind: 'text', name: 'Claimed by you', exact: true },
                    value: 'Claimed'
                },
                {
                    action: 'expectText', actor: 'peer',
                    target: { kind: 'text', name: 'Claimed', exact: true },
                    value: 'Claimed'
                }
            ]
        }, catalog, 'P20')).toThrow(/ordered trusted P20 primary expectText workflow behavior/);
    });

    it('rejects stale P23 chat locators at the trusted contract boundary', () => {
        const contract = validP23Contract();
        expect(validateContract(contract, catalog, 'P23').workflowId).toBe('P23');

        const staleTargets = [
            ['fill', 'Message', { kind: 'label', name: 'Message', exact: true }],
            ['fill', 'Message', { kind: 'placeholder', name: 'Chat', exact: false }],
            ['click', 'Send message', { kind: 'role', role: 'button', name: 'Send', exact: true }],
            ['click', 'Mute notifications', { kind: 'role', role: 'button', name: 'Mute', exact: true }],
            ['click', 'Unmute notifications', { kind: 'role', role: 'button', name: 'Unmute', exact: true }],
            ['click', 'Delete', { kind: 'role', role: 'button', name: 'Delete message', exact: true }]
        ];

        for (const [action, currentName, staleTarget] of staleTargets) {
            const rewrite = (step) => step.action === action && step.target?.name === currentName
                ? { ...step, target: staleTarget }
                : step;
            expect(() => validateContract({
                ...contract,
                steps: contract.steps.map(rewrite),
                cleanupSteps: contract.cleanupSteps.map(rewrite)
            }, catalog, 'P23')).toThrow(/trusted P23/);
        }

        const staleActors = [
            ['Send message', 'peer'],
            ['Delete', 'peer'],
            ['Mute notifications', 'primary'],
            ['Unmute notifications', 'primary']
        ];

        for (const [targetName, staleActor] of staleActors) {
            const rewrite = (step) => step.target?.name === targetName
                ? { ...step, actor: staleActor }
                : step;
            expect(() => validateContract({
                ...contract,
                steps: contract.steps.map(rewrite),
                cleanupSteps: contract.cleanupSteps.map(rewrite)
            }, catalog, 'P23')).toThrow(/trusted P23/);
        }
    });

    it('requires P34 primary caption fills to use the composer label', () => {
        const captionFill = {
            action: 'fill', actor: 'primary',
            target: { kind: 'label', name: 'Write one short note', exact: true },
            value: '{RUN_MARKER}'
        };

        expect(() => assertParentCoverageStepCapability('P34', captionFill, 'execution', 'primary'))
            .not.toThrow();
        expect(() => assertParentCoverageStepCapability('P34', {
            ...captionFill,
            target: { kind: 'label', name: 'Post', exact: true }
        }, 'execution', 'primary')).toThrow(/trusted P34\/fill exact locator/);

        expect(() => assertParentCoverageStepCapability('P34', {
            ...captionFill,
            actor: 'peer',
            target: { kind: 'label', name: 'Comment', exact: true }
        }, 'execution', 'peer')).not.toThrow();
    });

    it('rejects the unsupported P28 Share label locator', () => {
        const contract = validP28Contract();
        expect(validateContract(contract, catalog, 'P28').workflowId).toBe('P28');
        expect(() => validateContract({
            ...contract,
            steps: contract.steps.map((step) => step.action === 'fill'
                ? { ...step, target: { kind: 'label', name: 'Share', exact: true } }
                : step)
        }, catalog, 'P28')).toThrow(/trusted P28\/fill exact locator/);
    });

    it('requires P35 to fill the exact production composer placeholder', () => {
        const contract = validContract({
            workflowId: 'P35', title: catalog.workflows[34].title, actors: ['primary'],
            mutatesProduction: true, cleanupRequired: true,
            steps: [
                {
                    action: 'fill', actor: 'primary',
                    target: { kind: 'placeholder', name: 'Ask ALL PLAYS...', exact: true },
                    value: '{RUN_MARKER}', mutationId: 'ai-message'
                },
                {
                    action: 'click', actor: 'primary',
                    target: { kind: 'role', role: 'button', name: 'Send', exact: true },
                    mutationId: 'ai-message', commitMutation: true
                },
                {
                    action: 'expectText', actor: 'primary',
                    target: { kind: 'text', name: 'Parent schedule', exact: true }, value: 'Parent'
                },
                {
                    action: 'expectNoText', actor: 'primary',
                    target: { kind: 'text', name: 'Manager tools', exact: true }, value: 'Manager'
                }
            ],
            cleanupSteps: [{
                action: 'click', actor: 'primary',
                target: { kind: 'role', role: 'button', name: 'Delete message', exact: true },
                mutationId: 'ai-message', scope: '{RUN_MARKER}'
            }]
        });

        expect(validateContract(contract, catalog, 'P35').workflowId).toBe('P35');
        expect(() => validateContract({
            ...contract,
            steps: contract.steps.map((step) => step.action === 'fill'
                ? { ...step, target: { kind: 'label', name: 'Prompt', exact: true } }
                : step)
        }, catalog, 'P35')).toThrow(/trusted P35\/fill exact locator/);
    });

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

    it('keeps P10 home action destinations inside its trusted read-only routes', () => {
        const homeAction = validContract({
            workflowId: 'P10',
            title: catalog.workflows[9].title,
            actors: ['primary'],
            steps: [
                { action: 'goto', actor: 'primary', route: '/home' },
                {
                    action: 'expectText', actor: 'primary',
                    target: { kind: 'text', name: 'Action queue', exact: true }, value: 'Action'
                },
                {
                    action: 'clickAndExpectRoute', actor: 'primary',
                    target: { kind: 'role', role: 'link', name: 'Schedule', exact: true },
                    route: '/schedule'
                }
            ]
        });

        expect(validateContract(homeAction, catalog, 'P10').workflowId).toBe('P10');
        for (const route of [
            '/parent-tools', '/parent-tools/tasks', '/schedule', '/schedule/team-1/event-1',
            '/messages', '/messages/team-1', '/profile', '/profile/settings'
        ]) {
            expect(workflowRouteAllowed('P10', route)).toBe(true);
        }
        for (const route of ['/teams', '/teams/team-1', '/ai', '/ai/private']) {
            expect(workflowRouteAllowed('P10', route)).toBe(false);
        }
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
                { action: 'fill', actor: 'lifecycle', target: { kind: 'label', name: 'Invite code', exact: true }, value: '{LIFECYCLE_SIGNUP_INVITE_CODE}' },
                { action: 'fillActorEmail', actor: 'lifecycle', target: { kind: 'label', name: 'Email', exact: true } },
                { action: 'fillActorPassword', actor: 'lifecycle', target: { kind: 'label', name: 'Password', exact: true } },
                { action: 'click', actor: 'lifecycle', target: { kind: 'role', role: 'button', name: 'Create account', exact: true } },
                { action: 'expectText', actor: 'lifecycle', target: { kind: 'text', name: 'Verify your email', exact: true }, value: 'Verify' },
                { action: 'expectRoute', actor: 'lifecycle', route: '/verify-pending' }
            ],
            cleanupSteps: []
        });
        expect(validateContract(signup, catalog, 'P02').steps).toHaveLength(7);
        expect(() => validateContract({
            ...signup,
            steps: signup.steps.filter((step) => step.action !== 'expectRoute')
        }, catalog, 'P02')).toThrow(/ordered trusted P02 lifecycle expectRoute workflow behavior/);
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

    it('keeps email workflows request-scoped and labels unverified delivery', () => {
        const button = (name) => ({ kind: 'role', role: 'button', name, exact: true });
        const verification = validContract({
            workflowId: 'P03', title: catalog.workflows[2].title, actors: ['lifecycle'],
            mutatesProduction: true, cleanupRequired: false, lifecycleTransition: true,
            steps: [
                { action: 'login', actor: 'lifecycle' },
                { action: 'goto', actor: 'lifecycle', route: '/verify-pending' },
                { action: 'click', actor: 'lifecycle', target: button("I've verified, continue") },
                { action: 'expectText', actor: 'lifecycle', target: { kind: 'text', name: 'We could not confirm verification yet', exact: true }, value: 'could not confirm verification' },
                { action: 'click', actor: 'lifecycle', target: button('Resend verification email') },
                { action: 'expectText', actor: 'lifecycle', target: { kind: 'text', name: 'Verification email queued', exact: true }, value: 'Verification email queued' },
                { action: 'expectRoute', actor: 'lifecycle', route: '/verify-pending' }
            ]
        });
        const reset = validContract({
            workflowId: 'P05', title: catalog.workflows[4].title, actors: ['lifecycle'],
            mutatesProduction: true, cleanupRequired: false, lifecycleTransition: true,
            steps: [
                { action: 'click', actor: 'lifecycle', target: button('Forgot password?') },
                { action: 'fillActorEmail', actor: 'lifecycle', target: { kind: 'label', name: 'Password reset email', exact: true } },
                { action: 'click', actor: 'lifecycle', target: button('Send reset email') },
                { action: 'expectText', actor: 'lifecycle', target: { kind: 'text', name: 'If an account exists', exact: true }, value: 'reset email has been queued' },
                { action: 'expectRoute', actor: 'lifecycle', route: '/auth' }
            ]
        });

        expect(validateContract(verification, catalog, 'P03').workflowId).toBe('P03');
        expect(validateContract(reset, catalog, 'P05').workflowId).toBe('P05');
        expect(parentCoverageEvidenceScope('P02')).toContain('email-delivery-unverified');
        expect(parentCoverageEvidenceScope('P03')).toContain('email-delivery-unverified');
        expect(parentCoverageEvidenceScope('P05')).toContain('email-delivery-unverified');
        expect(parentCoverageEvidenceScope('P27')).toBe('end-to-end');
    });

    it('locks account deletion to the security tab and its two-step confirmation', () => {
        const button = (name) => ({ kind: 'role', role: 'button', name, exact: true });
        const deletion = {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            workflowId: 'P37', title: catalog.workflows[36].title, actors: ['lifecycle'],
            viewport: 'mobile',
            mutatesProduction: true, cleanupRequired: false, lifecycleTransition: true,
            steps: [
                { action: 'login', actor: 'lifecycle' },
                { action: 'goto', actor: 'lifecycle', route: '/profile/settings?section=security' },
                { action: 'click', actor: 'lifecycle', target: button('Delete my account') },
                {
                    action: 'fillActorPassword', actor: 'lifecycle',
                    target: { kind: 'label', name: 'Account password (email sign-in only)', exact: true }
                },
                {
                    action: 'fill', actor: 'lifecycle',
                    target: { kind: 'label', name: 'Type DELETE to confirm', exact: true },
                    value: 'DELETE'
                },
                { action: 'click', actor: 'lifecycle', target: button('Delete account') },
                {
                    action: 'expectVisible', actor: 'lifecycle',
                    target: { kind: 'role', role: 'heading', name: 'Sign in', exact: true }
                },
                { action: 'expectRoute', actor: 'lifecycle', route: '/auth' }
            ],
            cleanupSteps: []
        };

        expect(validateContract(deletion, catalog, 'P37').workflowId).toBe('P37');
        expect(() => validateContract({
            ...deletion,
            steps: deletion.steps.filter((step) => step.target?.name !== 'Delete my account')
        }, catalog, 'P37')).toThrow(/ordered trusted P37 lifecycle click workflow behavior/);
        expect(() => validateContract({
            ...deletion,
            steps: deletion.steps.map((step) => step.action === 'goto'
                ? { ...step, route: '/profile/settings' }
                : step)
        }, catalog, 'P37')).toThrow(/ordered trusted P37 lifecycle goto workflow behavior/);
        expect(() => validateContract({
            ...deletion,
            steps: deletion.steps.flatMap((step) => step.target?.name === 'Delete account'
                ? [step, { action: 'goto', actor: 'lifecycle', route: '/auth' }]
                : [step])
        }, catalog, 'P37')).toThrow(/route is outside the trusted P37 capability/);
    });

    it('rejects checkout actions for disabled P30 while preserving explicit unverified evidence', () => {
        const target = { kind: 'role', role: 'button', name: 'Pay fee', exact: true };
        expect(() => validateContract({
            ...validContract(),
            steps: [{ action: 'clickAndExpectStripeCheckout', target }]
        }, catalog, 'P01')).toThrow(/restricted to enabled checkout workflows/);

        const invalidCheckout = validContract({
            workflowId: 'P30',
            title: catalog.workflows[29].title,
            actors: ['primary'],
            steps: [
                { action: 'expectText', actor: 'primary', target: { kind: 'text', name: 'Fees', exact: true }, value: 'Fee' },
                { action: 'clickAndExpectStripeCheckout', actor: 'primary', target }
            ]
        });
        expect(() => validateContract(invalidCheckout, catalog, 'P30'))
            .toThrow(/restricted to enabled checkout workflows/);

        const disabledCheckout = {
            ...invalidCheckout,
            steps: [
                { action: 'expectText', actor: 'primary', target: { kind: 'text', name: 'Fees', exact: true }, value: 'Fee' },
                { action: 'expectHidden', actor: 'primary', target }
            ]
        };
        expect(validateContract(disabledCheckout, catalog, 'P30').steps).toHaveLength(2);
        expect(parentCoverageEvidenceScope('P30')).toBe('fees-visible-checkout-disabled-unverified');
        expect(parentCoverageAuthoringContext('P30')).toMatchObject({
            allowedActions: expect.not.arrayContaining(['clickAndExpectStripeCheckout']),
            orderedEvidence: expect.arrayContaining([
                expect.objectContaining({ action: 'expectHidden', actor: 'primary' })
            ])
        });
    });

    it('binds P29 downloads to the exact production locator', () => {
        const downloadTarget = { kind: 'role', role: 'button', name: 'Download .ics', exact: true };
        const calendar = validContract({
            workflowId: 'P29',
            title: catalog.workflows[28].title,
            actors: ['primary'],
            steps: [{
                action: 'clickAndExpectDownload',
                actor: 'primary',
                target: downloadTarget
            }, {
                action: 'expectText', actor: 'primary',
                target: { kind: 'text', name: 'Calendar feed', exact: true }, value: 'Calendar'
            }]
        });
        expect(validateContract(calendar, catalog, 'P29').steps).toHaveLength(3);
        const authoringContext = parentCoverageAuthoringContext('P29');
        const downloadPattern = new RegExp(
            authoringContext.interactionTargetPatterns.clickAndExpectDownload.pattern,
            authoringContext.interactionTargetPatterns.clickAndExpectDownload.flags
        );
        expect(downloadPattern.test('Download .ics')).toBe(true);
        expect(downloadPattern.test('Download ICS')).toBe(false);
        expect(downloadPattern.test('Download calendar')).toBe(false);
        expect(authoringContext.orderedEvidence[0]).toMatchObject({
            action: 'clickAndExpectDownload',
            actor: 'primary',
            target: { pattern: '^Download \\.ics$', flags: '' }
        });

        for (const staleName of ['Download ICS', 'Download calendar']) {
            expect(() => validateContract({
                ...calendar,
                steps: [{
                    action: 'clickAndExpectDownload',
                    actor: 'primary',
                    target: { ...downloadTarget, name: staleName }
                }]
            }, catalog, 'P29')).toThrow(/target is outside the trusted P29\/clickAndExpectDownload capability/);
        }
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

    it('treats the schedule filter as a bounded non-production interaction', () => {
        const schedule = validContract({
            workflowId: 'P16',
            title: catalog.workflows[15].title,
            actors: ['primary'],
            steps: [
                { action: 'goto', actor: 'primary', route: '/schedule' },
                {
                    action: 'select', actor: 'primary',
                    target: { kind: 'label', name: 'Team', exact: true }, option: '{TEAM_ID}'
                },
                { action: 'expectText', actor: 'primary', target: { kind: 'text', name: 'Game', exact: true }, value: 'Game' },
                { action: 'goto', actor: 'primary', route: '/schedule/{TEAM_ID}/{EVENT_ID}' },
                { action: 'expectText', actor: 'primary', target: { kind: 'text', name: 'Event', exact: true }, value: 'Event' }
            ]
        });
        expect(validateContract(schedule, catalog, 'P16').cleanupSteps).toEqual([]);
        expect(() => validateContract({
            ...schedule,
            steps: schedule.steps.map((step) => step.action === 'select'
                ? { ...step, mutationId: 'fake-production-change', commitMutation: true }
                : step)
        }, catalog, 'P16')).toThrow(/transient filter interaction cannot declare a production mutation/);
    });

    it('requires paired control-state keys for reversible fixture edits', () => {
        const reversible = validP12Contract();
        expect(validateContract(reversible, catalog, 'P12').cleanupSteps).toHaveLength(3);
        expect(() => validateContract({
            ...reversible,
            cleanupSteps: [{
                action: 'restoreControl',
                target: { kind: 'label', name: 'Full name', exact: true },
                option: 'Bad Key',
                mutationId: 'profile-fields'
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
                target: { kind: 'label', name: 'Full name', exact: true },
                option: 'different-key',
                mutationId: 'profile-fields'
            }]
        }, catalog, 'P12')).toThrow(/exactly match one remembered control|exact mutated control/);
        expect(() => validateContract({
            ...reversible,
            cleanupSteps: [{
                action: 'restoreControl',
                target: { kind: 'label', name: 'Phone', exact: true },
                option: 'profile-name',
                mutationId: 'profile-fields'
            }]
        }, catalog, 'P12')).toThrow(/exactly match one remembered control|exact mutated control/);
    });

    it('requires both profile fields advertised by P12 to be changed and restored', () => {
        const profile = validP12Contract();
        expect(() => validateContract({
            ...profile,
            steps: profile.steps.filter((step) => !(step.action === 'fill' && step.target?.name === 'Phone'))
        }, catalog, 'P12')).toThrow(/profile-fields|ordered trusted P12 primary fill workflow behavior/);
    });

    it('keeps the complete P17 RSVP notes and sibling workflow constructible', () => {
        const rsvp = { kind: 'label', name: 'RSVP', exact: true };
        const note = { kind: 'label', name: 'Note', exact: true };
        const sibling = { kind: 'label', name: 'Sibling', exact: true };
        const save = { kind: 'role', role: 'button', name: 'Save', exact: true };
        const contract = validContract({
            workflowId: 'P17', title: catalog.workflows[16].title, actors: ['primary'],
            mutatesProduction: true, cleanupRequired: true,
            steps: [
                { action: 'rememberControl', target: rsvp, option: 'rsvp' },
                { action: 'rememberControl', target: note, option: 'note' },
                { action: 'rememberControl', target: sibling, option: 'sibling' },
                { action: 'select', target: rsvp, option: 'Going', mutationId: 'rsvp-update' },
                { action: 'fill', target: note, value: '{RUN_MARKER}', mutationId: 'rsvp-update' },
                { action: 'fill', target: sibling, value: '{RUN_MARKER}', mutationId: 'rsvp-update' },
                { action: 'click', target: save, mutationId: 'rsvp-update', commitMutation: true },
                { action: 'expectText', target: { kind: 'text', name: '{RUN_MARKER}', exact: true }, value: '{RUN_MARKER}' }
            ],
            cleanupSteps: [
                { action: 'restoreControl', target: rsvp, option: 'rsvp', mutationId: 'rsvp-update' },
                { action: 'restoreControl', target: note, option: 'note', mutationId: 'rsvp-update' },
                { action: 'restoreControl', target: sibling, option: 'sibling', mutationId: 'rsvp-update' },
                { action: 'click', target: save, mutationId: 'rsvp-update' }
            ]
        });
        expect(validateContract(contract, catalog, 'P17').workflowId).toBe('P17');
    });

    it('binds reversible mutations to actor-specific targets and cleanup mutation ids', () => {
        const reversible = validP12Contract();
        expect(validateContract(reversible, catalog, 'P12').steps).toHaveLength(7);
        expect(() => validateContract({
            ...reversible,
            steps: [reversible.steps[0], {
                ...reversible.steps[2],
                target: { kind: 'role', role: 'button', name: 'Delete account' }
            }]
        }, catalog, 'P12')).toThrow(/outside the trusted P12\/primary mutation capability/);
        expect(() => validateContract({
            ...reversible,
            cleanupSteps: reversible.cleanupSteps.map((step) => ({ ...step, mutationId: 'other-change' }))
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
                target: { kind: 'role', role: 'button', name: 'Sign up', exact: true },
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
                target: { kind: 'label', name: 'Full name', exact: true },
                value: 'Unverified replacement value',
                mutationId: 'profile-fields'
            }]
        }, catalog, 'P12')).toThrow(/restore remembered state or invoke a bounded inverse action/);
    });

    it('requires target-specific inverse actions and exact control restoration', () => {
        const claimAndRelease = validP20Contract();
        expect(validateContract(claimAndRelease, catalog, 'P20').workflowId).toBe('P20');
        expect(() => validateContract({
            ...claimAndRelease,
            cleanupSteps: [{ action: 'click', actor: 'primary', target: { kind: 'role', role: 'button', name: 'Sign up', exact: true }, mutationId: 'task-claim', scope: 'Snacks' }]
        }, catalog, 'P20')).toThrow(/target-specific inverse/);

        const changedControl = validP12Contract();
        expect(() => validateContract({
            ...changedControl,
            cleanupSteps: changedControl.cleanupSteps.map((step, index) => index === 0
                ? { ...step, target: { kind: 'label', name: 'Phone', exact: true } }
                : step)
        }, catalog, 'P12')).toThrow(/exact mutated control|exactly match/);
    });

    it('binds uploaded and clicked mutations to a completed operation and exact entity scope', () => {
        const profileImage = validP13Contract();
        expect(validateContract(profileImage, catalog, 'P13').workflowId).toBe('P13');
        expect(() => validateContract({
            ...profileImage,
            cleanupSteps: profileImage.cleanupSteps.map((step, index) => index === 0
                ? { ...step, scope: 'Existing profile image' }
                : step)
        }, catalog, 'P13')).toThrow(/created-entity cleanup must be scoped to the run marker/);
        expect(() => validateContract({
            ...profileImage,
            steps: profileImage.steps.map((step) => {
                const { commitMutation, ...withoutCommit } = step;
                return withoutCommit;
            })
        }, catalog, 'P13')).toThrow(/exactly one trusted completed forward operation/);

        const task = validP20Contract();
        expect(() => validateContract({
            ...task,
            cleanupSteps: task.cleanupSteps.map(({ scope, ...step }) => step)
        }, catalog, 'P20')).toThrow(/inverse cleanup must be bound to an exact entity scope/);
    });

    it('requires P14 to prove the child image slot is empty before replacement', () => {
        const name = { kind: 'label', name: 'Name', exact: true };
        const image = { kind: 'label', name: 'Image', exact: true };
        const save = { kind: 'role', role: 'button', name: 'Save', exact: true };
        const remove = { kind: 'role', role: 'button', name: 'Remove image', exact: true };
        const childImage = validContract({
            workflowId: 'P14', title: catalog.workflows[13].title, actors: ['primary'],
            mutatesProduction: true, cleanupRequired: true,
            steps: [
                { action: 'expectHidden', target: remove },
                { action: 'rememberControl', target: name, option: 'child-name' },
                { action: 'fill', target: name, value: '{RUN_MARKER}', mutationId: 'child-image' },
                { action: 'uploadSyntheticImage', target: image, mutationId: 'child-image', commitMutation: true },
                { action: 'click', target: save, mutationId: 'child-image' },
                { action: 'expectText', target: { kind: 'text', name: '{RUN_MARKER}', exact: true }, value: '{RUN_MARKER}' }
            ],
            cleanupSteps: [
                { action: 'click', target: remove, mutationId: 'child-image', scope: '{RUN_MARKER}' },
                { action: 'restoreControl', target: name, option: 'child-name', mutationId: 'child-image' },
                { action: 'click', target: save, mutationId: 'child-image' }
            ]
        });
        expect(validateContract(childImage, catalog, 'P14').workflowId).toBe('P14');
        expect(() => validateContract({
            ...childImage,
            steps: childImage.steps.filter((step) => step.action !== 'expectHidden')
        }, catalog, 'P14')).toThrow(/ordered trusted P14 primary expectHidden workflow behavior/);
    });

    it('models P26 friendship request and acceptance as one bounded restoration', () => {
        const button = (name) => ({ kind: 'role', role: 'button', name, exact: true });
        const friendship = validContract({
            workflowId: 'P26', title: catalog.workflows[25].title, actors: ['primary', 'peer'],
            mutatesProduction: true, cleanupRequired: true,
            steps: [
                { action: 'click', actor: 'primary', target: button('Add friend'), mutationId: 'friendship', scope: '{RUN_MARKER}', commitMutation: true },
                { action: 'click', actor: 'peer', target: button('Accept'), mutationId: 'friendship', scope: '{RUN_MARKER}', commitMutation: true },
                { action: 'fill', actor: 'primary', target: { kind: 'label', name: 'Message', exact: true }, value: '{RUN_MARKER}', mutationId: 'friend-message' },
                { action: 'click', actor: 'primary', target: button('Send'), mutationId: 'friend-message', scope: '{RUN_MARKER}', commitMutation: true },
                { action: 'expectText', actor: 'peer', target: { kind: 'text', name: '{RUN_MARKER}', exact: true }, value: '{RUN_MARKER}' }
            ],
            cleanupSteps: [
                { action: 'click', actor: 'primary', target: button('Delete message'), mutationId: 'friend-message', scope: '{RUN_MARKER}' },
                { action: 'restoreFriendship', actor: 'primary', mutationId: 'friendship' }
            ]
        });
        expect(validateContract(friendship, catalog, 'P26').workflowId).toBe('P26');
        expect(() => validateContract({
            ...friendship,
            cleanupSteps: [...friendship.cleanupSteps, friendship.cleanupSteps[1]]
        }, catalog, 'P26')).toThrow(/one actor|target-specific inverse/);
    });

    it('models a P22 ride request and owner confirmation as one cancellable lifecycle', () => {
        const button = (name) => ({ kind: 'role', role: 'button', name, exact: true });
        const ride = validContract({
            workflowId: 'P22', title: catalog.workflows[21].title, actors: ['primary', 'peer'],
            mutatesProduction: true, cleanupRequired: true,
            steps: [
                { action: 'click', actor: 'peer', target: button('Request spot'), mutationId: 'ride-request', scope: '{RUN_MARKER}', commitMutation: true },
                { action: 'expectText', actor: 'primary', target: { kind: 'text', name: 'Ride request pending', exact: true }, value: 'pending' },
                { action: 'click', actor: 'primary', target: button('Confirm'), mutationId: 'ride-request', scope: '{RUN_MARKER}', commitMutation: true },
                { action: 'expectText', actor: 'peer', target: { kind: 'text', name: 'confirmed', exact: false }, value: 'confirmed' }
            ],
            cleanupSteps: [
                { action: 'click', actor: 'peer', target: button('Cancel'), mutationId: 'ride-request', scope: '{RUN_MARKER}' }
            ]
        });
        expect(validateContract(ride, catalog, 'P22').workflowId).toBe('P22');

        const staleRequest = {
            ...ride,
            steps: ride.steps.map((step, index) => index === 0
                ? { ...step, target: button('Request ride') }
                : step)
        };
        expect(() => validateContract(staleRequest, catalog, 'P22'))
            .toThrow(/outside the trusted P22\/peer mutation capability/);

        const staleDecision = {
            ...ride,
            steps: ride.steps.map((step, index) => index === 2
                ? { ...step, target: button('Approve') }
                : step)
        };
        expect(() => validateContract(staleDecision, catalog, 'P22'))
            .toThrow(/outside the trusted P22\/primary mutation capability/);

        const staleOutcome = {
            ...ride,
            steps: ride.steps.map((step, index) => index === 3
                ? { ...step, target: { kind: 'text', name: 'Approved', exact: true }, value: 'Approved' }
                : step)
        };
        expect(() => validateContract(staleOutcome, catalog, 'P22'))
            .toThrow(/ordered trusted P22 peer expectVisible\|expectText workflow behavior/);
    });

    it('requires a distinct run-scoped inverse for every AI attachment', () => {
        const removeAttachment = { kind: 'role', role: 'button', name: 'Remove attachment', exact: true };
        const contract = validContract({
            workflowId: 'P36', title: catalog.workflows[35].title, actors: ['primary'],
            mutatesProduction: true, cleanupRequired: true,
            steps: [
                { action: 'uploadSyntheticImage', target: { kind: 'label', name: 'Attach image, CSV, or PDF', exact: true }, mutationId: 'ai-image', commitMutation: true },
                { action: 'expectText', target: { kind: 'text', name: 'Image attachment', exact: true }, value: 'image' },
                { action: 'uploadSyntheticDocument', target: { kind: 'label', name: 'Attach image, CSV, or PDF', exact: true }, mutationId: 'ai-document', commitMutation: true },
                { action: 'expectText', target: { kind: 'text', name: 'Document PDF', exact: true }, value: 'document' },
                { action: 'fill', target: { kind: 'label', name: 'Prompt', exact: true }, value: '{RUN_MARKER}', mutationId: 'ai-message' },
                { action: 'click', target: { kind: 'role', role: 'button', name: 'Send', exact: true }, mutationId: 'ai-message', commitMutation: true },
                { action: 'expectText', target: { kind: 'text', name: 'Assistant response', exact: true }, value: '{RUN_MARKER}' }
            ],
            cleanupSteps: [
                { action: 'click', target: removeAttachment, mutationId: 'ai-image', scope: '{RUN_MARKER}.png' },
                { action: 'click', target: removeAttachment, mutationId: 'ai-document', scope: '{RUN_MARKER}.pdf' },
                { action: 'click', target: { kind: 'role', role: 'button', name: 'Delete message', exact: true }, mutationId: 'ai-message', scope: '{RUN_MARKER}' }
            ]
        });
        expect(validateContract(contract, catalog, 'P36').workflowId).toBe('P36');
        for (const [action, staleName] of [
            ['uploadSyntheticImage', 'Image'],
            ['uploadSyntheticDocument', 'Document']
        ]) {
            expect(() => validateContract({
                ...contract,
                steps: contract.steps.map((step) => step.action === action
                    ? { ...step, target: { ...step.target, name: staleName } }
                    : step)
            }, catalog, 'P36')).toThrow(new RegExp(`trusted P36/${action} exact locator`));
        }
        expect(() => validateContract({
            ...contract,
            steps: contract.steps.map((step) => step.action === 'uploadSyntheticImage'
                ? { ...step, target: { ...step.target, kind: 'testId' } }
                : step)
        }, catalog, 'P36')).toThrow(/trusted P36\/uploadSyntheticImage exact locator/);
        expect(() => validateContract({
            ...contract,
            cleanupSteps: contract.cleanupSteps.slice(1)
        }, catalog, 'P36')).toThrow(/same mutationId|trusted target-specific inverse/);
    });

    it('makes multi-operation rideshare coverage possible and unwinds it in reverse', () => {
        const rideshare = validP21Contract();
        expect(validateContract(rideshare, catalog, 'P21').workflowId).toBe('P21');
        expect(() => validateContract({
            ...rideshare,
            cleanupSteps: [...rideshare.cleanupSteps].reverse()
        }, catalog, 'P21')).toThrow(/unwind completed operations in reverse order/);
        expect(() => validateContract({
            ...rideshare,
            steps: rideshare.steps.map((step) => step.action === 'click'
                ? { ...step, mutationId: 'one-unsafe-group' }
                : step)
        }, catalog, 'P21')).toThrow(/same mutationId|own completed operation|exactly one trusted completed/);
    });

    it('requires actor-specific workflow evidence in the trusted order', () => {
        const task = validP20Contract();
        expect(() => validateContract({
            ...task,
            steps: task.steps.map((step) => step.actor === 'peer' ? { ...step, actor: 'primary' } : step)
        }, catalog, 'P20')).toThrow(/ordered trusted P20 peer expectHidden workflow behavior/);
    });

    it('requires each catalogued workflow to exercise its trusted behavior', () => {
        const signupWithoutSubmission = validContract({
            workflowId: 'P02', title: catalog.workflows[1].title, actors: ['lifecycle'],
            mutatesProduction: true, cleanupRequired: false, lifecycleTransition: true,
            steps: [
                { action: 'fill', target: { kind: 'label', name: 'Invite code', exact: true }, value: '{LIFECYCLE_SIGNUP_INVITE_CODE}' },
                { action: 'fillActorEmail', target: { kind: 'label', name: 'Email', exact: true } },
                { action: 'fillActorPassword', target: { kind: 'label', name: 'Password', exact: true } }
            ]
        });
        expect(() => validateContract(signupWithoutSubmission, catalog, 'P02')).toThrow(/ordered trusted P02 lifecycle click workflow behavior/);
        expect(() => validateContract({
            ...signupWithoutSubmission,
            steps: [...signupWithoutSubmission.steps.filter((step) => step.action !== 'expectVisible'), {
                action: 'click', target: { kind: 'role', role: 'button', name: 'Create account', exact: true }
            }]
        }, catalog, 'P02')).toThrow(/ordered trusted P02 lifecycle expectVisible\|expectText workflow behavior/);
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
                { action: 'rememberControl', target: { kind: 'text', name: 'Full name' }, option: 'profile-name' },
                { action: 'fill', target: { kind: 'label', name: 'Full name', exact: true }, value: '{RUN_MARKER}', mutationId: 'profile-name' }
            ],
            cleanupSteps: [{
                action: 'restoreControl',
                target: { kind: 'text', name: 'Full name' },
                option: 'profile-name',
                mutationId: 'profile-name'
            }]
        });
        expect(() => validateContract(remembered, catalog, 'P12')).toThrow(/remembered controls must use exact/);
    });

    it('requires P33 to prove a manager-only upload control is denied', () => {
        const deniedUpload = {
            action: 'expectUploadDenied',
            actor: 'primary',
            target: { kind: 'testId', name: 'Manager upload', exact: true }
        };
        expect(() => assertParentCoverageStepCapability('P33', deniedUpload, 'execution', 'primary')).not.toThrow();
        expect(() => assertParentCoverageStepCapability('P33', {
            ...deniedUpload,
            target: { kind: 'testId', name: 'Upload', exact: true }
        }, 'execution', 'primary')).toThrow(/exact P33 disabled manager upload control/);
    });

    it('keeps the run-scoped P25 notification lifecycle constructible', () => {
        const button = (name) => ({ kind: 'role', role: 'button', name, exact: true });
        const emailPreference = { kind: 'label', name: 'Email', exact: true };
        const notification = validContract({
            workflowId: 'P25', title: catalog.workflows[24].title, actors: ['primary', 'peer'],
            mutatesProduction: true, cleanupRequired: true,
            steps: [
                { action: 'fill', actor: 'primary', target: { kind: 'placeholder', name: 'Message', exact: false }, value: '{RUN_MARKER}', mutationId: 'notification-message' },
                { action: 'click', actor: 'primary', target: button('Send message'), mutationId: 'notification-message', commitMutation: true },
                { action: 'expectText', actor: 'peer', target: { kind: 'text', name: 'Notification', exact: true }, value: '{RUN_MARKER}', scope: '{RUN_MARKER}' },
                { action: 'expectVisible', actor: 'peer', target: { kind: 'text', name: 'Unread', exact: true }, scope: '{RUN_MARKER}' },
                { action: 'clickAndExpectRoute', actor: 'peer', target: button('Open notification'), route: '/messages/{TEAM_ID}', scope: '{RUN_MARKER}' },
                { action: 'expectHidden', actor: 'peer', target: { kind: 'text', name: 'Unread', exact: true }, scope: '{RUN_MARKER}' },
                { action: 'expectText', actor: 'peer', target: { kind: 'text', name: 'Read', exact: true }, value: 'Read', scope: '{RUN_MARKER}' },
                { action: 'rememberControl', actor: 'primary', target: emailPreference, option: 'notification-email' },
                { action: 'uncheck', actor: 'primary', target: emailPreference, mutationId: 'notification-preference' },
                { action: 'click', actor: 'primary', target: button('Save'), mutationId: 'notification-preference', commitMutation: true }
            ],
            cleanupSteps: [
                { action: 'restoreControl', actor: 'primary', target: emailPreference, option: 'notification-email', mutationId: 'notification-preference' },
                { action: 'click', actor: 'primary', target: button('Save'), mutationId: 'notification-preference' },
                { action: 'click', actor: 'primary', target: button('Delete message'), mutationId: 'notification-message', scope: '{RUN_MARKER}' }
            ]
        });

        expect(validateContract(notification, catalog, 'P25').workflowId).toBe('P25');

        const staleInput = {
            ...notification,
            steps: notification.steps.map((step) => {
                if (step.action === 'fill') {
                    return { ...step, target: { kind: 'label', name: 'Message', exact: true } };
                }
                return step;
            })
        };
        expect(() => validateContract(staleInput, catalog, 'P25'))
            .toThrow(/trusted P25\/fill exact locator/);

        const staleSendButton = {
            ...notification,
            steps: notification.steps.map((step) => {
                if (step.action === 'click' && step.target?.name === 'Send message') {
                    return { ...step, target: button('Send') };
                }
                return step;
            })
        };
        expect(() => validateContract(staleSendButton, catalog, 'P25'))
            .toThrow(/outside the trusted P25\/primary mutation capability/);
    });

    it('does not let a lifecycle declaration transfer another actor mutation authority', () => {
        const household = validContract({
            workflowId: 'P27',
            title: catalog.workflows[26].title,
            actors: ['primary', 'lifecycle'],
            mutatesProduction: true,
            cleanupRequired: true,
            lifecycleTransition: false,
            steps: [{
                action: 'click',
                actor: 'primary',
                target: { kind: 'role', role: 'button', name: 'Accept invite' }
            }],
            cleanupSteps: [{
                action: 'click', actor: 'primary', mutationId: 'invalid-household', scope: '{LIFECYCLE_EMAIL}',
                target: { kind: 'role', role: 'button', name: 'Revoke access for {LIFECYCLE_EMAIL}', exact: true }
            }]
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
            cleanupRequired: true,
            lifecycleTransition: false,
            steps: [
                { action: 'redeemRunScopedHouseholdInvite', actor: 'primary', option: 'primary' }
            ],
            cleanupSteps: [{ action: 'restoreHouseholdAccess', actor: 'primary', mutationId: 'household' }]
        });
        expect(() => validateContract(household, catalog, 'P27')).toThrow(/restricted to P27 lifecycle from primary/);
        expect(validateContract({
            ...household,
            steps: [
                { action: 'fill', actor: 'primary', target: { kind: 'label', name: 'Email', exact: true }, value: '{LIFECYCLE_EMAIL}', mutationId: 'household' },
                { action: 'fill', actor: 'primary', target: { kind: 'label', name: 'Relation', exact: true }, value: '{RUN_MARKER}', mutationId: 'household' },
                { action: 'click', actor: 'primary', target: { kind: 'role', role: 'button', name: 'Create invite', exact: true }, mutationId: 'household', scope: '{LIFECYCLE_EMAIL}', commitMutation: true },
                { action: 'login', actor: 'lifecycle' },
                { action: 'redeemRunScopedHouseholdInvite', actor: 'lifecycle', option: 'primary', mutationId: 'household', scope: '{LIFECYCLE_EMAIL}', commitMutation: true },
                { action: 'reload', actor: 'primary' },
                { action: 'expectText', actor: 'primary', target: { kind: 'text', name: '{LIFECYCLE_EMAIL}', exact: true }, value: '{LIFECYCLE_EMAIL}' }
            ]
        }, catalog, 'P27').steps).toHaveLength(7);
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

    it('classifies Playwright failures without retaining production-derived text', () => {
        const raw = new Error('expect(locator).toContainText failed: Received "Parent 555-0109 private household chat"');
        const classification = classifyParentCoverageError(raw);
        expect(classification).toBe('assertion-failed');
        expect(classification).not.toContain('555-0109');
        expect(classification).not.toContain('household chat');
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
