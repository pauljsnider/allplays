import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readEditRoster() {
    return readFileSync(new URL('../../edit-roster.html', import.meta.url), 'utf8');
}

describe('edit roster tracking status matrix wiring', () => {
    it('binds async renders and status writes to the captured tracking item and roster snapshot', () => {
        const source = readEditRoster();

        expect(source).toContain('let trackingStatusRenderToken = 0;');
        expect(source).toContain('const renderToken = ++trackingStatusRenderToken;');
        expect(source).toContain('const trackingItemId = selectedTrackingItemId;');
        expect(source).toContain('const rosterPlayers = [...latestRosterPlayers];');
        expect(source).toContain('if (renderToken !== trackingStatusRenderToken || trackingItemId !== selectedTrackingItemId)');
        expect(source).toContain('const player = rosterPlayers.find((item) => item.id === checkbox.dataset.playerId);');
        expect(source).toContain('itemId: trackingItemId');
        expect(source).toContain('await setTeamTrackingStatus(currentTeamId, trackingItemId, player.id, payload);');
    });

    it('uses rules-compatible tracking item names in the selector and summary', () => {
        const source = readEditRoster();

        expect(source).toContain("from './js/db.js?v=45'");
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
