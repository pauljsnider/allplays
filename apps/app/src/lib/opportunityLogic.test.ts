import { describe, expect, it } from 'vitest';
import {
  applyOpportunityTeamDefaults,
  emptyOpportunityInput,
  formatOpportunityLocation,
  getOpportunityInquiryStarterMessages,
  getOpportunityKindLabel,
  getMissingOpportunityRequiredFields,
  opportunityAvailabilityOptions,
  opportunityToInput,
  opportunityKinds,
  type PublicOpportunity
} from './opportunityLogic';

describe('opportunityLogic', () => {
  it('builds safe defaults for looking-for-team posts', () => {
    expect(emptyOpportunityInput('player_seeking_team')).toEqual(expect.objectContaining({
      kind: 'player_seeking_team',
      guardianAttested: false,
      compensationType: 'not_applicable',
      availability: opportunityAvailabilityOptions[0]
    }));
  });

  it('prefills safe team fields and keeps draft values the user already entered', () => {
    const input = {
      ...emptyOpportunityInput('coach_or_staff'),
      title: 'Assistant coach',
      city: 'User-entered city'
    };
    const result = applyOpportunityTeamDefaults(input, {
      id: 'team-1',
      name: 'Bears',
      sport: 'Basketball',
      city: 'Austin',
      state: 'TX',
      zip: '78701',
      ageGroup: '12U',
      competitiveLevel: 'Travel',
      division: 'Gold',
      availability: 'Weekends'
    });

    expect(result).toEqual(expect.objectContaining({
      teamId: 'team-1',
      sport: 'Basketball',
      city: 'User-entered city',
      state: 'TX',
      ageGroup: '12U',
      title: 'Assistant coach'
    }));
  });

  it('reports kind-specific missing required fields', () => {
    const teamListing = emptyOpportunityInput('team_seeking_players');
    expect(getMissingOpportunityRequiredFields(teamListing).map((field) => field.key)).toEqual([
      'teamId', 'title', 'description', 'sport', 'city', 'state'
    ]);

    const playerListing = emptyOpportunityInput('player_seeking_team');
    expect(getMissingOpportunityRequiredFields(playerListing).map((field) => field.key)).toEqual([
      'title', 'description', 'sport', 'city', 'state', 'ageGroup', 'guardianAttested'
    ]);
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

  it('offers common and category-specific inquiry starters for every opportunity kind', () => {
    const categorySpecificStarters = opportunityKinds.map(({ id }) => {
      const starters = getOpportunityInquiryStarterMessages(id);
      expect(starters).toHaveLength(3);
      expect(starters.slice(0, 2)).toEqual([
        'Is this opportunity still available?',
        'What are the next steps?'
      ]);
      return starters[2];
    });

    expect(new Set(categorySpecificStarters).size).toBe(opportunityKinds.length);
  });
});
