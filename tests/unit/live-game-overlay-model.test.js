import { describe, expect, it } from 'vitest';
import {
    applyOverlayEvents,
    applyOverlayGame,
    createOverlayDemoFixture,
    createOverlayState,
    filterOverlayReplayStreams,
    formatOverlayChatMessageHtml,
    formatOverlayClock,
    getControllableReplayEmbedUrl,
    getControllableYouTubeEmbedUrl,
    getOverlayEventTone,
    getOverlayLineup,
    getOverlayLiveClockMs,
    getOverlayReplayDurationMs,
    getOverlayReplayStartAt,
    getSafeOverlayProviderUrl,
    parseYouTubeReplayTelemetry,
    reconcileOverlayLiveEvents,
    resolvePublicProjectionVideoOptions,
    replaceOverlayChat
} from '../../js/live-game-overlay-model.js';
import {
    applyResetEventState,
    applyViewerEventToState,
    collectVisibleLiveEventsSequentially
} from '../../js/live-game-state.js';

const stateTools = {
    applyResetEventState,
    applyViewerEventToState,
    collectVisibleLiveEventsSequentially
};

describe('live game overlay model', () => {
    it('formats a bounded broadcast clock', () => {
        expect(formatOverlayClock(0)).toBe('0:00');
        expect(formatOverlayClock(65_999)).toBe('1:05');
        expect(formatOverlayClock(-5_000)).toBe('0:00');
        expect(formatOverlayClock('not-a-clock')).toBe('0:00');
    });

    it('interpolates a running live clock between authoritative snapshots only', () => {
        const base = {
            snapshotClockMs: 690_000,
            snapshotAtMs: 1_000_000,
            nowMs: 1_002_500,
            clockRunning: true
        };

        expect(getOverlayLiveClockMs(base)).toBe(692_500);
        expect(getOverlayLiveClockMs({ ...base, clockRunning: false })).toBe(690_000);
        expect(getOverlayLiveClockMs({ ...base, isReplay: true })).toBe(690_000);
        expect(getOverlayLiveClockMs({ ...base, isCompleted: true })).toBe(690_000);
        expect(getOverlayLiveClockMs({ ...base, nowMs: 999_000 })).toBe(690_000);
        expect(getOverlayLiveClockMs({ ...base, snapshotAtMs: 0 })).toBe(690_000);
    });

    it('exposes only absolute HTTP(S) provider links', () => {
        expect(getSafeOverlayProviderUrl('https://www.youtube.com/watch?v=PK1HyC37doc'))
            .toBe('https://www.youtube.com/watch?v=PK1HyC37doc');
        expect(getSafeOverlayProviderUrl('http://localhost:8000/replay.mp4'))
            .toBe('http://localhost:8000/replay.mp4');
        expect(getSafeOverlayProviderUrl('javascript:alert(1)')).toBeNull();
        expect(getSafeOverlayProviderUrl('data:text/html,unsafe')).toBeNull();
        expect(getSafeOverlayProviderUrl('/relative-replay.mp4')).toBeNull();
        expect(getSafeOverlayProviderUrl('not a url')).toBeNull();
    });

    it('turns only explicitly public projected game video links into playable options', () => {
        expect(resolvePublicProjectionVideoOptions({
            isPublicProjection: true,
            videoUrl: 'https://www.youtube.com/live/PK1HyC37doc?si=share-token'
        })).toMatchObject({
            mode: 'embed',
            sourceUrl: 'https://www.youtube.com/embed/PK1HyC37doc?autoplay=1&mute=1',
            publicUrl: 'https://www.youtube.com/live/PK1HyC37doc?si=share-token',
            publicLabel: 'Watch on YouTube ↗'
        });
        expect(resolvePublicProjectionVideoOptions({
            isPublicProjection: true,
            videoUrl: 'https://twitch.tv/viperslive'
        }, { parentHost: 'allplays.ai' })).toMatchObject({
            mode: 'embed',
            sourceUrl: 'https://player.twitch.tv/?channel=viperslive&parent=allplays.ai&autoplay=true&muted=true',
            publicLabel: 'Watch on Twitch ↗'
        });
        expect(resolvePublicProjectionVideoOptions({
            isPublicProjection: true,
            videoUrl: 'https://www.youtube.com/embed/live_stream?channel=UCa9ghvbup6VQmnDOdqwYpqQ'
        })).toMatchObject({
            mode: 'embed',
            sourceUrl: 'https://www.youtube.com/embed/live_stream?channel=UCa9ghvbup6VQmnDOdqwYpqQ&autoplay=1&mute=1'
        });
        expect(resolvePublicProjectionVideoOptions({
            isPublicProjection: true,
            videoUrl: 'https://twitch.tv/videos/123456789'
        }, { parentHost: 'allplays.ai' })).toMatchObject({
            mode: 'embed',
            sourceUrl: 'https://player.twitch.tv/?video=123456789&parent=allplays.ai&autoplay=true&muted=true'
        });
        expect(resolvePublicProjectionVideoOptions({
            isPublicProjection: true,
            videoUrl: 'https://media.example.test/game.mp4'
        })).toMatchObject({
            mode: 'recorded',
            sourceUrl: 'https://media.example.test/game.mp4'
        });
        expect(resolvePublicProjectionVideoOptions({ videoUrl: 'https://media.example.test/private.mp4' })).toBeNull();
        expect(resolvePublicProjectionVideoOptions({ isPublicProjection: true, videoUrl: 'javascript:alert(1)' })).toBeNull();
        expect(resolvePublicProjectionVideoOptions({ isPublicProjection: true, videoUrl: 'https://youtube.com/not-a-video' })).toBeNull();
    });

    it('formats live and replay chat like the canonical viewer without allowing stored markup', () => {
        const html = formatOverlayChatMessageHtml(
            '*Update* @all plays see https://allplays.ai/game.html and `ready` <img src=x onerror=alert(1)>'
        );

        expect(html).toContain('<strong>Update</strong>');
        expect(html).toContain('<span class="chat-mention">@ALL PLAYS</span>');
        expect(html).toContain('class="chat-link"');
        expect(html).toContain('<code class="chat-code">ready</code>');
        expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
        expect(html).not.toContain('<img');
        expect(formatOverlayChatMessageHtml('javascript:alert(1)')).not.toContain('<a ');
    });

    it('builds a replay duration from plays, saved conversation, reactions, and recorded media', () => {
        expect(getOverlayReplayDurationMs({
            replayEvents: [{ gameClockMs: 90_000 }],
            replayChat: [{ createdAt: 101_000 }],
            replayReactions: [{ createdAt: { toMillis: () => 160_000 } }],
            replayStartAt: 100_000,
            videoDurationMs: 120_000
        })).toBe(120_000);
        expect(getOverlayReplayDurationMs({
            replayEvents: [{ gameClockMs: -1 }],
            replayChat: [{ createdAt: 'invalid' }],
            replayStartAt: 100_000
        })).toBe(0);
    });

    it('anchors replay conversation to the game clock when tracking begins mid-game', () => {
        const replayStartAt = getOverlayReplayStartAt({
            replayEvents: [{
                id: 'resumed-event',
                gameClockMs: 20 * 60 * 1000,
                createdAt: 1_300_000
            }],
            replayChat: [{ id: 'later-chat', createdAt: 1_360_000 }]
        });

        expect(replayStartAt).toBe(100_000);
        expect(getOverlayReplayDurationMs({
            replayEvents: [{ gameClockMs: 20 * 60 * 1000 }],
            replayChat: [{ createdAt: 1_360_000 }],
            replayStartAt
        })).toBe(21 * 60 * 1000);
    });

    it('uses only the latest reset epoch for replay events, conversation, and duration', () => {
        const replayEvents = [
            { id: 'stale-goal', type: 'goal', gameClockMs: 45 * 60 * 1000, createdAt: 100_000 },
            { id: 'old-reset', type: 'reset', gameClockMs: 0, createdAt: 120_000 },
            { id: 'stale-after-old-reset', type: 'goal', gameClockMs: 10 * 60 * 1000, createdAt: 130_000 },
            { id: 'latest-reset', type: 'reset', gameClockMs: 0, createdAt: 200_000 },
            { id: 'fresh-goal', type: 'goal', gameClockMs: 30_000, createdAt: 230_000 }
        ];
        const replayChat = [
            { id: 'stale-chat', createdAt: 150_000 },
            { id: 'fresh-chat', createdAt: 220_000 }
        ];
        const replayReactions = [
            { id: 'stale-reaction', createdAt: 190_000 },
            { id: 'fresh-reaction', createdAt: 225_000 }
        ];
        const latestEpoch = filterOverlayReplayStreams({ replayEvents, replayChat, replayReactions });

        expect(latestEpoch.resetBoundaryMs).toBe(200_000);
        expect(latestEpoch.replayEvents.map((event) => event.id)).toEqual(['latest-reset', 'fresh-goal']);
        expect(latestEpoch.replayChat.map((message) => message.id)).toEqual(['fresh-chat']);
        expect(latestEpoch.replayReactions.map((reaction) => reaction.id)).toEqual(['fresh-reaction']);

        const replayStartAt = getOverlayReplayStartAt({ replayEvents, replayChat, replayReactions });
        expect(replayStartAt).toBe(200_000);
        expect(getOverlayReplayDurationMs({
            replayEvents,
            replayChat,
            replayReactions,
            replayStartAt
        })).toBe(30_000);
    });

    it('enables the YouTube player API for replay without rewriting other providers or invalid URLs', () => {
        const source = getControllableReplayEmbedUrl(
            'https://www.youtube.com/embed/PK1HyC37doc?autoplay=1&mute=1',
            'http://localhost:8000'
        );
        const url = new URL(source);

        expect(url.searchParams.get('autoplay')).toBe('0');
        expect(url.searchParams.get('mute')).toBe('1');
        expect(url.searchParams.get('enablejsapi')).toBe('1');
        expect(url.searchParams.get('playsinline')).toBe('1');
        expect(url.searchParams.get('origin')).toBe('http://localhost:8000');
        expect(getControllableReplayEmbedUrl('https://player.twitch.tv/?channel=vipers', 'http://localhost:8000'))
            .toBe('https://player.twitch.tv/?channel=vipers');
        expect(getControllableReplayEmbedUrl('not a url', 'http://localhost:8000')).toBe('not a url');
        const liveSource = new URL(getControllableYouTubeEmbedUrl(
            'https://www.youtube.com/embed/PK1HyC37doc?autoplay=1&mute=1',
            'http://localhost:8000'
        ));
        expect(liveSource.searchParams.get('autoplay')).toBe('1');
        expect(liveSource.searchParams.get('enablejsapi')).toBe('1');
        expect(liveSource.searchParams.get('origin')).toBe('http://localhost:8000');
    });

    it('accepts bounded YouTube replay telemetry and rejects unrelated player messages', () => {
        expect(parseYouTubeReplayTelemetry(JSON.stringify({
            event: 'infoDelivery',
            info: { currentTime: 32.5, duration: 120, playerState: 2, playbackRate: 1.5 }
        }))).toEqual({
            currentTimeMs: 32_500,
            durationMs: 120_000,
            playerState: 2,
            playbackRate: 1.5
        });
        expect(parseYouTubeReplayTelemetry({ event: 'infoDelivery', info: { currentTime: 0 } })).toEqual({
            currentTimeMs: 0,
            durationMs: null,
            playerState: null,
            playbackRate: null
        });
        expect(parseYouTubeReplayTelemetry('{bad json')).toBeNull();
        expect(parseYouTubeReplayTelemetry({ event: 'onStateChange', info: { currentTime: 12 } })).toBeNull();
        expect(parseYouTubeReplayTelemetry({ event: 'infoDelivery', info: { currentTime: null } })).toBeNull();
        expect(parseYouTubeReplayTelemetry({ event: 'infoDelivery', info: { currentTime: -1 } })).toBeNull();
    });

    it('normalizes game context and applies passive game-document updates', () => {
        const state = createOverlayState({
            team: { name: 'Vipers' },
            game: {
                opponentTeamName: 'Union KC',
                homeScore: 1,
                awayScore: 0,
                period: 'H1',
                liveClockMs: 1_200_000,
                liveStatus: 'live',
                liveLineup: { onCourt: ['p1'], bench: ['p2'] }
            },
            players: [
                { id: 'p1', name: 'Alex', number: 4 },
                { id: 'p2', name: 'Jordan', number: 7 }
            ]
        });

        applyOverlayGame(state, {
            opponent: 'Sporting Blue',
            homeScore: 2,
            awayScore: 1,
            period: 'H2',
            gameClockMs: 350_000,
            liveStatus: 'completed'
        });

        expect(state).toMatchObject({
            homeName: 'Vipers',
            awayName: 'Sporting Blue',
            homeScore: 2,
            awayScore: 1,
            period: 'H2',
            gameClockMs: 350_000,
            liveStatus: 'completed'
        });
        expect(getOverlayLineup(state, 'onCourt').map((player) => player.name)).toEqual(['Alex']);
        expect(getOverlayLineup(state, 'bench').map((player) => player.name)).toEqual(['Jordan']);
    });

    it('preserves lineup positions while optional roster details are unavailable', () => {
        const state = createOverlayState({
            game: { liveLineup: { onCourt: ['missing-1'], bench: ['missing-2'] } }
        });

        expect(getOverlayLineup(state, 'onCourt')).toEqual([expect.objectContaining({
            id: 'missing-1',
            name: 'Player 1',
            position: 'Roster details unavailable'
        })]);
        expect(getOverlayLineup(state, 'bench')).toEqual([expect.objectContaining({
            id: 'missing-2',
            name: 'Player 1',
            position: 'Roster details unavailable'
        })]);
    });

    it('uses the canonical live viewer count and preserves event-authoritative score during document refreshes', () => {
        const state = createOverlayState({
            game: {
                homeScore: 4,
                awayScore: 2,
                liveClockMs: 690_000,
                viewerCount: 3,
                liveViewerCount: 27,
                opponentStats: { away9: { name: 'Riley', goals: 1 } },
                liveResetAt: { toMillis: () => 12_345 }
            }
        });

        applyOverlayGame(state, {
            homeScore: 0,
            awayScore: 0,
            liveClockMs: 0,
            liveViewerCount: 31,
            liveLineup: { onCourt: ['p1'], bench: [] }
        }, { preserveEventState: true });

        expect(state).toMatchObject({
            homeScore: 4,
            awayScore: 2,
            gameClockMs: 690_000,
            viewerCount: 31,
            lastResetAt: 12_345,
            onCourt: [],
            opponentStats: { away9: { name: 'Riley', goals: 1 } }
        });
    });

    it('keeps the event baseline stable when a stale game projection arrives before a correction', () => {
        const state = createOverlayState({
            game: {
                homeScore: 3,
                awayScore: 1,
                period: 'H2',
                liveClockMs: 690_000,
                liveLineup: { onCourt: ['p1'], bench: ['p2'] },
                liveStatus: 'live'
            }
        });
        const goal = {
            id: 'goal-1', type: 'goal', description: 'Current goal',
            homeScore: 4, awayScore: 1, period: 'H2', gameClockMs: 700_000, createdAt: 1_000
        };

        reconcileOverlayLiveEvents(state, [goal], stateTools);
        applyOverlayGame(state, {
            homeScore: 1,
            awayScore: 0,
            period: 'H1',
            liveClockMs: 300_000,
            liveLineup: { onCourt: ['stale'], bench: [] },
            liveViewerCount: 22
        }, { preserveEventState: true });
        reconcileOverlayLiveEvents(state, [{
            id: 'lineup-2', type: 'lineup', onCourt: ['p2'], bench: ['p1'], createdAt: 2_000
        }], stateTools);

        expect(state).toMatchObject({
            homeScore: 3,
            awayScore: 1,
            period: 'H2',
            gameClockMs: 690_000,
            viewerCount: 22,
            onCourt: ['p2'],
            bench: ['p1']
        });
        expect(state.liveBaseline).toMatchObject({
            homeScore: 3,
            awayScore: 1,
            period: 'H2',
            gameClockMs: 690_000
        });
    });

    it('deduplicates event snapshots while applying absolute score and player stats', () => {
        const state = createOverlayState({
            team: { name: 'Vipers' },
            game: { opponent: 'Union KC', liveStatus: 'live' },
            players: [{ id: 'p11', name: 'Bennett Kurtz', number: '11' }]
        });
        const goal = {
            id: 'goal-1',
            type: 'goal',
            description: 'Kurtz scores',
            playerId: 'p11',
            statKey: 'goals',
            value: 1,
            homeScore: 1,
            awayScore: 0,
            period: 'H1',
            gameClockMs: 420_000,
            createdAt: 1000
        };

        applyOverlayEvents(state, [goal]);
        applyOverlayEvents(state, [goal]);

        expect(state.homeScore).toBe(1);
        expect(state.awayScore).toBe(0);
        expect(state.stats.p11.goals).toBe(1);
        expect(state.events).toHaveLength(1);
        expect(state.latestEvent).toMatchObject({ id: 'goal-1', tone: 'home-score', label: 'GOAL' });
    });

    it('keeps provider-side events distinct and resets overlay history safely', () => {
        const state = createOverlayState({ game: {}, events: [{ id: 'old', description: 'Old play', createdAt: 1 }] });
        applyOverlayEvents(state, [{ id: 'reset', type: 'reset', description: 'Game reset', createdAt: 2 }]);
        applyOverlayEvents(state, [{ id: 'away', type: 'goal', isOpponent: true, awayScore: 1, createdAt: 3 }]);

        expect(getOverlayEventTone({ type: 'clock_pause' })).toBe('system');
        expect(getOverlayEventTone({ type: 'undo' })).toBe('system');
        expect(getOverlayEventTone({ type: 'log_remove' })).toBe('system');
        expect(getOverlayEventTone({ type: 'goal', isOpponent: true })).toBe('away-score');
        expect(state.events.map((event) => event.id)).toEqual(['away', 'reset']);
        expect(state.awayScore).toBe(1);
    });

    it('labels point values while preserving neutral system-event presentation', () => {
        const state = createOverlayState({
            game: {},
            events: [
                { id: 'three', type: 'stat', statKey: 'pts', value: 3, homeScore: 3, createdAt: 1 },
                { id: 'undo', type: 'undo', description: 'Undo score', createdAt: 2 }
            ]
        });

        expect(state.events.find((event) => event.id === 'three')).toMatchObject({
            tone: 'home-score',
            label: '+3'
        });
        expect(state.events.find((event) => event.id === 'undo')).toMatchObject({
            tone: 'system',
            label: ''
        });
    });

    it('reconciles the complete ordered tracker snapshot without dropping non-play state events', () => {
        const state = createOverlayState({
            team: { name: 'Vipers' },
            game: {
                opponent: 'Union KC',
                homeScore: 0,
                awayScore: 0,
                period: 'H1',
                liveClockMs: 0,
                liveStatus: 'live',
                liveLineup: { onCourt: ['p1'], bench: ['p2'] }
            },
            players: [
                { id: 'p1', name: 'Alex', number: '4' },
                { id: 'p2', name: 'Jordan', number: '7' }
            ]
        });
        const events = [
            { id: 'lineup', type: 'lineup', onCourt: ['p2'], bench: ['p1'], createdAt: 100 },
            { id: 'start', type: 'clock_start', description: 'Game started', homeScore: 0, awayScore: 0, period: 'H1', gameClockMs: 1_000, createdAt: 200 },
            { id: 'sync', type: 'clock_sync', homeScore: 0, awayScore: 0, period: 'H1', gameClockMs: 5_000, createdAt: 300 },
            { id: 'home-stat', type: 'stat', description: 'Alex scores', playerId: 'p1', playerName: 'Alex', statKey: 'pts', value: 2, homeScore: 2, awayScore: 0, gameClockMs: 6_000, createdAt: 400 },
            { id: 'home-stat-undo', type: 'stat', description: 'Alex score reversed', playerId: 'p1', playerName: 'Alex', statKey: 'pts', value: -1, homeScore: 1, awayScore: 0, gameClockMs: 6_500, createdAt: 450 },
            { id: 'away-stat', type: 'stat', description: 'Away foul', playerId: 'opp1', opponentPlayerName: 'Away Player', statKey: 'fouls', value: 1, isOpponent: true, homeScore: 2, awayScore: 0, gameClockMs: 7_000, createdAt: 500 },
            { id: 'goal', type: 'goal', description: 'Goal', playerId: 'p1', statKey: 'goals', value: 1, homeScore: 3, awayScore: 0, gameClockMs: 8_000, createdAt: 600 },
            { id: 'score-update', type: 'score_update', description: 'Manual score', homeScore: 4, awayScore: 1, gameClockMs: 9_000, createdAt: 700 },
            { id: 'period', type: 'period_change', description: 'Second half', period: 'H2', homeScore: 4, awayScore: 1, gameClockMs: 10_000, createdAt: 800 },
            { id: 'volleyball', type: 'volleyball', description: 'Side out', homeScore: 5, awayScore: 1, gameClockMs: 11_000, createdAt: 900 },
            { id: 'baseball', type: 'baseball', description: 'Run scored', homeScore: 6, awayScore: 1, gameClockMs: 12_000, createdAt: 1_000 },
            { id: 'football-play', type: 'football_play', description: 'Pass complete', homeScore: 6, awayScore: 1, gameClockMs: 13_000, createdAt: 1_100 },
            { id: 'football-score', type: 'football_score', description: 'Touchdown', homeScore: 12, awayScore: 1, gameClockMs: 14_000, createdAt: 1_200 },
            { id: 'note', type: 'note', description: 'Great defensive shape', homeScore: 12, awayScore: 1, gameClockMs: 15_000, createdAt: 1_300 },
            { id: 'substitution', type: 'substitution', description: 'Jordan for Alex', onCourt: ['p2'], bench: ['p1'], homeScore: 12, awayScore: 1, gameClockMs: 16_000, createdAt: 1_400 },
            { id: 'undo', type: 'undo', description: 'Undo score', homeScore: 11, awayScore: 1, gameClockMs: 17_000, createdAt: 1_500 },
            { id: 'log-remove', type: 'log_remove', description: 'Removed play', homeScore: 11, awayScore: 1, gameClockMs: 18_000, createdAt: 1_600 },
            { id: 'pause', type: 'clock_pause', description: 'Game paused', homeScore: 11, awayScore: 1, gameClockMs: 19_000, createdAt: 1_700 }
        ];

        const result = reconcileOverlayLiveEvents(state, [...events].reverse(), stateTools);

        expect(result.processedEventIds).toEqual(events.map((event) => event.id));
        expect(state).toMatchObject({
            homeScore: 11,
            awayScore: 1,
            period: 'H2',
            gameClockMs: 19_000,
            clockRunning: false,
            onCourt: ['p2'],
            bench: ['p1']
        });
        expect(state.stats.p1).toMatchObject({ pts: 1, goals: 1 });
        expect(state.opponentStats.opp1).toMatchObject({ name: 'Away Player', fouls: 1 });
        expect(state.events.map((event) => event.id)).toEqual([
            'pause', 'log-remove', 'undo', 'substitution', 'note', 'football-score', 'football-play',
            'baseball', 'volleyball', 'period', 'score-update', 'goal', 'away-stat', 'home-stat-undo', 'home-stat', 'start'
        ]);
        expect(state.eventIds.size).toBe(events.length);
    });

    it('rebuilds opponent stat keys from live events while preserving baseline-only stats', () => {
        const state = createOverlayState({
            game: {
                homeScore: 2,
                awayScore: 1,
                liveStatus: 'live',
                opponentStats: {
                    away8: {
                        name: 'Jordan Vale',
                        number: '8',
                        goals: 1,
                        shots: 0,
                        assists: 2
                    }
                }
            }
        });
        const historicalGoal = {
            id: 'away-goal', type: 'goal', description: 'Jordan scores',
            playerId: 'away8', opponentPlayerName: 'Jordan Vale', opponentPlayerNumber: '8',
            statKey: 'goals', value: 1, isOpponent: true,
            homeScore: 2, awayScore: 1, createdAt: 1_000
        };
        const liveShot = {
            id: 'away-shot', type: 'stat', description: 'Jordan shoots',
            playerId: 'away8', opponentPlayerName: 'Jordan Vale', opponentPlayerNumber: '8',
            statKey: 'shots', value: 1, isOpponent: true,
            homeScore: 2, awayScore: 1, createdAt: 2_000
        };

        reconcileOverlayLiveEvents(state, [historicalGoal, liveShot], stateTools);

        expect(state.opponentStats.away8).toMatchObject({
            name: 'Jordan Vale',
            number: '8',
            goals: 1,
            shots: 1,
            assists: 2
        });

        reconcileOverlayLiveEvents(state, [historicalGoal, liveShot, {
            ...liveShot,
            id: 'away-shot-undo',
            description: 'Jordan shot reversed',
            value: -1,
            createdAt: 3_000
        }], stateTools);

        expect(state.opponentStats.away8).toMatchObject({ goals: 1, shots: 0, assists: 2 });
    });

    it('keeps an unrecognized future play event visible while applying its common state fields', () => {
        const state = createOverlayState({ game: { homeScore: 0, awayScore: 0, liveStatus: 'live' } });

        reconcileOverlayLiveEvents(state, [{
            id: 'future-event', type: 'timeout_awarded', description: 'Timeout awarded',
            homeScore: 2, awayScore: 1, period: 'Q3', gameClockMs: 42_000, createdAt: 1_000
        }], stateTools);

        expect(state).toMatchObject({ homeScore: 2, awayScore: 1, period: 'Q3', gameClockMs: 42_000 });
        expect(state.events.map((event) => event.id)).toEqual(['future-event']);
    });

    it('rebuilds from the complete snapshot so a late offline event cannot regress current state', () => {
        const state = createOverlayState({
            game: { homeScore: 0, awayScore: 0, liveStatus: 'live' }
        });
        const current = {
            id: 'current', type: 'score_update', description: 'Current score',
            homeScore: 2, awayScore: 0, gameClockMs: 20_000, createdAt: 2_000
        };
        reconcileOverlayLiveEvents(state, [current], stateTools);

        const lateOffline = {
            id: 'late-offline', type: 'score_update', description: 'Queued earlier score',
            homeScore: 1, awayScore: 0, gameClockMs: 10_000,
            clientCreatedAt: new Date(1_000).toISOString(), createdAt: 3_000
        };
        reconcileOverlayLiveEvents(state, [current, lateOffline], stateTools);

        expect(state.homeScore).toBe(2);
        expect(state.gameClockMs).toBe(20_000);
        expect(state.latestEvent.id).toBe('current');
        expect(state.events.map((event) => event.id)).toEqual(['current', 'late-offline']);
    });

    it('replays reset boundaries deterministically after reconnect and ignores duplicate ids', () => {
        const state = createOverlayState({
            game: { homeScore: 8, awayScore: 4, liveStatus: 'live' },
            players: [{ id: 'p1', name: 'Alex' }]
        });
        const duplicateGoal = {
            id: 'fresh-goal', type: 'goal', description: 'Fresh goal', playerId: 'p1', statKey: 'goals',
            value: 1, homeScore: 1, awayScore: 0, gameClockMs: 5_000, createdAt: 3_000
        };

        reconcileOverlayLiveEvents(state, [
            { id: 'stale-goal', type: 'goal', description: 'Stale goal', playerId: 'p1', statKey: 'goals', value: 1, homeScore: 8, awayScore: 4, createdAt: 1_000 },
            { id: 'reset', type: 'reset', description: 'Reset', homeScore: 0, awayScore: 0, gameClockMs: 0, createdAt: 2_000 },
            duplicateGoal,
            { ...duplicateGoal }
        ], stateTools);

        expect(state.homeScore).toBe(1);
        expect(state.awayScore).toBe(0);
        expect(state.stats.p1.goals).toBe(1);
        expect(state.events.map((event) => event.id)).toEqual(['fresh-goal']);
        expect(Array.from(state.eventIds)).toEqual(['stale-goal', 'reset', 'fresh-goal']);

        reconcileOverlayLiveEvents(state, [{
            id: 'delayed-stale', type: 'score_update', description: 'Pre-reset delayed event',
            homeScore: 7, awayScore: 4, gameClockMs: 15_000,
            clientCreatedAt: new Date(1_500).toISOString(), createdAt: 4_000
        }], stateTools);
        expect(state.homeScore).toBe(1);
        expect(state.awayScore).toBe(0);
        expect(state.gameClockMs).toBe(5_000);
        expect(state.events.map((event) => event.id)).toEqual([]);
    });

    it('sorts replacement chat and supplies a realistic local fixture', () => {
        const state = createOverlayState();
        replaceOverlayChat(state, [
            { id: 'older', senderName: 'One', text: 'Earlier', createdAt: 10 },
            { id: 'newer', senderName: 'ALL PLAYS', text: 'Latest', createdAt: 20 }
        ]);
        const fixture = createOverlayDemoFixture(100_000);

        expect(state.chatMessages.map((message) => message.id)).toEqual(['newer', 'older']);
        expect(state.chatMessages[0].ai).toBe(false);
        replaceOverlayChat(state, [{ id: 'trusted-fixture', senderName: 'ALL PLAYS', text: 'Fixture', ai: true }]);
        expect(state.chatMessages[0].ai).toBe(false);
        expect(fixture.game.liveStatus).toBe('live');
        expect(fixture.events.length).toBeGreaterThanOrEqual(4);
        expect(fixture.players.length).toBeGreaterThanOrEqual(6);
    });
});
