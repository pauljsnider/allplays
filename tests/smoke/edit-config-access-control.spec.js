import { test, expect } from '@playwright/test';

const UTILS_STUB = `
export function renderHeader() {}
export function renderFooter() {}
export function getUrlParams() {
    return { teamId: 'team-a' };
}
`;

const TEAM_ADMIN_BANNER_STUB = `
export function renderTeamAdminBanner(container, { team, active = 'stats', unreadCount = 0 } = {}) {
    container.innerHTML = '<div data-testid="team-admin-banner">' + (team?.name || 'Unknown Team') + '|' + active + '|' + unreadCount + '</div>';
}
`;

const STAT_LEADERBOARDS_STUB = `
export function parseAdvancedStatDefinitions(input) {
    if (!input || !String(input).trim()) return [];
    return String(input)
        .split('\\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
            const [head] = line.split('|');
            const [label, statId = ''] = head.split('=');
            return {
                id: statId.trim(),
                label: label.trim(),
                acronym: label.trim(),
                type: 'base'
            };
        });
}

export function validateStatDefinitionsForPublicLeaderboards() {
    return { valid: true, errors: [] };
}
`;

const STAT_CONFIG_PRESETS_STUB = `
const presets = {
    blank: { name: 'Custom Stat Schema', baseType: 'Custom', columns: [], statDefinitions: [] },
    basketball: { name: 'Basketball Standard', baseType: 'Basketball', columns: ['PTS', 'REB', 'AST'], statDefinitions: [{ id: 'pts', label: 'PTS', topStat: true }] },
    soccer: { name: 'Soccer Standard', baseType: 'Soccer', columns: ['GOALS', 'SHOTS'], statDefinitions: [{ id: 'goals', label: 'GOALS', topStat: true }] }
};

export function getStatConfigPresetOptions() {
    return [
        { id: 'blank', label: 'Blank Slate', description: 'Start empty' },
        { id: 'basketball', label: 'Basketball Standard', description: 'Hoops' },
        { id: 'soccer', label: 'Soccer Standard', description: 'Soccer' }
    ];
}

export function getStatConfigPresetById(id) {
    return JSON.parse(JSON.stringify(presets[id] || presets.blank));
}

export function serializeAdvancedStatDefinitions(config) {
    return (config?.statDefinitions || [])
        .filter((definition) => definition?.formula || definition?.topStat)
        .map((definition) => {
            let line = definition.label + '=' + definition.id;
            if (definition.formula) line += '|formula=' + definition.formula;
            if (definition.topStat) line += '|topStat=true';
            return line;
        })
        .join('\\n');
}
`;

function buildAuthStub(user) {
    return `
export function checkAuth(callback) {
    callback(${JSON.stringify(user)});
}
`;
}

function buildDbStub(team) {
    return `
const configs = [{
    id: 'cfg-1',
    name: 'Existing Config',
    baseType: 'Basketball',
    columns: ['PTS', 'REB', 'AST'],
    statDefinitions: [
        { id: 'pts', label: 'PTS', type: 'base' },
        { id: 'reb', label: 'REB', type: 'base' },
        { id: 'ast', label: 'AST', type: 'base' }
    ]
}];

export async function getTeam(teamId) {
    return ${JSON.stringify(team)};
}

export async function getUserTeams() {
    return [];
}

export async function getConfigs() {
    return configs.map((config) => ({
        ...config,
        columns: [...config.columns],
        statDefinitions: config.statDefinitions.map((definition) => ({ ...definition }))
    }));
}

export async function createConfig() {
    throw new Error('not implemented in test');
}

export async function updateConfig() {
    throw new Error('not implemented in test');
}

export async function deleteConfig() {
    throw new Error('not implemented in test');
}

export async function resetTeamStatConfigs() {
    throw new Error('not implemented in test');
}

export async function getUnreadChatCount() {
    return 0;
}
`;
}

async function mockDependencies(page, { user, team }) {
    await page.route('https://www.googletagmanager.com/**', (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: ''
    }));
    await page.route('**/dashboard.html', (route) => route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><html><body><h1>Dashboard</h1></body></html>'
    }));
    await page.route('**/index.html', (route) => route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><html><body><h1>Home</h1></body></html>'
    }));
    await page.route(/\/js\/db\.js(?:\?v=\d+)?$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: buildDbStub(team) }));
    await page.route('**/js/utils.js?v=15', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: UTILS_STUB }));
    await page.route('**/js/auth.js?v=*', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: buildAuthStub(user) }));
    await page.route(/\/js\/team-admin-banner\.js(?:\?v=\d+)?$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: TEAM_ADMIN_BANNER_STUB }));
    await page.route('**/js/stat-leaderboards.js?v=2', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: STAT_LEADERBOARDS_STUB }));
    await page.route('**/js/stat-config-presets.js?v=2', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: STAT_CONFIG_PRESETS_STUB }));
}

test('team coach with case-different auth email can open stat config editor with real access checks', async ({ page, baseURL }) => {
    await mockDependencies(page, {
        user: {
            uid: 'coach-1',
            email: 'Coach@Example.com',
            displayName: 'Coach Casey'
        },
        team: {
            id: 'team-a',
            name: 'Team A',
            ownerId: 'owner-1',
            adminEmails: ['coach@example.com']
        }
    });

    await page.goto(`${baseURL}/edit-config.html#teamId=team-a`, { waitUntil: 'domcontentloaded' });

    await expect(page).toHaveURL(/edit-config\.html#teamId=team-a$/);
    await expect(page.locator('#team-name-display')).toHaveText('Team A');
    await expect(page.locator('#config-list')).toContainText('Existing Config');
    await expect(page.locator('#add-config-form')).toBeVisible();
});

test('platform admin outside owner and adminEmails can open stat config editor with real access checks', async ({ page, baseURL }) => {
    await mockDependencies(page, {
        user: {
            uid: 'platform-admin-1',
            email: 'admin@example.com',
            isAdmin: true,
            displayName: 'Platform Admin'
        },
        team: {
            id: 'team-a',
            name: 'Team A',
            ownerId: 'owner-1',
            adminEmails: ['coach@example.com']
        }
    });

    await page.goto(`${baseURL}/edit-config.html#teamId=team-a`, { waitUntil: 'domcontentloaded' });

    await expect(page).toHaveURL(/edit-config\.html#teamId=team-a$/);
    await expect(page.locator('#team-name-display')).toHaveText('Team A');
    await expect(page.locator('#config-list')).toContainText('Existing Config');
    await expect(page.locator('#add-config-form')).toBeVisible();
});

test('legacy-normalized coach is denied and redirected by real stat config access checks', async ({ page, baseURL }) => {
    await mockDependencies(page, {
        user: {
            uid: 'coach-1',
            email: 'coach@example.com',
            displayName: 'Coach Casey'
        },
        team: {
            id: 'team-a',
            name: 'Team A',
            ownerId: 'owner-1',
            adminEmails: [' Coach@Example.com ']
        }
    });

    const dialogs = [];
    page.on('dialog', async (dialog) => {
        dialogs.push(dialog.message());
        await dialog.accept();
    });

    await page.goto(`${baseURL}/edit-config.html#teamId=team-a`, { waitUntil: 'domcontentloaded' });

    await expect(page).toHaveURL(/dashboard\.html$/);
    await expect(page.locator('h1')).toHaveText('Dashboard');
    expect(dialogs).toEqual(['Team not found or access denied.']);
});

test('non-owner non-admin user absent from adminEmails is denied by real stat config access checks', async ({ page, baseURL }) => {
    await mockDependencies(page, {
        user: {
            uid: 'viewer-1',
            email: 'viewer@example.com',
            displayName: 'Viewer Val'
        },
        team: {
            id: 'team-a',
            name: 'Team A',
            ownerId: 'owner-1',
            adminEmails: ['coach@example.com']
        }
    });

    const dialogs = [];
    page.on('dialog', async (dialog) => {
        dialogs.push(dialog.message());
        await dialog.accept();
    });

    await page.goto(`${baseURL}/edit-config.html#teamId=team-a`, { waitUntil: 'domcontentloaded' });

    await expect(page).toHaveURL(/index\.html$/);
    await expect(page.locator('h1')).toHaveText('Home');
    expect(dialogs).toEqual(['Team not found or access denied.']);
});
