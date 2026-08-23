import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
    buildPremiumAccessControlView,
    createAdminPremiumAccessControl,
    getPremiumAccessToggleConfirmation,
    updatePremiumAccessConfig
} from '../../js/admin-premium-access-control.js';

function readyConfig(openToAll) {
    return {
        state: 'ready',
        openToAll,
        reason: openToAll ? 'global-open' : 'entitlement-required'
    };
}

function firebaseWithConfig({ openToAll, setDocError = null, fromCache = false }) {
    const timestamp = { type: 'server-timestamp' };
    return {
        db: {},
        doc: vi.fn((_db, ...parts) => ({ path: parts.join('/') })),
        setDoc: setDocError
            ? vi.fn().mockRejectedValue(setDocError)
            : vi.fn().mockResolvedValue(undefined),
        serverTimestamp: vi.fn(() => timestamp),
        getDoc: vi.fn().mockResolvedValue({
            exists: () => true,
            data: () => ({ openToAll }),
            metadata: { fromCache }
        }),
        timestamp
    };
}

function createFakeElement() {
    const listeners = new Map();
    return {
        dataset: {},
        textContent: '',
        disabled: false,
        attributes: new Map(),
        setAttribute(name, value) {
            this.attributes.set(name, value);
        },
        addEventListener(name, listener) {
            listeners.set(name, listener);
        },
        click() {
            listeners.get('click')?.({ currentTarget: this });
        }
    };
}

function createFakeRoot() {
    const ids = [
        'premium-access-control',
        'premium-access-status',
        'premium-access-summary',
        'premium-access-toggle',
        'premium-access-feedback'
    ];
    const elements = new Map(ids.map((id) => [id, createFakeElement()]));
    return {
        elements,
        getElementById(id) {
            return elements.get(id) || null;
        }
    };
}

describe('legacy admin premium access control', () => {
    it('writes only the shared config path and exact public schema, then verifies the result', async () => {
        const firebase = firebaseWithConfig({ openToAll: false });

        await expect(updatePremiumAccessConfig({
            openToAll: false,
            deps: { firebase }
        })).resolves.toMatchObject({
            state: 'confirmed',
            reason: 'confirmed-after-write',
            config: readyConfig(false)
        });

        expect(firebase.doc).toHaveBeenCalledWith({}, 'platformConfig', 'premium');
        expect(firebase.setDoc).toHaveBeenCalledWith(
            { path: 'platformConfig/premium' },
            { openToAll: false, updatedAt: firebase.timestamp }
        );
        expect(firebase.serverTimestamp).toHaveBeenCalledTimes(1);
        expect(firebase.getDoc).toHaveBeenCalledTimes(1);
    });

    it('reconciles a thrown write response against the authoritative config', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const committed = firebaseWithConfig({
            openToAll: true,
            setDocError: new Error('response lost')
        });
        const notCommitted = firebaseWithConfig({
            openToAll: false,
            setDocError: new Error('write rejected')
        });

        await expect(updatePremiumAccessConfig({
            openToAll: true,
            deps: { firebase: committed }
        })).resolves.toMatchObject({
            state: 'confirmed',
            reason: 'confirmed-after-write-error',
            config: readyConfig(true)
        });
        await expect(updatePremiumAccessConfig({
            openToAll: true,
            deps: { firebase: notCommitted }
        })).resolves.toMatchObject({
            state: 'not-committed',
            config: readyConfig(false)
        });
        consoleError.mockRestore();
    });

    it('reports an unverified server read as unknown and rejects malformed input before writing', async () => {
        const firebase = firebaseWithConfig({ openToAll: false, fromCache: true });

        await expect(updatePremiumAccessConfig({
            openToAll: false,
            deps: { firebase }
        })).resolves.toMatchObject({
            state: 'unknown',
            reason: 'write-state-unverified',
            config: {
                state: 'unavailable',
                openToAll: false,
                reason: 'global-config-server-unavailable'
            }
        });
        await expect(updatePremiumAccessConfig({
            openToAll: 'false',
            deps: { firebase }
        })).rejects.toThrow('openToAll must be a boolean');
        expect(firebase.setDoc).toHaveBeenCalledTimes(1);
    });

    it('renders explicit on, off, loading, and unavailable states', () => {
        expect(buildPremiumAccessControlView(readyConfig(true))).toMatchObject({
            state: 'on',
            statusLabel: 'On',
            buttonLabel: 'Turn premium off',
            buttonDisabled: false
        });
        expect(buildPremiumAccessControlView(readyConfig(false))).toMatchObject({
            state: 'off',
            statusLabel: 'Off',
            buttonLabel: 'Turn premium on',
            buttonDisabled: false
        });
        expect(buildPremiumAccessControlView({ state: 'unavailable' }, {
            busy: true,
            busyLabel: 'Checking...'
        })).toMatchObject({
            state: 'loading',
            buttonLabel: 'Checking...',
            buttonDisabled: true
        });
        expect(buildPremiumAccessControlView({ state: 'unavailable' })).toMatchObject({
            state: 'unavailable',
            buttonLabel: 'Retry current setting',
            buttonDisabled: false
        });
    });

    it('re-reads immediately before confirmation so stale UI cannot flip the wrong value', async () => {
        const root = createFakeRoot();
        const readConfig = vi.fn()
            .mockResolvedValueOnce(readyConfig(true))
            .mockResolvedValueOnce(readyConfig(false));
        const writeConfig = vi.fn().mockResolvedValue({
            state: 'confirmed',
            config: readyConfig(true)
        });
        const confirmChange = vi.fn().mockReturnValue(true);
        const control = createAdminPremiumAccessControl({
            root,
            readConfig,
            writeConfig,
            confirmChange
        });

        await control.load();
        expect(root.elements.get('premium-access-status').textContent).toBe('On');
        expect(root.elements.get('premium-access-status').className).toContain('bg-emerald-100');
        expect(root.elements.get('premium-access-toggle').className).toContain('bg-red-600');

        await expect(control.toggle()).resolves.toMatchObject({ state: 'confirmed' });

        expect(readConfig).toHaveBeenCalledTimes(2);
        expect(confirmChange).toHaveBeenCalledWith(expect.stringContaining('Turn on premium access'));
        expect(writeConfig).toHaveBeenCalledWith({ openToAll: true });
        expect(root.elements.get('premium-access-status').textContent).toBe('On');
        expect(root.elements.get('premium-access-feedback').textContent).toContain('unlocked for everyone');
    });

    it('requires confirmation and suppresses duplicate writes while a toggle is active', async () => {
        const cancelledRoot = createFakeRoot();
        const cancelledWrite = vi.fn();
        const cancelled = createAdminPremiumAccessControl({
            root: cancelledRoot,
            readConfig: vi.fn().mockResolvedValue(readyConfig(true)),
            writeConfig: cancelledWrite,
            confirmChange: () => false
        });
        await cancelled.load();
        await expect(cancelled.toggle()).resolves.toMatchObject({ state: 'cancelled' });
        expect(cancelledWrite).not.toHaveBeenCalled();

        const root = createFakeRoot();
        let resolveWrite;
        const pendingWrite = new Promise((resolve) => {
            resolveWrite = resolve;
        });
        const writeConfig = vi.fn(() => pendingWrite);
        const control = createAdminPremiumAccessControl({
            root,
            readConfig: vi.fn().mockResolvedValue(readyConfig(true)),
            writeConfig,
            confirmChange: () => true
        });
        await control.load();
        const firstToggle = control.toggle();
        await expect(control.toggle()).resolves.toMatchObject({ state: 'busy' });
        expect(root.elements.get('premium-access-toggle').disabled).toBe(true);
        expect(writeConfig).toHaveBeenCalledTimes(1);
        resolveWrite({ state: 'confirmed', config: readyConfig(false) });
        await firstToggle;
    });

    it('wires the control only after legacy admin authorization and cache-busts the entry module', () => {
        const adminHtml = readFileSync('admin.html', 'utf8');
        const adminJs = readFileSync('js/admin.js', 'utf8');

        expect(adminHtml).toContain('id="premium-access-control"');
        expect(adminHtml).toContain('id="premium-access-toggle"');
        expect(adminHtml).toContain('id="premium-access-feedback" role="status" aria-live="polite"');
        expect(adminHtml).toContain('js/admin.js?v=443355');
        expect(adminJs).toContain("from './admin-premium-access-control.js?v=6'");
        expect(adminJs.indexOf('if (!user.isAdmin)')).toBeLessThan(adminJs.indexOf('createAdminPremiumAccessControl()'));
        expect(getPremiumAccessToggleConfirmation(false)).toContain('Users without a valid premium entitlement');
    });
});
