import { describe, expect, it } from 'vitest';
import {
    canManageTeamMedia,
    canViewTeamMediaFolder,
    buildBulkDeleteUpdates,
    buildMoveUpdates,
    buildReorderUpdates,
    getTeamMediaItemUrl,
    getTeamMediaUploaderName,
    isSafeTeamMediaPhoto,
    isSafeTeamMediaUrl,
    isSupportedTeamMediaVideoUrl,
    normalizeSelectedMediaIds,
    normalizeTeamMediaFolderDraft,
    normalizeTeamMediaVideoDraft,
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

describe('team media video folders', () => {
    it('normalizes folder names and supported visibility values', () => {
        expect(normalizeTeamMediaFolderDraft({ name: '  Game Film  ', visibility: 'managers' })).toEqual({
            name: 'Game Film',
            visibility: 'managers'
        });
        expect(normalizeTeamMediaFolderDraft({ name: 'Highlights', visibility: 'public' })).toEqual({
            name: 'Highlights',
            visibility: 'members'
        });
    });

    it('requires a folder name', () => {
        expect(() => normalizeTeamMediaFolderDraft({ name: '   ' })).toThrow('Folder name is required.');
    });

    it('accepts only YouTube or Vimeo video links for team media video links', () => {
        expect(isSupportedTeamMediaVideoUrl('https://www.youtube.com/watch?v=abc123')).toBe(true);
        expect(isSupportedTeamMediaVideoUrl('https://youtu.be/abc123')).toBe(true);
        expect(isSupportedTeamMediaVideoUrl('https://vimeo.com/123456')).toBe(true);
        expect(isSupportedTeamMediaVideoUrl('https://example.com/video')).toBe(false);
        expect(isSupportedTeamMediaVideoUrl('javascript:alert(1)')).toBe(false);
    });

    it('normalizes video-link payloads', () => {
        expect(normalizeTeamMediaVideoDraft({
            title: '  First Half  ',
            url: 'https://youtu.be/abc123'
        })).toEqual({
            title: 'First Half',
            url: 'https://youtu.be/abc123',
            type: 'video_link'
        });
    });

    it('hides manager-only folders from parents', () => {
        expect(canViewTeamMediaFolder({ visibility: 'members' }, 'parent')).toBe(true);
        expect(canViewTeamMediaFolder({ visibility: 'managers' }, 'parent')).toBe(false);
        expect(canViewTeamMediaFolder({ visibility: 'managers' }, 'full')).toBe(true);
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

    it('accepts only safe http and https media links for generic safety checks', () => {
        expect(isSafeTeamMediaUrl('https://videos.example.com/clip')).toBe(true);
        expect(isSafeTeamMediaUrl('http://videos.example.com/clip')).toBe(true);
        expect(isSafeTeamMediaUrl('javascript:alert(1)')).toBe(false);
        expect(isSafeTeamMediaUrl('not a url')).toBe(false);
    });

    it('identifies uploaded photo items and uploader metadata', () => {
        const item = {
            downloadUrl: 'https://cdn.example.com/photo.png',
            type: 'photo',
            uploadedByName: 'Coach Pat'
        };

        expect(getTeamMediaItemUrl(item)).toBe('https://cdn.example.com/photo.png');
        expect(isSafeTeamMediaPhoto(item)).toBe(true);
        expect(isSafeTeamMediaPhoto({ url: 'https://cdn.example.com/photo.jpg?token=1' })).toBe(true);
        expect(isSafeTeamMediaPhoto({ url: 'javascript:alert(1)', type: 'photo' })).toBe(false);
        expect(getTeamMediaUploaderName(item)).toBe('Coach Pat');
    });

    it('sorts by saved order with stable name fallback', () => {
        expect(sortByMediaOrder([
            { id: 'b', name: 'B', order: 2 },
            { id: 'a', name: 'A', order: 1 },
            { id: 'c', name: 'C' }
        ]).map((item) => item.id)).toEqual(['a', 'b', 'c']);
    });
});
