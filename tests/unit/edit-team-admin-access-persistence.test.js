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

    toggle(token, force) {
        const shouldAdd = force === undefined ? !this.tokens.has(token) : !!force;
        if (shouldAdd) {
            this.tokens.add(token);
        } else {
            this.tokens.delete(token);
        }
        return shouldAdd;
    }

    contains(token) {
        return this.tokens.has(token);
    }

    toggle(token, force) {
        if (force === true) {
            this.add(token);
            return true;
        }
        if (force === false) {
            this.remove(token);
            return false;
        }
        if (this.contains(token)) {
            this.remove(token);
            return false;
        }
        this.add(token);
        return true;
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
        this.attributes = {};
        this.dataset = {};
        this.listeners = new Map();
        this.classList = new MockClassList();
        this._innerHTML = '';
        this._removeButtons = [];
        this._rolloverStaffInputs = [];
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

    setAttribute(name, value) {
        this.attributes[name] = String(value);
    }

    closest() {
        return this;
    }

    querySelectorAll(selector) {
        if (selector === '.remove-admin-btn') {
            return this._removeButtons;
        }
        if (selector === '.rollover-staff-email') {
            return this._rolloverStaffInputs;
        }
        if (selector === '.rollover-staff-email:checked') {
            return this._rolloverStaffInputs.filter((input) => input.checked);
        }
        return [];
    }

    set innerHTML(value) {
        this._innerHTML = value;
        this.textContent = stripHtml(value);
        if (this.id === 'rollover-staff-list') {
            const rolloverStaffInputs = [];
            for (const match of String(value).matchAll(/<input[^>]*class="[^"]*rollover-staff-email[^"]*"[^>]*value="([^"]+)"([^>]*)>/g)) {
                const input = new MockElement();
                input.value = match[1];
                input.checked = /\bchecked\b/.test(match[2]);
                input.classList.add('rollover-staff-email');
                rolloverStaffInputs.push(input);
            }
            this._rolloverStaffInputs = rolloverStaffInputs;
            return;
        }

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
        'team-create-options',
        'team-create-mode-registration',
        'registration-import-panel',
        'registration-source-select',
        'registration-empty-state',
        'registration-import-help',
        'team-form',
        'advanced-team-setup',
        'name',
        'description',
        'sport',
        'teamColorPrimary',
        'teamColorSecondary',
        'notificationEmail',
        'leagueUrl',
        'bracketUrl',
        'standingsEnabled',
        'standingsRankingMode',
        'standingsPointWin',
        'standingsPointTie',
        'standingsPointLoss',
        'standingsMaxGoalDiff',
        'standingsTiebreakers',
        'standingsTwoTeamTiebreakers',
        'standingsMultiTeamTiebreakers',
        'zip',
        'isPublic',
        'teamPassRecordedReplayPaywallEnabled',
        'streamUrl',
        'stream-detect',
        'team-permissions-empty',
        'scorekeepingAccessMode',
        'scorekeeping-member-list',
        'streamingAccessMode',
        'streaming-member-list',
        'videography-member-list',
        'streamAccessMode',
        'stream-volunteer-panel',
        'stream-volunteer-list',
        'stream-volunteer-email-input',
        'add-stream-volunteer-btn',
        'roster-rollover-section',
        'rosterRolloverEnabled',
        'roster-rollover-controls',
        'rosterRolloverSourceTeam',
        'roster-rollover-status',
        'roster-rollover-preview',
        'access-rollover-panel',
        'rollover-source-team',
        'rollover-staff-review',
        'rollover-staff-enabled',
        'rollover-staff-list',
        'rollover-member-note',
        'add-admin-btn',
        'admin-list',
        'add-admin-form',
        'admin-email-input',
        'admin-invite-status',
        'admin-invite-code',
        'admin-code-text',
        'copy-admin-code-btn',
        'copy-admin-link-btn',
        'team-id-panel',
        'team-id-text',
        'team-id-status',
        'copy-team-id-btn',
        'registrationProviderName',
        'registrationExternalTeamId',
        'registrationCopiedTeamId',
        'registrationLastSyncStatus',
        'registration-connection-status',
        'registration-sync-status',
        'registration-sync-time',
        'registration-connection-help',
        'registration-refresh-btn',
        'clear-registration-provider-btn',
        'save-admin-btn',
        'cancel-admin-btn',
        'manage-roster-btn',
        'manage-schedule-btn',
        'photo-preview',
        'photo-upload',
        'save-btn',
        'add-default-assignment-btn',
        'default-assignment-rows'
    ];

    const elements = new Map(ids.map((id) => [id, new MockElement(id)]));
    elements.get('page-title').textContent = 'Create New Team';
    elements.get('add-admin-form').classList.add('hidden');
    elements.get('admin-invite-status').classList.add('hidden');
    elements.get('admin-invite-code').classList.add('hidden');
    elements.get('roster-rollover-controls').classList.add('hidden');
    elements.get('roster-rollover-preview').classList.add('hidden');
    elements.get('access-rollover-panel').classList.add('hidden');
    elements.get('rollover-staff-review').classList.add('hidden');
    elements.get('save-btn').textContent = 'Save Team';
    elements.get('advanced-team-setup').open = false;
    elements.get('teamColorPrimary').value = '#5ec9c5';
    elements.get('teamColorSecondary').value = '#d32f3a';
    elements.get('standingsPointWin').value = '3';
    elements.get('standingsPointTie').value = '1';
    elements.get('standingsPointLoss').value = '0';
    elements.get('isPublic').checked = true;
    elements.get('streamAccessMode').value = 'admins';
    elements.get('photo-upload').files = [];

    const document = {
        getElementById(id) {
            const element = elements.get(id);
            if (!element) {
                throw new Error(`Unknown test element: ${id}`);
            }
            return element;
        },
        querySelectorAll(selector) {
            return Array.from(elements.values()).flatMap((element) => element.querySelectorAll(selector));
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
            /import\s+\{\s*createTeam,\s*updateTeam,\s*getTeam,\s*getUserProfile,\s*getUserTeamsWithAccess,\s*getPlayers,\s*copySelectedPlayersForTeamRollover,\s*uploadTeamPhoto,\s*addConfig,\s*getUnreadChatCount,\s*inviteAdmin,\s*addTeamAdminEmail,\s*getAllUsers,\s*getTeamAccessCodes(?:,\s*getConfigs,\s*getGames,\s*updateGame)?(?:,\s*getRegistrationSources)?(?:,\s*syncRegistrationProvider)?\s*\}\s+from\s+'\.\/js\/db\.js\?v=\d+';/,
            'const { createTeam, updateTeam, getTeam, getUserProfile, getUserTeamsWithAccess, getPlayers, copySelectedPlayersForTeamRollover, uploadTeamPhoto, addConfig, getUnreadChatCount, inviteAdmin, addTeamAdminEmail, getAllUsers, getTeamAccessCodes, getConfigs, getGames, updateGame, getRegistrationSources, syncRegistrationProvider } = deps.db;'
        )
        .replace(
            "import { getDefaultStatConfigForSport } from './js/stat-config-presets.js?v=1';",
            'const { getDefaultStatConfigForSport } = deps.statConfigPresets;'
        )
        .replace(
            "import { buildTeamSportConfigMigrationPlan } from './js/team-stat-config-migration.js?v=1';",
            'const { buildTeamSportConfigMigrationPlan } = deps.teamStatConfigMigration;'
        )
        .replace(
            "import { renderHeader, renderFooter, getUrlParams, escapeHtml } from './js/utils.js?v=8';",
            'const { renderHeader, renderFooter, getUrlParams, escapeHtml } = deps.utils;'
        )
        .replace(
            /import\s+\{\s*checkAuth,\s*sendInviteEmail\s*\}\s+from\s+'\.\/js\/auth\.js\?v=\d+';/,
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
            "import { hasFullTeamAccess, normalizeAdminEmailList, normalizeStreamVolunteerEmailList, normalizeTeamPermissions } from './js/team-access.js?v=3';",
            'const { hasFullTeamAccess, normalizeAdminEmailList, normalizeStreamVolunteerEmailList, normalizeTeamPermissions } = deps.teamAccess;'
        )
        .replace(
            "import { processPendingAdminInvites, buildAdminInviteFollowUp, inviteExistingTeamAdmin, loadPendingAdminInviteEmails } from './js/edit-team-admin-invites.js?v=4';",
            'const { processPendingAdminInvites, buildAdminInviteFollowUp, inviteExistingTeamAdmin, loadPendingAdminInviteEmails } = deps.editTeamAdminInvites;'
        )
        .replace(
            "import { buildRolloverAccessPreview, buildStaffAdminRolloverUpdate } from './js/rollover-access.js?v=1';",
            'const { buildRolloverAccessPreview, buildStaffAdminRolloverUpdate } = deps.rolloverAccess;'
        )
        .replace(
            "import { buildRosterRolloverPreviewRows } from './js/roster-rollover-preview.js?v=1';",
            'const { buildRosterRolloverPreviewRows } = deps.rosterRolloverPreview;'
        );
}

const editTeamModuleSource = extractEditTeamModule();
const runEditTeamModule = new AsyncFunction('deps', editTeamModuleSource);

async function bootEditTeam(initialState, overrides = {}, dependencyOverrides = {}) {
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

    const baseDeps = {
        db: {
            async createTeam(teamData) {
                env.state.createCalls = env.state.createCalls || [];
                env.state.createCalls.push({ teamData: deepClone(teamData) });
                return 'team-created';
            },
            async updateTeam(teamId, teamData) {
                env.state.updateCalls.push({ teamId, teamData: deepClone(teamData) });
                env.state.team = { ...env.state.team, ...deepClone(teamData), id: teamId };
            },
            async getTeam(teamId) {
                return env.state.team && env.state.team.id === teamId ? deepClone(env.state.team) : null;
            },
            async getUserProfile() {
                return deepClone(env.state.userProfile || {});
            },
            async getUserTeamsWithAccess() {
                return deepClone(env.state.sourceTeams || []);
            },
            async getPlayers() {
                return deepClone(env.state.players || []);
            },
            async copySelectedPlayersForTeamRollover() {
                return { copiedCount: 0 };
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
            async addTeamAdminEmail() {},
            async getAllUsers() {
                return env.state.users || [];
            },
            async getTeamAccessCodes(teamId) {
                return (env.state.teamAccessCodes || []).filter((code) => code.teamId === teamId);
            },
            async getConfigs() {
                return deepClone(env.state.configs || []);
            },
            async getGames() {
                return deepClone(env.state.games || []);
            },
            async updateGame(teamId, gameId, gameData) {
                env.state.updateGameCalls = env.state.updateGameCalls || [];
                env.state.updateGameCalls.push({ teamId, gameId, gameData: deepClone(gameData) });
            },
            async getRegistrationSources() {
                return [];
            },
            async syncRegistrationProvider() {
                return { synced: false };
            }
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
            },
            escapeHtml(value) {
                return String(value ?? '')
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;')
                    .replace(/'/g, '&#039;');
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
        statConfigPresets: {
            getDefaultStatConfigForSport() {
                return null;
            }
        },
        teamStatConfigMigration: {
            buildTeamSportConfigMigrationPlan() {
                return {
                    sportChanged: false,
                    needsNewConfig: false,
                    targetConfigId: null,
                    gameIdsToUpdate: []
                };
            }
        },
        teamAccess: await import('../../js/team-access.js'),
        rolloverAccess: await import('../../js/rollover-access.js'),
        rosterRolloverPreview: await import('../../js/roster-rollover-preview.js'),
        editTeamAdminInvites: {
            ...(await import('../../js/edit-team-admin-invites.js')),
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

    const deps = {
        ...baseDeps,
        ...dependencyOverrides,
        db: {
            ...baseDeps.db,
            ...(dependencyOverrides.db || {})
        },
        utils: {
            ...baseDeps.utils,
            ...(dependencyOverrides.utils || {})
        },
        auth: {
            ...baseDeps.auth,
            ...(dependencyOverrides.auth || {})
        },
        teamAdminBanner: {
            ...baseDeps.teamAdminBanner,
            ...(dependencyOverrides.teamAdminBanner || {})
        },
        liveStreamUtils: {
            ...baseDeps.liveStreamUtils,
            ...(dependencyOverrides.liveStreamUtils || {})
        },
        statConfigPresets: {
            ...baseDeps.statConfigPresets,
            ...(dependencyOverrides.statConfigPresets || {})
        },
        teamStatConfigMigration: {
            ...baseDeps.teamStatConfigMigration,
            ...(dependencyOverrides.teamStatConfigMigration || {})
        },
        teamAccess: {
            ...baseDeps.teamAccess,
            ...(dependencyOverrides.teamAccess || {})
        },
        rolloverAccess: {
            ...baseDeps.rolloverAccess,
            ...(dependencyOverrides.rolloverAccess || {})
        },
        rosterRolloverPreview: {
            ...baseDeps.rosterRolloverPreview,
            ...(dependencyOverrides.rosterRolloverPreview || {})
        },
        editTeamAdminInvites: {
            ...baseDeps.editTeamAdminInvites,
            ...(dependencyOverrides.editTeamAdminInvites || {})
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
    for (let i = 0; i < 20; i += 1) {
        await Promise.resolve();
    }

    return env;
}

describe('edit team admin access persistence', () => {
    it('defers advanced setup controls behind a collapsed create-mode disclosure', async () => {
        const html = readFileSync(new URL('../../edit-team.html', import.meta.url), 'utf8');
        const advancedIndex = html.indexOf('id="advanced-team-setup"');
        expect(advancedIndex).toBeGreaterThan(-1);
        expect(html.indexOf('id="zip"')).toBeLessThan(advancedIndex);
        expect(html.indexOf('id="isPublic"')).toBeLessThan(advancedIndex);
        expect(html.indexOf('id="teamColorPrimary"')).toBeGreaterThan(advancedIndex);
        expect(html.indexOf('id="registrationProviderName"')).toBeGreaterThan(advancedIndex);
        expect(html).toContain('Registration Provider Connection');
        expect(html).toContain('Sports Connect live sync is unavailable until a connector is added.');
        expect(html).toContain('Sync unavailable');
        expect(html).toContain('id="team-create-mode-registration"');
        expect(html).toContain('No registration sources are configured yet. Start with a blank team or load provider data before using this import path.');
        expect(html).toContain('registrationMode.setAttribute(\'aria-disabled\', String(registrationMode.disabled));');
        expect(html).toContain('configuredRegistrationTeams.length === 0');

        const createEnv = await bootEditTeam({
            currentUser: { uid: 'owner-1', email: 'owner@example.com' },
            createCalls: [],
            updateCalls: []
        }, { href: 'http://example.com/edit-team.html' });
        try {
            expect(createEnv.elements.get('advanced-team-setup').open).toBe(false);
        } finally {
            createEnv.cleanup();
        }
    });

    it('blocks Sports Connect roster import until a stored provider snapshot exists', () => {
        const html = readFileSync(new URL('../../edit-roster.html', import.meta.url), 'utf8');

        expect(html).toContain('Sports Connect metadata is saved for this team, but roster import is unavailable until a provider connector stores a roster snapshot.');
        expect(html).toContain('Import unavailable: Sports Connect has metadata only. A live connector must create a stored roster snapshot before this page can preview or import players.');
        expect(html).toContain('No stored registration roster snapshot is available yet. Sports Connect live import requires a provider connector before preview is possible.');
        expect(html).toContain("previewButton.disabled = !hasImportableSnapshot;");
        expect(html).toContain("importButton.disabled = true;");
    });

    it('saves the simple create path with safe advanced defaults', async () => {
        const initialState = {
            currentUser: { uid: 'owner-1', email: 'owner@example.com' },
            createCalls: [],
            updateCalls: []
        };

        const env = await bootEditTeam(initialState, { href: 'http://example.com/edit-team.html' });
        try {
            env.elements.get('name').value = 'Spring Sharks';
            env.elements.get('description').value = 'First season';
            env.elements.get('sport').value = 'Basketball';
            env.elements.get('zip').value = '66209';
            env.elements.get('bracketUrl').value = 'https://example.com/bracket';
            expect(env.elements.get('advanced-team-setup').open).toBe(false);

            await env.elements.get('team-form').requestSubmit();

            expect(env.state.createCalls).toHaveLength(1);
            expect(env.state.createCalls[0].teamData).toMatchObject({
                name: 'Spring Sharks',
                description: 'First season',
                sport: 'Basketball',
                zip: '66209',
                isPublic: true,
                colors: { primary: '#5ec9c5', secondary: '#d32f3a' },
                standingsConfig: {
                    enabled: false,
                    rankingMode: 'points',
                    points: { win: 3, tie: 1, loss: 0 },
                    maxGoalDiff: null
                },
                teamPassConfig: { recordedReplayPaywallEnabled: false },
                teamPermissions: {
                    scorekeeping: { mode: 'all_confirmed', memberIds: [] },
                    streaming: { mode: 'all_confirmed', memberIds: [] },
                    videography: { mode: 'selected', memberIds: [] }
                },
                bracketUrl: 'https://example.com/bracket',
                streamAccessMode: 'admins',
                streamVolunteerEmails: [],
                defaultAssignments: [],
                twitchChannel: null,
                streamEmbedUrl: null,
                youtubeEmbedUrl: null,
                ownerId: 'owner-1',
                ownerEmail: 'owner@example.com'
            });
            expect(env.state.createCalls[0].teamData.registrationSource).toBeNull();
        } finally {
            env.cleanup();
        }
    });

    it('runs sport migration before saving the new team sport so failed migrations can be retried', async () => {
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
                adminEmails: []
            },
            configs: [
                { id: 'cfg-basketball', baseType: 'Basketball', columns: ['PTS'] }
            ],
            games: [
                { id: 'game-1', status: 'scheduled', statTrackerConfigId: 'cfg-basketball' }
            ],
            updateCalls: [],
            updateGameCalls: [],
            operationOrder: []
        };

        const env = await bootEditTeam(initialState, undefined, {
            teamStatConfigMigration: {
                buildTeamSportConfigMigrationPlan() {
                    return {
                        sportChanged: true,
                        shouldCreateTargetConfig: true,
                        targetConfigId: null,
                        targetConfigData: { baseType: 'Soccer', columns: ['GOALS'] },
                        gameIdsToUpdate: ['game-1']
                    };
                }
            },
            db: {
                async getConfigs() {
                    initialState.operationOrder.push('getConfigs');
                    return deepClone(initialState.configs || []);
                },
                async getGames() {
                    initialState.operationOrder.push('getGames');
                    return deepClone(initialState.games || []);
                },
                async addConfig() {
                    initialState.operationOrder.push('addConfig');
                    return 'cfg-soccer';
                },
                async updateGame(teamId, gameId, gameData) {
                    initialState.operationOrder.push(`updateGame:${gameId}`);
                    initialState.updateGameCalls.push({ teamId, gameId, gameData: deepClone(gameData) });
                    throw new Error('game migration failed');
                },
                async updateTeam(teamId, teamData) {
                    initialState.operationOrder.push('updateTeam');
                    initialState.updateCalls.push({ teamId, teamData: deepClone(teamData) });
                    initialState.team = { ...initialState.team, ...deepClone(teamData), id: teamId };
                }
            }
        });
        try {
            env.elements.get('sport').value = 'Soccer';

            await env.elements.get('team-form').requestSubmit();

            expect(initialState.operationOrder).toEqual([
                'getConfigs',
                'getGames',
                'addConfig',
                'updateGame:game-1'
            ]);
            expect(initialState.updateCalls).toEqual([]);
            expect(initialState.team.sport).toBe('Basketball');
            expect(env.alerts.at(-1)).toContain('game migration failed');
        } finally {
            env.cleanup();
        }
    });

    it('keeps advanced setup open when editing an existing team', async () => {
        const initialState = {
            currentUser: { uid: 'owner-1', email: 'owner@example.com' },
            team: {
                id: 'team-1',
                ownerId: 'owner-1',
                name: 'Sharks',
                description: 'Travel team',
                sport: 'Soccer',
                notificationEmail: 'notify@example.com',
                leagueUrl: 'https://example.com/league',
                bracketUrl: 'https://example.com/bracket',
                standingsConfig: {
                    enabled: true,
                    rankingMode: 'points',
                    points: { win: 5, tie: 2, loss: 1 },
                    maxGoalDiff: 3,
                    twoTeamTiebreakers: ['wins'],
                    multiTeamTiebreakers: ['goals_for']
                },
                colors: { primary: '#111111', secondary: '#eeeeee' },
                zip: '66209',
                isPublic: true,
                adminEmails: []
            },
            updateCalls: []
        };

        const env = await bootEditTeam(initialState);
        try {
            expect(env.elements.get('advanced-team-setup').open).toBe(true);
            expect(env.elements.get('teamColorPrimary').value).toBe('#111111');
            expect(env.elements.get('notificationEmail').value).toBe('notify@example.com');
            expect(env.elements.get('leagueUrl').value).toBe('https://example.com/league');
            expect(env.elements.get('bracketUrl').value).toBe('https://example.com/bracket');
            expect(env.elements.get('standingsEnabled').checked).toBe(true);
            expect(env.elements.get('standingsPointWin').value).toBe('5');
        } finally {
            env.cleanup();
        }
    });

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

  it('normalizes an invited existing-team admin email without granting access before redemption', async () => {
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
                'existing@example.com'
            ]);
        } finally {
            env.cleanup();
        }

        const reloadEnv = await bootEditTeam({
            ...env.state,
            currentUser: { uid: 'user-new', email: 'newadmin@example.com' }
        });
        try {
            expect(reloadEnv.alerts).toContain("You don't have permission to edit this team.");
            expect(reloadEnv.window.location.href).toBe('http://example.com/dashboard.html');
        } finally {
            reloadEnv.cleanup();
        }
    });

    it('keeps invited existing-team admins out of the saved admin list until redemption', async () => {
        const future = Date.now() + 60_000;
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
                adminEmails: ['existing@example.com']
            },
            updateCalls: []
        };

        const env = await bootEditTeam(initialState);
        try {
            await env.elements.get('add-admin-btn').click();
            env.elements.get('admin-email-input').value = 'pending@example.com';
            await env.elements.get('save-admin-btn').click();
            await env.elements.get('team-form').requestSubmit();

            expect(env.state.updateCalls).toHaveLength(1);
            expect(env.state.updateCalls[0].teamData.adminEmails).toEqual(['existing@example.com']);
            expect(env.elements.get('admin-list').textContent).not.toContain('pending@example.com');
        } finally {
            env.cleanup();
        }

        const ownerReloadEnv = await bootEditTeam({
            ...env.state,
            currentUser: { uid: 'owner-1', email: 'owner@example.com' },
            teamAccessCodes: [
                {
                    id: 'invite-1',
                    teamId: 'team-1',
                    email: 'pending@example.com',
                    type: 'admin_invite',
                    used: false,
                    expiresAt: { toMillis: () => future }
                }
            ]
        });
        try {
            await ownerReloadEnv.elements.get('add-admin-btn').click();
            ownerReloadEnv.elements.get('admin-email-input').value = 'pending@example.com';
            await ownerReloadEnv.elements.get('save-admin-btn').click();

            expect(ownerReloadEnv.elements.get('admin-invite-status').textContent).toBe('This email already has a pending invite.');
        } finally {
            ownerReloadEnv.cleanup();
        }

        const reloadEnv = await bootEditTeam({
            ...env.state,
            currentUser: { uid: 'user-pending', email: 'pending@example.com' }
        });
        try {
            expect(reloadEnv.alerts).toContain("You don't have permission to edit this team.");
            expect(reloadEnv.window.location.href).toBe('http://example.com/dashboard.html');
        } finally {
            reloadEnv.cleanup();
        }
    });

    it('preserves disabled rollover access across new-team admin rerenders', async () => {
        const initialState = {
            currentUser: { uid: 'owner-1', email: 'owner@example.com' },
            sourceTeams: [
                {
                    id: 'source-1',
                    name: 'Spring Sharks',
                    adminEmails: ['coach-a@example.com', 'coach-b@example.com']
                }
            ],
            createCalls: [],
            updateCalls: []
        };

        const env = await bootEditTeam(initialState, { href: 'http://example.com/edit-team.html' });
        try {
            env.elements.get('rollover-source-team').value = 'source-1';
            await env.elements.get('rollover-source-team').dispatchEvent(new MockEvent('change'));
            expect(env.elements.get('rollover-staff-enabled').checked).toBe(true);

            env.elements.get('rollover-staff-enabled').checked = false;
            await env.elements.get('add-admin-btn').click();
            env.elements.get('admin-email-input').value = 'manual@example.com';
            await env.elements.get('save-admin-btn').click();

            expect(env.elements.get('rollover-staff-enabled').checked).toBe(false);
            await env.elements.get('team-form').requestSubmit();

            expect(env.state.createCalls).toHaveLength(1);
            expect(env.state.createCalls[0].teamData.adminEmails).toEqual(['manual@example.com']);
        } finally {
            env.cleanup();
        }
    });

    it('preserves individual rollover staff deselections across admin add and remove rerenders', async () => {
        const initialState = {
            currentUser: { uid: 'owner-1', email: 'owner@example.com' },
            sourceTeams: [
                {
                    id: 'source-1',
                    name: 'Spring Sharks',
                    adminEmails: ['coach-a@example.com', 'coach-b@example.com']
                }
            ],
            createCalls: [],
            updateCalls: []
        };

        const env = await bootEditTeam(initialState, { href: 'http://example.com/edit-team.html' });
        try {
            env.elements.get('rollover-source-team').value = 'source-1';
            await env.elements.get('rollover-source-team').dispatchEvent(new MockEvent('change'));

            const findRolloverInput = (email) => env.elements.get('rollover-staff-list')
                .querySelectorAll('.rollover-staff-email')
                .find((input) => input.value === email);

            expect(findRolloverInput('coach-a@example.com').checked).toBe(true);
            expect(findRolloverInput('coach-b@example.com').checked).toBe(true);
            findRolloverInput('coach-b@example.com').checked = false;

            await env.elements.get('add-admin-btn').click();
            env.elements.get('admin-email-input').value = 'manual@example.com';
            await env.elements.get('save-admin-btn').click();
            expect(findRolloverInput('coach-b@example.com').checked).toBe(false);

            const removeButtons = env.elements.get('admin-list').querySelectorAll('.remove-admin-btn');
            expect(removeButtons).toHaveLength(1);
            await removeButtons[0].click();
            expect(findRolloverInput('coach-b@example.com').checked).toBe(false);

            await env.elements.get('team-form').requestSubmit();

            expect(env.state.createCalls).toHaveLength(1);
            expect(env.state.createCalls[0].teamData.adminEmails).toEqual(['coach-a@example.com']);
            expect(env.state.createCalls[0].teamData.accessRolloverAudit.staffAdmins).toEqual([
                { email: 'coach-a@example.com', sourceTeamId: 'source-1', rolledOverAt: expect.any(String) }
            ]);
        } finally {
            env.cleanup();
        }
    });


    it('allows admins to edit and clear registration provider metadata without external calls', async () => {
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
                adminEmails: [],
                registrationSource: {
                    provider: 'sports-connect',
                    externalTeamId: 'SC-123',
                    sourceId: 'sports-connect',
                    externalTeamName: 'Sharks 12U',
                    season: 'Spring 2026',
                    division: '12U',
                    teamId: 'team-1',
                    providerId: 'sports-connect',
                    connectionStatus: 'metadata_configured',
                    syncEnabled: false,
                    lastSyncStatus: 'Not synced',
                    lastSyncAt: '2026-05-10T18:30:00.000Z'
                }
            },
            updateCalls: []
        };

        const env = await bootEditTeam(initialState);
        try {
            expect(env.elements.get('registrationProviderName').value).toBe('Sports Connect');
            expect(env.elements.get('registrationExternalTeamId').value).toBe('SC-123');
            expect(env.elements.get('registrationCopiedTeamId').value).toBe('team-1');
            expect(env.elements.get('registrationLastSyncStatus').value).toBe('Metadata saved; live sync unavailable');
            expect(env.elements.get('registration-connection-status').textContent).toBe('Metadata saved; live sync unavailable');
            expect(env.elements.get('registration-sync-status').textContent).toBe('Metadata saved; live sync unavailable');
            expect(env.elements.get('registration-sync-time').textContent).toContain('2026');
            expect(env.elements.get('registration-refresh-btn').disabled).toBe(true);

            env.elements.get('registrationProviderName').value = 'League Apps';
            env.elements.get('registrationExternalTeamId').value = 'LA-456';
            await env.elements.get('registrationProviderName').dispatchEvent(new MockEvent('change'));
            await env.elements.get('team-form').requestSubmit();

            expect(env.state.updateCalls).toHaveLength(1);
            expect(env.state.updateCalls[0].teamData.registrationSource).toEqual({
                provider: 'League Apps',
                externalTeamId: 'LA-456',
                sourceId: 'sports-connect',
                externalTeamName: 'Sharks 12U',
                season: 'Spring 2026',
                division: '12U',
                teamId: 'team-1',
                providerId: null,
                connectionStatus: 'metadata_configured',
                syncEnabled: false,
                lastSyncStatus: 'Registration metadata only. No live sync.',
                lastSyncAt: '2026-05-10T18:30:00.000Z'
            });

            await env.elements.get('clear-registration-provider-btn').click();
            await env.elements.get('team-form').requestSubmit();

            expect(env.state.updateCalls).toHaveLength(2);
            expect(env.state.updateCalls[1].teamData.registrationSource).toBeNull();
        } finally {
            env.cleanup();
        }
    });

    it('saves Sports Connect metadata as configured but not live synced', async () => {
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
                adminEmails: []
            },
            updateCalls: []
        };

        let syncCalls = 0;
        const env = await bootEditTeam(initialState, undefined, {
            db: {
                async syncRegistrationProvider() {
                    syncCalls += 1;
                    throw new Error('sync should stay unavailable');
                }
            }
        });
        try {
            env.elements.get('registrationProviderName').value = 'sports-connect';
            env.elements.get('registrationExternalTeamId').value = 'SC-987';
            await env.elements.get('registrationProviderName').dispatchEvent(new MockEvent('change'));

            expect(env.elements.get('registrationLastSyncStatus').value).toBe('Metadata saved; live sync unavailable');
            expect(env.elements.get('registration-connection-status').textContent).toBe('Metadata saved; live sync unavailable');
            expect(env.elements.get('registration-sync-status').textContent).toBe('Metadata saved; live sync unavailable');
            expect(env.elements.get('registration-connection-help').textContent).toContain('future provider connector');
            expect(env.elements.get('registration-refresh-btn').disabled).toBe(true);
            await env.elements.get('registration-refresh-btn').click();
            expect(syncCalls).toBe(0);

            await env.elements.get('team-form').requestSubmit();

            expect(env.state.updateCalls[0].teamData.registrationSource).toEqual({
                provider: 'sports-connect',
                providerId: 'sports-connect',
                externalTeamId: 'SC-987',
                teamId: 'team-1',
                connectionStatus: 'metadata_configured',
                syncEnabled: false,
                lastSyncStatus: 'Metadata saved; live sync unavailable'
            });
        } finally {
            env.cleanup();
        }
    });

    it('keeps Sports Connect connector guidance visible even when prior sync metadata contains an error', async () => {
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
                adminEmails: [],
                registrationSource: {
                    provider: 'sports-connect',
                    externalTeamId: 'SC-987',
                    teamId: 'team-1',
                    connectionStatus: 'metadata_configured',
                    syncEnabled: false,
                    lastSyncStatus: 'error',
                    lastSyncError: 'Connector failed upstream'
                }
            },
            updateCalls: []
        };

        const env = await bootEditTeam(initialState);
        try {
            expect(env.elements.get('registration-sync-status').textContent).toBe('Metadata saved; live sync unavailable');
            expect(env.elements.get('registration-connection-help').textContent).toContain('future provider connector');
            expect(env.elements.get('registration-connection-help').textContent).not.toContain('Connector failed upstream');
        } finally {
            env.cleanup();
        }
    });

    it('round-trips the archived replay Team Pass gate setting', async () => {
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
                adminEmails: [],
                teamPassConfig: {
                    checkoutEnabled: false,
                    recordedReplayPaywallEnabled: true
                }
            },
            updateCalls: []
        };

        const env = await bootEditTeam(initialState);
        try {
            expect(env.elements.get('teamPassRecordedReplayPaywallEnabled').checked).toBe(true);

            env.elements.get('teamPassRecordedReplayPaywallEnabled').checked = false;
            await env.elements.get('team-form').requestSubmit();

            expect(env.state.updateCalls).toHaveLength(1);
            expect(env.state.updateCalls[0].teamData.teamPassConfig).toEqual({
                checkoutEnabled: false,
                recordedReplayPaywallEnabled: false
            });
        } finally {
            env.cleanup();
        }
    });

    it('round-trips expanded standings settings for tournament rules', async () => {
        const initialState = {
            currentUser: { uid: 'owner-1', email: 'owner@example.com' },
            team: {
                id: 'team-1',
                ownerId: 'owner-1',
                name: 'Sharks',
                description: 'Travel team',
                sport: 'Soccer',
                notificationEmail: 'notify@example.com',
                leagueUrl: '',
                standingsConfig: {
                    enabled: true,
                    rankingMode: 'points',
                    points: { win: 3, tie: 1, loss: 0 },
                    maxGoalDiff: 4,
                    twoTeamTiebreakers: ['head_to_head', 'goal_diff', 'name'],
                    multiTeamTiebreakers: ['group_head_to_head', 'goal_diff', 'goals_for', 'name']
                },
                zip: '66209',
                isPublic: true,
                adminEmails: []
            },
            updateCalls: []
        };

        const env = await bootEditTeam(initialState);
        try {
            expect(env.elements.get('standingsPointWin').value).toBe('3');
            expect(env.elements.get('standingsMaxGoalDiff').value).toBe('4');
            expect(env.elements.get('standingsTwoTeamTiebreakers').value).toBe('head_to_head, goal_diff, name');
            expect(env.elements.get('standingsMultiTeamTiebreakers').value).toBe('group_head_to_head, goal_diff, goals_for, name');

            env.elements.get('standingsPointWin').value = '5';
            env.elements.get('standingsPointTie').value = '2';
            env.elements.get('standingsPointLoss').value = '1';
            env.elements.get('standingsMaxGoalDiff').value = '3';
            env.elements.get('standingsTwoTeamTiebreakers').value = 'head_to_head, wins';
            env.elements.get('standingsMultiTeamTiebreakers').value = 'group_head_to_head, goals_for, fewest_goals_allowed';

            await env.elements.get('team-form').requestSubmit();

            expect(env.state.updateCalls).toHaveLength(1);
            expect(env.state.updateCalls[0].teamData.standingsConfig).toEqual({
                enabled: true,
                rankingMode: 'points',
                points: { win: 5, tie: 2, loss: 1 },
                maxGoalDiff: 3,
                tiebreakers: ['head_to_head', 'wins'],
                twoTeamTiebreakers: ['head_to_head', 'wins'],
                multiTeamTiebreakers: ['group_head_to_head', 'goals_for', 'fewest_goals_allowed']
            });
        } finally {
            env.cleanup();
        }
    });
});
