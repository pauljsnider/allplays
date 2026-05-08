import { describe, expect, it } from 'vitest';
import {
    canViewTeamMediaFolder,
    isSupportedTeamMediaVideoUrl,
    normalizeTeamMediaFolderDraft,
    normalizeTeamMediaVideoDraft
} from '../../js/team-media-utils.js';

describe('team media utilities', () => {
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

    it('accepts only YouTube or Vimeo video links', () => {
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
