import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    CONTRACT_SCHEMA_VERSION,
    createSanitizedParentCoverageError,
    interpolateTemplate,
    redactParentCoverageValue,
    stableFailureSignature,
    validateCatalog,
    validateContract
} from '../../scripts/parent-coverage-contract.mjs';

const catalog = JSON.parse(readFileSync('tests/parent-census/workflows.json', 'utf8'));

function validContract(overrides = {}) {
    return {
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        workflowId: 'P01',
        title: catalog.workflows[0].title,
        actors: ['anonymous'],
        viewport: 'mobile',
        mutatesProduction: false,
        cleanupRequired: false,
        lifecycleTransition: false,
        steps: [
            { action: 'goto', route: '/auth' },
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
        const reversible = {
            ...validContract(),
            workflowId: 'P12',
            title: catalog.workflows[11].title,
            actors: ['primary'],
            mutatesProduction: true,
            cleanupRequired: true,
            steps: [
                { action: 'rememberControl', target: { kind: 'label', name: 'Name' }, option: 'profile-name' }
            ]
        };
        expect(() => validateContract({
            ...reversible,
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
        }, catalog, 'P01')).toThrow(/action click is not allowed for workflow P01/);
        expect(() => validateContract({
            ...validContract(),
            steps: [{ action: 'goto', route: '/profile/settings' }]
        }, catalog, 'P01')).toThrow(/outside the trusted scope/);

        const reversible = validContract({
            workflowId: 'P12',
            title: catalog.workflows[11].title,
            actors: ['primary'],
            mutatesProduction: true,
            cleanupRequired: true,
            steps: [{ action: 'rememberControl', target: { kind: 'label', name: 'Name' }, option: 'name' }],
            cleanupSteps: [{ action: 'click', target: { kind: 'role', role: 'button', name: 'Delete account' } }]
        });
        expect(() => validateContract(reversible, catalog, 'P12')).toThrow(/cleanup action click is not allowed/);
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
                { action: 'fillActorEmail', actor: 'lifecycle', target: { kind: 'label', name: 'Email' } },
                { action: 'fillActorPassword', actor: 'lifecycle', target: { kind: 'label', name: 'Password' } }
            ],
            cleanupSteps: []
        });
        expect(validateContract(signup, catalog, 'P02').steps).toHaveLength(2);
        expect(() => validateContract({
            ...signup,
            steps: [{
                action: 'fillActorPassword',
                actor: 'lifecycle',
                target: { kind: 'label', name: 'Password' },
                value: 'embedded-password'
            }]
        }, catalog, 'P02')).toThrow(/unsupported key value/);
    });

    it('restricts the checkout popup primitive to the two checkout workflows', () => {
        const target = { kind: 'role', role: 'button', name: 'Pay fee' };
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
        expect(validateContract(checkout, catalog, 'P30').steps).toHaveLength(1);
    });

    it('restricts non-cleaned lifecycle transitions to the locked fixture sequence', () => {
        expect(() => validateContract({
            ...validContract(),
            mutatesProduction: true,
            lifecycleTransition: true
        }, catalog, 'P01')).toThrow(/locked lifecycle fixture sequence/);
    });

    it('requires paired control-state keys for reversible fixture edits', () => {
        const reversible = validContract({
            workflowId: 'P12',
            title: catalog.workflows[11].title,
            actors: ['primary'],
            mutatesProduction: true,
            cleanupRequired: true,
            steps: [
                { action: 'rememberControl', target: { kind: 'label', name: 'Name' }, option: 'profile-name' },
                { action: 'fill', target: { kind: 'label', name: 'Name' }, value: '{RUN_MARKER}' }
            ],
            cleanupSteps: [
                { action: 'restoreControl', target: { kind: 'label', name: 'Name' }, option: 'profile-name' }
            ]
        });
        expect(validateContract(reversible, catalog, 'P12').cleanupSteps).toHaveLength(1);
        expect(() => validateContract({
            ...reversible,
            cleanupSteps: [{
                action: 'restoreControl',
                target: { kind: 'label', name: 'Name' },
                option: 'Bad Key'
            }]
        }, catalog, 'P12')).toThrow(/stable lowercase state key/);
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

    it('creates a replacement error without leaking a raw Firebase action URL', () => {
        const rawUrl = 'https://game-flow-c6311.firebaseapp.com/__/auth/action?mode=verifyEmail&oobCode=raw-secret-code&apiKey=raw-api-key';
        const sanitized = createSanitizedParentCoverageError(new Error(`page.goto: ${rawUrl}`));
        expect(sanitized).not.toBeInstanceOf(TypeError);
        expect(sanitized.message).not.toContain('raw-secret-code');
        expect(sanitized.message).not.toContain('raw-api-key');
        expect(sanitized.stack).not.toContain('raw-secret-code');
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
});
