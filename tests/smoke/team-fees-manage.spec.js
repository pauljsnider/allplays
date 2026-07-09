import { expect, test } from '@playwright/test';

const USER_ID = 'admin-1';

function buildTeamFeesManageUrl(baseURL) {
    const url = new URL('/team-fees.html', `${baseURL}/`);
    url.hash = 'teamId=team-1&batchId=batch-1';
    url.searchParams.set('cb', String(Date.now()));
    return url.toString();
}

const AUTH_STUB = `
export async function requireAuth() {
    return {
        uid: '${USER_ID}',
        email: 'coach@example.com'
    };
}
`;

const DB_STUB = `
const state = window.__teamFeesManageState;

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

export async function getTeam(teamId) {
    state.getTeamCalls.push({ teamId });
    return {
        id: teamId,
        name: 'Bears',
        ownerId: '${USER_ID}',
        adminEmails: ['coach@example.com']
    };
}

export async function getUserProfile(uid) {
    state.getUserProfileCalls.push({ uid });
    return {
        email: 'coach@example.com',
        isAdmin: false
    };
}

export async function getTeamFeeBatch(teamId, batchId) {
    state.getTeamFeeBatchCalls.push({ teamId, batchId });
    return {
        id: batchId,
        title: 'Summer dues',
        amountCents: 10000
    };
}

export async function listTeamFeeRecipients(teamId, batchId) {
    state.listTeamFeeRecipientsCalls.push({ teamId, batchId });
    return clone(state.recipients);
}

export async function updateTeamFeeRecipient(teamId, batchId, recipientId, updates) {
    state.updateTeamFeeRecipientCalls.push({ teamId, batchId, recipientId, updates: clone(updates) });
    const recipient = state.recipients.find((candidate) => candidate.id === recipientId);
    if (recipient) Object.assign(recipient, clone(updates));
}

export function canModerateChat() {
    return false;
}

export async function getPlayers() {
    return [];
}

export async function createTeamFeeBatch() {
    throw new Error('createTeamFeeBatch should not be called in manage mode');
}

export async function listTeamFeeBatches() {
    return [];
}
`;

const FIREBASE_STUB = `
const state = window.__teamFeesManageState;

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

export function getFunctions() {
    return { type: 'mock-functions' };
}

export function httpsCallable(_functions, name) {
    return async (payload) => {
        state.callableRefundCalls.push({ name, payload: clone(payload) });
        return { data: { ok: true } };
    };
}
`;

async function mockTeamFeesManageModules(page) {
    await page.addInitScript(() => {
        window.__teamFeesManageState = {
            getTeamCalls: [],
            getUserProfileCalls: [],
            getTeamFeeBatchCalls: [],
            listTeamFeeRecipientsCalls: [],
            updateTeamFeeRecipientCalls: [],
            callableRefundCalls: [],
            recipients: [
                {
                    id: 'unpaid-1',
                    playerName: 'Unpaid Player',
                    amountCents: 10000,
                    amountDueCents: 10000,
                    amountPaidCents: 0,
                    status: 'unpaid'
                },
                {
                    id: 'partial-1',
                    playerName: 'Partial Player',
                    amountCents: 10000,
                    amountDueCents: 10000,
                    amountPaidCents: 2500,
                    status: 'partial',
                    manualPayment: { note: 'Deposit recorded' }
                },
                {
                    id: 'paid-1',
                    playerName: 'Paid Player',
                    amountCents: 10000,
                    amountDueCents: 10000,
                    amountPaidCents: 10000,
                    status: 'paid',
                    manualPayment: { note: 'Cash paid in full' }
                },
                {
                    id: 'stripe-1',
                    playerName: 'Stripe Player',
                    amountCents: 10000,
                    amountDueCents: 10000,
                    amountPaidCents: 10000,
                    paymentProvider: 'stripe',
                    hasAdminBilling: true,
                    adminBilling: {
                        stripePaymentIntentId: 'pi_123',
                        stripeChargeId: 'ch_123'
                    },
                    status: 'paid'
                },
                {
                    id: 'canceled-1',
                    playerName: 'Canceled Player',
                    amountCents: 10000,
                    amountDueCents: 0,
                    amountPaidCents: 0,
                    status: 'canceled'
                }
            ]
        };
    });

    await page.route(/https:\/\/cdn\.tailwindcss\.com\/.*/, (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: "window.tailwind = window.tailwind || {}; const style = document.createElement('style'); style.textContent = '.hidden{display:none!important}'; document.head.appendChild(style);"
    }));
    await page.route(/\/js\/telemetry\.js(?:\?v=\d+)?$/, (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: ''
    }));
    await page.route(/\/js\/auth\.js(?:\?v=\d+)?$/, (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: AUTH_STUB
    }));
    await page.route(/\/js\/db\.js(?:\?v=\d+)?$/, (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: DB_STUB
    }));
    await page.route(/\/js\/firebase\.js(?:\?v=\d+)?$/, (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: FIREBASE_STUB
    }));
}

test('team fees manage page records manual payments and refunds through delegated controls', async ({ page, baseURL }) => {
    await mockTeamFeesManageModules(page);
    await page.goto(buildTeamFeesManageUrl(baseURL), { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('heading', { name: 'Summer dues' })).toBeVisible();
    await expect(page.getByText('5 assigned recipients')).toBeVisible();

    const unpaidRecipient = page.locator('[data-recipient-id="unpaid-1"]');
    await expect(unpaidRecipient.getByRole('heading', { name: 'Unpaid Player' })).toBeVisible();
    await expect(unpaidRecipient).toContainText('Assigned $100.00');
    await expect(unpaidRecipient).toContainText('Paid $0.00');
    await expect(unpaidRecipient).toContainText('Outstanding $100.00');
    await expect(unpaidRecipient.locator('form[data-action="paid"]')).toBeVisible();
    await expect(unpaidRecipient.locator('form[data-action="adjust"]')).toBeVisible();
    await expect(unpaidRecipient.locator('[data-refund-action]')).toBeDisabled();

    const partialRecipient = page.locator('[data-recipient-id="partial-1"]');
    await expect(partialRecipient).toContainText('Paid $25.00');
    await expect(partialRecipient).toContainText('Outstanding $75.00');
    await expect(partialRecipient.locator('[data-refund-action]')).toBeEnabled();

    const paidRecipient = page.locator('[data-recipient-id="paid-1"]');
    await expect(paidRecipient).toContainText('Paid $100.00');
    await expect(paidRecipient).toContainText('Outstanding $0.00');
    await expect(paidRecipient.locator('form[data-action="cancel"]')).toContainText('Refund paid recipients before canceling their balance.');
    await expect(paidRecipient.locator('form[data-action="cancel"] button')).toBeDisabled();
    await expect(paidRecipient.locator('[data-refund-action]')).toBeEnabled();

    const stripeRecipient = page.locator('[data-recipient-id="stripe-1"]');
    await expect(stripeRecipient.locator('form[data-action="refund"]')).toBeVisible();
    await expect(stripeRecipient.getByRole('button', { name: 'Issue refund' })).toBeVisible();

    await unpaidRecipient.locator('form[data-action="paid"] input[name="amount"]').fill('25.00');
    await unpaidRecipient.locator('form[data-action="paid"] input[name="date"]').fill('2026-07-09');
    await unpaidRecipient.locator('form[data-action="paid"] input[name="note"]').fill('Cash deposit');
    await unpaidRecipient.locator('form[data-action="paid"]').evaluate((form) => form.requestSubmit());

    await expect(page.getByText('Fee recipient updated.')).toBeVisible();
    const manualPaymentCall = await page.evaluate(() => window.__teamFeesManageState.updateTeamFeeRecipientCalls.at(-1));
    expect(manualPaymentCall).toMatchObject({
        teamId: 'team-1',
        batchId: 'batch-1',
        recipientId: 'unpaid-1',
        updates: {
            status: 'partial',
            amountPaidCents: 2500,
            remainingBalanceCents: 7500,
            manualPayment: {
                amountPaidCents: 2500,
                paidAt: '2026-07-09'
            },
            adminBilling: {
                type: 'offline_payment',
                amountPaidCents: 2500,
                paidAt: '2026-07-09',
                note: 'Cash deposit',
                recordedBy: USER_ID
            }
        }
    });
    expect(manualPaymentCall.updates.ledgerEntries).toEqual([
        expect.objectContaining({
            type: 'offline_payment',
            amountCents: 2500,
            paymentDate: '2026-07-09'
        })
    ]);
    await expect.poll(() => page.evaluate(() => window.__teamFeesManageState.listTeamFeeRecipientsCalls.length)).toBe(2);

    await paidRecipient.locator('[data-refund-action]').click();
    await expect(page.locator('#refund-modal')).toContainText('Record an offline refund up to $100.00.');
    await page.locator('#refund-form select[name="method"]').selectOption('check');
    await page.locator('#refund-form textarea[name="note"]').fill('Check refund issued after duplicate collection.');
    await page.locator('#refund-form').evaluate((form) => form.requestSubmit());

    await expect(page.getByText('Offline refund recorded.')).toBeVisible();
    const offlineRefundCall = await page.evaluate(() => window.__teamFeesManageState.updateTeamFeeRecipientCalls.at(-1));
    expect(offlineRefundCall).toMatchObject({
        teamId: 'team-1',
        batchId: 'batch-1',
        recipientId: 'paid-1',
        updates: {
            status: 'unpaid',
            amountPaidCents: 0,
            remainingBalanceCents: 10000,
            refunded: {
                amountCents: 10000,
                refundType: 'full',
                refundMethod: 'check'
            },
            adminBilling: {
                type: 'offline_refund',
                refundAmountCents: 10000,
                refundType: 'full',
                refundMethod: 'check',
                note: 'Check refund issued after duplicate collection.',
                recordedBy: USER_ID
            }
        }
    });
    expect(offlineRefundCall.updates.ledgerEntries).toEqual([
        expect.objectContaining({
            type: 'offline_refund',
            amountCents: -10000,
            refundAmountCents: 10000,
            refundMethod: 'check'
        })
    ]);

    const directUpdateCountBeforeOnlineRefund = await page.evaluate(() => window.__teamFeesManageState.updateTeamFeeRecipientCalls.length);
    await stripeRecipient.locator('form[data-action="refund"] input[name="amount"]').fill('15.00');
    await stripeRecipient.locator('form[data-action="refund"] input[name="reason"]').fill('Partial Stripe refund');
    await stripeRecipient.locator('form[data-action="refund"]').evaluate((form) => form.requestSubmit());

    await expect(page.getByText('Stripe refund submitted.')).toBeVisible();
    const callableRefundCall = await page.evaluate(() => window.__teamFeesManageState.callableRefundCalls.at(-1));
    expect(callableRefundCall).toMatchObject({
        name: 'refundStripeTeamFeePayment',
        payload: {
            teamId: 'team-1',
            batchId: 'batch-1',
            recipientId: 'stripe-1',
            amountCents: 1500,
            reason: 'Partial Stripe refund'
        }
    });
    expect(callableRefundCall.payload.refundRequestId).toEqual(expect.any(String));
    await expect.poll(() => page.evaluate(() => window.__teamFeesManageState.updateTeamFeeRecipientCalls.length)).toBe(directUpdateCountBeforeOnlineRefund);
    await expect.poll(() => page.evaluate(() => window.__teamFeesManageState.listTeamFeeRecipientsCalls.length)).toBe(4);
});
