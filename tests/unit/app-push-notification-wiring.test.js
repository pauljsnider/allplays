import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('app push notification wiring', () => {
    it('registers native notification-open listeners and consumes pending routes after auth bootstrap', () => {
        const source = readFileSync(new URL('../../apps/app/src/App.tsx', import.meta.url), 'utf8');
        expect(source).toContain("import { clearPendingPushRoute, readPendingPushRoute } from './lib/pushNotificationRouting';");
        expect(source).toContain("import { addPushNotificationOpenListener, ensureAndroidNotificationChannels } from './lib/pushService';");
        expect(source).toContain('await ensureAndroidNotificationChannels();');
        expect(source).toContain('removeListener = await addPushNotificationOpenListener');
        expect(source).toContain('const pendingRoute = readPendingPushRoute();');
        expect(source).toContain('clearPendingPushRoute();');
    });

    it('keeps Android channel metadata local to the app so Vite does not try to import the Functions CommonJS bundle in the browser', () => {
        const source = readFileSync(new URL('../../apps/app/src/lib/pushService.ts', import.meta.url), 'utf8');
        expect(source).toContain("id: 'allplays_messages'");
        expect(source).toContain("id: 'allplays_game_day'");
        expect(source).toContain("id: 'allplays_schedule'");
        expect(source).not.toContain('notification-delivery-metadata.cjs');
    });
});
