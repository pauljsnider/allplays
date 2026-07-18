import { describe, expect, it } from 'vitest';

import { assertSafeAppCheckBuildEnvironment } from '../../apps/app/build/appCheckBuildGuard.js';

describe('App Check production build guard', () => {
    it.each(['true', '1', 'registered-debug-token-value'])(
        'rejects production debug configuration %s',
        (debugToken) => {
            expect(() => assertSafeAppCheckBuildEnvironment('production', {
                VITE_APP_CHECK_DEBUG_TOKEN: debugToken
            })).toThrow(/must not set VITE_APP_CHECK_DEBUG_TOKEN/);
        }
    );

    it.each([undefined, '', 'false', '0'])(
        'permits production when the debug provider is disabled (%s)',
        (debugToken) => {
            expect(() => assertSafeAppCheckBuildEnvironment('production', {
                VITE_APP_CHECK_DEBUG_TOKEN: debugToken
            })).not.toThrow();
        }
    );

    it('permits explicit debug mode only outside production', () => {
        expect(() => assertSafeAppCheckBuildEnvironment('development', {
            VITE_APP_CHECK_DEBUG_TOKEN: 'true'
        })).not.toThrow();
    });
});
