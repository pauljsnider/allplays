import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
    buildPublicGamesIcs,
    isPublicFanGame,
    stablePublicGameUid
} = require('../../functions/public-calendar-core.cjs');

describe('public games calendar feed helpers', () => {
    it('includes only public games and excludes practices, private events, and member-only fields', () => {
        const team = { name: 'Wildcats', isPublic: true };
        const ics = buildPublicGamesIcs({
            teamId: 'team-1',
            team,
            now: new Date('2026-05-09T01:18:00Z'),
            games: [
                {
                    id: 'game-1',
                    type: 'game',
                    date: '2026-06-01T18:00:00Z',
                    opponent: 'Tigers',
                    location: 'Main Gym, Court 1',
                    notes: 'Member-only scouting note',
                    assignments: [{ role: 'Book', value: 'Sam' }],
                    rsvpSummary: { going: 8 }
                },
                {
                    id: 'practice-1',
                    type: 'practice',
                    date: '2026-06-02T18:00:00Z',
                    opponent: 'Practice Squad'
                },
                {
                    id: 'private-1',
                    type: 'game',
                    visibility: 'private',
                    date: '2026-06-03T18:00:00Z',
                    opponent: 'Secret Opponent'
                }
            ]
        });

        expect(ics).toContain('BEGIN:VCALENDAR');
        expect(ics).toContain('BEGIN:VEVENT');
        expect(ics).toContain('UID:game-1-team-1@allplays-public-games');
        expect(ics).toContain('SUMMARY:Wildcats vs Tigers');
        expect(ics).toContain('LOCATION:Main Gym\\, Court 1');
        expect(ics).not.toContain('Practice Squad');
        expect(ics).not.toContain('Secret Opponent');
        expect(ics).not.toContain('Member-only scouting note');
        expect(ics).not.toContain('Book');
        expect(ics).not.toContain('rsvp');
    });

    it('allows explicitly shareable games for private teams without allowing private games', () => {
        const privateTeam = { name: 'Wildcats', isPublic: false };

        expect(isPublicFanGame(privateTeam, {
            id: 'game-1',
            type: 'game',
            visibility: 'public',
            date: '2026-06-01T18:00:00Z'
        })).toBe(true);

        expect(isPublicFanGame(privateTeam, {
            id: 'game-2',
            type: 'game',
            date: '2026-06-01T18:00:00Z'
        })).toBe(false);
    });

    it('uses stable public game UIDs', () => {
        const game = { id: 'game-123', date: '2026-06-01T18:00:00Z', opponent: 'Tigers' };

        expect(stablePublicGameUid('team-1', game)).toBe(stablePublicGameUid('team-1', game));
        expect(stablePublicGameUid('team-1', game)).toBe('game-123-team-1@allplays-public-games');
    });
});
