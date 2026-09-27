import { describe, expect, it, vi } from 'vitest';
import { readPremiumAccessConfig } from '../../js/premium-access.js';

function firebaseWithSnapshot({ exists, data, fromCache = false }) {
    return {
        db: {},
        doc: vi.fn((_db, ...parts) => ({ path: parts.join('/') })),
        getDoc: vi.fn().mockResolvedValue({
            exists: () => exists,
            data: () => data,
            metadata: { fromCache }
        })
    };
}

describe('global premium access config reader', () => {
    it('reads the exact public config document and defaults confirmed absence to open', async () => {
        const firebase = firebaseWithSnapshot({ exists: false, data: null });
        await expect(readPremiumAccessConfig({ deps: { firebase } })).resolves.toMatchObject({
            state: 'ready',
            openToAll: true,
            reason: 'default-open'
        });
        expect(firebase.doc).toHaveBeenCalledWith({}, 'platformConfig', 'premium');
    });

    it('honors an explicit off value', async () => {
        const firebase = firebaseWithSnapshot({ exists: true, data: { openToAll: false } });
        await expect(readPremiumAccessConfig({ deps: { firebase } })).resolves.toMatchObject({
            state: 'ready',
            openToAll: false,
            reason: 'entitlement-required'
        });
    });

    it('fails closed when only a cached config snapshot is available', async () => {
        const firebase = firebaseWithSnapshot({ exists: false, data: null, fromCache: true });
        await expect(readPremiumAccessConfig({ deps: { firebase } })).resolves.toMatchObject({
            state: 'unavailable',
            openToAll: false,
            reason: 'global-config-server-unavailable'
        });
    });

    it('does not treat malformed data or a failed read as open', async () => {
        const malformed = firebaseWithSnapshot({ exists: true, data: { openToAll: 'yes' } });
        await expect(readPremiumAccessConfig({ deps: { firebase: malformed } })).resolves.toMatchObject({
            state: 'unavailable',
            openToAll: false
        });

        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const failed = {
            db: {},
            doc: vi.fn(),
            getDoc: vi.fn().mockRejectedValue(new Error('network failed'))
        };
        await expect(readPremiumAccessConfig({ deps: { firebase: failed } })).resolves.toMatchObject({
            state: 'unavailable',
            openToAll: false,
            reason: 'global-config-read-failed'
        });
        consoleError.mockRestore();
    });
});
