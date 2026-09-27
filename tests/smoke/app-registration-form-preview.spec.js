import { expect, test } from '@playwright/test';

test.skip(
    process.env.SMOKE_SUITE === 'production',
    'Module-mocked app specs need the Vite dev server.'
);

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

function appUrl(baseURL) {
    const url = new URL('/', process.env.SMOKE_APP_BASE_URL || baseURL || 'http://localhost:3000/');
    url.hash = '/teams/team-1/registration-forms';
    return url.toString();
}

async function mockRegistrationEditor(page) {
    await page.addInitScript(() => {
        window.__registrationFormSaveCalls = [];
        window.ALLPLAYS_FIREBASE_CONFIG = {
            apiKey: 'demo-api-key',
            authDomain: 'demo-allplays.firebaseapp.com',
            projectId: 'demo-allplays',
            messagingSenderId: '1234567890',
            appId: '1:1234567890:web:demo'
        };
    });

    await page.route(/\/src\/lib\/useAuth\.ts(\?.*)?$/, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/javascript',
            body: `
                export function useAuth() {
                    return {
                        user: { uid: 'coach-1', email: 'coach@example.com', coachOf: ['team-1'], roles: ['coach'] },
                        profile: null,
                        loading: false,
                        error: null,
                        roles: ['coach'],
                        isParent: false,
                        isCoach: true,
                        isAdmin: false,
                        isPlatformAdmin: false,
                        refresh: async () => {},
                        signOut: async () => {}
                    };
                }
            `
        });
    });

    await page.route(/\/src\/lib\/registrationFormAdminService\.ts(\?.*)?$/, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/javascript',
            body: `
                export function canManageRegistrationFormsForApp() { return true; }
                export async function listRegistrationFormEditorsForApp() {
                    return { forms: [{
                        teamId: 'team-1',
                        formId: 'form-1',
                        title: 'Mobile parent preview',
                        description: 'A long mobile description that must remain readable inside the preview sheet.',
                        programType: 'camp',
                        season: 'Summer 2027',
                        feeAmount: '175.00',
                        participantFieldsText: 'Player legal name\\nJersey size',
                        guardianFieldsText: 'Guardian full name\\nGuardian email',
                        registrationOptions: [{ id: 'travel', label: 'Travel tournament program', description: 'Includes tournaments and uniforms.', capacityLimit: '20', active: true, waitlistEnabled: true }],
                        paymentSettings: { offlinePaymentEnabled: true, onlineCheckoutEnabled: false },
                        installmentPlan: { enabled: true, title: 'Installment plan', installmentCount: 3, firstDueDate: '2027-05-15', intervalDays: 30 },
                        discountRules: [{ id: 'sibling', type: 'quantity', label: 'Sibling savings', amountType: 'fixed', amountValue: 25, minimumQuantity: 2, active: true }],
                        backgroundCheck: { enabled: false, required: false },
                        waiverText: 'Guardian accepts the mobile preview waiver terms.',
                        status: 'draft',
                        published: false,
                        isOpen: false,
                        isClosed: false
                    }], lastDoc: null, hasMore: false };
                }
                export async function saveRegistrationFormEditorForApp(input) {
                    window.__registrationFormSaveCalls.push(input);
                    throw new Error('Preview must not save.');
                }
            `
        });
    });
}

test('opens a read-only parent preview at mobile width without overflow or writes', async ({ page, baseURL }) => {
    await mockRegistrationEditor(page);
    await page.goto(appUrl(baseURL), { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('heading', { name: 'Registration setup' })).toBeVisible({ timeout: 45000 });
    await page.getByRole('button', { name: 'Preview as parent' }).click();

    const dialog = page.getByRole('dialog', { name: 'Parent registration preview' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Preview only. Registration and payment are disabled.')).toBeVisible();
    await expect(dialog.getByText('Travel tournament program')).toBeVisible();
    await expect(dialog.getByText('Sibling savings')).toBeVisible();
    await expect(dialog.getByText('Guardian accepts the mobile preview waiver terms.')).toBeVisible();
    await expect(dialog.getByRole('button', { name: /submit registration|pay registration/i })).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await expect.poll(() => dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await expect.poll(() => page.evaluate(() => window.__registrationFormSaveCalls)).toEqual([]);
});
