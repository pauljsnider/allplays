import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readTrackLive() {
  return readFileSync(new URL('../../track-live.html', import.meta.url), 'utf8');
}

describe('track-live live event publishing', () => {
  it('publishes reverse stat events when stats are undone or corrected', () => {
    const source = readTrackLive();

    expect(source).toContain("type: 'undo'");
    expect(source).toContain("type: 'stat'");
    expect(source).toContain('let appliedDelta = 0;');
    expect(source).toContain('value: -appliedDelta');
    expect(source).toContain('value: -value');
    expect(source).toContain('description: `Undo stat: ${entry.text}`');
    expect(source).toContain('description: `Corrected stat: ${statKey.toUpperCase()} adjusted`');
  });

  it('only emits note undo events when the original note was published live', () => {
    const source = readTrackLive();

    expect(source).toContain('const liveNote = addLiveNoteRecord(clean, type);');
    expect(source).toContain('const noteWasPublished = gameState.isRunning;');
    expect(source).toContain('wasPublished: noteWasPublished');
    expect(source).toContain('if (noteWasPublished) {');
    expect(source).toContain("type: 'note'");
    expect(source).toContain('liveNoteId: liveNote?.id || null');
    expect(source).toContain("} else if (undoData && undoData.type === 'note') {");
    expect(source).toContain('removeLiveNoteRecord(undoData.liveNoteId, undoData.liveNoteText || undoData.note);');
    expect(source).toContain('scheduleLiveHasData();');
    expect(source).toContain('if (undoData.wasPublished) {');
    expect(source).toContain('description: `Undo: ${entry.text}`');
    expect(source).toContain("removedNote: undoData.liveNoteText || undoData.note || ''");
  });

  it('wires bounded goal-sport controls into track-live', () => {
    const source = readTrackLive();

    expect(source).toContain('id="goal-sport-controls"');
    expect(source).toContain('id="goal-scorer-input"');
    expect(source).toContain('id="goal-note-input"');
    expect(source).toContain('id="live-notes-list"');
    expect(source).toContain('resolveGoalSportTrackerProfile');
    expect(source).toContain("from './js/live-game-state.js?v=7'");
    expect(source).toContain("from './js/live-tracker-notes.js?v=3'");
    expect(source).toContain('buildGoalSportNoteText');
    expect(source).toContain('removeGameSummaryLine');
    expect(source).toContain('const { teamId, gameId, trackerMode } = getUrlParams();');
    expect(source).toContain('trackerMode,');
    expect(source).toContain('game: currentGame,');
    expect(source).toContain('team: currentTeam,');
    expect(source).toContain('config: currentConfig');
    expect(source).toContain("recordGoalSportGoal('home')");
    expect(source).toContain("recordGoalSportGoal('away')");
    expect(source).toContain("type: 'goal'");
    expect(source).toContain('statKey: event.statKey');
    expect(source).toContain('isOpponent: event.isOpponent');
    expect(source).toContain('buildGoalSportEvent({');
    expect(source).toContain("const liveNote = addLiveNoteRecord(buildGoalSportNoteText(noteTeamLabel, event.note), 'goal');");
    expect(source).toContain('liveNoteId: liveNote?.id || null');
    expect(source).toContain('liveNoteText: liveNote?.text || null');
    expect(source).toContain('removeLiveNoteRecord(undoData.liveNoteId, undoData.liveNoteText);');
    expect(source).toContain('function renderLiveNotes()');
  });

  it('includes bounded football play logging with down-distance context', () => {
    const source = readTrackLive();

    expect(source).toContain('id="football-play-panel"');
    expect(source).toContain('data-football-play="rush"');
    expect(source).toContain('data-football-play="pass_complete"');
    expect(source).toContain('data-football-play="incomplete_pass"');
    expect(source).toContain('data-football-play="penalty"');
    expect(source).toContain('data-football-play="turnover"');
    expect(source).toContain('data-football-play="punt"');
    expect(source).toContain('data-football-play="kickoff"');
    expect(source).toContain('data-football-score="touchdown"');
    expect(source).toContain('data-football-score="field_goal"');
    expect(source).toContain('data-football-score="safety"');
    expect(source).toContain('data-football-score="pat_kick"');
    expect(source).toContain('data-football-score="two_point_conversion"');
    expect(source).toContain("type: 'football_play'");
    expect(source).toContain('footballPlayType: playType');
    expect(source).toContain('liveFootballState: gameState.footballState');
    expect(source).toContain('scheduleFootballStateSync()');
    expect(source).toContain("genericPanels.classList.toggle('hidden', isGoalSportMode || gameState.isBaseballScorekeeping || volleyballMode || footballMode)");
    expect(source).toContain('possession: context.possession');
    expect(source).toContain('down: context.down');
    expect(source).toContain('distance: context.distance');
    expect(source).toContain('yardLine: context.yardLine');
    expect(source).toContain("type: 'football_score'");
    expect(source).toContain('footballScoringAction: action');
    expect(source).toContain('points: scoringAction.points');
    expect(source).toContain('teamSide: context.possession');
    expect(source).toContain('previousScore');
    expect(source).toContain("alert('Undo football scoring entries from newest to oldest so the scoreboard stays accurate.');");
    expect(source).toContain("logFootballScore(btn.dataset.footballScore)");

  });
});
