import { describe, expect, it } from 'vitest';
import {
    buildPlayerProfilePhotoPath,
    buildTeamProfilePhotoPath,
    buildUserProfilePhotoPath
} from '../../js/profile-photo-paths.js';

describe('profile photo Storage paths', () => {
    it('binds own, player, and team uploads to the authenticated primary Storage contract', () => {
        expect(buildUserProfilePhotoPath('user/1', 'My photo.jpg', 123)).toBe(
            'profile-photos/users/user_1/123_profile-photo.jpg'
        );
        expect(buildPlayerProfilePhotoPath('team/1', 'player 7', 'Kid photo.png', 123)).toBe(
            'profile-photos/teams/team_1/players/player_7/123_profile-photo.png'
        );
        expect(buildTeamProfilePhotoPath('team/1', 'Logo.png', 123)).toBe(
            'profile-photos/teams/team_1/team/123_profile-photo.png'
        );
    });

    it('fails closed when a scoped owner id is missing', () => {
        expect(() => buildUserProfilePhotoPath('', 'photo.jpg')).toThrow('User is required');
        expect(() => buildPlayerProfilePhotoPath('team-1', '', 'photo.jpg')).toThrow('Player is required');
        expect(() => buildTeamProfilePhotoPath('', 'photo.jpg')).toThrow('Team is required');
    });

    it('keeps uploader account IDs out of public team and player download paths', () => {
        const playerPath = buildPlayerProfilePhotoPath('team-1', 'player-1', 'private name.jpg', 123);
        const teamPath = buildTeamProfilePhotoPath('team-1', 'private name.jpg', 123);
        expect(playerPath.split('/')).toHaveLength(6);
        expect(teamPath.split('/')).toHaveLength(5);
        expect(playerPath).not.toContain('private');
        expect(teamPath).not.toContain('private');
    });
});
