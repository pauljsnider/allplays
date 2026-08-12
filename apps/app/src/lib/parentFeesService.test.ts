import { beforeEach, describe, expect, it, vi } from 'vitest';

const legacyParentToolsMocks = vi.hoisted(() => ({
    formatParentFeeAmount: vi.fn(() => '$100.00'),
    formatParentFeeDueDate: vi.fn(() => 'Aug 15, 2026'),
    getParentFeeStatusMeta: vi.fn(() => ({ label: 'Unpaid' })),
    initiateTeamFeeCheckout: vi.fn(),
    normalizeParentFeeRecord: vi.fn((fee: any) => ({
        ...fee,
        checkoutUrl: fee.checkoutUrl || fee.checkoutURL || fee.paymentLink || fee.paymentLinkUrl || fee.paymentUrl || ''
    })),
    sortParentFeeRecords: vi.fn((fees: any[]) => fees)
}));

const parentFeeRecipientMocks = vi.hoisted(() => ({
    listParentTeamFeeRecipientsForApp: vi.fn()
}));
const nativeCallableMocks = vi.hoisted(() => ({ callNativeFirebaseFunction: vi.fn() }));
const nativeRuntimeMocks = vi.hoisted(() => ({ isNativeRuntime: vi.fn() }));

vi.mock('./adapters/legacyParentTools', () => legacyParentToolsMocks);
vi.mock('./parentFeeRecipientsService', () => parentFeeRecipientMocks);
vi.mock('./nativeCallable', () => nativeCallableMocks);
vi.mock('./nativeRuntime', () => nativeRuntimeMocks);

import { initiateParentTeamFeeCheckout, loadParentFeesForApp } from './parentFeesService';

const user = { uid: 'parent-1', parentOf: [] } as any;

function payableFee(overrides: Record<string, unknown> = {}) {
    return {
        teamId: 'team-1',
        batchId: 'batch-1',
        recipientId: 'recipient-1',
        collectionMode: 'online_stripe',
        status: 'unpaid',
        balanceDueCents: 10000,
        checkoutStatus: 'open',
        checkoutUrl: '',
        ...overrides
    };
}

describe('parentFeesService checkout destinations', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        nativeRuntimeMocks.isNativeRuntime.mockReturnValue(false);
        parentFeeRecipientMocks.listParentTeamFeeRecipientsForApp.mockResolvedValue([]);
    });

    it('regenerates even a trusted stored Stripe destination through the same-payer callable', async () => {
        const checkoutUrl = 'https://checkout.stripe.com/c/pay/session-1';
        parentFeeRecipientMocks.listParentTeamFeeRecipientsForApp.mockResolvedValue([
            payableFee({ checkoutUrl })
        ]);

        const [fee] = await loadParentFeesForApp(user);

        expect(fee).toEqual(expect.objectContaining({
            checkoutUrl: '',
            canPay: true,
            checkoutInitiatable: true,
            paymentAction: 'createCheckout'
        }));
    });

    it.each([
        ['HTTP', 'http://checkout.stripe.com/c/pay/insecure'],
        ['malformed', 'not a url'],
        ['credential-bearing', 'https://user:password@checkout.stripe.com/c/pay/credentialed'],
        ['non-Stripe', 'https://checkout.stripe.com.attacker.example/c/pay/lookalike'],
        ['explicit-port', 'https://checkout.stripe.com:8443/c/pay/nonstandard-port']
    ])('scrubs a %s stored destination and selects regeneration', async (_caseName, checkoutUrl) => {
        parentFeeRecipientMocks.listParentTeamFeeRecipientsForApp.mockResolvedValue([
            payableFee({ checkoutUrl })
        ]);

        const [fee] = await loadParentFeesForApp(user);

        expect(fee).toEqual(expect.objectContaining({
            checkoutUrl: '',
            canPay: true,
            checkoutInitiatable: true,
            paymentAction: 'createCheckout'
        }));
    });

    it('selects regeneration when an online fee has no stored destination', async () => {
        parentFeeRecipientMocks.listParentTeamFeeRecipientsForApp.mockResolvedValue([payableFee()]);

        const [fee] = await loadParentFeesForApp(user);

        expect(fee).toEqual(expect.objectContaining({
            checkoutUrl: '',
            canPay: true,
            checkoutInitiatable: true,
            paymentAction: 'createCheckout'
        }));
    });

    it('preserves due-date metadata while sanitizing the checkout destination', async () => {
        parentFeeRecipientMocks.listParentTeamFeeRecipientsForApp.mockResolvedValue([
            payableFee({
                dueDate: '2026-08-15',
                checkoutUrl: 'https://attacker.example/checkout'
            })
        ]);

        const [fee] = await loadParentFeesForApp(user);

        expect(legacyParentToolsMocks.formatParentFeeDueDate).toHaveBeenCalledWith('2026-08-15');
        expect(fee).toEqual(expect.objectContaining({
            dueDate: '2026-08-15',
            dueLabel: 'Aug 15, 2026',
            checkoutUrl: ''
        }));
    });

    it.each(['checkoutURL', 'paymentLink', 'paymentLinkUrl', 'paymentUrl'])(
        'removes a rejected %s alias from the returned record',
        async (field) => {
            const rejectedUrl = 'https://attacker.example/checkout';
            parentFeeRecipientMocks.listParentTeamFeeRecipientsForApp.mockResolvedValue([
                payableFee({ [field]: rejectedUrl })
            ]);

            const [fee] = await loadParentFeesForApp(user);

            expect(fee).toEqual(expect.objectContaining({
                checkoutUrl: '',
                checkoutInitiatable: true,
                paymentAction: 'createCheckout'
            }));
            expect(fee).not.toHaveProperty(field);
            expect(Object.values(fee)).not.toContain(rejectedUrl);
        }
    );

    it('returns a trusted destination created by the server', async () => {
        const checkoutUrl = 'https://checkout.stripe.com/c/pay/generated';
        legacyParentToolsMocks.initiateTeamFeeCheckout.mockResolvedValue(checkoutUrl);

        await expect(initiateParentTeamFeeCheckout('team-1', 'batch-1', 'recipient-1'))
            .resolves.toEqual({ success: true, checkoutUrl });
        expect(legacyParentToolsMocks.initiateTeamFeeCheckout).toHaveBeenCalledWith({
            teamId: 'team-1',
            batchId: 'batch-1',
            recipientId: 'recipient-1'
        });
    });

    it('creates native checkout with the native-authenticated callable transport', async () => {
        const checkoutUrl = 'https://checkout.stripe.com/c/pay/native-generated';
        nativeRuntimeMocks.isNativeRuntime.mockReturnValue(true);
        nativeCallableMocks.callNativeFirebaseFunction.mockResolvedValue({ checkoutUrl, sessionId: 'session-1' });

        await expect(initiateParentTeamFeeCheckout('team-1', 'batch-1', 'recipient-1'))
            .resolves.toEqual({ success: true, checkoutUrl });
        expect(nativeCallableMocks.callNativeFirebaseFunction).toHaveBeenCalledWith(
            'createStripeTeamFeeCheckout',
            { teamId: 'team-1', batchId: 'batch-1', recipientId: 'recipient-1' },
            { errorLabel: 'Team fee checkout' }
        );
        expect(legacyParentToolsMocks.initiateTeamFeeCheckout).not.toHaveBeenCalled();
    });

    it.each([
        ['missing', ''],
        ['malformed', 'not a url'],
        ['HTTP', 'http://checkout.stripe.com/c/pay/insecure'],
        ['credential-bearing', 'https://user:password@checkout.stripe.com/c/pay/credentialed'],
        ['non-Stripe', 'https://attacker.example/checkout']
    ])('rejects a %s server destination recoverably', async (_caseName, checkoutUrl) => {
        legacyParentToolsMocks.initiateTeamFeeCheckout.mockResolvedValue(checkoutUrl);

        await expect(initiateParentTeamFeeCheckout('team-1', 'batch-1', 'recipient-1'))
            .rejects.toThrow('Unable to get a trusted Stripe checkout link. Try again.');
    });

    it('propagates checkout regeneration failures without returning a destination', async () => {
        legacyParentToolsMocks.initiateTeamFeeCheckout.mockRejectedValue(new Error('checkout unavailable'));

        await expect(initiateParentTeamFeeCheckout('team-1', 'batch-1', 'recipient-1'))
            .rejects.toThrow('checkout unavailable');
    });
});
