import { expect } from '@playwright/test';

export const RAW_REPLAY_AUTH_FIXTURE = `
export const auth = { currentUser: window.__OVERLAY_AUTH_USER__ || window.__RAW_REPLAY_USER__ || null };
const authListeners = new Set();
export function onAuthStateChanged(_auth, callback) {
    authListeners.add(callback);
    queueMicrotask(() => callback(auth.currentUser));
    return () => authListeners.delete(callback);
}
window.__FIRE_RAW_AUTH__ = user => {
    auth.currentUser = user;
    for (const callback of authListeners) callback(user);
};
`;

export async function stubDelayedProfileAuth(page) {
    await page.route(/\/js\/auth\.js(?:\?.*)?$/, route => route.fulfill({
        contentType: 'application/javascript',
        body: `import { auth, onAuthStateChanged } from './firebase.js?v=33';
        export function checkAuth(callback) {
            return onAuthStateChanged(auth, async user => {
                if (window.__HOLD_PROFILE__) {
                    try { await new Promise((resolve, reject) => {
                        (window.__PROFILE_PENDING__ ||= []).push({ resolve, reject });
                    }); } catch { return; }
                }
                callback(user);
            });
        }`
    }));
}

export async function stubReplayPlayback(page, outcome) {
    await page.route(/\/js\/firebase\.js(?:\?.*)?$/, route => route.fulfill({
        contentType: 'application/javascript',
        body: RAW_REPLAY_AUTH_FIXTURE + `export const functions = {};
        export function httpsCallable(_functions, name) {
            return async (input) => {
                if (name !== 'getGameReplayPlayback') throw new Error('Unexpected callable');
                window.__PLAYBACK_READS__ = [...(window.__PLAYBACK_READS__ || []), input];
                const outcome = window.__PLAYBACK_OUTCOME__ || ${JSON.stringify(outcome)};
                if (window.__PLAYBACK_HOLD__) await new Promise(resolve => {
                    (window.__PLAYBACK_PENDING__ ||= []).push(resolve);
                });
                window.__PLAYBACK_COMPLETED__ = (window.__PLAYBACK_COMPLETED__ || 0) + 1;
                if (outcome === 'private' || outcome === 'missing' || outcome === 'error') throw new Error(outcome);
                return { data: outcome === 'allowed' ? {
                    state: 'ready', available: true, replayVideo: {
                        provider: 'youtube', videoId: 'T3f9AjVhn9U', status: 'ready',
                        embedUrl: 'https://www.youtube.com/embed/T3f9AjVhn9U',
                        publicUrl: 'https://www.youtube.com/watch?v=T3f9AjVhn9U'
                    }
                } : { state: outcome === 'deleted' ? 'removed' : 'ready', available: false, reason: 'team-pass-required' } };
            };
        }`
    }));
    await page.route('https://www.youtube.com/embed/**', route => route.fulfill({ contentType: 'text/html', body: '<title>Recording fixture</title><video id=fixture-video></video>' }));
}

export async function expectReplayPlayback(page, outcome, selector, errors) {
    await expect.poll(() => page.evaluate(() => window.__PLAYBACK_READS__?.length || 0)).toBeGreaterThan(0);
    expect(errors).toEqual([]);
    if (outcome === 'allowed') await expect(page.locator(selector)).toHaveAttribute('src', /youtube\.com\/embed\/T3f9AjVhn9U/);
    else {
        await expect(page.getByText(/Replay (?:video is|access is)/).first()).toBeVisible();
        await expect(page.locator(selector)).not.toHaveAttribute('src', /youtube\.com\/embed/);
    }
    expect(errors).toEqual([]);
}

export async function expectNoReplayPlaybackProbe(page, { selector, errors }) {
    await expect.poll(() => page.evaluate(() => typeof window.__POLL_REPLAY_GAME__)).toBe('function');
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)));
    expect(await page.evaluate(() => window.__PLAYBACK_READS__?.length || 0)).toBe(0);
    await expect(page.locator(selector)).not.toHaveAttribute('src', /youtube\.com\/embed/);
    for (let poll = 0; poll < 3; poll++) {
        await page.evaluate(async () => {
            await window.__POLL_REPLAY_GAME__();
            await new Promise(resolve => setTimeout(resolve, 0));
        });
        expect(await page.evaluate(() => window.__PLAYBACK_READS__?.length || 0)).toBe(0);
    }
    expect(errors).toEqual([]);
}

export async function verifyRawReplayAuthIsolation(page, { selector, inFlight, rejectProfile, errors }) {
    // Simulate the existing UI auth layer independently from the raw Firebase
    // observer. Its profile read can remain pending or fail after SDK identity
    // already changed; media invalidation must never wait for this callback.
    await page.evaluate(async () => {
        const { checkAuth } = await import('/js/auth.js?v=4433206');
        checkAuth(() => { window.__ENRICHED_AUTH_CALLS__ = (window.__ENRICHED_AUTH_CALLS__ || 0) + 1; });
    });
    if (inFlight) {
        await expect.poll(() => page.evaluate(() => window.__PLAYBACK_PENDING__?.length || 0)).toBeGreaterThan(0);
    } else {
        await expectReplayPlayback(page, 'allowed', selector, errors);
    }
    const transition = await page.evaluate((selector) => {
        const before = window.__ENRICHED_AUTH_CALLS__ || 0;
        window.__HOLD_PROFILE__ = true;
        window.__PLAYBACK_HOLD__ = false;
        window.__PLAYBACK_OUTCOME__ = 'denied';
        window.__FIRE_RAW_AUTH__({ uid: 'principal-B' });
        return { before, src: document.querySelector(selector).getAttribute('src') };
    }, selector);
    expect(transition.src || '').toBe('');
    await expect.poll(() => page.evaluate(() => window.__PROFILE_PENDING__?.length || 0)).toBeGreaterThan(0);
    if (rejectProfile) {
        await page.evaluate(() => window.__PROFILE_PENDING__.forEach(({ reject }) => reject(new Error('profile unavailable'))));
    }
    await expect(page.locator(selector)).not.toHaveAttribute('src', /youtube\.com\/embed/);
    if (inFlight) {
        await page.evaluate(async () => {
            window.__PLAYBACK_PENDING__.forEach(resolve => resolve());
            await new Promise(resolve => setTimeout(resolve, 0));
        });
    }
    await expect(page.locator(selector)).not.toHaveAttribute('src', /youtube\.com\/embed/);
    await expectReplayPlayback(page, 'denied', selector, errors);
    expect(await page.evaluate(() => window.__ENRICHED_AUTH_CALLS__ || 0)).toBe(transition.before);
    expect(errors).toEqual([]);
}

export async function verifyReplayProjectionPolling(page, { scenario, selector, errors }) {
    await expectReplayPlayback(page, 'allowed', selector, errors);
    await expect.poll(() => page.evaluate(() => typeof window.__POLL_REPLAY_GAME__)).toBe('function');
    const player = await page.locator(selector).elementHandle();
    const frame = await player.contentFrame();
    await expect.poll(() => frame.title()).toBe('Recording fixture');
    // A real iframe navigation destroys this player-time sentinel even though
    // the outer iframe element and final src can look identical afterward.
    await frame.evaluate(() => { document.querySelector('video').currentTime = 37; });
    if (scenario === 'unchanged') {
        for (let poll = 0; poll < 3; poll++) {
            const reads = await page.evaluate(() => window.__PLAYBACK_READS__.length);
            const completed = await page.evaluate(() => window.__PLAYBACK_COMPLETED__);
            await page.evaluate(() => window.__POLL_REPLAY_GAME__());
            await expect.poll(() => page.evaluate(() => window.__PLAYBACK_READS__.length)).toBeGreaterThan(reads);
            await expect.poll(() => page.evaluate(() => window.__PLAYBACK_COMPLETED__)).toBeGreaterThan(completed);
            await expectReplayPlayback(page, 'allowed', selector, errors);
            expect(await player.evaluate((el, selector) => el === document.querySelector(selector), selector)).toBe(true);
            expect(await frame.evaluate(() => document.querySelector('video')?.currentTime)).toBe(37);
        }
    } else {
        if (scenario === 'changed') {
            const reads = await page.evaluate(() => window.__PLAYBACK_READS__.length);
            for (let poll = 0; poll < 3; poll++) {
                const immediateSrc = await page.evaluate(async (selector) => {
                    await window.__POLL_REPLAY_GAME__({
                        hasRecordedReplay: false,
                        videoUrl: null,
                        updatedAt: `removed-${window.__FALSE_REPLAY_POLLS__ = (window.__FALSE_REPLAY_POLLS__ || 0) + 1}`
                    });
                    await new Promise(resolve => setTimeout(resolve, 0));
                    return document.querySelector(selector).getAttribute('src');
                }, selector);
                expect(immediateSrc || '').toBe('');
                expect(await page.evaluate(() => window.__PLAYBACK_READS__.length)).toBe(reads);
            }
            expect(errors).toEqual([]);
            return;
        }
        await page.evaluate(() => { window.__PLAYBACK_HOLD__ = true; });
        if (scenario === 'overlap') {
            await page.evaluate(() => window.__POLL_REPLAY_GAME__());
            await expect.poll(() => page.evaluate(() => window.__PLAYBACK_PENDING__?.length || 0)).toBeGreaterThan(0);
            // Latest denial must beat an older successful response, even when
            // both requests began from the same unchanged public projection.
            await page.evaluate(() => { window.__PLAYBACK_HOLD__ = false; });
        }
        const immediateSrc = await page.evaluate(async ({ scenario, selector }) => {
            window.__PLAYBACK_OUTCOME__ = scenario === 'error' ? 'private' : scenario === 'deleted' ? 'deleted' : 'denied';
            if (scenario === 'auth') window.__FIRE_RAW_AUTH__({ uid: 'different-principal' });
            else await window.__POLL_REPLAY_GAME__();
            return document.querySelector(selector).getAttribute('src');
        }, { scenario, selector });
        if (scenario === 'auth') expect(immediateSrc || '').toBe('');
        else if (scenario !== 'overlap') expect(immediateSrc).toContain('youtube.com/embed');
        if (scenario !== 'overlap') {
            await expect.poll(() => page.evaluate(() => window.__PLAYBACK_PENDING__?.length || 0)).toBeGreaterThan(0);
        } else await expectReplayPlayback(page, 'denied', selector, errors);
        await page.evaluate(async () => {
            window.__PLAYBACK_PENDING__.forEach(resolve => resolve());
            await new Promise(resolve => setTimeout(resolve, 0));
        });
        await expectReplayPlayback(page, 'denied', selector, errors);
    }
    expect(errors).toEqual([]);
}

export async function verifyExplicitReplayRevalidation(page, { scenario, selector, errors }) {
    await expectReplayPlayback(page, 'allowed', selector, errors);
    const player = await page.locator(selector).elementHandle();
    const frame = await player.contentFrame();
    await expect.poll(() => frame.title()).toBe('Recording fixture');
    await frame.evaluate(() => { document.querySelector('video').currentTime = 37; });
    if (scenario !== 'ordinary') await page.locator('#replay-progress').evaluate(input => {
        input.value = '50';
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const timeline = await page.locator('#replay-current').textContent();
    const before = await page.evaluate(() => window.__PLAYBACK_READS__.length);
    if (scenario === 'ordinary') {
        await page.clock.fastForward(60000);
        expect(await page.evaluate(() => window.__PLAYBACK_READS__.length)).toBe(before);
        return;
    }
    if (['pagehide', 'bfcache', 'visibility', 'unload'].includes(scenario)) {
        await page.evaluate(() => { window.__PLAYBACK_HOLD__ = true; });
    } else if (['slow', 'slow-success', 'auth'].includes(scenario)) {
        await page.evaluate(() => { window.__PLAYBACK_HOLD__ = true; });
    } else await page.evaluate(outcome => { window.__PLAYBACK_OUTCOME__ = outcome; }, scenario);
    await page.clock.fastForward(15001);
    await expect.poll(() => page.evaluate(() => window.__PLAYBACK_READS__.length)).toBe(before + 1);
    if (scenario === 'slow-success') {
        await page.clock.fastForward(8000);
        expect(await page.evaluate(() => window.__PLAYBACK_READS__.length)).toBe(before + 1);
        expect(await frame.evaluate(() => document.querySelector('video')?.currentTime)).toBe(37);
        await page.evaluate(() => {
            window.__PLAYBACK_HOLD__ = false;
            window.__PLAYBACK_PENDING__.forEach(resolve => resolve());
        });
        await expect.poll(() => page.evaluate(() => window.__PLAYBACK_COMPLETED__)).toBeGreaterThanOrEqual(before + 1);
        await expectReplayPlayback(page, 'allowed', selector, errors);
        expect(await frame.evaluate(() => document.querySelector('video')?.currentTime)).toBe(37);
        expect(await page.locator('#replay-current').textContent()).toBe(timeline);
    } else if (scenario === 'allowed') {
        await expectReplayPlayback(page, 'allowed', selector, errors);
        expect(await player.evaluate((el, selector) => el === document.querySelector(selector), selector)).toBe(true);
        expect(await frame.evaluate(() => document.querySelector('video')?.currentTime)).toBe(37);
        expect(await page.locator('#replay-current').textContent()).toBe(timeline);
        await page.clock.fastForward(15001);
        await expect.poll(() => page.evaluate(() => window.__PLAYBACK_READS__.length)).toBe(before + 2);
    } else if (['denied', 'deleted', 'private', 'error'].includes(scenario)) {
        await expectReplayPlayback(page, 'denied', selector, errors);
    } else {
        const immediate = await page.evaluate(({ scenario, selector }) => {
            if (scenario === 'auth') window.__FIRE_RAW_AUTH__({ uid: 'new-principal' });
            if (scenario === 'pagehide' || scenario === 'bfcache') {
                window.dispatchEvent(new Event('beforeunload'));
                window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
            }
            if (scenario === 'unload') {
                window.dispatchEvent(new Event('beforeunload'));
                window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
            }
            if (scenario === 'visibility') {
                Object.defineProperty(document, 'hidden', { configurable: true, value: true });
                document.dispatchEvent(new Event('visibilitychange'));
            }
            return document.querySelector(selector).getAttribute('src');
        }, { scenario, selector });
        if (scenario !== 'slow') expect(immediate || '').toBe('');
        await page.clock.fastForward(60000);
        expect(await page.evaluate(() => window.__PLAYBACK_READS__.length)).toBe(before + 1);
        await expect(page.locator(selector)).not.toHaveAttribute('src', /youtube.com\/embed/);
        await page.evaluate(({ scenario }) => {
            window.__PLAYBACK_OUTCOME__ = 'denied';
            window.__PLAYBACK_HOLD__ = false;
            if (scenario === 'bfcache') window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
            if (scenario === 'visibility') {
                Object.defineProperty(document, 'hidden', { configurable: true, value: false });
                document.dispatchEvent(new Event('visibilitychange'));
            }
            window.__PLAYBACK_PENDING__.forEach(resolve => resolve());
        }, { scenario });
        await expect.poll(() => page.evaluate(() => window.__PLAYBACK_COMPLETED__)).toBeGreaterThanOrEqual(before + 1);
        if (['auth', 'bfcache', 'visibility'].includes(scenario)) {
            await expect.poll(() => page.evaluate(() => window.__PLAYBACK_READS__.length)).toBe(before + 2);
        }
        await expect(page.locator(selector)).not.toHaveAttribute('src', /youtube.com\/embed/);
        if (['pagehide', 'unload'].includes(scenario)) {
            await page.clock.fastForward(60000);
            expect(await page.evaluate(() => window.__PLAYBACK_READS__.length)).toBe(before + 1);
        }
        if (scenario === 'slow') {
            await page.clock.fastForward(15001);
            await expect.poll(() => page.evaluate(() => window.__PLAYBACK_READS__.length)).toBe(before + 2);
        }
    }
    expect(errors).toEqual([]);
}
