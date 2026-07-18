import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function readEditTeamSource() {
    return readFileSync(new URL('../../edit-team.html', import.meta.url), 'utf8');
}

describe('edit team rollover cache delivery', () => {
    it('loads rollover writes from the current cache-busted db module', () => {
        const source = readEditTeamSource();

        expect(source).toContain("from './js/db.js?v=102';");
        expect(source).not.toContain("from './js/db.js?v=101';");
    });
});

class FakeClassList {
    constructor() {
        this.values = new Set();
    }

    add(...values) {
        values.forEach((value) => this.values.add(value));
    }

    remove(...values) {
        values.forEach((value) => this.values.delete(value));
    }

    toggle(value, force) {
        if (force === true) {
            this.add(value);
            return true;
        }
        if (force === false) {
            this.values.delete(value);
            return false;
        }
        if (this.values.has(value)) {
            this.values.delete(value);
            return false;
        }
        this.values.add(value);
        return true;
    }

    contains(value) {
        return this.values.has(value);
    }
}

class FakeElement {
    constructor(id = '', ownerDocument = null) {
        this.id = id;
        this.ownerDocument = ownerDocument;
        this.value = '';
        this.checked = false;
        this.disabled = false;
        this.textContent = '';
        this.className = '';
        this.classList = new FakeClassList();
        this.listeners = new Map();
        this.files = [];
        this.options = [];
        this.dataset = {};
        this.style = {};
        this.children = [];
        this.href = '';
        this.type = '';
        this.name = '';
    }

    set innerHTML(value) {
        this._innerHTML = String(value || '');
        if (this.ownerDocument) {
            this.ownerDocument.syncFromInnerHTML(this, this._innerHTML);
        }
    }

    get innerHTML() {
        return this._innerHTML || '';
    }

    addEventListener(type, listener) {
        const listeners = this.listeners.get(type) || [];
        listeners.push(listener);
        this.listeners.set(type, listeners);
    }

    dispatchEvent(event) {
        event.target = event.target || this;
        const listeners = this.listeners.get(event.type) || [];
        listeners.forEach((listener) => listener(event));
    }

    appendChild(child) {
        this.children.push(child);
        if (child.id && this.ownerDocument) {
            this.ownerDocument.elements.set(child.id, child);
        }
        if (this.options && child.type === 'option') {
            this.options.push(child);
        }
        return child;
    }

    querySelectorAll(selector) {
        return this.ownerDocument?.querySelectorAll(selector) || [];
    }

    focus() {}
    select() {}
    setAttribute(name, value) {
        this[name] = value;
    }
}

class FakeDocument {
    constructor(html) {
        this.elements = new Map();
        this.rolloverPlayerCheckboxes = [];
        const ids = Array.from(html.matchAll(/id="([^"]+)"/g)).map((match) => match[1]);
        ids.forEach((id) => this.getElementById(id));
        this.createModeInputs = ['manual', 'registration'].map((value) => {
            const input = new FakeElement('', this);
            input.name = 'teamCreateMode';
            input.value = value;
            input.checked = value === 'manual';
            return input;
        });
    }

    getElementById(id) {
        if (!this.elements.has(id)) {
            this.elements.set(id, new FakeElement(id, this));
        }
        return this.elements.get(id);
    }

    createElement(tagName) {
        const element = new FakeElement('', this);
        element.type = tagName.toLowerCase();
        return element;
    }

    querySelector(selector) {
        if (selector === 'input[name="teamCreateMode"]:checked') {
            return this.createModeInputs.find((input) => input.checked) || null;
        }
        if (selector === '.rollover-player-checkbox:checked') {
            return this.rolloverPlayerCheckboxes.find((input) => input.checked) || null;
        }
        return null;
    }

    querySelectorAll(selector) {
        if (selector === 'input[name="teamCreateMode"]') {
            return this.createModeInputs;
        }
        if (selector === '.rollover-player-checkbox') {
            return this.rolloverPlayerCheckboxes;
        }
        if (selector === '.rollover-player-checkbox:checked') {
            return this.rolloverPlayerCheckboxes.filter((input) => input.checked);
        }
        if (selector === '.rollover-staff-email:checked') {
            return [];
        }
        if (selector.startsWith('.')) {
            return [];
        }
        return [];
    }

    syncFromInnerHTML(element, html) {
        if (element.id !== 'roster-rollover-preview') return;
        this.rolloverPlayerCheckboxes = Array.from(html.matchAll(/class="[^"]*rollover-player-checkbox[^"]*" value="([^"]+)" checked/g))
            .map((match) => {
                const input = new FakeElement('', this);
                input.value = match[1];
                input.checked = true;
                return input;
            });
    }
}

function extractMainModule(source) {
    const match = source.match(/<script type="module">([\s\S]*?)<\/script>\s*<\/body>/);
    if (!match) throw new Error('Could not find edit-team module script');
    return match[1]
        .split('\n')
        .filter((line) => !line.trim().startsWith('import '))
        .join('\n');
}

async function loadEditTeamHarness({ copyRejects = false } = {}) {
    const html = readEditTeamSource();
    const document = new FakeDocument(html);
    const alerts = [];
    const createTeam = vi.fn(async () => 'new-team-123');
    const addConfig = vi.fn(async () => 'config-1');
    const copySelectedPlayersForTeamRollover = vi.fn(async () => {
        if (copyRejects) {
            throw new Error('copy exploded');
        }
        return { copiedCount: 1 };
    });
    const getPlayers = vi.fn(async () => [
        { id: 'player-keep', name: 'Keep Player', number: '7', active: true, parents: [{ email: 'family@example.com' }] },
        { id: 'player-skip', name: 'Skip Player', number: '8', active: true, parents: [] }
    ]);
    const getUserTeamsWithAccess = vi.fn(async () => [
        { id: 'source-team-1', name: 'Old Team', adminEmails: ['coach@example.com'] }
    ]);
    const location = { href: '' };
    const context = {
        document,
        window: {
            location,
            allplaysRegistrationSources: [],
            prompt: vi.fn()
        },
        navigator: { clipboard: { writeText: vi.fn() } },
        URLSearchParams,
        Date,
        Event: class {
            constructor(type) {
                this.type = type;
            }
        },
        FileReader: class {},
        console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
        alert: (message) => alerts.push(message),
        setTimeout: vi.fn(),
        createTeam,
        updateTeam: vi.fn(),
        getTeam: vi.fn(),
        getUserProfile: vi.fn(async () => ({ email: 'coach@example.com' })),
        getUserTeamsWithAccess,
        getPlayers,
        copySelectedPlayersForTeamRollover,
        uploadTeamPhoto: vi.fn(),
        addConfig,
        getUnreadChatCount: vi.fn(),
        inviteAdmin: vi.fn(),
        addTeamAdminEmail: vi.fn(),
        getAllUsers: vi.fn(async () => []),
        getRegistrationSources: vi.fn(async () => []),
        getDefaultStatConfigForSport: vi.fn(() => ({ name: 'Basketball defaults' })),
        renderHeader: vi.fn(),
        renderFooter: vi.fn(),
        getUrlParams: vi.fn(() => ({})),
        escapeHtml: (value) => String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;'),
        checkAuth: vi.fn((callback) => {
            context.authPromise = callback({ uid: 'coach-1', email: 'coach@example.com' });
        }),
        sendInviteEmail: vi.fn(),
        renderTeamAdminBanner: vi.fn(),
        normalizeYouTubeEmbedUrl: vi.fn(() => null),
        hasFullTeamAccess: vi.fn(() => true),
        normalizeAdminEmailList: vi.fn((emails = []) => Array.from(new Set(emails.filter(Boolean)))),
        normalizeStreamVolunteerEmailList: vi.fn((emails = []) => Array.from(new Set(emails.filter(Boolean)))),
        normalizeTeamPermissions: vi.fn((permissions = {}) => permissions),
        processPendingAdminInvites: vi.fn(async () => ({ fallbackCodeCount: 0, failedCount: 0 })),
        buildAdminInviteFollowUp: vi.fn(() => ({ shareableCount: 0, unresolvedCount: 0 })),
        inviteExistingTeamAdmin: vi.fn(),
        buildRolloverAccessPreview: vi.fn(() => ({ staffAdmins: [] })),
        buildStaffAdminRolloverUpdate: vi.fn(),
        buildRosterRolloverPreviewRows: vi.fn((players = []) => players
            .filter((player) => player.active !== false)
            .map((player) => ({
                id: player.id,
                name: player.name,
                number: player.number,
                familyCount: Array.isArray(player.parents) ? player.parents.length : 0,
                contactCount: Array.isArray(player.parents) ? player.parents.filter((parent) => parent.email && parent.email.includes('@')).length : 0
            })))
    };

    vm.createContext(context);
    vm.runInContext(extractMainModule(html), context);
    await context.authPromise;

    document.getElementById('name').value = 'New Team';
    document.getElementById('sport').value = 'Basketball';
    document.getElementById('teamColorPrimary').value = '#5ec9c5';
    document.getElementById('teamColorSecondary').value = '#d32f3a';
    document.getElementById('standingsPointWin').value = '3';
    document.getElementById('standingsPointTie').value = '1';
    document.getElementById('standingsPointLoss').value = '0';
    document.getElementById('streamAccessMode').value = 'admins';
    document.getElementById('isPublic').checked = true;

    return { document, alerts, location, createTeam, addConfig, copySelectedPlayersForTeamRollover, getPlayers, getUserTeamsWithAccess };
}

async function submitRolloverCreateFlow(options) {
    const harness = await loadEditTeamHarness(options);
    const { document } = harness;

    document.getElementById('rosterRolloverEnabled').checked = true;
    await document.getElementById('rosterRolloverEnabled').listeners.get('change')[0]({
        target: document.getElementById('rosterRolloverEnabled')
    });
    document.getElementById('rosterRolloverSourceTeam').value = 'source-team-1';
    await document.getElementById('rosterRolloverSourceTeam').listeners.get('change')[0]({
        target: document.getElementById('rosterRolloverSourceTeam')
    });
    document.rolloverPlayerCheckboxes.find((input) => input.value === 'player-skip').checked = false;

    await document.getElementById('team-form').listeners.get('submit')[0]({
        preventDefault: vi.fn()
    });

    return harness;
}

describe('edit team roster rollover wiring', () => {
    it('loads a selectable player preview and copies only selected players after team creation', async () => {
        const harness = await submitRolloverCreateFlow();

        expect(harness.getUserTeamsWithAccess).toHaveBeenCalledWith('coach-1', 'coach@example.com');
        expect(harness.getPlayers).toHaveBeenCalledWith('source-team-1');
        expect(harness.createTeam).toHaveBeenCalledWith(expect.objectContaining({
            name: 'New Team',
            sport: 'Basketball',
            ownerId: 'coach-1'
        }));
        expect(harness.addConfig).toHaveBeenCalledWith('new-team-123', { name: 'Basketball defaults' });
        expect(harness.copySelectedPlayersForTeamRollover).toHaveBeenCalledWith(
            'source-team-1',
            'new-team-123',
            ['player-keep']
        );
        expect(harness.location.href).toBe('edit-team.html?teamId=new-team-123&created=1');
    });

    it('reports rollover failures and redirects with failure context after team creation', async () => {
        const harness = await submitRolloverCreateFlow({ copyRejects: true });

        expect(harness.createTeam).toHaveBeenCalled();
        expect(harness.copySelectedPlayersForTeamRollover).toHaveBeenCalledWith(
            'source-team-1',
            'new-team-123',
            ['player-keep']
        );
        expect(harness.alerts[0]).toContain('Team created, but roster rollover failed. No selected players were copied.');
        expect(harness.alerts[0]).toContain('copy exploded');
        expect(harness.location.href).toBe('edit-team.html?teamId=new-team-123&created=1&rosterRolloverFailed=1');
    });
});
