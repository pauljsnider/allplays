import { describe, expect, it } from 'vitest';
import {
    buildPlayerProfilePhotoPath,
    buildTeamProfilePhotoPath,
    buildUserProfilePhotoPath,
    validateProfilePhotoFile
} from '../../js/profile-photo-paths.js';

describe('profile photo Storage paths', () => {
    it('binds own, player, and team uploads to the authenticated primary Storage contract', () => {
        expect(buildUserProfilePhotoPath('user/1', 'My photo.jpg', 123, 'attempt-1')).toBe(
            'profile-photos/users/user_1/123_attempt-1_profile-photo.jpg'
        );
        expect(buildPlayerProfilePhotoPath('team/1', 'player 7', 'Kid photo.png', 123, 'attempt-2')).toBe(
            'profile-photos/teams/team_1/players/player_7/123_attempt-2_profile-photo.png'
        );
        expect(buildTeamProfilePhotoPath('team/1', 'Logo.png', 123, 'attempt-3')).toBe(
            'profile-photos/teams/team_1/team/123_attempt-3_profile-photo.png'
        );
    });

    it('fails closed when a scoped owner id is missing', () => {
        expect(() => buildUserProfilePhotoPath('', 'photo.jpg')).toThrow('User is required');
        expect(() => buildPlayerProfilePhotoPath('team-1', '', 'photo.jpg')).toThrow('Player is required');
        expect(() => buildTeamProfilePhotoPath('', 'photo.jpg')).toThrow('Team is required');
    });

    it('keeps uploader account IDs out of public team and player download paths', () => {
        const playerPath = buildPlayerProfilePhotoPath('team-1', 'player-1', 'private name.jpg', 123, 'attempt-1');
        const teamPath = buildTeamProfilePhotoPath('team-1', 'private name.jpg', 123, 'attempt-2');
        expect(playerPath.split('/')).toHaveLength(6);
        expect(teamPath.split('/')).toHaveLength(5);
        expect(playerPath).not.toContain('private');
        expect(teamPath).not.toContain('private');
    });

    it('uses collision-resistant attempt paths even for same-millisecond uploads', () => {
        const first = buildUserProfilePhotoPath('user-1', 'photo.jpg', 123);
        const second = buildUserProfilePhotoPath('user-1', 'photo.jpg', 123);

        expect(first).not.toBe(second);
        expect(first).toMatch(/^profile-photos\/users\/user-1\/123_[a-f0-9]{32}_profile-photo\.jpg$/);
        expect(second).toMatch(/^profile-photos\/users\/user-1\/123_[a-f0-9]{32}_profile-photo\.jpg$/);
    });

    it('rejects invalid profile photos before any owner or upload can be created', () => {
        expect(() => validateProfilePhotoFile({ type: 'text/plain', size: 123 })).toThrow('image file');
        expect(() => validateProfilePhotoFile({ type: 'image/jpeg', size: 0 })).toThrow('non-empty');
        expect(() => validateProfilePhotoFile({ type: 'image/jpeg', size: 6 * 1024 * 1024 }, {
            maxBytes: 5 * 1024 * 1024
        })).toThrow('5 MB or smaller');
        expect(() => validateProfilePhotoFile({ type: 'image/jpeg', size: 123 })).not.toThrow();
    });
});
