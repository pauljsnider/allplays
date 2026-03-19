import { test, expect } from '@playwright/test';

function buildUrl(baseURL, path) {
    const url = new URL(path, `${baseURL}/`);
    url.searchParams.set('cb', String(Date.now()));
    return url.toString();
}

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

test('homepage footer support links navigate to live support destinations', async ({ page, baseURL }) => {
    await page.goto(buildUrl(baseURL, '/'), { waitUntil: 'domcontentloaded' });

    const { helpLink, helpHref, contactHref } = await getFooterSupportLinks(page);

    expectLiveSupportHref(helpHref, 'help.html');
    expectLiveSupportHref(contactHref, 'https://paulsnider.net');

    await Promise.all([
        page.waitForURL('**/help.html'),
        helpLink.click()
    ]);

    expect(new URL(page.url()).pathname).toBe('/help.html');
});

test('shared footer support links stay wired on login page', async ({ page, baseURL }) => {
    await page.goto(buildUrl(baseURL, '/login.html'), { waitUntil: 'domcontentloaded' });

    const { helpHref, contactHref } = await getFooterSupportLinks(page);

    expectLiveSupportHref(helpHref, 'help.html');
    expectLiveSupportHref(contactHref, 'https://paulsnider.net');
});
