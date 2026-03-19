import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
}

function stripHtml(value) {
    return String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

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
        this.checked = false;
        this.disabled = false;
        this.textContent = '';
        this.href = '';
        this.files = [];
        this.dataset = {};
        this.listeners = new Map();
        this.classList = new MockClassList();
        this._innerHTML = '';
        this._removeButtons = [];
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

    async click() {
        await this.dispatchEvent(new MockEvent('click'));
    }

    focus() {}

    querySelectorAll(selector) {
        if (selector === '.remove-admin-btn') {
            return this._removeButtons;
        }
        return [];
    }

    set innerHTML(value) {
        this._innerHTML = value;
        this.textContent = stripHtml(value);
        if (this.id !== 'admin-list') {
            return;
        }

        const removeButtons = [];
        for (const match of String(value).matchAll(/data-email="([^"]+)"/g)) {
            const button = new MockElement();
            button.dataset.email = match[1];
            button.classList.add('remove-admin-btn');
            removeButtons.push(button);
        }
        this._removeButtons = removeButtons;
    }

    get innerHTML() {
        return this._innerHTML;
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

    get origin() {
        return new URL(this._href).origin;
    }

    get search() {
        return new URL(this._href).search;
    }
}

function createEnvironment(initialState, overrides = {}) {
    const ids = [
        'header-container',
        'footer-container',
        'team-admin-banner',
        'page-title',
        'team-form',
        'name',
        'description',
        'sport',
        'notificationEmail',
        'leagueUrl',
        'standingsEnabled',
        'standingsRankingMode',
        'standingsTiebreakers',
        'zip',
        'isPublic',
        'streamUrl',
        'stream-detect',
        'add-admin-btn',
        'admin-list',
        'add-admin-form',
        'admin-email-input',
        'admin-invite-status',
        'admin-invite-code',
        'admin-code-text',
        'copy-admin-code-btn',
        'copy-admin-link-btn',
        'save-admin-btn',
        'cancel-admin-btn',
        'manage-roster-btn',
        'manage-schedule-btn',
        'photo-preview',
        'photo-upload',
        'save-btn'
    ];

    const elements = new Map(ids.map((id) => [id, new MockElement(id)]));
    elements.get('page-title').textContent = 'Create New Team';
    elements.get('add-admin-form').classList.add('hidden');
    elements.get('admin-invite-status').classList.add('hidden');
    elements.get('admin-invite-code').classList.add('hidden');
    elements.get('save-btn').textContent = 'Save Team';
    elements.get('photo-upload').files = [];

    const document = {
        getElementById(id) {
            const element = elements.get(id);
            if (!element) {
                throw new Error(`Unknown test element: ${id}`);
            }
            return element;
        }
    };

    const alerts = [];
    const prompts = [];
    const location = new MockLocation(overrides.href || 'http://example.com/edit-team.html?teamId=team-1');
    const state = deepClone(initialState);
    const window = {
        document,
        location,
        navigator: {
            clipboard: {
                async writeText() {}
            }
        },
        alert(message) {
            alerts.push(String(message));
        },
        prompt(message, details) {
            prompts.push({ message: String(message), details: String(details || '') });
            return '';
        },
        Event: MockEvent
    };

    elements.get('team-form').requestSubmit = async function () {
        await this.dispatchEvent(new MockEvent('submit'));
    };

    return { alerts, document, elements, prompts, state, window };
}

function extractEditTeamModule() {
    const html = readFileSync(new URL('../../edit-team.html', import.meta.url), 'utf8');
    const match = html.match(/<script type="module">([\s\S]*?)<\/script>/);
    if (!match) {
        throw new Error('Edit Team module script not found');
    }

    return match[1]
        .replace(
            "import { createTeam, updateTeam, getTeam, uploadTeamPhoto, addConfig, getUnreadChatCount, inviteAdmin, addTeamAdminEmail } from './js/db.js?v=15';",
            'const { createTeam, updateTeam, getTeam, uploadTeamPhoto, addConfig, getUnreadChatCount, inviteAdmin, addTeamAdminEmail } = deps.db;'
        )
        .replace(
            "import { renderHeader, renderFooter, getUrlParams } from './js/utils.js?v=8';",
            'const { renderHeader, renderFooter, getUrlParams } = deps.utils;'
        )
        .replace(
            "import { checkAuth, sendInviteEmail } from './js/auth.js?v=10';",
            'const { checkAuth, sendInviteEmail } = deps.auth;'
        )
        .replace(
            "import { renderTeamAdminBanner } from './js/team-admin-banner.js';",
            'const { renderTeamAdminBanner } = deps.teamAdminBanner;'
        )
        .replace(
            "import { normalizeYouTubeEmbedUrl } from './js/live-stream-utils.js?v=1';",
            'const { normalizeYouTubeEmbedUrl } = deps.liveStreamUtils;'
        )
        .replace(
            "import { hasFullTeamAccess, normalizeAdminEmailList } from './js/team-access.js';",
            'const { hasFullTeamAccess, normalizeAdminEmailList } = deps.teamAccess;'
        )
        .replace(
            "import { processPendingAdminInvites, buildAdminInviteFollowUp, inviteExistingTeamAdmin } from './js/edit-team-admin-invites.js?v=4';",
            'const { processPendingAdminInvites, buildAdminInviteFollowUp, inviteExistingTeamAdmin } = deps.editTeamAdminInvites;'
        );
}

const editTeamModuleSource = extractEditTeamModule();
const runEditTeamModule = new AsyncFunction('deps', editTeamModuleSource);

async function bootEditTeam(initialState, overrides = {}) {
    const env = createEnvironment(initialState, overrides);
    const previousGlobals = new Map();
    const globalOverrides = {
        document: env.document,
        window: env.window,
        navigator: env.window.navigator,
        Event: MockEvent,
        alert: env.window.alert,
        prompt: env.window.prompt,
        setTimeout: (callback) => {
            callback();
            return 1;
        }
    };

    for (const [key, value] of Object.entries(globalOverrides)) {
        previousGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
        Object.defineProperty(globalThis, key, {
            configurable: true,
            writable: true,
            value
        });
    }

    const deps = {
        db: {
            async createTeam() {
                return 'team-created';
            },
            async updateTeam(teamId, teamData) {
                env.state.updateCalls.push({ teamId, teamData: deepClone(teamData) });
                env.state.team = { ...env.state.team, ...deepClone(teamData), id: teamId };
            },
            async getTeam(teamId) {
                return env.state.team && env.state.team.id === teamId ? deepClone(env.state.team) : null;
            },
            async uploadTeamPhoto() {
                throw new Error('Not implemented in test');
            },
            async addConfig() {
                return 'config-1';
            },
            async getUnreadChatCount() {
                return 0;
            },
            async inviteAdmin() {
                return { code: 'INVITE123' };
            },
            async addTeamAdminEmail() {}
        },
        utils: {
            renderHeader(container) {
                container.textContent = 'Header';
            },
            renderFooter(container) {
                container.textContent = 'Footer';
            },
            getUrlParams() {
                return Object.fromEntries(new URLSearchParams(env.window.location.search).entries());
            }
        },
        auth: {
            async checkAuth(callback) {
                await callback(deepClone(env.state.currentUser));
            },
            async sendInviteEmail() {}
        },
        teamAdminBanner: {
            renderTeamAdminBanner(container) {
                container.textContent = 'Team Admin Banner';
            }
        },
        liveStreamUtils: {
            normalizeYouTubeEmbedUrl(url) {
                return url;
            }
        },
        teamAccess: await import('../../js/team-access.js'),
        editTeamAdminInvites: {
            async processPendingAdminInvites() {
                return { results: [], fallbackCodeCount: 0, failedCount: 0 };
            },
            buildAdminInviteFollowUp() {
                return { shareableCount: 0, unresolvedCount: 0, shareableDetails: '' };
            },
            async inviteExistingTeamAdmin({ email }) {
                return { status: 'sent', email, code: '' };
            }
        }
    };

    env.cleanup = () => {
        for (const [key, descriptor] of previousGlobals.entries()) {
            if (descriptor) {
                Object.defineProperty(globalThis, key, descriptor);
            } else {
                delete globalThis[key];
            }
        }
    };

    await runEditTeamModule(deps);

    return env;
}

describe('edit team admin access persistence', () => {
    it('persists a normalized admin list after removing an admin and blocks the removed admin on the next load', async () => {
        const initialState = {
            currentUser: { uid: 'owner-1', email: 'owner@example.com' },
            team: {
                id: 'team-1',
                ownerId: 'owner-1',
                name: 'Sharks',
                description: 'Travel team',
                sport: 'Basketball',
                notificationEmail: 'notify@example.com',
                leagueUrl: '',
                standingsConfig: { enabled: false, rankingMode: 'points', tiebreakers: [] },
                zip: '66209',
                isPublic: true,
                adminEmails: ['coach1@example.com', ' CoachTwo@Example.com ']
            },
            updateCalls: []
        };

        const env = await bootEditTeam(initialState);
        try {
            const removeButtons = env.elements.get('admin-list').querySelectorAll('.remove-admin-btn');
            expect(removeButtons).toHaveLength(2);

            await removeButtons[0].click();
            await env.elements.get('team-form').requestSubmit();

            expect(env.state.updateCalls).toHaveLength(1);
            expect(env.state.updateCalls[0].teamData.adminEmails).toEqual(['coachtwo@example.com']);
        } finally {
            env.cleanup();
        }

        const reloadEnv = await bootEditTeam({
            ...env.state,
            currentUser: { uid: 'user-removed', email: 'coach1@example.com' }
        });
        try {
            expect(reloadEnv.alerts).toContain("You don't have permission to edit this team.");
            expect(reloadEnv.window.location.href).toBe('http://example.com/dashboard.html');
        } finally {
            reloadEnv.cleanup();
        }
    });

    it('adds a mixed-case admin once in lowercase and keeps next-load access aligned with the saved list', async () => {
        const initialState = {
            currentUser: { uid: 'owner-1', email: 'owner@example.com' },
            team: {
                id: 'team-1',
                ownerId: 'owner-1',
                name: 'Sharks',
                description: 'Travel team',
                sport: 'Basketball',
                notificationEmail: 'notify@example.com',
                leagueUrl: '',
                standingsConfig: { enabled: false, rankingMode: 'points', tiebreakers: [] },
                zip: '66209',
                isPublic: true,
                adminEmails: [' Existing@Example.com ', 'existing@example.com']
            },
            updateCalls: []
        };

        const env = await bootEditTeam(initialState);
        try {
            await env.elements.get('add-admin-btn').click();
            env.elements.get('admin-email-input').value = 'NewAdmin@Example.COM';
            await env.elements.get('save-admin-btn').click();
            await env.elements.get('team-form').requestSubmit();

            expect(env.state.updateCalls).toHaveLength(1);
            expect(env.state.updateCalls[0].teamData.adminEmails).toEqual([
                'existing@example.com',
                'newadmin@example.com'
            ]);
        } finally {
            env.cleanup();
        }

        const reloadEnv = await bootEditTeam({
            ...env.state,
            currentUser: { uid: 'user-new', email: 'newadmin@example.com' }
        });
        try {
            expect(reloadEnv.elements.get('page-title').textContent).toBe('Edit Team');
            expect(reloadEnv.elements.get('admin-list').textContent).toContain('existing@example.com');
            expect(reloadEnv.elements.get('admin-list').textContent).toContain('newadmin@example.com');
            expect(reloadEnv.elements.get('admin-list').querySelectorAll('.remove-admin-btn')).toHaveLength(2);
        } finally {
            reloadEnv.cleanup();
        }
    });
});
