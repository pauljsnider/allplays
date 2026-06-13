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
});
