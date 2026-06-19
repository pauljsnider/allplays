import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const functionsSource = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');

function extractChunk(startMarker, endMarker) {
    const start = functionsSource.indexOf(startMarker);
    const end = functionsSource.indexOf(endMarker, start);
    if (start === -1 || end === -1) {
        throw new Error(`Unable to extract source chunk for ${startMarker}.`);
    }
    return functionsSource.slice(start, end);
}

function extractNotifyFeeMarkedPaid() {
    return [
        extractChunk('function buildStaffFeeNotificationDestination(', 'function buildNotificationLink'),
        extractChunk('function formatMoneyFromCents(', 'function normalizeTeamChatConversationId'),
        extractChunk('function getFeePaymentAmountCents(', 'function getFeePayerIdentity'),
        extractChunk('function getFeePayerIdentity(', 'function normalizeTeamChatConversationId'),
        extractChunk('exports.notifyFeeMarkedPaid = functions.firestore', 'exports.notifyFeeAssigned = functions.firestore')
    ].join('\n');
}

function buildTriggerHarness({
    categories = ['fees', 'schedule'],
    targets = [],
    users = []
} = {}) {
    const sendDirectTargetsNotification = vi.fn(async () => ({ successCount: 1, failureCount: 0 }));
    const getTargetsForCategory = vi.fn(async () => targets);
    const getCandidateUsersForTeam = vi.fn(async () => users);
    const functions = {
        firestore: {
            document: vi.fn(() => ({
                onWrite: vi.fn((handler) => handler)
            }))
        },
        logger: {
            error: vi.fn(),
            warn: vi.fn()
        }
    };
    const exportsObject = {};
    const factory = new Function(
        'exports',
        'functions',
        'NOTIFICATION_CATEGORIES',
        'getTargetsForCategory',
        'getCandidateUsersForTeam',
        'sendDirectTargetsNotification',
        `${extractNotifyFeeMarkedPaid()}\nreturn exports.notifyFeeMarkedPaid;`
    );
    const trigger = factory(
        exportsObject,
        functions,
        categories,
        getTargetsForCategory,
        getCandidateUsersForTeam,
        sendDirectTargetsNotification
    );

    return {
        trigger,
        sendDirectTargetsNotification,
        getTargetsForCategory,
        getCandidateUsersForTeam,
        functions
    };
}

describe('notifyFeeMarkedPaid trigger', () => {
    it('fires on status changes to paid and limits staff notifications to staff targets', async () => {
        const harness = buildTriggerHarness({
            targets: [
                { uid: 'parent-1', token: 'parent-token', teamId: 'team-1' },
                { uid: 'staff-1', token: 'staff-token', teamId: 'team-1' },
                { uid: 'staff-2', token: 'staff-2-token', teamId: 'team-1' }
            ],
            users: [
                { uid: 'parent-1', roles: ['parent'] },
                { uid: 'staff-1', roles: ['staff'] },
                { uid: 'staff-2', roles: ['staff', 'parent'] }
            ]
        });

        await harness.trigger({
            before: { exists: true, data: () => ({ status: 'unpaid' }) },
            after: { exists: true, data: () => ({ status: 'paid', feeTitle: 'Spring dues', parentUserId: 'parent-1', parentName: 'Pat Parent', manualPayment: { amountPaidCents: 10000 } }) }
        }, {
            params: { teamId: 'team-1', batchId: 'batch-1', recipientId: 'recipient-1' }
        });

        expect(harness.getTargetsForCategory).toHaveBeenCalledWith('team-1', 'fees', null);
        expect(harness.getCandidateUsersForTeam).toHaveBeenCalledWith('team-1');
        expect(harness.sendDirectTargetsNotification).toHaveBeenCalledTimes(2);
        expect(harness.sendDirectTargetsNotification).toHaveBeenNthCalledWith(1, expect.objectContaining({
            targets: [{ uid: 'parent-1', token: 'parent-token', teamId: 'team-1' }],
            title: 'Payment received: Spring dues',
            body: 'We received your $100.00 payment. Thank you!'
        }));
        expect(harness.sendDirectTargetsNotification).toHaveBeenNthCalledWith(2, expect.objectContaining({
            targets: [
                { uid: 'staff-1', token: 'staff-token', teamId: 'team-1' },
                { uid: 'staff-2', token: 'staff-2-token', teamId: 'team-1' }
            ],
            title: 'Fee paid: Spring dues',
            body: 'Pat Parent paid $100.00.',
            batchId: 'batch-1',
            recipientId: 'recipient-1',
            linkOverride: 'https://allplays.ai/app/#/teams/team-1/fees/batch-1?recipientId=recipient-1',
            appRouteOverride: '/teams/team-1/fees/batch-1?recipientId=recipient-1'
        }));
    });

    it('sends a balance-paid message instead of a payment receipt when credits mark the fee paid', async () => {
        const harness = buildTriggerHarness({
            targets: [
                { uid: 'parent-1', token: 'parent-token', teamId: 'team-1' },
                { uid: 'staff-1', token: 'staff-token', teamId: 'team-1' }
            ],
            users: [{ uid: 'staff-1', roles: ['staff'] }]
        });

        await harness.trigger({
            before: { exists: true, data: () => ({ status: 'pending', parentName: 'Pat Parent', amountPaidCents: 2500 }) },
            after: {
                exists: true,
                data: () => ({
                    status: 'paid',
                    feeTitle: 'Spring dues',
                    userId: 'parent-1',
                    parentName: 'Pat Parent',
                    amountPaidCents: 2500,
                    amountDueCents: 2500
                })
            }
        }, {
            params: { teamId: 'team-1', batchId: 'batch-1', recipientId: 'recipient-1' }
        });

        expect(harness.sendDirectTargetsNotification).toHaveBeenCalledTimes(2);
        expect(harness.sendDirectTargetsNotification).toHaveBeenNthCalledWith(1, expect.objectContaining({
            title: 'Fee paid: Spring dues',
            body: 'Your fee balance is now marked as paid.'
        }));
        expect(harness.sendDirectTargetsNotification).toHaveBeenNthCalledWith(2, expect.objectContaining({
            title: 'Fee paid: Spring dues',
            body: "Pat Parent's fee balance is now marked as paid."
        }));
    });

    it('does not send when an already-paid recipient gets an unrelated update', async () => {
        const harness = buildTriggerHarness({
            targets: [{ uid: 'staff-1', token: 'staff-token', teamId: 'team-1' }],
            users: [{ uid: 'staff-1', roles: ['staff'] }]
        });

        await harness.trigger({
            before: { exists: true, data: () => ({ status: 'paid', feeTitle: 'Spring dues', parentName: 'Pat Parent', amountPaidCents: 10000 }) },
            after: { exists: true, data: () => ({ status: 'paid', feeTitle: 'Spring dues', parentName: 'Pat Parent', amountPaidCents: 10000, updatedAt: 'later' }) }
        }, {
            params: { teamId: 'team-1', batchId: 'batch-1', recipientId: 'recipient-1' }
        });

        expect(harness.getTargetsForCategory).not.toHaveBeenCalled();
        expect(harness.sendDirectTargetsNotification).not.toHaveBeenCalled();
    });

    it('logs and exits when the fees notification category is unavailable', async () => {
        const harness = buildTriggerHarness({ categories: ['schedule'] });

        await harness.trigger({
            before: { exists: true, data: () => ({ status: 'unpaid' }) },
            after: { exists: true, data: () => ({ status: 'paid', feeTitle: 'Camp fee' }) }
        }, {
            params: { teamId: 'team-1', recipientId: 'recipient-1' }
        });

        expect(harness.functions.logger.error).toHaveBeenCalledWith(
            'notifyFeeMarkedPaid requires the fees notification category.',
            expect.objectContaining({ teamId: 'team-1' })
        );
        expect(harness.getTargetsForCategory).not.toHaveBeenCalled();
        expect(harness.sendDirectTargetsNotification).not.toHaveBeenCalled();
    });
});
