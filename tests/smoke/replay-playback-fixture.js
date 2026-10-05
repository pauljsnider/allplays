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
                if (outcome === 'private' || outcome === 'missing') throw new Error(outcome);
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
    await page.route('https://www.youtube.com/embed/**', route => route.fulfill({ contentType: 'text/html', body: '<title>Recording fixture</title>' }));
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

export async function verifyRawReplayAuthIsolation(page, { selector, inFlight, rejectProfile, errors }) {
    // Simulate the existing UI auth layer independently from the raw Firebase
    // observer. Its profile read can remain pending or fail after SDK identity
    // already changed; media invalidation must never wait for this callback.
    await page.evaluate(async () => {
        const { checkAuth } = await import('/js/auth.js?v=4433205');
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
    await expectReplayPlayback(page, 'denied', selector, errors);
    if (inFlight) {
        await page.evaluate(async () => {
            window.__PLAYBACK_PENDING__.forEach(resolve => resolve());
            await new Promise(resolve => setTimeout(resolve, 0));
        });
    }
    await expect(page.locator(selector)).not.toHaveAttribute('src', /youtube\.com\/embed/);
    expect(await page.evaluate(() => window.__ENRICHED_AUTH_CALLS__ || 0)).toBe(transition.before);
    expect(errors).toEqual([]);
}
