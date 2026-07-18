import { describe, expect, it } from 'vitest';

import {
    NATIVE_APP_CHECK_DEBUG_MODE,
    assertSafeAppCheckBuildEnvironment
} from '../../apps/app/build/appCheckBuildGuard.js';

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

    it('permits the token-free native debug provider only through the explicit local build contract', () => {
        expect(() => assertSafeAppCheckBuildEnvironment(
            NATIVE_APP_CHECK_DEBUG_MODE,
            {},
            { ALLPLAYS_APP_CHECK_NATIVE_DEBUG: '1' }
        )).not.toThrow();
    });

    it('rejects native debug mode without the non-client local-build opt-in', () => {
        expect(() => assertSafeAppCheckBuildEnvironment(
            NATIVE_APP_CHECK_DEBUG_MODE,
            {},
            {}
        )).toThrow(/dedicated local build script/);
    });

    it.each(['true', '1', 'registered-debug-token-value'])(
        'rejects embedded debug value %s even in native debug mode',
        (debugToken) => {
            expect(() => assertSafeAppCheckBuildEnvironment(
                NATIVE_APP_CHECK_DEBUG_MODE,
                { VITE_APP_CHECK_DEBUG_TOKEN: debugToken },
                { ALLPLAYS_APP_CHECK_NATIVE_DEBUG: '1' }
            )).toThrow(/must not set VITE_APP_CHECK_DEBUG_TOKEN/);
        }
    );

    it.each(['1', 'true', 'unexpected-value'])(
        'rejects native debug opt-in %s from an ordinary production build',
        (nativeDebugOptIn) => {
            expect(() => assertSafeAppCheckBuildEnvironment(
                'production',
                {},
                { ALLPLAYS_APP_CHECK_NATIVE_DEBUG: nativeDebugOptIn }
            )).toThrow(/only allowed in the native-debug build mode/);
        }
    );
});
