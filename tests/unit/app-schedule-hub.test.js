import { describe, expect, it } from 'vitest';
import {
    buildGameHubDestinations,
    buildPracticeHubDestinations,
    getPracticeShareText,
    getPublicGameReportHref,
    getPublicLiveHref,
    getPublicPlayerHref,
    getPublicPracticeHref,
    getPublicReplayHref,
    getPublicTeamHref
} from '../../apps/app/src/lib/scheduleHub';

function event(overrides = {}) {
    return {
        eventKey: overrides.eventKey || `${overrides.teamId || 'team-1'}::${overrides.id || 'game-1'}::${overrides.childId || 'player-1'}`,
        id: overrides.id || 'game-1',
        teamId: overrides.teamId || 'team-1',
        teamName: overrides.teamName || 'Bears',
        type: overrides.type || 'game',
        date: overrides.date || new Date('2026-05-21T18:00:00Z'),
        location: overrides.location || 'Main Gym',
        opponent: overrides.opponent || 'Falcons',
        title: overrides.title || null,
        childId: overrides.childId || 'player-1',
        childName: overrides.childName || 'Pat',
        isDbGame: overrides.isDbGame !== false,
        isCancelled: overrides.isCancelled === true,
        assignments: overrides.assignments || [],
        ...overrides
    };
}

describe('React app schedule More tab hub helpers', () => {
    it('builds completed game destinations for replay and match report sharing', () => {
        const game = event({ liveStatus: 'completed', homeScore: 4, awayScore: 2 });
        const destinations = buildGameHubDestinations(game);

        expect(destinations.map((destination) => destination.id)).toEqual(['watch-replay', 'match-report']);
        expect(destinations[0]).toMatchObject({
            title: 'Watch replay',
            icon: 'video',
            badge: 'Replay',
            actionLabel: 'Watch replay',
            shareLabel: 'Replay',
            url: 'https://allplays.ai/live-game.html?teamId=team-1&gameId=game-1&replay=true'
        });
        expect(destinations[0].shareText).toContain('Bears vs. Falcons replay');
        expect(destinations[1]).toMatchObject({
            title: 'Match report',
            icon: 'file-text',
            actionLabel: 'Open report',
            shareLabel: 'Match report',
            url: 'https://allplays.ai/game.html#teamId=team-1&gameId=game-1'
        });
        expect(destinations[1].shareText).toContain('Bears vs. Falcons match report');
    });

    it('switches the first game destination to live viewing while a game is live', () => {
        const destinations = buildGameHubDestinations(event({ liveStatus: 'live' }));

        expect(destinations.map((destination) => destination.id)).toEqual(['watch-live', 'match-report']);
        expect(destinations[0]).toMatchObject({
            title: 'Watch live',
            icon: 'radio',
            badge: 'Live',
            url: 'https://allplays.ai/live-game.html?teamId=team-1&gameId=game-1'
        });
        expect(destinations[0].url).not.toContain('replay=true');
    });

    it('keeps scheduled games focused on the match report destination', () => {
        const destinations = buildGameHubDestinations(event({ liveStatus: 'scheduled' }));

        expect(destinations).toHaveLength(1);
        expect(destinations[0]).toMatchObject({
            id: 'match-report',
            url: 'https://allplays.ai/game.html#teamId=team-1&gameId=game-1'
        });
    });

    it('puts a text-only practice share card first before packet and team actions', () => {
        const practice = event({
            id: 'practice-1',
            type: 'practice',
            title: 'Practice',
            opponent: null,
            location: 'North Field',
            arrivalTime: new Date('2026-05-21T17:30:00Z'),
            practiceHomePacketSummary: '2 drills · 20 min',
            notes: 'Bring water'
        });
        const destinations = buildPracticeHubDestinations(practice);

        expect(destinations.map((destination) => destination.id)).toEqual(['practice-share', 'practice-team']);
        expect(destinations[0]).toMatchObject({
            title: 'Share practice',
            icon: 'share',
            actionKind: 'share',
            shareLabel: 'Practice',
            shareUrl: null,
            hideShareButton: true
        });
        expect(destinations[0].url).toBeUndefined();
        expect(destinations[0].shareText).toContain('Bears Practice');
        expect(destinations[0].shareText).toContain('North Field');
        expect(destinations[0].shareText).toContain('Packet: 2 drills · 20 min');
        expect(destinations[0].shareText).toContain('Bring water');
        expect(destinations[0].shareText).not.toContain('allplays.ai');
        expect(destinations[1]).toMatchObject({
            id: 'practice-team',
            actionLabel: 'Open team',
            url: 'https://allplays.ai/team.html#teamId=team-1',
            shareUrl: null,
            hideShareButton: true
        });
    });

    it('formats practice share details without a public URL', () => {
        const text = getPracticeShareText(event({
            type: 'practice',
            title: 'Keeper Training',
            location: '',
            practiceHomePacketSummary: 'Footwork',
            notes: 'Cleats only'
        }));

        expect(text).toContain('Bears Keeper Training');
        expect(text).toContain('Location TBD');
        expect(text).toContain('Packet: Footwork');
        expect(text).toContain('Cleats only');
        expect(text).not.toContain('https://');
    });

    it('generates the public destinations used by the More tab', () => {
        const game = event();
        const practice = event({ id: 'practice-1', type: 'practice' });

        expect(getPublicGameReportHref(game)).toBe('https://allplays.ai/game.html#teamId=team-1&gameId=game-1');
        expect(getPublicLiveHref(game)).toBe('https://allplays.ai/live-game.html?teamId=team-1&gameId=game-1');
        expect(getPublicReplayHref(game)).toBe('https://allplays.ai/live-game.html?teamId=team-1&gameId=game-1&replay=true');
        expect(getPublicPlayerHref('team-1', 'game-1', 'player-1')).toBe('https://allplays.ai/player.html#teamId=team-1&gameId=game-1&playerId=player-1');
        expect(getPublicTeamHref(practice)).toBe('https://allplays.ai/team.html#teamId=team-1');
        expect(getPublicPracticeHref(practice)).toBe('https://allplays.ai/drills.html?teamId=team-1&eventId=practice-1');
    });
});
