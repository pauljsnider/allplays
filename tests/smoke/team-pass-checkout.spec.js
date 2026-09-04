import { expect, test } from '@playwright/test';

const HARNESS_PATH = '/team-pass-checkout-harness.html';
const TEAM = {
    id: 'team-1',
    name: 'Blue Jays',
    currentSeasonId: '2026',
    ownerId: 'owner-1'
};

const HARNESS_HTML = `<!doctype html>
<html lang="en">
<body>
    <main id="team-pass-root"></main>
    <script>
        window.__ALLPLAYS_CONFIG__ = {
            functionsBaseUrl: window.location.origin + '/functions'
        };
    </script>
    <script type="module">
        import {
            bindTeamPassCheckoutButton,
            buildTeamPassMarkup,
            getTeamPassAccess
        } from '/js/team-pass.js?v=44346';

        const team = ${JSON.stringify(TEAM)};
        const user = { uid: 'parent-1', parentTeamIds: ['team-1'] };
        const root = document.querySelector('#team-pass-root');
        const access = getTeamPassAccess(user, team);
        root.innerHTML = buildTeamPassMarkup({
            team,
            access,
            pass: { status: 'missing', label: 'Missing' }
        });
        bindTeamPassCheckoutButton(root, { team });
        window.__teamPassHarnessReady = true;
    </script>
</body>
</html>`;

async function installTeamPassHarness(page, baseURL) {
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.route(`**${HARNESS_PATH}`, (route) => route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: HARNESS_HTML
    }));
    await page.route(/\/js\/firebase\.js\?v=\d+$/, (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: `export const auth = {
            app: { options: { projectId: 'demo-allplays' } },
            currentUser: { getIdToken: async () => 'team-pass-token' }
        };`
    }));
    await page.route(/\/js\/firebase-app-check-rest\.js\?v=\d+$/, (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: 'export async function getPrimaryAppCheckHeaders(headers) { return headers; }'
    }));
    await page.route(/\/js\/team-access\.js\?v=\d+$/, (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: 'export function hasFullTeamAccess() { return false; }'
    }));
    await page.route(/\/js\/premium-access\.js\?v=\d+$/, (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: "export async function readPremiumAccessConfig() { return { globalEnabled: false }; }"
    }));

    const harnessUrl = `${baseURL}${HARNESS_PATH}`;
    await page.goto(harnessUrl);
    await expect.poll(async () => pageErrors.length > 0 || await page.evaluate(() => window.__teamPassHarnessReady === true)).toBe(true);
    expect(pageErrors).toEqual([]);
    return { harnessUrl, pageErrors };
}

test('Team Pass checkout creates one request and navigates to canonical Stripe Checkout', async ({ page, baseURL }) => {
    const checkoutUrl = 'https://checkout.stripe.com/c/pay/team-pass-session';
    const checkoutRequests = [];
    let releaseCheckout;
    const checkoutPending = new Promise((resolve) => {
        releaseCheckout = resolve;
    });

    await page.route('**/functions/createStripeTeamPassCheckout', async (route) => {
        const request = route.request();
        checkoutRequests.push({
            method: request.method(),
            authorization: request.headers().authorization,
            body: request.postDataJSON()
        });
        await checkoutPending;
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ result: { checkoutUrl } })
        });
    });
    await page.route(checkoutUrl, (route) => route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><title>Stripe Checkout</title>'
    }));

    await installTeamPassHarness(page, baseURL);
    const button = page.locator('[data-team-pass-checkout]');
    await expect(button).toBeVisible();
    await expect(button).toBeEnabled();

    await button.click();
    await expect.poll(() => checkoutRequests.length).toBe(1);
    expect(checkoutRequests).toEqual([{
        method: 'POST',
        authorization: 'Bearer team-pass-token',
        body: { data: { teamId: 'team-1', seasonId: '2026', tier: 'team-pass' } }
    }]);
    await expect(button).toBeDisabled();
    await expect(button).toHaveAttribute('aria-busy', 'true');
    await expect(button).toHaveText('Starting checkout...');

    await button.evaluate((element) => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await expect.poll(() => checkoutRequests.length).toBe(1);

    releaseCheckout();
    await page.waitForURL(checkoutUrl);
    await expect(page).toHaveURL(checkoutUrl);
});

for (const [label, checkoutUrl] of [
    ['HTTP Stripe URL', 'http://checkout.stripe.com/c/pay/insecure'],
    ['Stripe hostname lookalike', 'https://checkout.stripe.com.attacker.example/c/pay/lookalike']
]) {
    test(`Team Pass checkout rejects ${label}`, async ({ page, baseURL }) => {
        let navigationRequests = 0;
        await page.route('**/functions/createStripeTeamPassCheckout', (route) => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ result: { checkoutUrl } })
        }));
        await page.route(checkoutUrl, (route) => {
            navigationRequests += 1;
            return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html>' });
        });

        const { harnessUrl, pageErrors } = await installTeamPassHarness(page, baseURL);
        const button = page.locator('[data-team-pass-checkout]');
        await button.click();

        await expect(page.locator('[data-team-pass-checkout-feedback]')).toHaveText(
            'Stripe returned an invalid checkout destination. Please try again.'
        );
        await expect(button).toBeEnabled();
        await expect(button).not.toHaveAttribute('aria-busy', 'true');
        await expect(button).toHaveText('Buy Team Pass');
        await expect(page).toHaveURL(harnessUrl);
        expect(navigationRequests).toBe(0);
        expect(pageErrors).toEqual([]);
    });
}
