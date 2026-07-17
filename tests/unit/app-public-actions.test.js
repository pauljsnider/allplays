// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const nativeState = vi.hoisted(() => ({
    isNative: false,
    plugins: new Set()
}));

const browserMocks = vi.hoisted(() => ({
    open: vi.fn()
}));

const appLauncherMocks = vi.hoisted(() => ({
    openUrl: vi.fn()
}));

const shareMocks = vi.hoisted(() => ({
    canShare: vi.fn(),
    share: vi.fn()
}));

const filesystemMocks = vi.hoisted(() => ({
    writeFile: vi.fn()
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

vi.mock('../../apps/app/node_modules/@capacitor/app-launcher/dist/plugin.cjs.js', () => ({
    AppLauncher: appLauncherMocks
}));

vi.mock('../../apps/app/node_modules/@capacitor/share/dist/plugin.cjs.js', () => ({
    Share: shareMocks
}));

vi.mock('../../apps/app/node_modules/@capacitor/filesystem/dist/plugin.cjs.js', () => ({
    Directory: { Cache: 'CACHE' },
    Encoding: { UTF8: 'utf8' },
    Filesystem: filesystemMocks
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
    appLauncherMocks.openUrl.mockResolvedValue({ completed: true });
    shareMocks.canShare.mockResolvedValue({ value: true });
    shareMocks.share.mockResolvedValue(undefined);
    filesystemMocks.writeFile.mockResolvedValue({ uri: 'file:///cache/calendar.ics' });
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

    it('copies public text with clipboard and textarea fallback paths', async () => {
        const { copyPublicText } = await loadPublicActions();
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText }
        });

        await expect(copyPublicText('<iframe src="https://allplays.ai/widget-scoreboard.html?teamId=team-1"></iframe>')).resolves.toBe('copied');
        expect(writeText).toHaveBeenCalledWith('<iframe src="https://allplays.ai/widget-scoreboard.html?teamId=team-1"></iframe>');

        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: undefined
        });
        document.execCommand = vi.fn(() => true);
        await expect(copyPublicText('https://allplays.ai/widget-scoreboard.html?teamId=team-1')).resolves.toBe('copied');
        expect(document.execCommand).toHaveBeenCalledWith('copy');
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
        installNativeCapacitor(['Browser', 'AppLauncher']);
        const { openPublicUrl } = await loadPublicActions();

        await openPublicUrl('https://allplays.ai/game.html#teamId=team-1&gameId=game-1');

        expect(browserMocks.open).toHaveBeenCalledWith({
            url: 'https://allplays.ai/game.html#teamId=team-1&gameId=game-1'
        });
        expect(appLauncherMocks.openUrl).not.toHaveBeenCalled();
    });

    it('hands native webcal URLs to the OS launcher without changing the URL', async () => {
        installNativeCapacitor(['Browser', 'AppLauncher']);
        const { openPublicUrl } = await loadPublicActions();
        const url = 'webcal://calendar.example.test/private/team-1.ics?token=private-token&view=full';

        await openPublicUrl(url);

        expect(appLauncherMocks.openUrl).toHaveBeenCalledWith({ url });
        expect(browserMocks.open).not.toHaveBeenCalled();
    });

    it('rejects when the native OS launcher cannot open a webcal URL', async () => {
        installNativeCapacitor(['Browser', 'AppLauncher']);
        appLauncherMocks.openUrl.mockRejectedValueOnce(new Error('Unable to open URL.'));
        const { openPublicUrl } = await loadPublicActions();

        await expect(openPublicUrl('webcal://calendar.example.test/team-1.ics?token=private-token')).rejects.toThrow('Unable to open URL.');
        expect(browserMocks.open).not.toHaveBeenCalled();
    });

    it('rejects when the native OS launcher reports no webcal handler', async () => {
        installNativeCapacitor(['Browser', 'AppLauncher']);
        appLauncherMocks.openUrl.mockResolvedValueOnce({ completed: false });
        const { openPublicUrl } = await loadPublicActions();

        await expect(openPublicUrl('webcal://calendar.example.test/team-1.ics?token=private-token')).rejects.toThrow('No application is available to open this URL.');
        expect(browserMocks.open).not.toHaveBeenCalled();
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

    it('writes and shares a native .ics file in Capacitor', async () => {
        installNativeCapacitor(['Filesystem', 'Share']);
        const { exportCalendarIcsFile } = await loadPublicActions();

        const result = await exportCalendarIcsFile('Family Schedule.ics', 'BEGIN:VCALENDAR\r\nEND:VCALENDAR');

        expect(result).toBe('shared');
        expect(filesystemMocks.writeFile).toHaveBeenCalledWith(expect.objectContaining({
            path: expect.stringMatching(/^calendar-exports\/\d+-Family-Schedule\.ics$/),
            data: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR',
            directory: 'CACHE',
            encoding: 'utf8',
            recursive: true
        }));
        expect(shareMocks.share).toHaveBeenCalledWith({
            title: 'ALL PLAYS calendar export',
            text: 'Share this .ics file with Calendar, Files, Gmail, or another app.',
            files: ['file:///cache/calendar.ics'],
            dialogTitle: 'Export calendar'
        });
    });

    it('keeps the web anchor download path for browser .ics exports', async () => {
        const { exportCalendarIcsFile } = await loadPublicActions();
        const originalCreateElement = document.createElement.bind(document);
        const linkClick = vi.fn();
        const linkRemove = vi.fn();
        const appendChild = vi.spyOn(document.body, 'appendChild');
        let createdLink;

        vi.spyOn(document, 'createElement').mockImplementation((tagName, options) => {
            if (String(tagName).toLowerCase() === 'a') {
                createdLink = originalCreateElement('a');
                createdLink.click = linkClick;
                createdLink.remove = linkRemove;
                return createdLink;
            }
            return originalCreateElement(tagName, options);
        });

        URL.createObjectURL = vi.fn(() => 'blob:test-calendar');
        URL.revokeObjectURL = vi.fn();

        const result = await exportCalendarIcsFile('Family Schedule.ics', 'BEGIN:VCALENDAR\r\nEND:VCALENDAR');

        expect(result).toBe('downloaded');
        expect(createdLink.download).toBe('Family-Schedule.ics');
        expect(createdLink.href).toBe('blob:test-calendar');
        expect(appendChild).toHaveBeenCalledWith(createdLink);
        expect(linkClick).toHaveBeenCalled();
        expect(linkRemove).toHaveBeenCalled();

        document.createElement.mockRestore();
        appendChild.mockRestore();
    });

    it('throws when the native .ics handoff fails', async () => {
        installNativeCapacitor(['Filesystem', 'Share']);
        shareMocks.share.mockRejectedValueOnce(new Error('Native share failed.'));
        const { exportCalendarIcsFile } = await loadPublicActions();

        await expect(exportCalendarIcsFile('family.ics', 'BEGIN:VCALENDAR\r\nEND:VCALENDAR')).rejects.toThrow('Native share failed.');
    });

    it('writes and shares a native certificate PNG export', async () => {
        installNativeCapacitor(['Filesystem', 'Share']);
        filesystemMocks.writeFile.mockResolvedValueOnce({ uri: 'file:///cache/certificate.png' });
        const { exportCertificatePngFile } = await loadPublicActions();

        const result = await exportCertificatePngFile('Pat Star Award.png', new Blob(['cert'], { type: 'image/png' }));

        expect(result).toBe('shared');
        expect(filesystemMocks.writeFile).toHaveBeenCalledWith(expect.objectContaining({
            path: expect.stringMatching(/^certificate-exports\/\d+-Pat-Star-Award\.png$/),
            data: 'Y2VydA==',
            directory: 'CACHE',
            recursive: true
        }));
        expect(shareMocks.share).toHaveBeenCalledWith({
            title: 'ALL PLAYS certificate export',
            text: 'Share this certificate image with Files, AirPrint, or another app.',
            files: ['file:///cache/certificate.png'],
            dialogTitle: 'Export certificate'
        });
    });

    it('throws when the native certificate export handoff fails', async () => {
        installNativeCapacitor(['Filesystem', 'Share']);
        shareMocks.share.mockRejectedValueOnce(new Error('Native certificate share failed.'));
        const { exportCertificatePngFile } = await loadPublicActions();

        await expect(exportCertificatePngFile('award.png', new Blob(['cert'], { type: 'image/png' }))).rejects.toThrow('Native certificate share failed.');
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
