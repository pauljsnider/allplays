import { afterEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_WINDOW = globalThis.window;
const ORIGINAL_DOCUMENT = globalThis.document;

function installWindow(href) {
    const url = new URL(href);
    const sessionState = new Map();
    globalThis.window = {
        location: {
            href,
            origin: url.origin
        },
        sessionStorage: {
            getItem: vi.fn((key) => sessionState.get(key) ?? null),
            setItem: vi.fn((key, value) => {
                sessionState.set(key, value);
            })
        }
    };
    delete globalThis.document;
}

async function loadModule(href) {
    vi.resetModules();
    installWindow(href);
    return import('../../js/native-app.js');
}

describe('native app routing helpers', () => {
    afterEach(() => {
        vi.resetModules();
        if (typeof ORIGINAL_WINDOW === 'undefined') {
            delete globalThis.window;
        } else {
            globalThis.window = ORIGINAL_WINDOW;
        }

        if (typeof ORIGINAL_DOCUMENT === 'undefined') {
            delete globalThis.document;
        } else {
            globalThis.document = ORIGINAL_DOCUMENT;
        }
    });

    it('keeps normal web auth redirects pointed at the website login page', async () => {
        const nativeApp = await loadModule('https://allplays.ai/parent-dashboard.html');

        expect(nativeApp.isAppMode()).toBe(false);
        expect(nativeApp.getAppLoginUrl()).toBe('login.html');
    });

    it('adds app context to bundled same-origin HTML routes', async () => {
        const nativeApp = await loadModule('capacitor://localhost/parent-dashboard.html');

        expect(nativeApp.isAppMode()).toBe(true);
        expect(nativeApp.withAppContext('team-chat.html#teamId=team-1')).toBe('team-chat.html?app=1#teamId=team-1');
        expect(nativeApp.withAppContext('calendar.html')).toBe('parent-dashboard.html?app=1#schedule-section');
        expect(nativeApp.getAppHomeUrl()).toBe('parent-dashboard.html?app=1');
        expect(nativeApp.getAppScheduleUrl()).toBe('parent-dashboard.html?app=1#schedule-section');
        expect(nativeApp.getAppMessagesUrl()).toBe('messages.html?app=1');
    });

    it('keeps unsupported post-auth app routes on the parent MVP home page', async () => {
        const nativeApp = await loadModule('capacitor://localhost/index.html');

        expect(nativeApp.getAppPostAuthRedirectUrl('dashboard.html')).toBe('parent-dashboard.html?app=1');
    });

    it('does not rewrite external links in app mode', async () => {
        const nativeApp = await loadModule('capacitor://localhost/parent-dashboard.html');

        expect(nativeApp.withAppContext('https://example.com/help.html')).toBe('https://example.com/help.html');
    });
});
