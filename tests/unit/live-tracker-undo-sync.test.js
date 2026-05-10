import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readLiveTracker() {
  return readFileSync(new URL('../../js/live-tracker.js', import.meta.url), 'utf8');
}

describe('live tracker undo stat sync', () => {
  it('resyncs reverted player and opponent aggregated stats after undo', () => {
    const source = readLiveTracker();
    const undoBody = source.match(/function undo\(\) \{[\s\S]*?\n\}/)?.[0] || '';

    expect(undoBody).toContain("lastLog?.undoData?.type === 'stat'");
    expect(undoBody).toContain('schedulePlayerStatsSync(lastLog.undoData.playerId);');
    expect(undoBody).toContain('scheduleOpponentStatsSync();');
    expect(undoBody).toContain('scheduleLiveHasData();');
  });
});
