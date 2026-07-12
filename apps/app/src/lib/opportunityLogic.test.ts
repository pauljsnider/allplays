import { describe, expect, it } from 'vitest';
import { emptyOpportunityInput, formatOpportunityLocation, getOpportunityKindLabel, opportunityToInput, type PublicOpportunity } from './opportunityLogic';

describe('opportunityLogic', () => {
  it('builds safe defaults for looking-for-team posts', () => {
    expect(emptyOpportunityInput('player_seeking_team')).toEqual(expect.objectContaining({
      kind: 'player_seeking_team',
      guardianAttested: false,
      compensationType: 'not_applicable'
    }));
  });

  it('formats labels, locations, and edit input', () => {
    const item = {
      ...emptyOpportunityInput('team_seeking_players'),
      id: 'listing-1',
      teamId: 'team-1',
      teamName: 'Bears',
      teamPhotoUrl: null,
      status: 'active',
      city: 'Austin',
      state: 'TX',
      zip: '78701',
      createdAt: null,
      updatedAt: null,
      expiresAt: null
    } as PublicOpportunity;
    expect(getOpportunityKindLabel(item.kind)).toBe('Players wanted');
    expect(formatOpportunityLocation(item)).toBe('Austin, TX 78701');
    expect(opportunityToInput(item)).toEqual(expect.objectContaining({ teamId: 'team-1', city: 'Austin' }));
  });
});
