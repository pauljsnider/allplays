import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const {
  buildPublicTeamProfile,
  collectAllPublicTeamSourceDocuments,
  isPublicTeamProfileSchemaValid,
  matchesPublicTeamProfileSearch
} = require('../../functions/public-team-profile-core.cjs');

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
    const completionWrite = migrationSource.indexOf("db.doc(PUBLIC_TEAM_PROFILE_MIGRATION_STATE_PATH).set({ completed: true }");
    const projectionLoop = migrationSource.indexOf('for (const teamSnap of teamDocs)');

    expect(migrationSource).toContain("PUBLIC_TEAM_PROFILE_MIGRATION_STATE_PATH = 'systemMigrations/publicTeamProfilesBackfill'");
    expect(migrationSource).toContain('if (options.apply && !options.teamId)');
    expect(completionWrite).toBeGreaterThan(projectionLoop);
  });
});
