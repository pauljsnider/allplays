import { describe, expect, it } from 'vitest';
import {
    buildTrackingStatusPayload,
    getActiveRosterPlayers,
    mergeTrackingStatusRows,
    normalizeTrackingItemDraft,
    summarizeTrackingStatus
} from '../../js/tracking-status-admin.js';

describe('tracking status admin helpers', () => {
    it('normalizes player-scoped tracking items', () => {
        expect(normalizeTrackingItemDraft({ title: ' Medical release ' })).toEqual({
            title: 'Medical release',
            scope: 'players',
            active: true
        });
        expect(() => normalizeTrackingItemDraft({ title: '   ' })).toThrow('Tracking item title');
    });

    it('builds rows for active roster players with persisted completion states', () => {
        const players = [
            { id: 'p1', name: 'Ava', number: '3' },
            { id: 'p2', name: 'Sam', number: '7', active: false },
            { id: 'p3', name: 'Kai' }
        ];
        const rows = mergeTrackingStatusRows(players, [
            { id: 'p1', playerId: 'p1', status: 'complete' },
            { id: 'p3', playerId: 'p3', complete: false }
        ]);

        expect(getActiveRosterPlayers(players).map((player) => player.id)).toEqual(['p1', 'p3']);
        expect(rows.map((row) => ({ id: row.player.id, complete: row.complete }))).toEqual([
            { id: 'p1', complete: true },
            { id: 'p3', complete: false }
        ]);
        expect(summarizeTrackingStatus(rows)).toEqual({
            total: 2,
            complete: 1,
            incomplete: 1
        });
    });

    it('builds auditable per-player status payloads', () => {
        expect(buildTrackingStatusPayload({
            teamId: 'team-1',
            itemId: 'item-1',
            player: { id: 'p1', name: 'Ava', number: '3' },
            complete: true,
            actorId: 'admin-1',
            actorEmail: 'coach@example.com'
        })).toEqual({
            teamId: 'team-1',
            trackingItemId: 'item-1',
            playerId: 'p1',
            playerName: 'Ava',
            playerNumber: '3',
            memberType: 'player',
            status: 'complete',
            complete: true,
            updatedBy: 'admin-1',
            updatedByEmail: 'coach@example.com'
        });
    });
});
