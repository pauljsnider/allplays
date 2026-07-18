import { describe, expect, it } from 'vitest';
import { emptyOpportunityInput } from './opportunityLogic';
import { applyOpportunityAiSuggestion, assertOpportunityAiDraftSafe, enhanceOpportunityDraft, parseOpportunityAiSuggestion } from './opportunityAiService';

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

  it('rejects unsafe draft and team text before an AI prompt can be built', () => {
    expect(() => assertOpportunityAiDraftSafe({
      ...emptyOpportunityInput('coach_or_staff'),
      description: 'Email coach@example.com for details.'
    }, null)).toThrow(/draft was not sent/i);

    expect(() => assertOpportunityAiDraftSafe(emptyOpportunityInput('coach_or_staff'), {
      id: 'team-1',
      name: 'Bears',
      sport: 'Basketball',
      city: 'Austin',
      state: 'TX',
      zip: '78701',
      ageGroup: '12U',
      competitiveLevel: 'Travel',
      division: 'Gold',
      availability: 'Meet at Central Middle School'
    })).toThrow(/draft was not sent/i);
  });

  it('stops unsafe drafts before initializing or calling the AI model', async () => {
    await expect(enhanceOpportunityDraft({
      ...emptyOpportunityInput('coach_or_staff'),
      description: 'Call 512-555-0199 for details.'
    }, null)).rejects.toThrow(/draft was not sent/i);
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
