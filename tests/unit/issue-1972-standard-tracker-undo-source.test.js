import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const liveTrackerSource = readFileSync(new URL('../../js/live-tracker.js', import.meta.url), 'utf8');
const integritySource = readFileSync(new URL('../../js/live-tracker-integrity.js', import.meta.url), 'utf8');
const undoSyncTestSource = readFileSync(new URL('./live-tracker-undo-sync.test.js', import.meta.url), 'utf8');
const liveEventsTestSource = readFileSync(new URL('./track-live-live-events.test.js', import.meta.url), 'utf8');
const integrityTestSource = readFileSync(new URL('./live-tracker-integrity.test.js', import.meta.url), 'utf8');

describe('issue 1972 standard tracker undo source contract', () => {
    it('keeps the standard tracker undo action wired to stat reversal and empty-state feedback', () => {
        expect(liveTrackerSource).toContain('function undo()');
        expect(liveTrackerSource).toContain("addLog('Nothing to undo');");
        expect(liveTrackerSource).toContain("lastLog?.undoData?.type === 'stat'");
        expect(liveTrackerSource).toContain('const prev = state.history.pop();');
        expect(liveTrackerSource).toContain('state.home = prev.home;');
        expect(liveTrackerSource).toContain('state.away = prev.away;');
        expect(liveTrackerSource).toContain('subs: [...state.subs],');
        expect(liveTrackerSource).toContain('state.subs = Array.isArray(prev.subs) ? prev.subs : [];');
        expect(liveTrackerSource).toContain('state.scoreLogIsComplete = prev.scoreLogIsComplete !== false;');
    });

    it('keeps undo resyncing aggregate stats and live game state after stat reversal', () => {
        expect(liveTrackerSource).toContain('schedulePlayerStatsSync(lastLog.undoData.playerId);');
        expect(liveTrackerSource).toContain('scheduleOpponentStatsSync();');
        expect(liveTrackerSource).toContain('scheduleLiveHasData();');
        expect(undoSyncTestSource).toContain('resyncs reverted player and opponent aggregated stats after undo');
    });

    it('keeps reverse live events published for undone or corrected stat entries', () => {
        expect(liveTrackerSource).toContain('description: undoText');
        expect(liveTrackerSource).toContain('value: -(lastLog.undoData.value || 0)');
        expect(liveTrackerSource).toContain('function buildStatEvent(undoData, description)');
        expect(liveEventsTestSource).toContain('publishes reverse stat events when stats are undone or corrected');
        expect(liveEventsTestSource).toContain("type: 'undo'");
    });

    it('keeps score reconciliation helpers treating undo reversals as signed score events', () => {
        expect(integritySource).toContain('export function deriveScoreFromLog(log = [])');
        expect(integritySource).toContain('const value = Number(undoData.value) || 0;');
        expect(integritySource).toContain('if (undoData.isOpponent) {');
        expect(integritySource).toContain('export function reconcileFinalScoreFromLog');
        expect(integrityTestSource).toContain('reconciles final score to event-derived score when mismatched');
        expect(integrityTestSource).toContain('trusts score log when derived totals match live score and contains scoring events');
    });
});
