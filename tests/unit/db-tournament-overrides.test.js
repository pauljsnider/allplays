import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  buildTournamentGroupOverrideKey,
  buildTournamentPoolOverrideKey,
  computeTournamentPoolStandings
} from '../../js/tournament-standings.js';

function readDbSource() {
  return readFileSync(new URL('../../js/db.js', import.meta.url), 'utf8');
}

function buildTournamentOverridePersistenceHarness(initialOverrides = {}) {
  const source = readDbSource();
  const start = source.indexOf('function normalizeTournamentPoolOverrideName');
  const end = source.indexOf('\nexport async function addTeamAdminEmail', start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  const persistenceSource = source
    .slice(start, end)
    .replace('export async function saveTournamentPoolOverride', 'async function saveTournamentPoolOverride')
    .replace('export async function clearTournamentPoolOverride', 'async function clearTournamentPoolOverride');
  const deleted = Symbol('deleted');
  let poolOverrides = { ...initialOverrides };
  const getDoc = vi.fn(async () => ({
    exists: () => true,
    data: () => ({ tournamentPoolOverrides: poolOverrides })
  }));
  const updateTeam = vi.fn(async (_teamId, updatePayload) => {
    Object.entries(updatePayload).forEach(([path, value]) => {
      const key = path.replace('tournamentPoolOverrides.', '');
      if (value === deleted) {
        delete poolOverrides[key];
      } else {
        poolOverrides[key] = value;
      }
    });
  });
  const persistence = new Function(
    'db',
    'doc',
    'getDoc',
    'Timestamp',
    'updateTeam',
    'deleteField',
    'buildTournamentGroupOverrideKey',
    'buildTournamentPoolOverrideKey',
    `${persistenceSource}\nreturn { saveTournamentPoolOverride, clearTournamentPoolOverride };`
  )(
    {},
    vi.fn((_db, ...parts) => ({ path: parts.join('/') })),
    getDoc,
    { now: vi.fn(() => 'now') },
    updateTeam,
    vi.fn(() => deleted),
    buildTournamentGroupOverrideKey,
    buildTournamentPoolOverrideKey
  );

  return {
    ...persistence,
    getPoolOverrides: () => ({ ...poolOverrides }),
    updateTeam
  };
}

describe('db tournament pool override persistence', () => {
  it('retires a legacy override through a structured save and clear round trip', async () => {
    const poolName = 'Pool A';
    const groupKey = JSON.stringify(['', poolName]);
    const legacyKey = buildTournamentPoolOverrideKey(poolName);
    const structuredKey = buildTournamentGroupOverrideKey(groupKey);
    const harness = buildTournamentOverridePersistenceHarness({
      [legacyKey]: {
        poolName,
        teamOrder: ['Lions', 'Tigers']
      }
    });

    await harness.saveTournamentPoolOverride('team-1', {
      poolName,
      groupKey,
      teamOrder: ['Tigers', 'Lions'],
      finalizedAt: 'saved-at'
    });

    expect(harness.getPoolOverrides()).toEqual({
      [structuredKey]: expect.objectContaining({
        poolName,
        groupKey,
        teamOrder: ['Tigers', 'Lions']
      })
    });

    await harness.clearTournamentPoolOverride('team-1', poolName, groupKey);

    expect(harness.getPoolOverrides()).toEqual({});
    const [pool] = computeTournamentPoolStandings([{
      competitionType: 'tournament',
      status: 'completed',
      opponent: 'Lions',
      isHome: true,
      homeScore: 2,
      awayScore: 1,
      tournament: { poolName }
    }], {
      teamName: 'Tigers',
      poolOverrides: harness.getPoolOverrides()
    });
    expect(pool.isOverridden).toBe(false);
    expect(pool.rows.map((row) => row.teamName)).toEqual(['Tigers', 'Lions']);
    expect(harness.updateTeam).toHaveBeenCalledTimes(2);
  });
});
