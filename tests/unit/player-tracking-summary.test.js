import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getVisiblePlayerTrackingSummary, isPublicTrackingItem } from '../../js/player-tracking-summary.js';

describe('player tracking summary', () => {
    it('shows only public items for requested players', () => {
        const summary = getVisiblePlayerTrackingSummary({
            playerIds: ['p1'],
            items: [
                { id: 'waiver', title: 'Waiver', public: true, sortOrder: 2 },
                { id: 'medical', title: 'Medical form', public: false, private: true, sortOrder: 1 },
                { id: 'photo', title: 'Photo release', visibility: 'public', sortOrder: 3 }
            ],
            statuses: [
                { itemId: 'waiver', playerId: 'p1', completed: true },
                { itemId: 'waiver', playerId: 'p2', completed: false },
                { itemId: 'medical', playerId: 'p1', completed: true }
            ]
        });

        expect(summary).toHaveLength(1);
        expect(summary[0].playerId).toBe('p1');
        expect(summary[0].items.map((item) => item.id)).toEqual(['waiver', 'photo']);
        expect(summary[0].items[0].isComplete).toBe(true);
        expect(summary[0].items[1].isComplete).toBe(false);
    });

    it('treats private visibility as non-public even when public is true', () => {
        expect(isPublicTrackingItem({ public: true, visibility: 'private' })).toBe(false);
        expect(isPublicTrackingItem({ public: true, isPrivate: true })).toBe(false);
    });

    it('wires team page and Firestore rules for family read-only access', () => {
        const teamHtml = readFileSync(resolve(process.cwd(), 'team.html'), 'utf8');
        const dbSource = readFileSync(resolve(process.cwd(), 'js/db.js'), 'utf8');
        const rules = readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8');

        expect(teamHtml).toContain('id="player-tracking-section"');
        expect(teamHtml).toContain('getPublicTrackingItems');
        expect(teamHtml).toContain('getPlayerTrackingStatuses');
        expect(dbSource).toContain('getDocs(collection(db, `teams/${teamId}/trackingItems`))');
        expect(dbSource).toContain('.filter((item) => isPublicTrackingItem(item)');
        expect(dbSource).toContain('const publicItems = await getPublicTrackingItems(teamId);');
        expect(dbSource).toContain('publicItems.flatMap');
        expect(dbSource).toContain('getDoc(doc(db, `teams/${teamId}/trackingItems/${item.id}/memberTracking/${playerId}`))');
        expect(dbSource).toContain('const statusesById = new Map();');
        expect(rules).toContain('match /trackingItems/{itemId}');
        expect(rules).toContain('match /memberTracking/{trackingId}');
        expect(rules).toContain('canReadPublicTrackingStatus(teamId, resource.data)');
        expect(rules).toContain("data.get('public', false) == true");
        expect(rules).toContain('isParentForPlayer(teamId, playerId) || isPlayerSelf(teamId, playerId)');
        expect(rules).toContain('allow create, update, delete: if isTeamOwnerOrAdmin(teamId);');
    });
});
