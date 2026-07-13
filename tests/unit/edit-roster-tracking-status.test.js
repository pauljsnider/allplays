// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import {
    buildTrackingStatusPayload,
    mergeTrackingStatusRows,
    summarizeTrackingStatus
} from '../../js/tracking-status-admin.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function readEditRoster() {
    return readFileSync(path.join(repoRoot, 'edit-roster.html'), 'utf8');
}

function extractFunction(source, functionName) {
    const signatures = [`async function ${functionName}`, `function ${functionName}`];
    const signature = signatures.find((candidate) => source.includes(candidate));
    const start = signature ? source.indexOf(signature) : -1;
    if (start === -1) {
        throw new Error(`Could not find ${functionName} in edit-roster.html`);
    }

    const bodyStart = source.indexOf('{', start);
    let depth = 0;
    for (let index = bodyStart; index < source.length; index += 1) {
        const char = source[index];
        if (char === '{') depth += 1;
        if (char === '}') depth -= 1;
        if (depth === 0) {
            return source.slice(start, index + 1);
        }
    }

    throw new Error(`Could not extract ${functionName} body`);
}

function createDeferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

async function flushAsyncWork() {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
}

function createRenderHarness({
    trackingItems,
    selectedTrackingItemId,
    latestRosterPlayers,
    listTeamTrackingStatuses,
    setTeamTrackingStatus
}) {
    const source = readEditRoster();
    const dom = new JSDOM(`<!doctype html><body>
        <p id="tracking-status-summary">No tracking item selected.</p>
        <div id="tracking-status-matrix"></div>
    </body>`);

    const context = vm.createContext({
        __initialState: {
            currentTeamId: 'team-1',
            currentUser: { uid: 'coach-1', email: 'coach@example.com' },
            trackingItems,
            selectedTrackingItemId,
            latestRosterPlayers
        },
        document: dom.window.document,
        window: dom.window,
        console: { error: vi.fn() },
        alert: vi.fn(),
        escapeHtml: (value = '') => String(value)
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#39;'),
        mergeTrackingStatusRows,
        summarizeTrackingStatus,
        buildTrackingStatusPayload,
        listTeamTrackingStatuses,
        setTeamTrackingStatus,
        globalThis: {}
    });

    const script = [
        `let currentTeamId = __initialState.currentTeamId;`,
        `let currentUser = __initialState.currentUser;`,
        `let trackingItems = __initialState.trackingItems;`,
        `let selectedTrackingItemId = __initialState.selectedTrackingItemId;`,
        `let latestRosterPlayers = __initialState.latestRosterPlayers;`,
        'let trackingStatusRenderToken = 0;',
        extractFunction(source, 'renderTrackingStatusMatrix'),
        `globalThis.__testHooks = {
            renderTrackingStatusMatrix,
            setSelectedTrackingItemId(value) {
                selectedTrackingItemId = value;
            },
            getSelectedTrackingItemId() {
                return selectedTrackingItemId;
            }
        };`
    ].join('\n');

    vm.runInContext(script, context);

    return {
        dom,
        document: dom.window.document,
        hooks: context.globalThis.__testHooks
    };
}

describe('edit roster tracking status matrix wiring', () => {
    it('keeps the rendered matrix bound to the latest tracking item when async loads resolve out of order', async () => {
        const itemOneStatuses = createDeferred();
        const itemTwoStatuses = createDeferred();
        const listStatuses = vi.fn((teamId, trackingItemId) => {
            if (trackingItemId === 'item-1') return itemOneStatuses.promise;
            if (trackingItemId === 'item-2') return itemTwoStatuses.promise;
            throw new Error(`Unexpected tracking item ${trackingItemId}`);
        });

        const harness = createRenderHarness({
            trackingItems: [
                { id: 'item-1', title: 'Medical release' },
                { id: 'item-2', title: 'Uniform handout' }
            ],
            selectedTrackingItemId: 'item-1',
            latestRosterPlayers: [
                { id: 'p1', name: 'Ava' },
                { id: 'p2', name: 'Sam' }
            ],
            listTeamTrackingStatuses: listStatuses,
            setTeamTrackingStatus: vi.fn()
        });

        const firstRender = harness.hooks.renderTrackingStatusMatrix();
        harness.hooks.setSelectedTrackingItemId('item-2');
        const secondRender = harness.hooks.renderTrackingStatusMatrix();

        itemTwoStatuses.resolve([
            { playerId: 'p1', complete: true },
            { playerId: 'p2', complete: false }
        ]);
        await secondRender;

        itemOneStatuses.resolve([
            { playerId: 'p1', complete: false },
            { playerId: 'p2', complete: true }
        ]);
        await firstRender;

        expect(listStatuses).toHaveBeenCalledTimes(2);
        expect(harness.document.getElementById('tracking-status-summary').textContent).toBe('1 of 2 complete for Uniform handout (1 incomplete).');

        const toggles = [...harness.document.querySelectorAll('.tracking-status-toggle')];
        expect(toggles).toHaveLength(2);
        expect(toggles[0].checked).toBe(true);
        expect(toggles[1].checked).toBe(false);
    });

    it('saves checkbox changes against the latest selected tracking item after switching', async () => {
        const staleItemStatuses = createDeferred();
        const savedStatuses = [
            { playerId: 'p1', complete: true },
            { playerId: 'p2', complete: false }
        ];
        const listStatuses = vi.fn((teamId, trackingItemId) => {
            if (trackingItemId === 'item-1') return staleItemStatuses.promise;
            if (trackingItemId === 'item-2') return Promise.resolve(savedStatuses.map((status) => ({ ...status })));
            throw new Error(`Unexpected tracking item ${trackingItemId}`);
        });
        const setStatus = vi.fn(async (teamId, trackingItemId, playerId, payload) => {
            const existingIndex = savedStatuses.findIndex((status) => status.playerId === playerId);
            const nextStatus = { playerId, complete: payload.complete };
            if (existingIndex >= 0) {
                savedStatuses.splice(existingIndex, 1, nextStatus);
            } else {
                savedStatuses.push(nextStatus);
            }
        });

        const harness = createRenderHarness({
            trackingItems: [
                { id: 'item-1', title: 'Medical release' },
                { id: 'item-2', title: 'Uniform handout' }
            ],
            selectedTrackingItemId: 'item-1',
            latestRosterPlayers: [
                { id: 'p1', name: 'Ava', number: '3' },
                { id: 'p2', name: 'Sam', number: '7' }
            ],
            listTeamTrackingStatuses: listStatuses,
            setTeamTrackingStatus: setStatus
        });

        const firstRender = harness.hooks.renderTrackingStatusMatrix();
        harness.hooks.setSelectedTrackingItemId('item-2');
        await harness.hooks.renderTrackingStatusMatrix();

        const toggles = [...harness.document.querySelectorAll('.tracking-status-toggle')];
        toggles[1].checked = true;
        toggles[1].dispatchEvent(new harness.dom.window.Event('change', { bubbles: true }));
        await flushAsyncWork();

        expect(setStatus).toHaveBeenCalledTimes(1);
        expect(setStatus).toHaveBeenCalledWith(
            'team-1',
            'item-2',
            'p2',
            expect.objectContaining({
                trackingItemId: 'item-2',
                playerId: 'p2',
                complete: true,
                updatedBy: 'coach-1',
                updatedByEmail: 'coach@example.com'
            })
        );
        expect(harness.document.getElementById('tracking-status-summary').textContent).toBe('2 of 2 complete for Uniform handout (0 incomplete).');

        staleItemStatuses.resolve([
            { playerId: 'p1', complete: false },
            { playerId: 'p2', complete: false }
        ]);
        await firstRender;

        expect(harness.document.getElementById('tracking-status-summary').textContent).toBe('2 of 2 complete for Uniform handout (0 incomplete).');
    });

    it('uses rules-compatible tracking item names in the selector and summary', () => {
        const source = readEditRoster();

        expect(source).toContain("from './js/db.js?v=94'");
        expect(source).not.toContain("from './js/db.js?v=69'");
        expect(source).toContain("from './js/tracking-status-admin.js?v=2'");
        expect(source).toContain('item.title || item.name || item.id');
        expect(source).toContain("selectedItem.title || selectedItem.name || 'selected item'");
    });

    it('escapes roster player values before inserting them into the table HTML', () => {
        const source = readEditRoster();
        const rosterRender = source.slice(source.indexOf('tbody.innerHTML = players.map(p => {'), source.indexOf("document.querySelectorAll('.deactivate-btn')"));

        expect(rosterRender).toContain("const playerName = escapeHtml(p.name || 'Unnamed player');");
        expect(rosterRender).toContain("const playerNumber = escapeHtml(p.number || '-');");
        expect(rosterRender).toContain("const playerPhotoUrl = escapeHtml(p.photoUrl || '');");
        expect(rosterRender).toContain('<span>${playerName}</span>');
        expect(rosterRender).toContain('alt="${playerName}"');
        expect(rosterRender).not.toContain('<span>${p.name}</span>');
        expect(rosterRender).not.toContain('alt="${p.name}"');
    });
});
