import { describe, expect, it } from 'vitest';
import {
    buildPlayerProfilePhotoPath,
    buildTeamDraftProfilePhotoPath,
    buildTeamProfilePhotoPath,
    buildUserProfilePhotoPath
} from '../../js/profile-photo-paths.js';

describe('profile photo Storage paths', () => {
    it('binds own, player, team, and team-draft uploads to the authenticated primary Storage contract', () => {
        expect(buildUserProfilePhotoPath('user/1', 'My photo.jpg', 123)).toBe(
            'profile-photos/users/user_1/123_My_photo.jpg'
        );
        expect(buildPlayerProfilePhotoPath('team/1', 'player 7', 'user/1', 'Kid photo.png', 123)).toBe(
            'profile-photos/teams/team_1/players/player_7/user_1/123_Kid_photo.png'
        );
        expect(buildTeamProfilePhotoPath('team/1', 'user/1', 'Logo.png', 123)).toBe(
            'profile-photos/teams/team_1/team/user_1/123_Logo.png'
        );
        expect(buildTeamDraftProfilePhotoPath('user/1', 'Logo.png', 123)).toBe(
            'profile-photos/team-drafts/user_1/123_Logo.png'
        );
    });

    it('fails closed when a scoped owner id is missing', () => {
        expect(() => buildUserProfilePhotoPath('', 'photo.jpg')).toThrow('User is required');
        expect(() => buildPlayerProfilePhotoPath('team-1', '', 'user-1', 'photo.jpg')).toThrow('Player is required');
        expect(() => buildTeamProfilePhotoPath('', 'user-1', 'photo.jpg')).toThrow('Team is required');
    });
});
