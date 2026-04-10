import { test, expect } from '@playwright/test';
import { buildUrl } from './helpers/boot-path.js';

async function getFooterSupportLinks(page) {
    const footer = page.locator('footer').last();
    await expect(footer).toBeVisible();

    const helpLink = footer.getByRole('link', { name: 'Help Center' });
    const contactLink = footer.getByRole('link', { name: 'Contact' });

    await expect(helpLink).toBeVisible();
    await expect(contactLink).toBeVisible();

    return {
        helpLink,
        contactLink,
        helpHref: await helpLink.getAttribute('href'),
        contactHref: await contactLink.getAttribute('href')
    };
}

function expectLiveSupportHref(href, expectedValue) {
    expect(href).toBe(expectedValue);
    expect(href).not.toBe('#');
    expect(href).not.toBe('');
    expect(href?.startsWith('#')).toBeFalsy();
}

test('buildUrl preserves base path prefixes for absolute smoke routes', async () => {
    const builtUrl = new URL(buildUrl('https://example.com/app', '/login.html'));

    expect(builtUrl.origin).toBe('https://example.com');
    expect(builtUrl.pathname).toBe('/app/login.html');
    expect(builtUrl.searchParams.get('cb')).toBeTruthy();
});

test('homepage footer support links navigate to live support destinations', async ({ page, baseURL }) => {
    await page.goto(buildUrl(baseURL, '/'), { waitUntil: 'domcontentloaded' });

    const { helpLink, helpHref, contactHref } = await getFooterSupportLinks(page);

    expectLiveSupportHref(helpHref, 'help.html');
    expectLiveSupportHref(contactHref, 'mailto:paul@paulsnider.net?subject=ALL%20PLAYS%20Support');

    const navigationPromise = page.waitForNavigation({ url: '**/help.html' });
    await helpLink.click();
    const response = await navigationPromise;

    expect(response).not.toBeNull();
    expect(response.ok()).toBeTruthy();
    expect(new URL(page.url()).pathname).toBe('/help.html');
    await expect(page.getByRole('heading', { name: 'ALL PLAYS Help Center' })).toBeVisible();
});

test('shared footer support links stay wired on login page', async ({ page, baseURL }) => {
    await page.goto(buildUrl(baseURL, '/login.html'), { waitUntil: 'domcontentloaded' });

    const { helpHref, contactHref } = await getFooterSupportLinks(page);

    expectLiveSupportHref(helpHref, 'help.html');
    expectLiveSupportHref(contactHref, 'mailto:paul@paulsnider.net?subject=ALL%20PLAYS%20Support');
});
