import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
    buildPublicGamesIcs,
    canExposeEmptyPublicFeed,
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

    it('keeps active public teams subscribable before games are added', () => {
        const ics = buildPublicGamesIcs({
            teamId: 'team-1',
            team: { name: 'Wildcats', isPublic: true, active: true },
            now: new Date('2026-05-09T01:18:00Z'),
            games: []
        });

        expect(canExposeEmptyPublicFeed({ isPublic: true, active: true })).toBe(true);
        expect(canExposeEmptyPublicFeed({ isPublic: true, active: false })).toBe(false);
        expect(canExposeEmptyPublicFeed({ isPublic: false, active: true })).toBe(false);
        expect(ics).toContain('BEGIN:VCALENDAR');
        expect(ics).toContain('END:VCALENDAR');
        expect(ics).not.toContain('BEGIN:VEVENT');
    });

    it('runs the public feed function with the configured calendar runtime', () => {
        const source = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');
        const feedStart = source.indexOf('exports.publicTeamGamesIcs = functions');
        const feedEnd = source.indexOf('async function getCalendarTokenSnapshot', feedStart);
        const publicFeedSource = source.slice(feedStart, feedEnd);

        expect(source).toContain('exports.publicTeamGamesIcs = functions\n  .runWith(fetchCalendarRuntime)');
        expect(publicFeedSource).toContain('getCalendarFeedGamesQuery(teamId).get()');
        expect(publicFeedSource).toContain('games.filter((game) => isPublicFanGame(team, game))');
        expect(publicFeedSource).toContain('buildPublicGamesIcs({ teamId, team, games: publicGames })');
        expect(publicFeedSource).toContain('!canExposeEmptyPublicFeed(team)');
        expect(publicFeedSource).not.toContain("firestore.collection(`teams/${teamId}/games`).get()");
    });

    it('uses stable public game UIDs', () => {
        const game = { id: 'game-123', date: '2026-06-01T18:00:00Z', opponent: 'Tigers' };

        expect(stablePublicGameUid('team-1', game)).toBe(stablePublicGameUid('team-1', game));
        expect(stablePublicGameUid('team-1', game)).toBe('game-123-team-1@allplays-public-games');
    });
});
