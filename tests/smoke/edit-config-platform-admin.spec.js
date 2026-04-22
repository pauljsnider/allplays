import { test, expect } from '@playwright/test';

const DB_STUB = `
const configs = [
    {
        id: 'cfg-1',
        name: 'Existing Config',
        baseType: 'Basketball',
        columns: ['PTS', 'REB', 'AST'],
        statDefinitions: [
            { id: 'pts', label: 'PTS', type: 'base' },
            { id: 'reb', label: 'REB', type: 'base' },
            { id: 'ast', label: 'AST', type: 'base' }
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

export async function getUserTeams() {
    return [
        { id: 'team-a', name: 'Team A', ownerId: 'platform-admin-1' },
        { id: 'team-b', name: 'Team B', ownerId: 'platform-admin-1' }
    ];
}

export async function getConfigs(teamId) {
    if (teamId === 'team-b') {
        return [{
            id: 'cfg-b-1',
            name: 'Imported Config',
            baseType: 'Soccer',
            columns: ['GOALS', 'ASSISTS'],
            statDefinitions: [
                { id: 'goals', label: 'GOALS', type: 'base' },
                { id: 'assists', label: 'ASSISTS', type: 'base' }
            ]
        }];
    }

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

export async function updateConfig(teamId, configId, config) {
    const index = configs.findIndex((entry) => entry.id === configId);
    if (index >= 0) {
        configs[index] = { ...configs[index], ...config };
    }
}

export async function deleteConfig(teamId, configId) {
    const index = configs.findIndex((config) => config.id === configId);
    if (index >= 0) {
        configs.splice(index, 1);
    }
}

export async function resetTeamStatConfigs() {
    configs.splice(0, configs.length);
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
            const [head, ...segments] = line.split('|');
            const [label, statId = ''] = head.split('=');
            const definition = {
                id: statId.trim(),
                label: label.trim(),
                acronym: label.trim(),
                type: head.includes('formula=') ? 'derived' : 'base'
            };
            segments.forEach((segment) => {
                const [key, value = ''] = segment.split('=');
                if (key === 'formula') {
                    definition.formula = value.trim();
                    definition.type = 'derived';
                }
                if (key === 'topStat') {
                    definition.topStat = value.trim() === 'true';
                }
            });
            return definition;
        });
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

async function mockDependencies(page) {
    await page.route('https://www.googletagmanager.com/**', (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: ''
    }));
    await page.route('**/js/db.js?v=16', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: DB_STUB }));
    await page.route('**/js/utils.js?v=8', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: UTILS_STUB }));
    await page.route('**/js/auth.js?v=10', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: AUTH_STUB }));
    await page.route('**/js/edit-config-access.js?v=1', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: EDIT_CONFIG_ACCESS_STUB }));
    await page.route('**/js/team-admin-banner.js', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: TEAM_ADMIN_BANNER_STUB }));
    await page.route('**/js/stat-leaderboards.js?v=1', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: STAT_LEADERBOARDS_STUB }));
    await page.route('**/js/stat-config-presets.js?v=1', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: STAT_CONFIG_PRESETS_STUB }));
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
    await expect(page.locator('#preset-select')).toBeVisible();
    await expect(page.locator('#import-config-select')).toContainText('Imported Config');

    await page.fill('#configName', 'Platform Admin Test');
    await page.fill('#columns', 'PTS, STL');
    await page.click('#add-config-form button[type="submit"]');

    await expect(page.locator('#config-list')).toContainText('Platform Admin Test');
    await expect(page.locator('#config-list')).toContainText('STL');

    const newConfigRow = page.locator('#config-list > div').filter({ hasText: 'Platform Admin Test' });
    await newConfigRow.locator('.edit-btn').click();
    await page.fill('#configName', 'Platform Admin Test Updated');
    await page.click('#save-config-btn');

    await expect(page.locator('#config-list')).toContainText('Platform Admin Test Updated');

    await page.selectOption('#import-config-select', 'team-b::cfg-b-1');
    await page.click('#load-import-config-btn');
    await expect(page.locator('#configName')).toHaveValue('Imported Config');

    await page.locator('#config-list > div').filter({ hasText: 'Platform Admin Test Updated' }).locator('.delete-btn').click();

    await expect(page.locator('#config-list')).not.toContainText('Platform Admin Test Updated');
    await page.click('#reset-configs-btn');
    await expect(page.locator('#config-list')).toContainText('No configurations found');
    await expect(page).toHaveURL(/edit-config\.html#teamId=team-a$/);
    expect(dialogs).toEqual([
        'Are you sure you want to delete this config?',
        'Reset Stats Setup? This deletes all team stat schemas that are not assigned to games and returns you to the initial setup state.'
    ]);
});
