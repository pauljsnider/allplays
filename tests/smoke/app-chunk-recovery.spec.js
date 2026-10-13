import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const appRequire = createRequire(new URL('../../apps/app/package.json', import.meta.url));
const { build } = await import(pathToFileURL(appRequire.resolve('vite')));
let output;
test.beforeAll(async () => {
    output = await mkdtemp(path.join(os.tmpdir(), 'allplays-chunk-recovery-'));
    await build({
        configFile: false,
        root: path.resolve('tests/smoke/fixtures/chunk-recovery'),
        base: '/app/',
        logLevel: 'error',
        resolve: { alias: {
            react: path.dirname(appRequire.resolve('react/package.json')),
            'react-dom': path.dirname(appRequire.resolve('react-dom/package.json'))
        } },
        build: { outDir: output, emptyOutDir: true, rollupOptions: {
            input: path.resolve('tests/smoke/fixtures/chunk-recovery/main.tsx'),
            output: { entryFileNames: 'assets/entry.js' }
        } }
    });
    await writeFile(path.join(output, 'index.html'), '<!doctype html><html><body><div id="root"></div><script type="module" src="/app/assets/entry.js"></script></body></html>');
});
test.afterAll(async () => { if (output) await rm(output, { recursive: true, force: true }); });

async function serveFixture(page, failureCount, wrongModule = false) {
    const observed = { documents: 0, chunks: [], failures: [] };
    page.on('response', response => {
        if (response.status() === 503) observed.failures.push(response.status());
    });
    await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin !== 'http://127.0.0.1:4173' || !url.pathname.startsWith('/app/')) return route.abort();
        const relative = url.pathname.slice('/app/'.length) || 'index.html';
        if (relative === 'index.html') observed.documents++;
        if (/^assets\/PlayerDetail-.*\.js$/.test(relative)) {
            observed.chunks.push(url.search);
            if (observed.chunks.length <= failureCount) {
                return route.fulfill({ status: 503, contentType: 'text/plain', body: 'Temporary asset delivery failure' });
            }
        }
        if (wrongModule && url.searchParams.has('allplays-chunk-retry')) {
            return route.fulfill({ contentType: 'application/javascript', body: 'export const NotTheRoute = true;' });
        }
        try {
            const body = await readFile(path.join(output, relative));
            return route.fulfill({ body, contentType: relative.endsWith('.js') ? 'application/javascript' : 'text/html' });
        } catch { return route.fulfill({ status: 404, body: 'Not found' }); }
    });
    await page.goto('http://127.0.0.1:4173/app/');
    return observed;
}

test('recovers one route chunk 503 without reloading or losing unsaved input', async ({ page }) => {
    const observed = await serveFixture(page, 1);
    await page.getByLabel('Unsaved note').fill('keep this note');
    await page.getByRole('button', { name: 'Open player' }).click();
    await expect(page.getByRole('heading', { name: 'Player loaded' })).toBeVisible();
    await expect(page.getByLabel('Unsaved note')).toHaveValue('keep this note');
    expect(observed.documents).toBe(1);
    expect(observed.chunks).toEqual(['', '?allplays-chunk-retry=1']);
    // Fault injection is explicit: the production strict smoke must still see this failure.
    expect(observed.failures).toEqual([503]);
});

test('persistent chunk failure remains visible after one in-page retry', async ({ page }) => {
    const observed = await serveFixture(page, 10);
    // Simulate the existing one-reload budget having already been consumed.
    await page.evaluate(() => sessionStorage.setItem('allplays:lazy-chunk-reload-attempted', '1'));
    await page.getByRole('button', { name: 'Open player' }).click();
    await expect(page.getByRole('alert')).toHaveText('Load failed');
    expect(observed.documents).toBe(1);
    expect(observed.chunks).toEqual(['', '?allplays-chunk-retry=1']);
    expect(observed.failures).toEqual([503, 503]);
});

test('a retry that returns a dependency cannot substitute for the route', async ({ page }) => {
    const observed = await serveFixture(page, 1, true);
    await page.evaluate(() => sessionStorage.setItem('allplays:lazy-chunk-reload-attempted', '1'));
    await page.getByRole('button', { name: 'Open player' }).click();
    await expect(page.getByRole('alert')).toHaveText('Load failed');
    expect(observed.chunks).toHaveLength(2);
    expect(observed.documents).toBe(1);
});

test('fresh-session persistent failure exhausts one reload then shows the error', async ({ page }) => {
    const observed = await serveFixture(page, 10);
    await page.getByRole('button', { name: 'Open player' }).click();
    await expect(page.getByRole('alert')).toHaveText('Load failed');
    expect(observed.documents).toBe(2);
    expect(observed.chunks).toEqual(['', '?allplays-chunk-retry=1', '', '?allplays-chunk-retry=1']);
    expect(observed.failures).toEqual([503, 503, 503, 503]);
});

test('unavailable session storage cannot create a persistent reload loop', async ({ page }) => {
    await page.addInitScript(() => {
        Object.defineProperty(window, 'sessionStorage', { get() { throw new Error('Storage blocked'); } });
    });
    const observed = await serveFixture(page, 10);
    await page.getByLabel('Unsaved note').fill('still here');
    await page.getByRole('button', { name: 'Open player' }).click();
    await expect(page.getByRole('alert')).toHaveText('Load failed');
    expect(observed.documents).toBe(1);
    expect(observed.chunks).toHaveLength(2);
    await expect(page.getByLabel('Unsaved note')).toHaveValue('still here');
});
