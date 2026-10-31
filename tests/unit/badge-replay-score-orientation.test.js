import { describe, expect, it } from 'vitest';
import { normalizeLiveEventScores } from '../../js/live-event-score-orientation.js';
import { applyViewerEventToState, applyResetEventState, collectVisibleLiveEventsSequentially } from '../../js/live-game-state.js';
import { createOverlayState, applyOverlayEvents, reconcileOverlayLiveEvents } from '../../js/live-game-overlay-model.js';
import { buildReplaySessionState } from '../../js/live-game-replay.js';

const game = { isHome: false, scoreOrientation: 'venue', liveStatus: 'completed', homeScore: 5, awayScore: 11 };
const events = [
    { id: 'old-legacy', type: 'clock_sync', homeScore: 7, awayScore: 3, gameClockMs: 1000, createdAt: 1000 },
    { id: 'badge', type: 'clock_sync', source: 'badge-score-controller', homeScore: 4, awayScore: 9, gameClockMs: 2000, createdAt: 2000 },
    { id: 'new-legacy', type: 'clock_sync', scoreOrientation: 'venue', homeScore: 4, awayScore: 11, gameClockMs: 3000, createdAt: 3000 },
    { id: 'app-live-history', type: 'score_update', homeScore: 5, awayScore: 11, gameClockMs: 4000, createdAt: 4000 }
];
const expected = [[3, 7], [4, 9], [4, 11], [5, 11]];
const tools = { applyViewerEventToState, applyResetEventState, collectVisibleLiveEventsSequentially };

describe('away-game replay across badge handoff', () => {
    it('keeps old legacy, badge, marked legacy and historical app scores on the same venue sides', () => {
        const replay = buildReplaySessionState({ game, replayEvents: events });
        let viewer = { game, ...replay.scoreboard };
        const overlay = createOverlayState({ team: { name: 'Tigers' }, game });
        replay.replayEvents.forEach((event, index) => {
            viewer = applyViewerEventToState(viewer, event).state;
            applyOverlayEvents(overlay, [event]);
            expect([viewer.homeScore, viewer.awayScore]).toEqual(expected[index]);
            expect([overlay.homeScore, overlay.awayScore]).toEqual(expected[index]);
            const rebuilt = createOverlayState({ game });
            reconcileOverlayLiveEvents(rebuilt, events.slice(0, index + 1), tools);
            expect([rebuilt.homeScore, rebuilt.awayScore]).toEqual(expected[index]);
        });
    });
    it('is idempotent and preserves absent score fields', () => {
        const event = { homeScore: 7, type: 'clock_sync' };
        const normalized = normalizeLiveEventScores(game, event);
        expect(normalized).toEqual({ awayScore: 7, type: 'clock_sync', scoreOrientation: 'venue' });
        expect(normalizeLiveEventScores(game, normalized)).toEqual(normalized);
        expect(normalizeLiveEventScores(game, { type: 'lineup' })).not.toHaveProperty('homeScore');
    });
    it('preserves historical team-oriented labels and honors explicit orientation over writer IDs', () => {
        const legacyGame = { isHome: false, liveHasData: true };
        expect(normalizeLiveEventScores(legacyGame, events[0])).toMatchObject({ homeScore: 7, awayScore: 3 });
        expect(normalizeLiveEventScores(legacyGame, events[1])).toMatchObject({ homeScore: 9, awayScore: 4, scoreOrientation: 'team-opponent' });
        expect(normalizeLiveEventScores(game, { ...events[3], scoreOrientation: 'team-opponent' })).toMatchObject({ homeScore: 11, awayScore: 5 });
        expect(normalizeLiveEventScores({ isHome: true }, events[0])).toBe(events[0]);
        expect(normalizeLiveEventScores({ ...game, trackingEngine: 'diamond-v2' }, events[0])).toBe(events[0]);
    });
});
