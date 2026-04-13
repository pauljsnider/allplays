import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createInviteProcessor } from '../../js/accept-invite-flow.js';

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

class MockClassList {
    constructor(initial = []) {
        this.tokens = new Set(initial);
    }

    add(...tokens) {
        tokens.forEach((token) => this.tokens.add(token));
    }

    remove(...tokens) {
        tokens.forEach((token) => this.tokens.delete(token));
    }

    contains(token) {
        return this.tokens.has(token);
    }
}

class MockEvent {
    constructor(type) {
        this.type = type;
        this.defaultPrevented = false;
        this.target = null;
        this.currentTarget = null;
    }

    preventDefault() {
        this.defaultPrevented = true;
    }
}

class MockElement {
    constructor(id = '') {
        this.id = id;
        this.value = '';
        this.textContent = '';
        this.disabled = false;
        this.listeners = new Map();
        this.classList = new MockClassList(
            id === 'loading-state'
                ? []
                : ['hidden']
        );
    }

    addEventListener(type, handler) {
        const handlers = this.listeners.get(type) || [];
        handlers.push(handler);
        this.listeners.set(type, handlers);
    }

    async dispatchEvent(event) {
        event.target = this;
        event.currentTarget = this;
        const handlers = this.listeners.get(event.type) || [];
        for (const handler of handlers) {
            await handler.call(this, event);
        }
        return !event.defaultPrevented;
    }
}

class MockLocation {
    constructor(href) {
        this._href = href;
    }

    get href() {
        return this._href;
    }

    set href(value) {
        this._href = new URL(value, this._href).toString();
    }

    get search() {
        return new URL(this._href).search;
    }

    get pathname() {
        return new URL(this._href).pathname;
    }
}

function extractAcceptInviteModule() {
    const html = readFileSync(new URL('../../accept-invite.html', import.meta.url), 'utf8');
    const match = html.match(/<script type="module">([\s\S]*?)<\/script>/);
    if (!match) {
        throw new Error('Accept invite module script not found');
    }

    return `
const window = deps.window;
const document = deps.document;
const localStorage = window.localStorage;
const URLSearchParams = deps.URLSearchParams;
const setTimeout = deps.setTimeout;
` + match[1]
        .replace(
            "import { isEmailSignInLink, completeEmailLinkSignIn, checkAuth, getRedirectUrl } from './js/auth.js?v=11';",
            'const { isEmailSignInLink, completeEmailLinkSignIn, checkAuth, getRedirectUrl } = deps.auth;'
        )
        .replace(
            "import { validateAccessCode, redeemParentInvite, redeemAdminInviteAtomically, updateUserProfile, updateTeam, getTeam, getUserProfile, markAccessCodeAsUsed } from './js/db.js?v=15';",
            'const { validateAccessCode, redeemParentInvite, redeemAdminInviteAtomically, updateUserProfile, updateTeam, getTeam, getUserProfile, markAccessCodeAsUsed } = deps.db;'
        )
        .replace(
            "import { createInviteProcessor } from './js/accept-invite-flow.js?v=4';",
            'const { createInviteProcessor } = deps.acceptInviteFlow;'
        )
        .replace(
            "import { renderHeader, renderFooter } from './js/utils.js?v=8';",
            'const { renderHeader, renderFooter } = deps.utils;'
        )
        .replace(/\binit\(\);\s*$/, 'await init();');
}

const runAcceptInviteModule = new AsyncFunction('deps', extractAcceptInviteModule());

function createStorage(initialEntries = {}) {
    const state = new Map(Object.entries(initialEntries));
    return {
        getItem(key) {
            return state.has(key) ? state.get(key) : null;
        },
        setItem(key, value) {
            state.set(key, String(value));
        },
        removeItem(key) {
            state.delete(key);
        }
    };
}

function createEnvironment({ href, storage } = {}) {
    const ids = [
        'header-container',
        'footer-container',
        'loading-state',
        'email-required-state',
        'manual-code-state',
        'success-state',
        'error-state',
        'email-form',
        'email-input',
        'email-error',
        'confirm-email-btn',
        'code-form',
        'code-input',
        'code-error',
        'submit-code-btn',
        'success-message',
        'error-message',
        'try-manual-code-btn'
    ];

    const elements = new Map(ids.map((id) => [id, new MockElement(id)]));
    const document = {
        getElementById(id) {
            const element = elements.get(id);
            if (!element) {
                throw new Error(`Unknown test element: ${id}`);
            }
            return element;
        }
    };

    const window = {
        document,
        location: new MockLocation(href || 'http://example.com/accept-invite.html'),
        localStorage: storage || createStorage()
    };

    return { document, elements, window };
}

async function bootAcceptInvite({
    href,
    authUser,
    authCallbackCount = 1,
    storageEntries,
    dbOverrides = {},
    authOverrides = {}
} = {}) {
    const env = createEnvironment({ href, storage: createStorage(storageEntries) });
    const db = {
        validateAccessCode: vi.fn().mockResolvedValue({
            valid: true,
            type: 'parent_invite',
            data: {
                teamId: 'team-1',
                playerNum: '22'
            }
        }),
        redeemParentInvite: vi.fn().mockResolvedValue(undefined),
        redeemAdminInviteAtomically: vi.fn(),
        updateUserProfile: vi.fn().mockResolvedValue(undefined),
        updateTeam: vi.fn().mockResolvedValue(undefined),
        getTeam: vi.fn().mockResolvedValue({ id: 'team-1', name: 'Tigers' }),
        getUserProfile: vi.fn().mockResolvedValue({}),
        markAccessCodeAsUsed: vi.fn().mockResolvedValue(undefined),
        ...dbOverrides
    };
    const auth = {
        isEmailSignInLink: vi.fn(() => false),
        completeEmailLinkSignIn: vi.fn(),
        getRedirectUrl: vi.fn(() => 'dashboard.html'),
        pendingCheckAuth: null,
        checkAuth: vi.fn((callback) => {
            auth.pendingCheckAuth = (async () => {
                for (let index = 0; index < authCallbackCount; index += 1) {
                    await callback(authUser);
                }
                return () => {};
            })();
            return auth.pendingCheckAuth;
        }),
        ...authOverrides
    };
    const previousGlobals = new Map();
    const globalOverrides = {
        window: env.window,
        document: env.document,
        localStorage: env.window.localStorage,
        Event: MockEvent,
        URLSearchParams,
        setTimeout: (callback) => {
            callback();
            return 1;
        }
    };

    try {
        for (const [key, value] of Object.entries(globalOverrides)) {
            previousGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
            Object.defineProperty(globalThis, key, {
                configurable: true,
                writable: true,
                value
            });
        }

        await runAcceptInviteModule({
            window: env.window,
            document: env.document,
            URLSearchParams,
            setTimeout: globalOverrides.setTimeout,
            auth,
            db,
            utils: {
                renderHeader: vi.fn(),
                renderFooter: vi.fn()
            },
            acceptInviteFlow: {
                createInviteProcessor
            }
        });
        await auth.pendingCheckAuth;
    } finally {
        for (const [key, descriptor] of previousGlobals.entries()) {
            if (descriptor) {
                Object.defineProperty(globalThis, key, descriptor);
            } else {
                delete globalThis[key];
            }
        }
    }

    return { ...env, auth, db };
}

describe('accept-invite page parent flow', () => {
    it('processes an authenticated parent invite once, shows success, and redirects to the parent dashboard', async () => {
        const { elements, window, db } = await bootAcceptInvite({
            href: 'http://example.com/accept-invite.html?code=ab12cd34',
            authUser: { uid: 'parent-1', email: 'parent@example.com' },
            authCallbackCount: 2
        });

        expect(db.validateAccessCode).toHaveBeenCalledOnce();
        expect(db.redeemParentInvite).toHaveBeenCalledOnce();
        expect(db.redeemParentInvite).toHaveBeenCalledWith('parent-1', 'ab12cd34');
        expect(db.getTeam).toHaveBeenCalledWith('team-1');
        expect(elements.get('success-state').classList.contains('hidden')).toBe(false);
        expect(elements.get('success-message').textContent).toContain("#22");
        expect(elements.get('success-message').textContent).toContain('Tigers');
        expect(window.location.href).toBe('http://example.com/parent-dashboard.html');
    });

    it('uppercases the manual code for login redirect and redeems exactly once after the user returns authenticated', async () => {
        const loggedOut = await bootAcceptInvite({
            href: 'http://example.com/accept-invite.html',
            authUser: null
        });

        loggedOut.elements.get('code-input').value = 'ab12cd34';
        await loggedOut.elements.get('code-form').dispatchEvent(new MockEvent('submit'));

        expect(loggedOut.window.location.href).toBe('http://example.com/login.html?code=AB12CD34&type=parent');
        expect(loggedOut.db.redeemParentInvite).not.toHaveBeenCalled();

        const authenticated = await bootAcceptInvite({
            href: 'http://example.com/accept-invite.html?code=AB12CD34&type=parent',
            authUser: { uid: 'parent-2', email: 'family@example.com' },
            authCallbackCount: 2
        });

        expect(authenticated.db.validateAccessCode).toHaveBeenCalledOnce();
        expect(authenticated.db.redeemParentInvite).toHaveBeenCalledOnce();
        expect(authenticated.db.redeemParentInvite).toHaveBeenCalledWith('parent-2', 'AB12CD34');
        expect(authenticated.window.location.href).toBe('http://example.com/parent-dashboard.html');
    });
});

describe('accept-invite page admin flow', () => {
    it('processes an authenticated admin invite and redirects to the coach dashboard', async () => {
        const { elements, window, db } = await bootAcceptInvite({
            href: 'http://example.com/accept-invite.html?code=exist111&type=admin',
            authUser: { uid: 'admin-1', email: 'coach@example.com' },
            authCallbackCount: 2,
            dbOverrides: {
                validateAccessCode: vi.fn().mockResolvedValue({
                    valid: true,
                    codeId: 'code-admin-1',
                    type: 'admin_invite',
                    data: {
                        teamId: 'team-9'
                    }
                }),
                redeemAdminInviteAtomically: vi.fn().mockResolvedValue({
                    success: true,
                    teamId: 'team-9',
                    teamName: 'Tigers'
                }),
                getTeam: vi.fn().mockResolvedValue({
                    id: 'team-9',
                    name: 'Tigers',
                    ownerId: 'owner-1',
                    adminEmails: ['coach@example.com']
                }),
                getUserProfile: vi.fn().mockResolvedValue({
                    email: 'coach@example.com'
                })
            }
        });

        expect(db.validateAccessCode).toHaveBeenCalledWith('exist111');
        expect(db.redeemAdminInviteAtomically).toHaveBeenCalledOnce();
        expect(db.redeemAdminInviteAtomically).toHaveBeenCalledWith('code-admin-1', 'admin-1', 'coach@example.com');
        expect(elements.get('success-state').classList.contains('hidden')).toBe(false);
        expect(elements.get('success-message').textContent).toContain('admin of Tigers');
        expect(window.location.href).toBe('http://example.com/dashboard.html');
    });

    it('preserves the admin invite type when a signed-out user submits a manual code', async () => {
        const loggedOut = await bootAcceptInvite({
            href: 'http://example.com/accept-invite.html?code=exist111&type=admin',
            authUser: null,
            dbOverrides: {
                validateAccessCode: vi.fn().mockResolvedValue({
                    valid: true,
                    codeId: 'code-admin-2',
                    type: 'admin_invite',
                    data: {
                        teamId: 'team-9'
                    }
                })
            }
        });

        await loggedOut.elements.get('code-form').dispatchEvent(new MockEvent('submit'));

        expect(loggedOut.window.location.href).toBe('http://example.com/login.html?code=EXIST111&type=admin');
    });

    it('completes cross-device email-link admin redemption after the user confirms their email', async () => {
        const { elements, window, auth, db } = await bootAcceptInvite({
            href: 'http://example.com/accept-invite.html?code=exist111&type=admin',
            authUser: null,
            authOverrides: {
                isEmailSignInLink: vi.fn(() => true),
                completeEmailLinkSignIn: vi.fn().mockResolvedValue({
                    user: {
                        uid: 'admin-1',
                        email: 'coach@example.com'
                    }
                })
            },
            dbOverrides: {
                validateAccessCode: vi.fn().mockResolvedValue({
                    valid: true,
                    codeId: 'code-admin-3',
                    type: 'admin_invite',
                    data: {
                        teamId: 'team-9'
                    }
                }),
                redeemAdminInviteAtomically: vi.fn().mockResolvedValue({
                    success: true,
                    teamId: 'team-9',
                    teamName: 'Tigers'
                }),
                getTeam: vi.fn().mockResolvedValue({
                    id: 'team-9',
                    name: 'Tigers',
                    ownerId: 'owner-1',
                    adminEmails: ['coach@example.com']
                }),
                getUserProfile: vi.fn().mockResolvedValue({
                    email: 'coach@example.com'
                })
            }
        });

        expect(elements.get('email-required-state').classList.contains('hidden')).toBe(false);

        elements.get('email-input').value = 'coach@example.com';
        await elements.get('email-form').dispatchEvent(new MockEvent('submit'));

        expect(auth.completeEmailLinkSignIn).toHaveBeenCalledWith('coach@example.com');
        expect(db.redeemAdminInviteAtomically).toHaveBeenCalledWith('code-admin-3', 'admin-1', 'coach@example.com');
        expect(elements.get('success-message').textContent).toContain('admin of Tigers');
        expect(window.location.href).toBe('http://example.com/dashboard.html');
    });
});
