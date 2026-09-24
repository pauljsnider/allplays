import { expect, test } from '@playwright/test';

const HARNESS_PATH = '/team-pass-checkout-harness.html';
const TEAM = {
    id: 'team-1',
    name: 'Blue Jays',
    currentSeasonId: '2026',
    ownerId: 'owner-1'
};

function buildHarnessHtml(pass) {
    return `<!doctype html>
<html lang="en">
<body>
    <main id="team-pass-root"></main>
    <script type="module">
        import { buildTeamPassMarkup, getTeamPassAccess } from '/js/team-pass.js?v=44348';

        const team = ${JSON.stringify(TEAM)};
        const user = { uid: 'owner-1' };
        const access = getTeamPassAccess(user, team);
        document.querySelector('#team-pass-root').innerHTML = buildTeamPassMarkup({
            team,
            access,
            pass: ${JSON.stringify(pass)}
        });
        window.__teamPassHarnessReady = true;
    </script>
</body>
</html>`;
}

async function installTeamPassHarness(page, baseURL, pass) {
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.route(`**${HARNESS_PATH}`, (route) => route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: buildHarnessHtml(pass)
    }));
    await page.route(/\/js\/team-access\.js\?v=\d+$/, (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: 'export function hasFullTeamAccess(user, team) { return user?.uid === team?.ownerId; }'
    }));
    await page.route(/\/js\/premium-access\.js\?v=\d+$/, (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: "export async function readPremiumAccessConfig() { return { state: 'ready', openToAll: false }; }"
    }));

    await page.goto(`${baseURL}${HARNESS_PATH}`);
    await expect.poll(async () => pageErrors.length > 0 || await page.evaluate(() => window.__teamPassHarnessReady === true)).toBe(true);
    expect(pageErrors).toEqual([]);
}

test('Team Pass page exposes status but no new-purchase action or request', async ({ page, baseURL }) => {
    let checkoutRequests = 0;
    await page.route('**/functions/createStripeTeamPassCheckout', (route) => {
        checkoutRequests += 1;
        return route.abort();
    });

    await installTeamPassHarness(page, baseURL, {
        status: 'missing',
        label: 'Missing',
        expiresAt: null,
        updatedAt: null
    });

    await expect(page.getByText('Current status')).toBeVisible();
    await expect(page.getByText('Missing', { exact: true })).toBeVisible();
    await expect(page.getByText('Existing premium access remains visible here.')).toBeVisible();
    await expect(page.getByRole('button', { name: /team pass/i })).toHaveCount(0);
    await expect(page.locator('[data-team-pass-checkout]')).toHaveCount(0);
    await expect(page.locator('a[href*="checkout.stripe.com"]')).toHaveCount(0);
    expect(checkoutRequests).toBe(0);
});

test('Team Pass page preserves active entitlement status without sales controls', async ({ page, baseURL }) => {
    await installTeamPassHarness(page, baseURL, {
        status: 'active',
        label: 'Active',
        expiresAt: '2026-12-31T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z'
    });

    await expect(page.getByText('Active', { exact: true })).toBeVisible();
    await expect(page.getByText(/active Team Pass/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /team pass/i })).toHaveCount(0);
    await expect(page.locator('[data-team-pass-checkout]')).toHaveCount(0);
});
