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
    expect(source).toContain('value: -parsedValue');
    expect(source).toContain('value: -value');
    expect(source).toContain('description: `Undo stat: ${entry.text}`');
    expect(source).toContain('description: `Corrected stat: ${statKey.toUpperCase()} adjusted`');
  });
});
