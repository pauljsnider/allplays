import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readDbSource() {
  return readFileSync(new URL('../../js/db.js', import.meta.url), 'utf8');
}

describe('db tournament pool override persistence', () => {
  it('cleans up matching structured group overrides when saving or clearing', () => {
    const source = readDbSource();

    expect(source).toContain('function collectTournamentPoolOverrideKeys');
    expect(source).toContain('Object.entries(poolOverrides || {})');
    expect(source).toContain('buildTournamentGroupOverrideKey(groupKey)');
    expect(source).toContain('normalizeTournamentPoolOverrideName(override?.groupKey) === groupKey');
    expect(source).toContain('collectTournamentPoolOverrideKeys(existingOverrides, poolName, groupKey)');
    expect(source).toContain('collectTournamentPoolOverrideKeys(existingOverrides, normalizedPoolName, normalizedGroupKey)');
    expect(source).toContain('deleteField()');
  });
});
