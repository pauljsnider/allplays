import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ANDROID_NOTIFICATION_CHANNELS } = require('../../functions/notification-delivery-metadata.cjs');

function extractAppAndroidChannelIds(source) {
    return [...source.matchAll(/id: '([^']+)'/g)].map((match) => match[1]);
}

describe('app push notification wiring', () => {
    it('registers native notification-open listeners and consumes pending routes after auth bootstrap', () => {
        const source = readFileSync(new URL('../../apps/app/src/App.tsx', import.meta.url), 'utf8');
        expect(source).toContain("import { clearPendingPushRoute, readPendingPushRoute } from './lib/pushNotificationRouting';");
        expect(source).toContain("const { addPushNotificationOpenListener, ensureAndroidNotificationChannels } = await import('./lib/pushService');");
        expect(source).toContain('await ensureAndroidNotificationChannels();');
        expect(source).toContain('const remove = await addPushNotificationOpenListener');
        expect(source).toContain('removeListener = remove;');
        expect(source).toContain('const pendingRoute = readPendingPushRoute();');
        expect(source).toContain('clearPendingPushRoute();');
    });

    it('keeps Android channel metadata local to the app so Vite does not try to import the Functions CommonJS bundle in the browser', () => {
        const source = readFileSync(new URL('../../apps/app/src/lib/pushService.ts', import.meta.url), 'utf8');
        expect(extractAppAndroidChannelIds(source)).toEqual(ANDROID_NOTIFICATION_CHANNELS.map((channel) => channel.id));
        expect(source).not.toContain('notification-delivery-metadata.cjs');
    });
});
