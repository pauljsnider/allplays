import { test, expect } from '@playwright/test';
import { buildUrl } from './helpers/boot-path.js';

function encodeModuleValue(value) {
    return Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
}

function registrationForm(overrides = {}) {
    return {
        programName: 'Summer Skills Camp',
        description: 'Build skills before tryouts.',
        season: 'Summer 2026',
        feeAmountCents: 12000,
        currency: 'USD',
        published: true,
        paymentSettings: {
            offlinePaymentEnabled: true,
            onlineCheckoutEnabled: false
        },
        discountRules: [
            {
                id: 'sibling',
                type: 'quantity',
                label: 'Sibling discount',
                amountType: 'fixed',
                amountValue: 2000,
                minimumQuantity: 2,
                active: true
            }
        ],
        installmentPlan: {
            enabled: true,
            title: 'Two payments',
            installmentCount: 2,
            intervalDays: 30,
            firstDueDate: '2026-07-01'
        },
        participantFields: [
            { id: 'firstName', label: 'Player first name', type: 'text', required: true },
            { id: 'age', label: 'Player age', type: 'number', required: true }
        ],
        guardianFields: [
            { id: 'guardianName', label: 'Guardian name', type: 'text', required: true },
            { id: 'email', label: 'Guardian email', type: 'email', required: true }
        ],
        waiverText: 'I accept the registration waiver.',
        registrationOptions: [
            {
                id: 'u10',
                title: 'U10 Travel',
                description: 'Waitlist-only group.',
                capacityLimit: 1,
                waitlistEnabled: true,
                active: true
            },
            {
                id: 'u12',
                title: 'U12 Travel',
                description: 'Open roster spots.',
                capacityLimit: 10,
                waitlistEnabled: false,
                active: true
            }
        ],
        registrationOptionCounts: {
            u10: { enrolled: 1, waitlisted: 0 },
            u12: { enrolled: 3, waitlisted: 0 }
        },
        ...overrides
    };
}

async function mockRegistrationModules(page, { form = registrationForm(), submitResult = { status: 'pending', registrationId: 'reg-1' } } = {}) {
    const encodedForm = encodeModuleValue(form);
    const encodedSubmitResult = encodeModuleValue(submitResult);

    await page.addInitScript(() => {
        window.__registrationCalls = [];
        window.__registrationStripeCalls = [];
        window.__registrationCancelCalls = [];
    });

    await page.route(/\/js\/firebase\.js\?v=\d+$/, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/javascript',
            body: `
                const form = JSON.parse(atob('${encodedForm}'));
                const submitResult = JSON.parse(atob('${encodedSubmitResult}'));

                export const db = {};
                export function doc(_db, ...segments) {
                    return { path: segments.join('/') };
                }

                export async function getDoc(ref) {
                    window.__registrationCalls.push({ name: 'getDoc', path: ref.path });
                    return {
                        exists: () => true,
                        data: () => form
                    };
                }

                export function getFunctions() {
                    return {};
                }

                export function httpsCallable(_functions, name) {
                    return async (payload) => {
                        window.__registrationCalls.push({ name, payload });
                        if (name === 'submitPublicRegistration') {
                            return { data: submitResult };
                        }
                        throw new Error('Unexpected callable: ' + name);
                    };
                }
            `
        });
    });

    await page.route(/\/js\/utils\.js\?v=\d+$/, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/javascript',
            body: `
                export function renderHeader(container) {
                    if (container) container.innerHTML = '<header data-test-id="mock-header"></header>';
                }
                export function renderFooter(container) {
                    if (container) container.innerHTML = '<footer data-test-id="mock-footer"></footer>';
                }
            `
        });
    });

    await page.route(/\/js\/stripe-service\.js$/, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/javascript',
            body: `
                export async function initiateStripeCheckout(params) {
                    window.__registrationStripeCalls.push(params);
                    return new URL('#stripe-checkout', window.location.href).toString();
                }
                export async function cancelStripeRegistrationCheckout(params) {
                    window.__registrationCancelCalls.push(params);
                    return { released: true, nextPublicCheckoutCapability: 'cap-next' };
                }
            `
        });
    });
}

async function fillRequiredRegistrationFields(page) {
    await page.locator('[name="participant.firstName"]').fill('Avery');
    await page.locator('[name="participant.age"]').fill('11');
    await page.locator('[name="guardian.guardianName"]').fill('Pat Parent');
    await page.locator('[name="guardian.email"]').fill('parent@example.com');
    await page.locator('#waiver-accepted').check();
}

test('buildUrl preserves preview path prefixes for registration smoke coverage', async () => {
    const url = new URL(buildUrl('https://host/preview', '/registration.html?teamId=team-1&formId=form-1'));

    expect(url.origin).toBe('https://host');
    expect(url.pathname).toBe('/preview/registration.html');
    expect(url.searchParams.get('teamId')).toBe('team-1');
    expect(url.searchParams.get('formId')).toBe('form-1');
    expect(url.searchParams.get('cb')).toMatch(/^\d+$/);
});

test('public registration submits an offline-payment registration with option, plan, quantity, and waiver details', async ({ page, baseURL }) => {
    await mockRegistrationModules(page);
    await page.goto(buildUrl(baseURL, '/registration.html?teamId=team-1&formId=form-1'), { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('heading', { name: 'Summer Skills Camp' })).toBeVisible();
    await expect(page.locator('#program-fee')).toHaveText('$120.00');
    await expect(page.locator('#registration-options')).toContainText('U10 Travel');
    await expect(page.locator('#registration-options')).toContainText('(Full - Waitlist Available)');
    await expect(page.locator('#registration-options')).toContainText('U12 Travel');
    await expect(page.locator('#payment-plan-options')).toContainText('Two payments');

    await page.locator('#registration-quantity').fill('2');
    await expect(page.locator('#fee-summary-lines')).toContainText('Sibling discount');
    await expect(page.locator('#fee-summary-lines')).toContainText('$220.00');

    await fillRequiredRegistrationFields(page);
    await page.locator('input[name="paymentPlanId"][value="installments"]').check();
    await page.getByRole('button', { name: 'Submit registration' }).click();

    await expect(page.getByRole('heading', { name: 'Registration submitted' })).toBeVisible();
    const calls = await page.evaluate(() => window.__registrationCalls);
    const submitCall = calls.find((call) => call.name === 'submitPublicRegistration');
    expect(submitCall.payload).toMatchObject({
        teamId: 'team-1',
        formId: 'form-1',
        participant: { firstName: 'Avery', age: '11' },
        guardian: { guardianName: 'Pat Parent', email: 'parent@example.com' },
        waiverAccepted: true,
        selectedPaymentPlanId: 'installments',
        selectedOptionId: 'u12',
        quantity: 2
    });
});

test('public registration shows an unavailable state when all configured options are full', async ({ page, baseURL }) => {
    await mockRegistrationModules(page, {
        form: registrationForm({
            registrationOptions: [
                {
                    id: 'u10',
                    title: 'U10 Travel',
                    description: 'Roster is full.',
                    capacityLimit: 1,
                    waitlistEnabled: false,
                    active: true
                }
            ],
            registrationOptionCounts: {
                u10: { enrolled: 1, waitlisted: 0 }
            }
        })
    });
    await page.goto(buildUrl(baseURL, '/registration.html?teamId=team-1&formId=form-1'), { waitUntil: 'domcontentloaded' });

    await expect(page.getByText('Registration is currently unavailable. No registration options are available.')).toBeVisible();
    await expect(page.locator('#registration-options')).toBeEmpty();
    await expect(page.getByRole('button', { name: 'Submit registration' })).toBeDisabled();

    const calls = await page.evaluate(() => window.__registrationCalls);
    expect(calls.filter((call) => call.name === 'submitPublicRegistration')).toEqual([]);
});

test('online registration prepares one server registration and redirects to Stripe checkout', async ({ page, baseURL }) => {
    await mockRegistrationModules(page, {
        form: registrationForm({
            paymentSettings: {
                offlinePaymentEnabled: false,
                onlineCheckoutEnabled: true
            }
        })
    });
    await page.goto(buildUrl(baseURL, '/registration.html?teamId=team-1&formId=form-1'), { waitUntil: 'domcontentloaded' });

    await expect(page.getByText('Online checkout is available for this registration.')).toBeVisible();
    await fillRequiredRegistrationFields(page);
    await page.getByRole('button', { name: 'Pay registration with Stripe' }).click();
    await expect(page).toHaveURL(/#stripe-checkout$/);

    const result = await page.evaluate(() => ({
        submitCalls: window.__registrationCalls.filter((call) => call.name === 'submitPublicRegistration'),
        stripeCalls: window.__registrationStripeCalls
    }));
    expect(result.submitCalls).toHaveLength(1);
    expect(result.submitCalls[0].payload.checkoutAttemptToken).toMatch(/^[a-f0-9]{32}$/);
    expect(result.stripeCalls).toHaveLength(1);
    expect(result.stripeCalls[0]).toMatchObject({
        teamId: 'team-1',
        formId: 'form-1',
        registrationId: 'reg-1',
        amount: 12000,
        currency: 'usd',
        metadata: {
            teamId: 'team-1',
            formId: 'form-1',
            selectedOptionId: 'u12',
            paymentPlanId: 'pay_full',
            quantity: 1
        }
    });
});

test('cancelled checkout retry releases the held registration and retries without duplicate submission', async ({ page, baseURL }) => {
    await mockRegistrationModules(page, {
        form: registrationForm({
            paymentSettings: {
                offlinePaymentEnabled: false,
                onlineCheckoutEnabled: true
            }
        })
    });
    await page.goto(buildUrl(baseURL, '/registration.html?teamId=team-1&formId=form-1&retryPayment=1&publicCheckoutCapability=cap-1&checkoutAttemptToken=tok-1&status=cancelled'), { waitUntil: 'domcontentloaded' });

    await expect(page.getByText('Stripe payment was cancelled. You can try again.')).toBeVisible();
    await expect(page.getByText('Use the button below to retry payment without submitting a new registration.')).toBeVisible();
    await fillRequiredRegistrationFields(page);
    await page.getByRole('button', { name: 'Retry payment with Stripe' }).click();
    await expect(page).toHaveURL(/#stripe-checkout$/);

    const result = await page.evaluate(() => ({
        submitCalls: window.__registrationCalls.filter((call) => call.name === 'submitPublicRegistration'),
        stripeCalls: window.__registrationStripeCalls,
        cancelCalls: window.__registrationCancelCalls
    }));
    expect(result.cancelCalls).toEqual([
        {
            teamId: 'team-1',
            formId: 'form-1',
            registrationId: '',
            checkoutAttemptToken: 'tok-1',
            publicCheckoutCapability: 'cap-1'
        }
    ]);
    expect(result.submitCalls).toHaveLength(0);
    expect(result.stripeCalls).toEqual([
        {
            teamId: 'team-1',
            formId: 'form-1',
            registrationId: '',
            checkoutAttemptToken: 'tok-1',
            retryPayment: true,
            publicCheckoutCapability: 'cap-next'
        }
    ]);
});

test('successful Stripe return shows confirmation without loading the public form', async ({ page, baseURL }) => {
    await mockRegistrationModules(page);
    await page.goto(buildUrl(baseURL, '/registration.html?teamId=team-1&formId=form-1&status=success'), { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('heading', { name: 'Payment successful!' })).toBeVisible();
    await expect(page.getByText('Your registration payment was received.')).toBeVisible();
    expect(await page.evaluate(() => window.__registrationCalls)).toEqual([]);
});
