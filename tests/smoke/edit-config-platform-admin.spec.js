import { test, expect } from '@playwright/test';

const DB_STUB = `
const configs = [
    {
        id: 'cfg-1',
        name: 'Existing Config',
        baseType: 'Basketball',
        columns: ['PTS', 'REB', 'AST'],
        statDefinitions: [
            { label: 'PTS', type: 'raw' },
            { label: 'REB', type: 'raw' },
            { label: 'AST', type: 'raw' }
        ]
    }
];

export async function getTeam(teamId) {
    return {
        id: teamId,
        name: 'Team A',
        ownerId: 'owner-1',
        adminEmails: ['coach@example.com']
    };
}

export async function getConfigs() {
    return configs.map((config) => ({
        ...config,
        columns: [...config.columns],
        statDefinitions: Array.isArray(config.statDefinitions)
            ? config.statDefinitions.map((definition) => ({ ...definition }))
            : []
    }));
}

export async function createConfig(teamId, config) {
    const newConfig = {
        id: 'cfg-' + (configs.length + 1),
        ...config
    };
    configs.push(newConfig);
    return newConfig;
}

export async function deleteConfig(teamId, configId) {
    const index = configs.findIndex((config) => config.id === configId);
    if (index >= 0) {
        configs.splice(index, 1);
    }
}

export async function getUnreadChatCount() {
    return 2;
}
`;

const UTILS_STUB = `
export function renderHeader() {}
export function renderFooter() {}
export function getUrlParams() {
    return { teamId: 'team-a' };
}
`;

const AUTH_STUB = `
export function checkAuth(callback) {
    callback({
        uid: 'platform-admin-1',
        email: 'admin@example.com',
        isAdmin: true,
        displayName: 'Platform Admin'
    });
}
`;

const TEAM_ADMIN_BANNER_STUB = `
export function renderTeamAdminBanner(container, { team, active, unreadCount }) {
    container.innerHTML = '<div data-testid="team-admin-banner">' + team.name + '|' + active + '|' + unreadCount + '</div>';
}
`;

const EDIT_CONFIG_ACCESS_STUB = `
export function getEditConfigAccessDecision(user, team, teamId) {
    return {
        allowed: true,
        exitUrl: 'dashboard.html',
        team: {
            ...(team || {}),
            id: team?.id || teamId
        }
    };
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
            const [label, rest = ''] = line.split('=');
            const statIdPart = rest.split('|')[0] || '';
            return {
                label: label.trim(),
                statId: statIdPart.trim(),
                type: 'derived'
            };
        });
}
`;

async function mockDependencies(page) {
    await page.route('https://www.googletagmanager.com/**', (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: ''
    }));
    await page.route('**/js/db.js?v=15', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: DB_STUB }));
    await page.route('**/js/utils.js?v=8', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: UTILS_STUB }));
    await page.route('**/js/auth.js?v=10', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: AUTH_STUB }));
    await page.route('**/js/edit-config-access.js?v=1', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: EDIT_CONFIG_ACCESS_STUB }));
    await page.route('**/js/team-admin-banner.js', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: TEAM_ADMIN_BANNER_STUB }));
    await page.route('**/js/stat-leaderboards.js?v=1', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: STAT_LEADERBOARDS_STUB }));
}

test('platform admin can manage stats configs from the edit-config workflow', async ({ page, baseURL }) => {
    await mockDependencies(page);

    const dialogs = [];
    page.on('dialog', async (dialog) => {
        dialogs.push(dialog.message());
        await dialog.accept();
    });

    await page.goto(`${baseURL}/edit-config.html#teamId=team-a`, { waitUntil: 'domcontentloaded' });

    await expect(page).toHaveURL(/edit-config\.html#teamId=team-a$/);
    await expect(page.locator('[data-testid="team-admin-banner"]')).toHaveText('Team A|stats|2');
    await expect(page.locator('#team-name-display')).toHaveText('Team A');
    await expect(page.locator('#config-list')).toContainText('Existing Config');

    await page.fill('#configName', 'Platform Admin Test');
    await page.fill('#columns', 'PTS, STL');
    await page.click('#add-config-form button[type="submit"]');

    await expect(page.locator('#config-list')).toContainText('Platform Admin Test');
    await expect(page.locator('#config-list')).toContainText('STL');

    const newConfigRow = page.locator('#config-list > div').filter({ hasText: 'Platform Admin Test' });
    await newConfigRow.locator('.delete-btn').click();

    await expect(page.locator('#config-list')).not.toContainText('Platform Admin Test');
    await expect(page).toHaveURL(/edit-config\.html#teamId=team-a$/);
    expect(dialogs).toEqual(['Are you sure you want to delete this config?']);
});
