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
});
