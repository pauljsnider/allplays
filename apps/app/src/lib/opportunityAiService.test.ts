import { describe, expect, it } from 'vitest';
import { emptyOpportunityInput } from './opportunityLogic';
import { applyOpportunityAiSuggestion, parseOpportunityAiSuggestion } from './opportunityAiService';

describe('opportunity AI suggestions', () => {
  it('parses a fenced JSON response and keeps only supported fields', () => {
    expect(parseOpportunityAiSuggestion(`\n\`\`\`json\n{
      "title": "  Assistant coach for 12U Bears  ",
      "description": "Help lead purposeful practices and support weekend games.",
      "availability": "Weeknights",
      "compensationType": "volunteer",
      "unknown": "ignored"
    }\n\`\`\``)).toEqual({
      title: 'Assistant coach for 12U Bears',
      description: 'Help lead purposeful practices and support weekend games.',
      availability: 'Weeknights',
      compensationType: 'volunteer'
    });
  });

  it('rejects unsafe public contact and youth identity details without returning a partial draft', () => {
    expect(() => parseOpportunityAiSuggestion(JSON.stringify({
      title: 'Coach wanted',
      description: 'Email coach@example.com or visit Central Middle School.'
    }))).toThrow(/not safe for a public listing/i);
  });

  it('applies suggestions without allowing AI to change ownership or guardian state', () => {
    const input = {
      ...emptyOpportunityInput('coach_or_staff'),
      teamId: 'team-1',
      guardianAttested: false
    };
    expect(applyOpportunityAiSuggestion(input, {
      title: 'Improved title',
      description: 'Improved description.'
    })).toEqual(expect.objectContaining({
      kind: 'coach_or_staff',
      teamId: 'team-1',
      guardianAttested: false,
      title: 'Improved title'
    }));
  });
});
