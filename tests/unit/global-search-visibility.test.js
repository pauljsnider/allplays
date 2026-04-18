import { describe, it, expect } from 'vitest';
import { filterSearchableTeams } from '../../js/global-search-visibility.js';

const teams = [
  { id: 'public-team', name: 'Public Team', isPublic: true, ownerId: 'owner-1', adminEmails: ['coach@example.com'] },
  { id: 'private-team', name: 'Private Team', isPublic: false, ownerId: 'owner-1', adminEmails: ['coach@example.com'] }
];

describe('global search visibility', () => {
  it('hides private teams from anonymous search results', () => {
    expect(filterSearchableTeams(teams, null).map((team) => team.id)).toEqual(['public-team']);
  });

  it('keeps private teams visible to the owner', () => {
    expect(filterSearchableTeams(teams, { uid: 'owner-1', email: 'owner@example.com' }).map((team) => team.id)).toEqual([
      'public-team',
      'private-team'
    ]);
  });

  it('keeps private teams visible to a team admin', () => {
    expect(filterSearchableTeams(teams, { uid: 'coach-1', email: 'coach@example.com' }).map((team) => team.id)).toEqual([
      'public-team',
      'private-team'
    ]);
  });

  it('keeps private teams visible to a linked parent', () => {
    expect(filterSearchableTeams(teams, {
      uid: 'parent-1',
      email: 'parent@example.com',
      parentOf: [{ teamId: 'private-team', playerId: 'player-1' }]
    }).map((team) => team.id)).toEqual([
      'public-team',
      'private-team'
    ]);
  });
});
