import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

test.skip(process.env.SMOKE_SUITE === 'production', 'Isolated scorer harness requires Vite; no production route is enabled.');
const baseSnapshot = JSON.parse(readFileSync(new URL('./fixtures/diamond-scorer-snapshot.json', import.meta.url), 'utf8'));

// Mount the actual, currently unrouted component with a synthetic server boundary.
// This deliberately does not add an activation route or touch production data.
async function mountScorer(page, role, action) {
    const snapshot = structuredClone(baseSnapshot);
    snapshot.rulesProfileId = role === 'dh' ? 'baseball-nfhs@1' : 'fastpitch-nfhs@1';
    snapshot.bases = { first: null, second: null, third: null };
    snapshot.lineups.home[0].battingRole = role === 'dh' ? 'dh' : 'dp';
    const defender = { playerId: 'defender-sub', name: 'Defender Substitute' };
    snapshot.defense.home = { P: action === 'restore-flex' ? snapshot.lineups.home[0] : defender };
    const history = { ...defender, slot: 1, starterPlayerId: 'defender-starter', starterReentriesUsed: 0 };
    snapshot.lineupPersonnel = {
        home: {
            dhDefense: role === 'dh' ? history : null,
            flexDefense: role === 'flex' ? history : null,
            dpFlex: role === 'flex' ? { dpPlayerId: 'batter-1', flexPlayerId: 'defender-sub', dpBattingSlot: 1, flexDefensivePosition: 'P' } : null
        },
        away: { dhDefense: null, flexDefense: null, dpFlex: null }
    };
    await page.addInitScript((fixture) => {
        window.__diamondFixture = fixture;
        window.__diamondCommands = [];
        window.__ALLPLAYS_CONFIG__ = {
            firebase: { apiKey: 'demo-api-key', authDomain: 'demo-allplays.firebaseapp.com', projectId: 'demo-allplays', messagingSenderId: '1234567890', appId: '1:1234567890:web:allplayssmoke' },
            appCheck: { enabled: false },
            diamondScorebookUiEnabled: false
        };
    }, snapshot);
    await page.route('**/src/main.tsx*', async (route) => {
        const source = await (await route.fetch()).text();
        const dependencyUrl = (name) => {
            const url = source.match(new RegExp('"([^"\\n]*' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\?[^"\\n]+)"'))?.[1];
            if (!url) throw new Error(`Vite dependency URL missing: ${name}`);
            return JSON.stringify(url);
        };
        return route.fulfill({
        contentType: 'application/javascript',
        body: `
            import React from ${dependencyUrl('react.js')};
            import ReactDOM from ${dependencyUrl('react-dom_client.js')};
            import { MemoryRouter } from ${dependencyUrl('react-router-dom.js')};
            import '/src/styles/index.css';
            import { DiamondScorebook } from '/src/pages/DiamondScorebook.tsx';
            let snapshot = window.__diamondFixture;
            const client = {
                load: async () => snapshot,
                resolveAppBuild: async () => 20260905,
                readQueue: () => [],
                reconcileQueue: async () => ({ accepted: 0, duplicates: 0, remaining: [], lastSnapshot: null }),
                createCommand: (input) => ({ schemaVersion: 2, commandId: crypto.randomUUID(), ...input }),
                submitCommand: async (command) => {
                    window.__diamondCommands.push(command);
                    snapshot = { ...snapshot, revision: command.expectedRevision + 1 };
                    return { outcome: 'accepted', revision: snapshot.revision, eventId: 'event-8', snapshot, completeness: snapshot.completeness };
                }
            };
            const auth = { user: { uid: 'coach-1', displayName: 'Coach Carter', roles: ['coach'] }, profile: null, loading: false, error: null, roles: ['coach'], isParent: false, isCoach: true, isAdmin: false, isPlatformAdmin: false, refresh() {}, signOut() {} };
            ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(MemoryRouter, {}, React.createElement(DiamondScorebook, { auth, teamId: 'team-1', gameId: 'game-1', initialSnapshot: snapshot, client })));
        `
        });
    });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(process.env.SMOKE_APP_BASE_URL || 'http://localhost:5198/');
    await expect(async () => {
        expect(errors).toEqual([]);
        await expect(page.getByText('Full-mode advanced plays')).toBeVisible({ timeout: 3000 });
    }).toPass({ timeout: 45000 });
    await page.getByText('Full-mode advanced plays').click();
    return errors;
}

for (const role of ['dh', 'flex']) {
    test(`independent ${role} defender selection and starter re-entry`, async ({ page }) => {
        const errors = await mountScorer(page, role);
        const group = page.getByRole('group', { name: 'Substitution', exact: true });
        await group.getByLabel('Batting slot').selectOption(`${role}:1`);
        await group.getByRole('combobox', { name: 'Incoming', exact: true }).selectOption('bench-home');
        await group.getByRole('button', { name: 'Review substitution', exact: true }).click();
        const review = page.getByRole('dialog', { name: 'Review substitution', exact: true });
        await expect(review).toContainText('defender-sub');
        await review.getByRole('button', { name: 'Cancel', exact: true }).click();
        await group.getByRole('button', { name: 'Review starter re-entry', exact: true }).click();
        await page.getByRole('dialog', { name: 'Review starter re-entry', exact: true }).getByRole('button', { name: 'Confirm action' }).click();
        await expect.poll(() => page.evaluate(() => window.__diamondCommands.length)).toBe(1);
        expect(errors).toEqual([]);
        expect(await page.evaluate(() => window.__diamondCommands[0].payload)).toEqual({ side: 'home', battingSlot: 1, starterPlayerId: 'defender-starter', replacedPlayerId: 'defender-sub', defensivePosition: 'P' });
    });
}

test('active DP may take FLEX defense without replacing its batting entry', async ({ page }) => {
    const errors = await mountScorer(page, 'flex');
    const group = page.getByRole('group', { name: 'Substitution', exact: true });
    await group.getByLabel('Batting slot').selectOption('flex:1');
    await group.getByRole('combobox', { name: 'Incoming', exact: true }).selectOption('batter-1');
    await group.getByRole('button', { name: 'Review substitution', exact: true }).click();
    await page.getByRole('dialog', { name: 'Review substitution', exact: true }).getByRole('button', { name: 'Confirm action' }).click();
    await expect.poll(() => page.evaluate(() => window.__diamondCommands.length)).toBe(1);
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => window.__diamondCommands[0].payload)).toEqual({ side: 'home', battingSlot: 1, outgoingPlayerId: 'defender-sub', incomingPlayerId: 'batter-1', defensivePosition: 'P' });
});
