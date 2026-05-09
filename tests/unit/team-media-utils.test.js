import { describe, it, expect } from 'vitest';
import {
    canManageTeamMedia,
    buildBulkDeleteUpdates,
    buildMoveUpdates,
    buildReorderUpdates,
    isSafeTeamMediaUrl,
    normalizeSelectedMediaIds,
    sortByMediaOrder
} from '../../js/team-media-utils.js';

describe('team media management permissions', () => {
    it('allows only owners, admins, and platform admins to see management controls', () => {
        const team = { ownerId: 'coach-1', adminEmails: ['admin@example.com'] };

        expect(canManageTeamMedia({ uid: 'coach-1', email: 'coach@example.com' }, team)).toBe(true);
        expect(canManageTeamMedia({ uid: 'parent-1', email: 'admin@example.com' }, team)).toBe(true);
        expect(canManageTeamMedia({ uid: 'global-1', email: 'other@example.com', isAdmin: true }, team)).toBe(true);
        expect(canManageTeamMedia({ uid: 'parent-1', email: 'parent@example.com' }, team)).toBe(false);
        expect(canManageTeamMedia(null, team)).toBe(false);
    });
});

describe('team media bulk actions', () => {
    it('deduplicates selected ids before building bulk delete updates', () => {
        expect(normalizeSelectedMediaIds([' a ', 'b', 'a', '', null])).toEqual(['a', 'b']);
        expect(buildBulkDeleteUpdates(['a', 'b', 'a'])).toEqual([
            { id: 'a', deleted: true },
            { id: 'b', deleted: true }
        ]);
    });

    it('builds move updates with destination folder and contiguous order', () => {
        expect(buildMoveUpdates(['clip-1', 'clip-2'], 'folder-b', 3)).toEqual([
            { id: 'clip-1', folderId: 'folder-b', order: 3 },
            { id: 'clip-2', folderId: 'folder-b', order: 4 }
        ]);

        expect(() => buildMoveUpdates(['clip-1'], '')).toThrow(/destination folder/i);
    });

    it('builds persistent reorder updates from visible order', () => {
        expect(buildReorderUpdates(['folder-c', 'folder-a', 'folder-b'])).toEqual([
            { id: 'folder-c', order: 0 },
            { id: 'folder-a', order: 1 },
            { id: 'folder-b', order: 2 }
        ]);
    });

    it('accepts only safe http and https media links', () => {
        expect(isSafeTeamMediaUrl('https://videos.example.com/clip')).toBe(true);
        expect(isSafeTeamMediaUrl('http://videos.example.com/clip')).toBe(true);
        expect(isSafeTeamMediaUrl('javascript:alert(1)')).toBe(false);
        expect(isSafeTeamMediaUrl('not a url')).toBe(false);
    });

    it('sorts by saved order with stable name fallback', () => {
        expect(sortByMediaOrder([
            { id: 'b', name: 'B', order: 2 },
            { id: 'a', name: 'A', order: 1 },
            { id: 'c', name: 'C' }
        ]).map((item) => item.id)).toEqual(['a', 'b', 'c']);
    });
});
