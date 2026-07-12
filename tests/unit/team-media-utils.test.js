import { describe, expect, it } from 'vitest';
import {
    canManageTeamMedia,
    canViewTeamMediaFolder,
    canContributeTeamMedia,
    canDeleteTeamMediaItem,
    hasTeamMediaUploadGrant,
    canReadTeamMediaAlbum,
    buildBulkDeleteUpdates,
    buildMoveUpdates,
    buildReorderUpdates,
    getTeamMediaItemUrl,
    getTeamMediaUploaderName,
    isSafeTeamMediaPhoto,
    isSafeTeamMediaUrl,
    TEAM_MEDIA_MAX_FILE_SIZE_BYTES,
    isSupportedTeamMediaDocument,
    isSupportedTeamMediaVideoUrl,
    isSupportedTeamMediaImage,
    isTeamMediaDocument,
    normalizeAlbumVisibility,
    normalizeSelectedMediaIds,
    normalizeTeamMediaFolderDraft,
    normalizeTeamMediaVideoDraft,
    resolveTeamMediaAlbumNotificationAudience,
    sortByMediaOrder
} from '../../js/team-media-utils.js';

describe('team media management permissions', () => {
    it('allows owners, admins, platform admins, and selected media managers to see management controls', () => {
        const team = {
            id: 'team-1',
            ownerId: 'coach-1',
            adminEmails: ['admin@example.com'],
            teamPermissions: {
                teamMediaManagement: { mode: 'selected', memberIds: ['media-manager'] }
            }
        };

        expect(canManageTeamMedia({ uid: 'coach-1', email: 'coach@example.com' }, team)).toBe(true);
        expect(canManageTeamMedia({ uid: 'parent-1', email: 'admin@example.com' }, team)).toBe(true);
        expect(canManageTeamMedia({ uid: 'global-1', email: 'other@example.com', isAdmin: true }, team)).toBe(true);
        expect(canManageTeamMedia({ uid: 'media-manager', email: 'manager@example.com' }, team)).toBe(true);
        expect(canManageTeamMedia({ uid: 'coach-only', coachOf: ['team-1'] }, team)).toBe(false);
        expect(canManageTeamMedia({ uid: 'parent-1', email: 'parent@example.com' }, team)).toBe(false);
        expect(canManageTeamMedia(null, team)).toBe(false);
    });

    it('allows admins and explicitly approved members to contribute uploads', () => {
        const team = { id: 'team-1', ownerId: 'coach-1', adminEmails: ['admin@example.com'] };

        expect(canContributeTeamMedia({ uid: 'coach-1', email: 'coach@example.com' }, team)).toBe(true);
        expect(canContributeTeamMedia({ uid: 'parent-1', parentTeamIds: ['team-1'] }, team)).toBe(false);
        expect(canContributeTeamMedia({ uid: 'parent-2', parentOf: [{ teamId: 'team-1' }] }, team)).toBe(false);
        expect(canContributeTeamMedia({
            uid: 'media-manager',
            teamPermissions: {},
        }, {
            ...team,
            teamPermissions: { teamMediaManagement: { mode: 'selected', memberIds: ['media-manager'] } }
        })).toBe(true);
        expect(canContributeTeamMedia({ uid: 'parent-3', teamMediaUploadTeamIds: ['team-1'] }, team)).toBe(true);
        expect(canContributeTeamMedia({ uid: 'parent-4', mediaUploadTeamIds: ['team-1'] }, team)).toBe(true);
        expect(canContributeTeamMedia({ uid: 'other-1', teamMediaUploadTeamIds: ['other-team'] }, team)).toBe(false);
        expect(hasTeamMediaUploadGrant({ teamMediaUploadTeamIds: ['team-1'] }, 'team-1')).toBe(true);
    });

    it('allows owners or admins to moderate all uploads and uploaders to delete their own files', () => {
        const team = { id: 'team-1', ownerId: 'coach-1', adminEmails: [] };
        const item = { id: 'photo-1', type: 'photo', uploadedBy: 'parent-1' };
        const fileItem = { id: 'file-1', type: 'file', uploadedBy: 'parent-1' };

        expect(canDeleteTeamMediaItem({ uid: 'parent-1' }, team, item)).toBe(true);
        expect(canDeleteTeamMediaItem({ uid: 'parent-1' }, team, fileItem)).toBe(true);
        expect(canDeleteTeamMediaItem({ uid: 'parent-2' }, team, item)).toBe(false);
        expect(canDeleteTeamMediaItem({ uid: 'coach-1' }, team, item)).toBe(true);
    });
});

describe('team media video albums', () => {
    it('normalizes album names and supported visibility values', () => {
        expect(normalizeTeamMediaFolderDraft({ name: '  Game Film  ', visibility: 'private' })).toEqual({
            name: 'Game Film',
            visibility: 'private'
        });
        expect(normalizeTeamMediaFolderDraft({ name: 'Highlights', visibility: 'public' })).toEqual({
            name: 'Highlights',
            visibility: 'team'
        });
    });

    it('requires an album name', () => {
        expect(() => normalizeTeamMediaFolderDraft({ name: '   ' })).toThrow('Album name is required.');
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
        expect(() => normalizeTeamMediaVideoDraft({
            title: 'Unsupported',
            url: 'https://example.com/not-a-video'
        })).toThrow('Enter a valid YouTube or Vimeo URL.');
        expect(() => normalizeTeamMediaVideoDraft({
            title: '   ',
            url: 'https://youtu.be/abc123'
        })).toThrow('Video title is required.');
    });

    it('hides private albums from parents', () => {
        expect(canViewTeamMediaFolder({ visibility: 'team' }, 'parent')).toBe(true);
        expect(canViewTeamMediaFolder({ visibility: 'private' }, 'parent')).toBe(false);
        expect(canViewTeamMediaFolder({ visibility: 'team' }, 'media')).toBe(true);
        expect(canViewTeamMediaFolder({ visibility: 'private' }, 'media')).toBe(false);
        expect(canViewTeamMediaFolder({ visibility: 'private' }, 'full')).toBe(true);
    });
});

describe('team media album visibility', () => {
    it('normalizes album metadata with team visibility as the safe default', () => {
        expect(normalizeTeamMediaFolderDraft({ name: ' Highlights ', visibility: 'private' })).toEqual({
            name: 'Highlights',
            visibility: 'private'
        });
        expect(normalizeAlbumVisibility('public')).toBe('team');
        expect(normalizeAlbumVisibility()).toBe('team');
        expect(() => normalizeTeamMediaFolderDraft({ name: ' ' })).toThrow(/album name/i);
    });

    it('hides private albums from non-admin readers', () => {
        expect(canReadTeamMediaAlbum({ visibility: 'team' }, false)).toBe(true);
        expect(canReadTeamMediaAlbum({ visibility: 'private' }, false)).toBe(false);
        expect(canReadTeamMediaAlbum({ visibility: 'private' }, true)).toBe(true);
    });
});

describe('team media notification audience resolver', () => {
    const users = [
        { uid: 'parent-1', roles: ['parent'] },
        { uid: 'parent-2', roles: ['parent'] },
        { uid: 'staff-1', roles: ['staff'] },
        { uid: 'staff-parent-1', roles: ['parent', 'staff'] }
    ];
    const resolveIds = (folder) => resolveTeamMediaAlbumNotificationAudience(folder, users).map((user) => user.uid);

    it('resolves staff-only albums without parent-only users', () => {
        expect(resolveIds({ visibility: 'staff-only' })).toEqual(['staff-1', 'staff-parent-1']);
        expect(resolveIds({ albumVisibility: 'team', staffOnly: true })).toEqual(['staff-1', 'staff-parent-1']);
    });

    it('resolves visibility-restricted albums to explicitly allowed visible users', () => {
        expect(resolveIds({
            visibility: 'team',
            visibleToUserIds: ['parent-2'],
            visibleToRoles: ['staff']
        })).toEqual(['parent-2', 'staff-1', 'staff-parent-1']);

        expect(resolveIds({
            visibility: 'private',
            allowedUserIds: ['parent-2'],
            allowedRoles: ['staff']
        })).toEqual(['staff-1', 'staff-parent-1']);
    });

    it('treats null audience fields as absent so populated aliases still apply', () => {
        expect(resolveIds({
            visibility: 'team',
            allowedUserIds: null,
            visibleToUserIds: ['parent-2'],
            visibleToRoles: ['staff']
        })).toEqual(['parent-2', 'staff-1', 'staff-parent-1']);

        expect(resolveIds({
            audienceContext: {
                allowedUserIds: null,
                visibleToUserIds: ['parent-2'],
                visibleToRoles: ['staff']
            }
        })).toEqual(['parent-2', 'staff-1', 'staff-parent-1']);
    });

    it('keeps standard visible albums on the current eligible audience', () => {
        expect(resolveTeamMediaAlbumNotificationAudience({ visibility: 'team' }, users)).toEqual(users);
        expect(resolveTeamMediaAlbumNotificationAudience({}, users)).toEqual(users);
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

    it('identifies uploaded photo items and ignores persisted download URLs when storage re-authorization is required', () => {
        const item = {
            downloadUrl: 'https://cdn.example.com/photo.png',
            type: 'photo',
            uploadedByName: 'Coach Pat'
        };

        expect(getTeamMediaItemUrl(item)).toBe('https://cdn.example.com/photo.png');
        expect(getTeamMediaItemUrl({
            storagePath: 'team-media/team-1/folder-1/user-1/photo.png',
            downloadUrl: 'https://cdn.example.com/stale-token.png'
        })).toBe('');
        expect(getTeamMediaItemUrl({
            storagePath: 'team-media/team-1/folder-1/user-1/photo.png',
            url: 'https://cdn.example.com/fresh-session.png',
            downloadUrl: 'https://cdn.example.com/stale-token.png'
        })).toBe('https://cdn.example.com/fresh-session.png');
        expect(isSafeTeamMediaPhoto(item)).toBe(true);
        expect(isSafeTeamMediaPhoto({ url: 'https://cdn.example.com/photo.jpg?token=1' })).toBe(true);
        expect(isSafeTeamMediaPhoto({ url: 'javascript:alert(1)', type: 'photo' })).toBe(false);
        expect(getTeamMediaUploaderName(item)).toBe('Coach Pat');
    });

    it('accepts only image files up to the team media backend size limit', () => {
        expect(isSupportedTeamMediaImage({ type: 'image/jpeg', size: TEAM_MEDIA_MAX_FILE_SIZE_BYTES })).toBe(true);
        expect(isSupportedTeamMediaImage({ type: 'image/png', size: 1 })).toBe(true);
        expect(isSupportedTeamMediaImage({ type: 'image/jpeg', size: TEAM_MEDIA_MAX_FILE_SIZE_BYTES + 1 })).toBe(false);
        expect(isSupportedTeamMediaImage({ type: 'image/jpeg', size: 0 })).toBe(false);
        expect(isSupportedTeamMediaImage({ type: 'video/mp4', size: 1 })).toBe(false);
        expect(isSupportedTeamMediaImage(null)).toBe(false);
    });

    it('accepts approved document files up to the team media backend size limit', () => {
        expect(isSupportedTeamMediaDocument({ type: 'application/pdf', size: TEAM_MEDIA_MAX_FILE_SIZE_BYTES })).toBe(true);
        expect(isSupportedTeamMediaDocument({ type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 1 })).toBe(true);
        expect(isSupportedTeamMediaDocument({ type: 'text/csv', size: 1 })).toBe(true);
        expect(isSupportedTeamMediaDocument({ type: 'application/pdf', size: TEAM_MEDIA_MAX_FILE_SIZE_BYTES + 1 })).toBe(false);
        expect(isSupportedTeamMediaDocument({ type: 'application/pdf', size: 0 })).toBe(false);
        expect(isSupportedTeamMediaDocument({ type: 'video/mp4', size: 1 })).toBe(false);
        expect(isSupportedTeamMediaDocument({ type: 'image/png', size: 1 })).toBe(false);
        expect(isTeamMediaDocument({ type: 'file' })).toBe(true);
    });

    it('sorts by saved order with stable name fallback', () => {
        expect(sortByMediaOrder([
            { id: 'b', name: 'B', order: 2 },
            { id: 'a', name: 'A', order: 1 },
            { id: 'c', name: 'C' }
        ]).map((item) => item.id)).toEqual(['a', 'b', 'c']);
    });
});
