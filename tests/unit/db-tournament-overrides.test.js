import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readDbSource() {
  return readFileSync(new URL('../../js/db.js', import.meta.url), 'utf8');
}

describe('db tournament pool override persistence', () => {
  it('cleans up matching override entries by exact pool name when saving or clearing', () => {
    const source = readDbSource();

    expect(source).toContain('function collectTournamentPoolOverrideKeys');
    expect(source).toContain('Object.entries(poolOverrides || {})');
    expect(source).toContain("normalizeTournamentPoolOverrideName(override?.poolName) === normalizedPoolName");
    expect(source).toContain('collectTournamentPoolOverrideKeys(existingOverrides, poolName)');
    expect(source).toContain('collectTournamentPoolOverrideKeys(existingOverrides, normalizedPoolName)');
    expect(source).toContain('deleteField()');
  });
});
