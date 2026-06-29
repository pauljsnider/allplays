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
    if (!moduleScript) {
        throw new Error('Could not find family module script');
    }

    return moduleScript.replace(/^\s*import[\s\S]*?;\s*$/gm, '');
}

async function flushAsyncWork() {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
}

function createHarness({ token, url = 'https://example.test/family.html?token=share-token' }) {
    const familyPage = readFamilyPage();
    const moduleScript = extractFamilyModuleScript(familyPage);
    const dom = new JSDOM(familyPage, {
        url,
        runScripts: 'outside-only'
    });

    const mocks = {
        getFamilyShareToken: vi.fn().mockResolvedValue(token),
        resolveFamilyShareTokenChildren: vi.fn().mockResolvedValue([]),
        getTeam: vi.fn().mockResolvedValue({ name: 'Team Rocket', calendarUrls: [] }),
        getGames: vi.fn().mockResolvedValue([]),
        getTrackedCalendarEventUids: vi.fn().mockResolvedValue([]),
        resolveScheduleWatchCta: vi.fn().mockReturnValue(null),
        renderHeader: vi.fn(),
        renderFooter: vi.fn(),
        escapeHtml: (value = '') => String(value)
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#39;'),
        fetchAndParseCalendar: vi.fn().mockResolvedValue([]),
        extractOpponent: vi.fn().mockReturnValue('Opponent'),
        isPracticeEvent: vi.fn().mockReturnValue(false),
        expandRecurrence: vi.fn().mockReturnValue([]),
        getCalendarEventTrackingId: vi.fn().mockReturnValue(null),
        isTrackedCalendarEvent: vi.fn().mockReturnValue(false),
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

    return {
        dom,
        document: dom.window.document,
        mocks
    };
}

describe('family share page init expiry handling', () => {
    it('shows the explicit expired-link message and stops before loading family data', async () => {
        const harness = createHarness({
            token: {
                id: 'share-token',
                active: true,
                label: 'Grandma Share',
                expiresAt: new Date(Date.now() - 60_000).toISOString(),
                children: [{ teamId: 'team-1', playerId: 'player-1', teamName: 'Rockets', playerName: 'Ava' }]
            }
        });

        await flushAsyncWork();

        expect(harness.mocks.getFamilyShareToken).toHaveBeenCalledWith('share-token');
        expect(harness.document.getElementById('page-loading').classList.contains('hidden')).toBe(true);
        expect(harness.document.getElementById('page-error').classList.contains('hidden')).toBe(false);
        expect(harness.document.getElementById('page-error-title').textContent).toBe('This link has expired');
        expect(harness.document.getElementById('page-error-detail').textContent).toBe('Ask the parent to create a new family share link. Expired links never load player, team, or schedule details.');
        expect(harness.document.getElementById('page-main').classList.contains('hidden')).toBe(true);
        expect(harness.mocks.renderHeader).not.toHaveBeenCalled();
        expect(harness.mocks.getTeam).not.toHaveBeenCalled();
    });

    it('continues through init for a valid non-expired token', async () => {
        const harness = createHarness({
            token: {
                id: 'share-token',
                active: true,
                label: 'Grandma Share',
                expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
                children: [{ teamId: 'team-1', playerId: 'player-1', teamName: 'Rockets', playerName: 'Ava' }],
                extraCalendarUrls: []
            }
        });

        await flushAsyncWork();
        await flushAsyncWork();

        expect(harness.mocks.renderHeader).toHaveBeenCalled();
        expect(harness.mocks.getTeam).toHaveBeenCalledWith('team-1');
        expect(harness.document.getElementById('page-error').classList.contains('hidden')).toBe(true);
        expect(harness.document.getElementById('page-loading').classList.contains('hidden')).toBe(true);
        expect(harness.document.getElementById('page-main').classList.contains('hidden')).toBe(false);
        expect(harness.document.getElementById('page-title').textContent).toBe('Grandma Share');
        expect(harness.document.getElementById('players-list').textContent).toContain('Ava');
        expect(harness.document.title).toBe('Grandma Share - ALL PLAYS');
    });
});
