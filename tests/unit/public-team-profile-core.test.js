import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { runPublicTeamProfileBackfill } from '../../_migration/backfill-public-team-profiles.js';

const require = createRequire(import.meta.url);
const {
  buildPublicTeamProfile,
  collectAllPublicTeamSourceDocuments,
  isPublicTeamProfileSchemaValid,
  matchesPublicTeamProfileSearch
} = require('../../functions/public-team-profile-core.cjs');

function createBackfillSnapshot(id, data) {
  return {
    id,
    exists: data !== null,
    data: () => data
  };
}

function createBackfillDb({ listedTeam, currentTeam, existingProfile = null }) {
  const state = {
    profile: existingProfile,
    completion: null,
    completionWrites: [],
    teamCollectionReads: 0,
    transactionReads: []
  };
  const db = {
    collection: vi.fn((path) => ({
      get: vi.fn(async () => {
        if (path === 'publicTeamProfiles') {
          return { docs: state.profile ? [createBackfillSnapshot('team-race', state.profile)] : [] };
        }
        state.teamCollectionReads += 1;
        const team = state.teamCollectionReads === 1 ? listedTeam : currentTeam;
        return { docs: team ? [createBackfillSnapshot('team-race', team)] : [] };
      })
    })),
    doc: vi.fn((path) => ({
      path,
      get: vi.fn(async () => createBackfillSnapshot('team-race', state.profile)),
      set: vi.fn(async (value) => {
        if (path === 'systemMigrations/publicTeamProfilesBackfill') {
          state.completion = value;
          state.completionWrites.push(value);
        }
      })
    })),
    runTransaction: vi.fn(async (handler) => handler({
      get: vi.fn(async (ref) => {
        state.transactionReads.push(ref.path);
        if (ref.path === 'teams/team-race') {
          return createBackfillSnapshot('team-race', currentTeam);
        }
        return createBackfillSnapshot('team-race', state.profile);
      }),
      set: vi.fn((ref, value) => {
        if (ref.path === 'publicTeamProfiles/team-race') state.profile = value;
      }),
      delete: vi.fn((ref) => {
        if (ref.path === 'publicTeamProfiles/team-race') state.profile = null;
      })
    }))
  };
  return { db, state };
}

function createConcurrentBackfillDb({ keepChanging = false } = {}) {
  const teams = new Map([
    ['team-existing', { name: 'Existing Public Team', isPublic: true, active: true, revision: 0 }]
  ]);
  const profiles = new Map();
  const state = {
    completionWrites: [],
    events: [],
    teamCollectionReads: 0,
    teams,
    profiles
  };

  const snapshotForPath = (path) => {
    const [collectionName, id] = path.split('/');
    const source = collectionName === 'teams' ? teams : profiles;
    const value = source.get(id) || null;
    return createBackfillSnapshot(id, value);
  };

  const db = {
    collection: vi.fn((path) => ({
      get: vi.fn(async () => {
        if (path === 'teams') {
          state.teamCollectionReads += 1;
          if (state.teamCollectionReads === 2) {
            teams.set('team-concurrent', {
              name: 'Concurrent Public Team', isPublic: true, active: true, revision: 0
            });
          }
          if (keepChanging && state.teamCollectionReads > 1) {
            const existing = teams.get('team-existing');
            teams.set('team-existing', { ...existing, revision: existing.revision + 1 });
          }
          return { docs: Array.from(teams, ([id, value]) => createBackfillSnapshot(id, value)) };
        }
        return { docs: Array.from(profiles, ([id, value]) => createBackfillSnapshot(id, value)) };
      })
    })),
    doc: vi.fn((path) => ({
      path,
      get: vi.fn(async () => snapshotForPath(path)),
      set: vi.fn(async (value) => {
        if (path === 'systemMigrations/publicTeamProfilesBackfill') {
          state.completionWrites.push(value);
          state.events.push(`migration:${value.completed}`);
        }
      })
    })),
    runTransaction: vi.fn(async (handler) => handler({
      get: vi.fn(async (ref) => snapshotForPath(ref.path)),
      set: vi.fn((ref, value) => {
        const id = ref.path.split('/').pop();
        profiles.set(id, value);
        state.events.push(`profile:${id}`);
      }),
      delete: vi.fn((ref) => {
        profiles.delete(ref.path.split('/').pop());
      })
    }))
  };

  return { db, state };
}

describe('public team profile callable boundary', () => {
  it('builds an exact public allow-list and strips management data', () => {
    const profile = buildPublicTeamProfile({
      name: 'Safe Team',
      isPublic: true,
      active: true,
      city: 'Atlanta',
      state: 'GA',
      ownerId: 'private-owner',
      adminEmails: ['private@example.com'],
      paymentConfig: { secret: true }
    });

    expect(profile).toMatchObject({
      publicSchemaVersion: 1,
      name: 'Safe Team',
      city: 'Atlanta',
      state: 'GA',
      isPublic: true,
      active: true
    });
    expect(profile).not.toHaveProperty('ownerId');
    expect(profile).not.toHaveProperty('adminEmails');
    expect(profile).not.toHaveProperty('paymentConfig');
    expect(isPublicTeamProfileSchemaValid(profile)).toBe(true);
    expect(isPublicTeamProfileSchemaValid({ ...profile, unexpectedSecret: 'nope' })).toBe(false);
  });

  it('rejects malformed values even when every top-level field is allow-listed', () => {
    const base = { publicSchemaVersion: 1, name: 'Safe Team', isPublic: true, active: true };
    const malformedFields = [
      { description: ['private'] },
      { photoUrl: { private: true } },
      { leagueUrl: ['private'] },
      { publicSearchName: { private: true } },
      { appAccess: 'true' },
      { archived: 'false' },
      { sourceUpdatedAt: { private: true } }
    ];

    malformedFields.forEach((malformedField) => {
      expect(isPublicTeamProfileSchemaValid({ ...base, ...malformedField })).toBe(false);
    });
  });

  it('matches normalized public presentation fields without consulting private data', () => {
    const profile = buildPublicTeamProfile({
      name: 'Atlanta Fire', isPublic: true, active: true, city: 'Atlanta', state: 'GA', zip: '30303'
    });

    expect(matchesPublicTeamProfileSearch(profile, 'atlanta ga')).toBe(true);
    expect(matchesPublicTeamProfileSearch(profile, '30303')).toBe(true);
    expect(matchesPublicTeamProfileSearch(profile, 'private-owner')).toBe(false);
  });

  it('matches a whole two-letter query only against state while preserving city-state token searches', () => {
    const nameMatch = buildPublicTeamProfile({
      name: 'Indiana Bears', isPublic: true, active: true, city: 'Kansas City', state: 'MO'
    });
    const stateMatch = buildPublicTeamProfile({
      name: 'Wildcats', isPublic: true, active: true, city: 'Bloomington', state: 'IN'
    });

    expect(matchesPublicTeamProfileSearch(nameMatch, 'in')).toBe(false);
    expect(matchesPublicTeamProfileSearch(stateMatch, 'IN')).toBe(true);
    expect(matchesPublicTeamProfileSearch(stateMatch, 'bloomington in')).toBe(true);
  });

  it('caps paged compatibility scans and never requests more than the remaining budget', async () => {
    const documents = Array.from({ length: 7 }, (_, index) => ({ id: `team-${index}` }));
    const fetchPage = vi.fn(async ({ cursor, pageSize }) => {
      const start = cursor ? documents.indexOf(cursor) + 1 : 0;
      return { docs: documents.slice(start, start + pageSize) };
    });

    const result = await collectAllPublicTeamSourceDocuments(fetchPage, { pageSize: 3, maxDocuments: 5 });

    expect(result.map((document) => document.id)).toEqual(['team-0', 'team-1', 'team-2', 'team-3', 'team-4']);
    expect(fetchPage).toHaveBeenNthCalledWith(1, { cursor: null, pageSize: 3 });
    expect(fetchPage).toHaveBeenNthCalledWith(2, { cursor: documents[2], pageSize: 2 });
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('records completion only after a full applied backfill', () => {
    const migrationSource = readFileSync(new URL('../../_migration/backfill-public-team-profiles.js', import.meta.url), 'utf8');
    const completionWrite = migrationSource.indexOf("migrationStateRef.set({ completed: true }");
    const projectionLoop = migrationSource.indexOf('for (const teamSnap of teamDocs)');

    expect(migrationSource).toContain("PUBLIC_TEAM_PROFILE_MIGRATION_STATE_PATH = 'systemMigrations/publicTeamProfilesBackfill'");
    expect(migrationSource).toContain('if (options.apply && !options.teamId)');
    expect(migrationSource).toContain('migrationStateRef.set({ completed: false }');
    expect(migrationSource).toContain('reconcilePublicTeamProfilesToFixedPoint(db)');
    expect(completionWrite).toBeGreaterThan(projectionLoop);
  });

  it('transactionally re-reads current visibility before completing an applied backfill', async () => {
    const stalePublic = { name: 'Race Team', isPublic: true, active: true };
    const privateRace = createBackfillDb({
      listedTeam: stalePublic,
      currentTeam: { ...stalePublic, isPublic: false },
      existingProfile: buildPublicTeamProfile(stalePublic)
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const privateSummary = await runPublicTeamProfileBackfill({
      apply: true, teamId: '', projectId: 'demo-allplays', serviceAccountPath: ''
    }, { db: privateRace.db });

    expect(privateSummary).toMatchObject({
      projectionsUpserted: 0,
      projectionsDeleted: 1,
      migrationCompletionRecorded: true
    });
    expect(privateRace.state.profile).toBeNull();
    expect(privateRace.state.transactionReads).toEqual([
      'teams/team-race',
      'publicTeamProfiles/team-race',
      'teams/team-race',
      'publicTeamProfiles/team-race'
    ]);
    expect(privateRace.state.completion).toEqual({ completed: true });
    expect(privateRace.state.completionWrites).toEqual([{ completed: false }, { completed: true }]);

    const publicNow = { name: 'Newly Public Race Team', isPublic: true, active: true, state: 'MO' };
    const publicRace = createBackfillDb({
      listedTeam: { ...publicNow, isPublic: false },
      currentTeam: publicNow
    });
    const publicSummary = await runPublicTeamProfileBackfill({
      apply: true, teamId: '', projectId: 'demo-allplays', serviceAccountPath: ''
    }, { db: publicRace.db });

    expect(publicSummary).toMatchObject({
      projectionsUpserted: 1,
      projectionsDeleted: 0,
      migrationCompletionRecorded: true
    });
    expect(publicRace.state.profile).toMatchObject({
      name: 'Newly Public Race Team', isPublic: true, active: true, state: 'MO'
    });
    expect(publicRace.state.transactionReads).toEqual(['teams/team-race', 'teams/team-race']);

    const deletedRace = createBackfillDb({
      listedTeam: stalePublic,
      currentTeam: null,
      existingProfile: buildPublicTeamProfile(stalePublic)
    });
    const deletedSummary = await runPublicTeamProfileBackfill({
      apply: true, teamId: '', projectId: 'demo-allplays', serviceAccountPath: ''
    }, { db: deletedRace.db });

    expect(deletedSummary).toMatchObject({
      projectionsUpserted: 0,
      projectionsDeleted: 1,
      migrationCompletionRecorded: true
    });
    expect(deletedRace.state.profile).toBeNull();
    expect(deletedRace.state.transactionReads).toEqual([
      'teams/team-race',
      'publicTeamProfiles/team-race'
    ]);
    logSpy.mockRestore();
  });

  it('reconciles a public team created after the initial snapshot before recording completion', async () => {
    const concurrent = createConcurrentBackfillDb();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const summary = await runPublicTeamProfileBackfill({
      apply: true, teamId: '', projectId: 'demo-allplays', serviceAccountPath: ''
    }, { db: concurrent.db });

    expect(summary).toMatchObject({
      teamsScanned: 1,
      reconciliationPasses: 1,
      teamsReconciled: 2,
      migrationCompletionRecorded: true
    });
    expect(concurrent.state.profiles.get('team-concurrent')).toMatchObject({
      name: 'Concurrent Public Team', isPublic: true, active: true
    });
    expect(concurrent.state.events.indexOf('profile:team-concurrent')).toBeLessThan(
      concurrent.state.events.lastIndexOf('migration:true')
    );
    expect(concurrent.state.completionWrites).toEqual([{ completed: false }, { completed: true }]);
    logSpy.mockRestore();
  });

  it('leaves projection mode disabled when reconciliation cannot reach a fixed point', async () => {
    const changing = createConcurrentBackfillDb({ keepChanging: true });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await expect(runPublicTeamProfileBackfill({
      apply: true, teamId: '', projectId: 'demo-allplays', serviceAccountPath: ''
    }, { db: changing.db })).rejects.toThrow('migration completion was not recorded');

    expect(changing.state.completionWrites).toEqual([{ completed: false }]);
    logSpy.mockRestore();
  });
});
