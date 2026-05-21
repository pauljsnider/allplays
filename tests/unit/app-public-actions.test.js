import { beforeEach, describe, expect, it, vi } from 'vitest';

const nativeState = vi.hoisted(() => ({
    isNative: false,
    plugins: new Set()
}));

const browserMocks = vi.hoisted(() => ({
    open: vi.fn()
}));

const shareMocks = vi.hoisted(() => ({
    share: vi.fn()
}));

vi.mock('../../apps/app/node_modules/@capacitor/core/dist/index.cjs.js', () => ({
    Capacitor: {
        isNativePlatform: () => nativeState.isNative,
        isPluginAvailable: (pluginName) => nativeState.plugins.has(pluginName)
    }
}));

vi.mock('../../apps/app/node_modules/@capacitor/browser/dist/plugin.cjs.js', () => ({
    Browser: browserMocks
}));

vi.mock('../../apps/app/node_modules/@capacitor/share/dist/plugin.cjs.js', () => ({
    Share: shareMocks
}));

async function loadPublicActions() {
    return import('../../apps/app/src/lib/publicActions.ts');
}

function resetCapacitorGlobals() {
    delete globalThis.webkit;
    delete globalThis.androidBridge;
    delete globalThis.CapacitorCustomPlatform;
    if (globalThis.Capacitor) {
        globalThis.Capacitor.PluginHeaders = [];
        delete globalThis.Capacitor.nativePromise;
        delete globalThis.Capacitor.nativeCallback;
    }
}

function installNativeCapacitor(pluginNames) {
    nativeState.isNative = true;
    nativeState.plugins = new Set(pluginNames);
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.unstubAllGlobals();
    resetCapacitorGlobals();
    nativeState.isNative = false;
    nativeState.plugins = new Set();
    browserMocks.open.mockResolvedValue(undefined);
    shareMocks.share.mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: undefined
    });
    Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: undefined
    });
});

describe('React app public URL actions', () => {
    it('opens public URLs in a new browser context for web builds', async () => {
        const { openPublicUrl } = await loadPublicActions();
        const open = vi.fn(() => ({ closed: false }));
        vi.stubGlobal('window', {
            open,
            location: { href: '' }
        });

        await openPublicUrl('https://allplays.ai/live-game.html?teamId=team-1&gameId=game-1&replay=true');

        expect(open).toHaveBeenCalledWith(
            'https://allplays.ai/live-game.html?teamId=team-1&gameId=game-1&replay=true',
            '_blank',
            'noopener,noreferrer'
        );
    });

    it('falls back to clipboard copy when web share is unavailable', async () => {
        const { sharePublicUrl } = await loadPublicActions();
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'share', {
            configurable: true,
            value: undefined
        });
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText }
        });

        const result = await sharePublicUrl({
            title: 'Bears vs Falcons',
            text: 'Bears vs Falcons · May 21',
            url: 'https://allplays.ai/game.html#teamId=team-1&gameId=game-1',
            clipboardText: 'Bears vs Falcons · May 21\nhttps://allplays.ai/game.html#teamId=team-1&gameId=game-1'
        });

        expect(result).toBe('copied');
        expect(writeText).toHaveBeenCalledWith('Bears vs Falcons · May 21\nhttps://allplays.ai/game.html#teamId=team-1&gameId=game-1');
    });

    it('falls back to web share for browser builds', async () => {
        const { sharePublicUrl } = await loadPublicActions();
        const share = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'share', {
            configurable: true,
            value: share
        });

        const result = await sharePublicUrl({
            title: 'Bears vs Falcons',
            text: 'Bears vs Falcons · May 21',
            url: 'https://allplays.ai/game.html#teamId=team-1&gameId=game-1'
        });

        expect(result).toBe('shared');
        expect(share).toHaveBeenCalledWith({
            title: 'Bears vs Falcons',
            text: 'Bears vs Falcons · May 21\nhttps://allplays.ai/game.html#teamId=team-1&gameId=game-1',
            url: 'https://allplays.ai/game.html#teamId=team-1&gameId=game-1'
        });
    });

    it('shares plain event details without adding a URL', async () => {
        const { sharePublicUrl } = await loadPublicActions();
        const share = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'share', {
            configurable: true,
            value: share
        });

        const result = await sharePublicUrl({
            title: 'Bears Practice',
            text: 'Bears Practice · May 21 · Main Gym'
        });

        expect(result).toBe('shared');
        expect(share).toHaveBeenCalledWith({
            title: 'Bears Practice',
            text: 'Bears Practice · May 21 · Main Gym'
        });
    });

    it('opens public URLs with the native Browser plugin inside Capacitor', async () => {
        installNativeCapacitor(['Browser']);
        const { openPublicUrl } = await loadPublicActions();

        await openPublicUrl('https://allplays.ai/game.html#teamId=team-1&gameId=game-1');

        expect(browserMocks.open).toHaveBeenCalledWith({
            url: 'https://allplays.ai/game.html#teamId=team-1&gameId=game-1'
        });
    });

    it('uses the native Share plugin with URL-appended text on iOS and Android', async () => {
        installNativeCapacitor(['Share']);
        const { sharePublicUrl } = await loadPublicActions();

        const result = await sharePublicUrl({
            title: 'Bears vs Falcons replay',
            text: 'Bears vs Falcons replay · May 21',
            url: 'https://allplays.ai/live-game.html?teamId=team-1&gameId=game-1&replay=true'
        });

        expect(result).toBe('shared');
        expect(shareMocks.share).toHaveBeenCalledWith({
            title: 'Bears vs Falcons replay',
            text: 'Bears vs Falcons replay · May 21\nhttps://allplays.ai/live-game.html?teamId=team-1&gameId=game-1&replay=true',
            url: 'https://allplays.ai/live-game.html?teamId=team-1&gameId=game-1&replay=true',
            dialogTitle: 'Bears vs Falcons replay'
        });
    });

    it('reports native share cancellation without showing a false failure', async () => {
        const abortError = Object.assign(new Error('cancelled'), { name: 'AbortError' });
        installNativeCapacitor(['Share']);
        shareMocks.share.mockRejectedValue(abortError);
        const { sharePublicUrl } = await loadPublicActions();

        await expect(sharePublicUrl({
            title: 'Bears Practice',
            text: 'Bears Practice · May 21 · Main Gym'
        })).resolves.toBe('cancelled');
    });
});
