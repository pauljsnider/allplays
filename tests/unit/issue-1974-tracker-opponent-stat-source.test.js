import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const liveTrackerSource = readFileSync(new URL('../../js/live-tracker.js', import.meta.url), 'utf8');
const finishSource = readFileSync(new URL('../../js/live-tracker-finish.js', import.meta.url), 'utf8');
const saveCompleteSource = readFileSync(new URL('../../js/live-tracker-save-complete.js', import.meta.url), 'utf8');
const statsheetApplySource = readFileSync(new URL('../../js/track-statsheet-apply.js', import.meta.url), 'utf8');
const opponentStatsTestSource = readFileSync(new URL('./live-tracker-opponent-stats.test.js', import.meta.url), 'utf8');
const finishTestSource = readFileSync(new URL('./live-tracker-finish.test.js', import.meta.url), 'utf8');
const capabilitiesTestSource = readFileSync(new URL('./app-auth-profile-capabilities.test.js', import.meta.url), 'utf8');

describe('issue 1974 tracker opponent stat source contract', () => {
    it('keeps live opponent stat entry syncing to game opponentStats', () => {
        expect(liveTrackerSource).toContain('function scheduleOpponentStatsSync()');
        expect(liveTrackerSource).toContain('const opponentStats = buildOpponentStatsSnapshot();');
        expect(liveTrackerSource).toContain('await updateGame(currentTeamId, currentGameId, { opponentStats });');
        expect(liveTrackerSource).toContain("els.oppCards.querySelectorAll('[data-opp-stat]')");
        expect(liveTrackerSource).toContain('addOppStat(opp, stat, Number(delta));');
        expect(liveTrackerSource).toContain('scheduleOpponentStatsSync();');
    });

    it('keeps opponent stat events and removal cleanup preserving score integrity', () => {
        expect(liveTrackerSource).toContain('function removeOpponentEntry(opponentId)');
        expect(liveTrackerSource).toContain('state.away = safeDecrement(state.away, getOpponentRecordedPoints(opp));');
        expect(liveTrackerSource).toContain('state.log = state.log.filter(entry => entry?.undoData?.playerId !== opponentId || !entry.undoData?.isOpponent);');
        expect(liveTrackerSource).toContain('function buildStatEvent(undoData, description)');
        expect(liveTrackerSource).toContain('opponentPlayerName: opponent?.name || null');
        expect(liveTrackerSource).toContain("opponentPlayerNumber: opponent?.number || ''");
    });

    it('keeps finalization and statsheet import persisting opponent snapshots', () => {
        expect(finishSource).toContain('export function buildOpponentStatsSnapshotFromEntries({ opponentEntries = [], columns = [] } = {})');
        expect(finishSource).toContain('opponentStats[opp.id] = {');
        expect(finishSource).toContain('opponentStats[opp.id].fouls = opp.stats?.fouls || 0;');
        expect(finishSource).toContain('opponentStats: buildOpponentStatsSnapshotFromEntries({');
        expect(saveCompleteSource).toContain('opponentEntries: state.opp,');
        expect(statsheetApplySource).toContain('const opponentId = `statsheet_${index + 1}`;');
        expect(statsheetApplySource).toContain('opponentStats[opponentId] = {');
    });

    it('keeps regression coverage for opponent stats hydration and final report persistence', () => {
        expect(opponentStatsTestSource).toContain('preserves linked opponent roster additions so resume restores selected players');
        expect(opponentStatsTestSource).toContain('preserves persisted fouls when resuming opponent stats');
        expect(opponentStatsTestSource).toContain('reverses removed opponent scoring');
        expect(finishTestSource).toContain('opponentEntries: [');
        expect(finishTestSource).toContain('opponentStats: {');
        expect(capabilitiesTestSource).toContain('OpponentStatsSection');
    });
});
