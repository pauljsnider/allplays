// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function readFamilyPage() {
    return readFileSync(path.join(repoRoot, 'family.html'), 'utf8');
}

function extractFamilyModuleScript(source) {
    const matches = [...source.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)];
    const moduleScript = matches.at(-1)?.[1];
    if (!moduleScript) throw new Error('Could not find family module script');
    return moduleScript.replace(/^\s*import[\s\S]*?;\s*$/gm, '');
}

function familyProjection(overrides = {}) {
    return {
        projectionVersion: 2,
        presentation: { label: 'Grandma Share', expiresAt: '2099-01-01T00:00:00.000Z' },
        children: [{
            teamId: 'team-1',
            playerId: 'player-1',
            teamName: 'Rockets',
            playerName: 'Ava'
        }],
        teams: [{
            teamId: 'team-1',
            teamName: 'Rockets',
            games: []
        }],
        externalEvents: [],
        calendarWarnings: [],
        ...overrides
    };
}

async function flushAsyncWork() {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
}

function createHarness({ projectionResults = [familyProjection()] } = {}) {
    const familyPage = readFamilyPage();
    const moduleScript = extractFamilyModuleScript(familyPage);
    const dom = new JSDOM(familyPage, {
        url: 'https://example.test/family.html?token=share-token',
        runScripts: 'outside-only'
    });
    const results = [...projectionResults];
    const getFamilyShareView = vi.fn(async () => {
        const result = results.length > 1 ? results.shift() : results[0];
        if (result instanceof Error || result?.__throw === true) throw result.error || result;
        return result;
    });
    const mocks = {
        getFamilyShareView,
        resolveScheduleWatchCta: vi.fn().mockReturnValue(null),
        renderHeader: vi.fn(),
        renderFooter: vi.fn(),
        escapeHtml: (value = '') => String(value)
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#39;'),
        expandRecurrence: vi.fn().mockReturnValue([]),
        alert: vi.fn(),
        console: {
            error: vi.fn(),
            warn: vi.fn(),
            log: vi.fn()
        }
    };
    const context = vm.createContext({
        ...mocks,
        window: dom.window,
        document: dom.window.document,
        navigator: dom.window.navigator,
        location: dom.window.location,
        URL: dom.window.URL,
        URLSearchParams: dom.window.URLSearchParams,
        Blob: dom.window.Blob,
        setTimeout,
        clearTimeout,
        Date,
        Promise,
        Map,
        Set,
        Array,
        Object,
        String,
        Number,
        Boolean,
        Math,
        JSON,
        globalThis: {}
    });

    vm.runInContext(moduleScript, context);
    return { dom, document: dom.window.document, mocks };
}

describe('family share projection-only initialization', () => {
    it('renders an authoritative expired-link rejection without any fallback data load', async () => {
        const expired = {
            __throw: true,
            error: { code: 'functions/permission-denied', details: { reason: 'expired' } }
        };
        const harness = createHarness({ projectionResults: [expired] });

        await flushAsyncWork();

        expect(harness.mocks.getFamilyShareView).toHaveBeenCalledWith('share-token');
        expect(harness.document.getElementById('page-error-title').textContent).toBe('This link has expired');
        expect(harness.document.getElementById('page-error-detail').textContent)
            .toBe('Ask the parent to create a new family share link. Expired links never load player, team, or schedule details.');
        expect(harness.document.getElementById('page-error-retry').classList.contains('hidden')).toBe(true);
        expect(harness.document.getElementById('page-main').classList.contains('hidden')).toBe(true);
        expect(harness.mocks.renderHeader).not.toHaveBeenCalled();
    });

    it('renders players and stored games exclusively from the versioned projection', async () => {
        const harness = createHarness({
            projectionResults: [familyProjection({
                teams: [{
                    teamId: 'team-1',
                    teamName: 'Rockets',
                    games: [{
                        id: 'saved-game',
                        date: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
                        opponent: 'Comets',
                        location: 'Court 1',
                        status: 'scheduled'
                    }]
                }]
            })]
        });

        await flushAsyncWork();
        await flushAsyncWork();

        expect(harness.mocks.renderHeader).toHaveBeenCalled();
        expect(harness.document.getElementById('page-error').classList.contains('hidden')).toBe(true);
        expect(harness.document.getElementById('page-main').classList.contains('hidden')).toBe(false);
        expect(harness.document.getElementById('page-title').textContent).toBe('Grandma Share');
        expect(harness.document.getElementById('players-list').textContent).toContain('Ava');
        expect(harness.document.getElementById('schedule-list').textContent).toContain('Comets');
        expect(harness.document.title).toBe('Grandma Share - ALL PLAYS');
    });

    it('preserves projected events and surfaces server-provided calendar warnings', async () => {
        const harness = createHarness({
            projectionResults: [familyProjection({
                teams: [{
                    teamId: 'team-1',
                    teamName: 'Rockets',
                    games: [{
                        id: 'saved-game',
                        date: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
                        opponent: 'Comets',
                        location: 'Court 1',
                        status: 'scheduled'
                    }]
                }],
                calendarWarnings: ['Team calendar could not be loaded.']
            })]
        });

        await flushAsyncWork();
        await flushAsyncWork();

        expect(harness.document.getElementById('schedule-list').textContent).toContain('Comets');
        const warning = harness.document.getElementById('external-calendar-status');
        expect(warning.classList.contains('hidden')).toBe(false);
        expect(warning.textContent).toContain('Events saved in ALL PLAYS are still shown.');
        expect(warning.textContent).toContain('Retry this page to load the complete schedule.');
    });

    it('fails retryably on an unavailable projection and recovers through the same callable', async () => {
        const unavailable = { __throw: true, error: new Error('projection unavailable') };
        const harness = createHarness({ projectionResults: [unavailable, familyProjection()] });

        await flushAsyncWork();
        expect(harness.document.getElementById('page-error-title').textContent)
            .toBe('Family page temporarily unavailable');
        const retryButton = harness.document.getElementById('page-error-retry');
        expect(retryButton.classList.contains('hidden')).toBe(false);

        retryButton.click();
        await flushAsyncWork();
        await flushAsyncWork();

        expect(harness.mocks.getFamilyShareView).toHaveBeenCalledTimes(2);
        expect(harness.document.getElementById('page-main').classList.contains('hidden')).toBe(false);
        expect(harness.document.getElementById('page-title').textContent).toBe('Grandma Share');
    });

    it('rejects an unversioned or incomplete projection retryably', async () => {
        const harness = createHarness({
            projectionResults: [{ projectionVersion: 1, children: [], teams: [] }]
        });

        await flushAsyncWork();

        expect(harness.document.getElementById('page-error-title').textContent)
            .toBe('Family page temporarily unavailable');
        expect(harness.document.getElementById('page-error-retry').classList.contains('hidden')).toBe(false);
        expect(harness.mocks.renderHeader).not.toHaveBeenCalled();
    });

    it.each([
        ['team games are not an array', familyProjection({
            children: [],
            teams: [{ teamId: 'team-1', teamName: 'Rockets', games: null }]
        })],
        ['a stored game has an invalid date', familyProjection({
            teams: [{
                teamId: 'team-1',
                teamName: 'Rockets',
                games: [{ id: 'bad-game', date: 'not-a-date' }]
            }]
        })],
        ['the only external event has an invalid date', familyProjection({
            externalEvents: [{ id: 'bad-event', type: 'practice', date: 'not-a-date' }]
        })],
        ['an external event has an invalid type', familyProjection({
            externalEvents: [{ id: 'bad-event', type: 'meeting', date: '2099-01-02T18:00:00.000Z' }]
        })],
        ['a child entry is malformed', familyProjection({ children: [null] })],
        ['a child link is duplicated', familyProjection({
            children: [
                { teamId: 'team-1', playerId: 'player-1', playerName: 'Ava' },
                { teamId: 'team-1', childId: 'player-1', childName: 'Ava duplicate' }
            ]
        })],
        ['a team entry is malformed', familyProjection({ children: [], teams: [null] })],
        ['a projected team ID is blank', familyProjection({
            children: [],
            teams: [{ teamId: '   ', games: [] }]
        })],
        ['a projected team is duplicated', familyProjection({
            children: [],
            teams: [
                { teamId: 'team-1', games: [] },
                { id: 'team-1', games: [] }
            ]
        })],
        ['warning evidence is malformed', familyProjection({ calendarWarnings: [null] })],
        ['warning evidence is blank', familyProjection({ calendarWarnings: ['   '] })],
        ['warning evidence is duplicated after normalization', familyProjection({
            calendarWarnings: ['Calendar unavailable', ' Calendar unavailable ']
        })]
    ])('rejects a malformed v2 projection when %s', async (_label, projection) => {
        const harness = createHarness({ projectionResults: [projection] });

        await flushAsyncWork();

        expect(harness.document.getElementById('page-error-title').textContent)
            .toBe('Family page temporarily unavailable');
        expect(harness.document.getElementById('page-error-retry').classList.contains('hidden')).toBe(false);
        expect(harness.document.getElementById('page-main').classList.contains('hidden')).toBe(true);
        expect(harness.mocks.renderHeader).not.toHaveBeenCalled();
    });

    it('accepts a valid complete-empty v2 projection as authoritative', async () => {
        const harness = createHarness({
            projectionResults: [familyProjection({
                presentation: { label: 'Former family access', expiresAt: null },
                children: [],
                teams: [],
                externalEvents: [],
                calendarWarnings: []
            })]
        });

        await flushAsyncWork();
        await flushAsyncWork();

        expect(harness.document.getElementById('page-error').classList.contains('hidden')).toBe(true);
        expect(harness.document.getElementById('page-main').classList.contains('hidden')).toBe(false);
        expect(harness.document.getElementById('page-title').textContent).toBe('Former family access');
        expect(harness.document.getElementById('schedule-list').textContent).toContain('No events in this filter.');
        expect(harness.mocks.renderHeader).toHaveBeenCalled();
    });
});
