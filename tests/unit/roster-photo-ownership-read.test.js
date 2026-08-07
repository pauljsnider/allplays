import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const dbSource = readFileSync(new URL('../../js/db.js', import.meta.url), 'utf8');
const rosterSource = readFileSync(new URL('../../edit-roster.html', import.meta.url), 'utf8');

function buildPrivateRosterLoader({ players, getPlayerPrivateProfile }) {
    const start = dbSource.indexOf('export async function getPlayersWithPrivateRosterContacts');
    const end = dbSource.indexOf('function playerHasRosterContactFields', start);
    const source = dbSource
        .slice(start, end)
        .replace('export async function getPlayersWithPrivateRosterContacts', 'return async function getPlayersWithPrivateRosterContacts');
    return new Function('getPlayers', 'getPlayerPrivateProfile', source)(
        vi.fn(async () => players),
        getPlayerPrivateProfile
    );
}

describe('legacy roster photo ownership reads', () => {
    it('marks an authoritative private read as loaded and preserves its cleanup path', async () => {
        const loader = buildPrivateRosterLoader({
            players: [{ id: 'player-1', photoUrl: 'https://img.example/player.png' }],
            getPlayerPrivateProfile: vi.fn(async () => ({ photoPath: 'profile-photos/teams/team-1/players/player-1/photo.png' }))
        });

        await expect(loader('team-1')).resolves.toEqual([expect.objectContaining({
            id: 'player-1',
            photoOwnershipLoaded: true,
            photoPath: 'profile-photos/teams/team-1/players/player-1/photo.png'
        })]);
    });

    it('marks permission-denied ownership as unknown instead of an empty path', async () => {
        const error = Object.assign(new Error('denied'), { code: 'permission-denied' });
        const loader = buildPrivateRosterLoader({
            players: [{ id: 'player-1', photoUrl: 'https://img.example/player.png' }],
            getPlayerPrivateProfile: vi.fn(async () => { throw error; })
        });

        const [player] = await loader('team-1');
        expect(player).toMatchObject({ id: 'player-1', photoOwnershipLoaded: false });
        expect(player).not.toHaveProperty('photoPath');
    });

    it('disables roster photo changes and omits image fields from unknown text-only saves', () => {
        expect(rosterSource).toContain('editingPhotoOwnershipLoaded = player.photoOwnershipLoaded !== false;');
        expect(rosterSource).toContain("document.getElementById('playerPhoto').disabled = !editingPhotoOwnershipLoaded;");
        expect(rosterSource).toContain("document.getElementById('removePhoto').disabled = !editingPhotoOwnershipLoaded;");
        expect(rosterSource).toContain('if ((selectedPhotoFile || removePhoto) && !photoOwnershipLoaded)');
        expect(rosterSource).toMatch(/const playerData = \{[\s\S]*?profile: publicProfile[\s\S]*?\};[\s\S]*?if \(photoOwnershipLoaded\) \{[\s\S]*?playerData\.photoUrl = photoUrl;[\s\S]*?playerData\.photoPath = nextPhotoPath \|\| null;/);
    });
});
