import { expect } from '@playwright/test';

export async function stubReplayPlayback(page, outcome) {
    await page.route(/\/js\/firebase\.js(?:\?.*)?$/, route => route.fulfill({
        contentType: 'application/javascript',
        body: `export const functions = {};
        export function httpsCallable(_functions, name) {
            return async (input) => {
                if (name !== 'getGameReplayPlayback') throw new Error('Unexpected callable');
                window.__PLAYBACK_READS__ = [...(window.__PLAYBACK_READS__ || []), input];
                const outcome = ${JSON.stringify(outcome)};
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
