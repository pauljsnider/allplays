import { beforeEach, describe, expect, it, vi } from 'vitest';

const aiMocks = vi.hoisted(() => {
  const generateContent = vi.fn();
  const getGenerativeModel = vi.fn(() => ({ generateContent }));
  const makeSchema = (type: string, extra: Record<string, unknown> = {}) => ({ type, ...extra, toJSON: () => ({ type, ...extra }) });
  return {
    generateContent,
    getGenerativeModel,
    Schema: {
      object: vi.fn((config: any) => makeSchema('object', config)),
      array: vi.fn((config: any) => makeSchema('array', config)),
      string: vi.fn((config?: any) => makeSchema('string', config)),
      boolean: vi.fn((config?: any) => makeSchema('boolean', config))
    }
  };
});

vi.mock('../../../../js/vendor/firebase-app.js', () => ({
  getApp: vi.fn(() => ({}))
}));

vi.mock('../../../../js/vendor/firebase-ai.js', () => ({
  getAI: vi.fn(() => ({})),
  getGenerativeModel: aiMocks.getGenerativeModel,
  GoogleAIBackend: vi.fn(),
  Schema: aiMocks.Schema
}));

import {
  buildRosterAiImportCommitPlan,
  buildRosterAiImportPrompt,
  changeRosterAiImportPreviewAction,
  extractPastedRosterCsv,
  generateRosterAiImportRows,
  normalizeRosterAiImportResponse,
  removeRosterAiImportPreviewRow,
  updateRosterAiImportPreviewField,
  updateRosterAiImportPreviewRow
} from './rosterAiImport';

describe('rosterAiImport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds a prompt with current roster context and text/image instructions', () => {
    const prompt = buildRosterAiImportPrompt({
      text: 'Only varsity players',
      imageFile: { name: 'roster.png' } as File,
      currentPlayers: [{ id: 'p1', name: 'Avery Ace', number: '10' }]
    });

    expect(prompt).toContain('Current players in roster: 1');
    expect(prompt).toContain('Avery Ace');
    expect(prompt).toContain('A roster image is attached');
    expect(prompt).toContain('Only varsity players');
    expect(prompt).toContain('Use add for new players, update with playerId for matches');
    expect(prompt).toContain('familyContacts');
  });

  it('normalizes clean add operations into preview rows', () => {
    const result = normalizeRosterAiImportResponse({
      operations: [
        { action: 'add', player: { name: 'Jordan New', number: '#23' }, reason: 'new row' },
        { action: 'add', player: { name: 'Avery Ace Jr.', number: '11' }, reason: 'same player corrected number' }
      ]
    }, {
      currentPlayers: [{ id: 'p1', name: 'Avery Ace', number: '10' }]
    });

    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([
      expect.objectContaining({
        rowNumber: 1,
        action: 'add',
        name: 'Jordan New',
        number: '23',
        reason: 'new row',
        duplicatePlayerId: '',
        duplicatePlayerName: '',
        errors: []
      }),
      expect.objectContaining({
        rowNumber: 2,
        action: 'add',
        name: 'Avery Ace Jr.',
        number: '11',
        reason: 'same player corrected number',
        duplicatePlayerId: '',
        duplicatePlayerName: '',
        errors: []
      })
    ]);
  });

  it('normalizes messy OCR-ish names with suffixes, hyphens, and apostrophes', () => {
    const result = normalizeRosterAiImportResponse({
      operations: [
        { action: 'add', player: { name: "  Kai O'Neil-Smith III  ", number: ' #07 ' }, reason: 'OCR row' },
        { action: 'add', player: { name: 'Mia-Lynn Carter Jr.', number: '' }, reason: 'no visible number' }
      ]
    });

    expect(result.errors).toEqual([]);
    expect(result.rows.map((row) => ({ name: row.name, number: row.number }))).toEqual([
      { name: "Kai O'Neil-Smith III", number: '07' },
      { name: 'Mia-Lynn Carter Jr.', number: '' }
    ]);
  });

  it('converts exact matches to updates and blocks ambiguous matches', () => {
    const result = normalizeRosterAiImportResponse({
      operations: [
        { action: 'add', player: { name: 'Avery Ace', number: '10' } },
        { action: 'update', changes: { name: 'Morgan Match', number: '8' } },
        { action: 'add', player: { name: 'Riley Runner', number: '12' } }
      ]
    }, {
      currentPlayers: [
        { id: 'p1', name: 'Avery Ace', number: '10' },
        { id: 'p2', name: 'Morgan Match', number: '7' },
        { id: 'p3', name: 'Morgan Match', number: '8' }
      ]
    });

    expect(result.rows[0]).toMatchObject({ action: 'update', playerId: 'p1', errors: [] });
    expect(result.rows[1].errors[0]).toContain('multiple existing players match');
    expect(result.rows[2].errors).toEqual([]);

    const plan = buildRosterAiImportCommitPlan(result.rows);
    expect(plan.operations.map((operation) => operation.type)).toEqual(['update', 'add']);
    expect(plan.addPlayers).toEqual([{ name: 'Riley Runner', number: '12' }]);
    expect(plan.skippedRows.map((row) => row.rowNumber)).toEqual([2]);
  });

  it('updates and removes preview rows before building a commit plan', () => {
    const currentPlayers = [{ id: 'p1', name: 'Avery Ace', number: '10' }];
    const result = normalizeRosterAiImportResponse({
      operations: [
        { action: 'add', player: { name: 'Avery Ace', number: '10' } },
        { action: 'add', player: { name: 'Riley Runner', number: '12' } }
      ]
    }, { currentPlayers });

    const edited = updateRosterAiImportPreviewRow(result.rows, 1, { name: 'Jordan New', number: '#23' }, currentPlayers);
    expect(edited[0]).toMatchObject({
      name: 'Jordan New',
      number: '23',
      duplicatePlayerId: '',
      errors: []
    });

    const removed = removeRosterAiImportPreviewRow(edited, 2);
    expect(removed.map((row) => row.rowNumber)).toEqual([1]);
    expect(buildRosterAiImportCommitPlan(removed).addPlayers).toEqual([{ name: 'Jordan New', number: '23' }]);
  });

  it('lets a reviewer turn an unmatched update into a valid new player', () => {
    const currentPlayers = [{ id: 'p1', name: 'Avery Ace', number: '10' }];
    const result = normalizeRosterAiImportResponse({
      operations: [
        { action: 'update', changes: { name: 'Jordan New', number: '23' } }
      ]
    }, { currentPlayers });

    expect(result.rows[0]).toMatchObject({ action: 'update', playerId: '' });
    expect(result.rows[0].errors[0]).toContain('no matching existing player was found');

    const edited = changeRosterAiImportPreviewAction(result.rows, 1, 'add', currentPlayers);

    expect(edited[0]).toMatchObject({
      action: 'add',
      playerId: '',
      name: 'Jordan New',
      number: '23',
      errors: []
    });
    expect(buildRosterAiImportCommitPlan(edited).addPlayers).toEqual([
      { name: 'Jordan New', number: '23' }
    ]);
  });

  it('lets a reviewer clear an unknown supplied property to resolve its validation error', () => {
    const result = normalizeRosterAiImportResponse({
      operations: [
        { action: 'add', player: { name: 'Jordan New', unsupportedField: 'keep visible' } }
      ]
    });

    expect(result.rows[0].fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'unknown.unsupportedField', value: 'keep visible' })
    ]));
    expect(result.rows[0].errors[0]).toContain('unknown roster field');

    const edited = updateRosterAiImportPreviewField(
      result.rows,
      1,
      'unknown.unsupportedField',
      ''
    );

    expect(edited[0].errors).toEqual([]);
    expect(edited[0].fields.some((field) => field.key === 'unknown.unsupportedField')).toBe(false);
  });

  it('generates rows through Firebase AI without persisting them', async () => {
    aiMocks.generateContent.mockResolvedValue({
      response: {
        text: () => JSON.stringify({
          operations: [{ action: 'add', player: { name: 'Taylor Ten', number: '10' } }]
        })
      }
    });

    const result = await generateRosterAiImportRows({
      text: '#10 Taylor Ten',
      currentPlayers: []
    });

    expect(aiMocks.getGenerativeModel).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      model: 'gemini-2.5-flash',
      generationConfig: expect.objectContaining({ responseMimeType: 'application/json' })
    }));
    expect(aiMocks.generateContent).toHaveBeenCalledWith([expect.stringContaining('#10 Taylor Ten')]);
    expect(result.rows[0]).toMatchObject({ action: 'add', name: 'Taylor Ten', number: '10' });
  });

  it('finds an embedded roster CSV after chat instructions and parses it without AI', async () => {
    const text = [
      'For Bears, import this roster and preserve every omitted field.',
      '',
      'Name,Number',
      'Avery Ace,15',
      '',
      'Do not change the family contact.'
    ].join('\n');

    expect(extractPastedRosterCsv(text)).toBe('Name,Number\nAvery Ace,15');

    const result = await generateRosterAiImportRows({
      text,
      currentPlayers: [{
        id: 'p1',
        name: 'Avery Ace',
        number: '10',
        privateProfileParents: [{
          name: 'Pat Ace',
          email: 'pat@example.com',
          relation: 'Parent'
        }]
      }]
    });

    expect(aiMocks.generateContent).not.toHaveBeenCalled();
    expect(result.source).toBe('csv');
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      action: 'update',
      playerId: 'p1',
      name: 'Avery Ace',
      number: '15',
      contacts: []
    });
    expect(result.rows[0].fields.map((field) => field.key)).toEqual(['name', 'number']);
    expect(result.rows[0].operation.privateFamilyContacts).toEqual({
      parents: [
        expect.objectContaining({
          name: 'Pat Ace',
          email: 'pat@example.com',
          relation: 'Parent'
        })
      ]
    });
  });

  it('handles an explicit natural-language jersey update deterministically', async () => {
    const result = await generateRosterAiImportRows({
      text: "For Bears, update only Avery Ace's jersey number from 10 to 14. Keep everything else unchanged.",
      currentPlayers: [{
        id: 'p1',
        name: 'Avery Ace',
        number: '10',
        privateProfileParents: [{
          name: 'Pat Ace',
          email: 'pat@example.com',
          relation: 'Parent'
        }]
      }]
    });

    expect(aiMocks.generateContent).not.toHaveBeenCalled();
    expect(result.source).toBe('ai-text');
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      action: 'update',
      playerId: 'p1',
      name: 'Avery Ace',
      number: '14',
      contacts: []
    });
    expect(result.rows[0].fields.map((field) => field.key)).toEqual(['name', 'number']);
    expect(result.rows[0].operation.privateFamilyContacts).toEqual({
      parents: [expect.objectContaining({ email: 'pat@example.com' })]
    });
  });

  it('repairs AI roster rows that drop contacts, confuse jersey size, or invent fields', async () => {
    aiMocks.generateContent.mockResolvedValue({
      response: {
        text: () => JSON.stringify({
          operations: [
            {
              action: 'add',
              player: {
                name: 'Codex AI Preview Delta',
                jerseySize: '904',
                school: 'Vipers'
              }
            },
            {
              action: 'add',
              player: {
                name: 'Codex AI Preview Epsilon',
                number: null,
                school: 'Central'
              }
            }
          ]
        })
      }
    });

    const result = await generateRosterAiImportRows({
      text: [
        'Add Codex AI Preview Delta, jersey number 904, family contact Casey Test, coach@allplays.ai, relation Guardian.',
        'Add Codex AI Preview Epsilon, jersey number 905, family contact Robin Test, admin@allplays.ai, relation Father.'
      ].join('\n'),
      currentPlayers: []
    });

    expect(result.rows).toHaveLength(2);
    expect(result.rows.map((row) => row.number)).toEqual(['904', '905']);
    expect(result.rows.flatMap((row) => row.fields.map((field) => field.key))).not.toContain('jerseySize');
    expect(result.rows.flatMap((row) => row.fields.map((field) => field.key))).not.toContain('school');
    expect(result.rows[0].contacts).toEqual([
      expect.objectContaining({
        name: 'Casey Test',
        email: 'coach@allplays.ai',
        relation: 'Guardian'
      })
    ]);
    expect(result.rows[1].contacts).toEqual([
      expect.objectContaining({
        name: 'Robin Test',
        email: 'admin@allplays.ai',
        relation: 'Father'
      })
    ]);
    expect(result.rows.map((row) => row.inviteCount)).toEqual([1, 1]);
    expect(result.rows.flatMap((row) => row.contacts.map((contact) => contact.email))).toEqual([
      'coach@allplays.ai',
      'admin@allplays.ai'
    ]);
  });

  it('does not keep a hallucinated no-op update after unsupported placeholders are pruned', async () => {
    aiMocks.generateContent.mockResolvedValue({
      response: {
        text: () => JSON.stringify({
          operations: [{
            action: 'update',
            playerId: 'p1',
            changes: {
              school: 'Invented Academy',
              number: null
            }
          }]
        })
      }
    });

    const result = await generateRosterAiImportRows({
      text: 'Review this roster without changing Avery Ace.',
      currentPlayers: [{ id: 'p1', name: 'Avery Ace', number: '10' }]
    });

    expect(result.rows).toEqual([]);
    expect(result.errors[0]).toContain('did not find any players');
  });

  it('falls back to AI for structurally invalid CSV without hiding unknown supplied values', async () => {
    aiMocks.generateContent.mockResolvedValue({
      response: {
        text: () => JSON.stringify({
          operations: [{
            action: 'add',
            player: {
              name: 'Taylor Ten',
              favoriteSnack: 'Crackers'
            }
          }]
        })
      }
    });

    const result = await generateRosterAiImportRows({
      csvText: 'Name,Favorite Snack\nTaylor Ten,Crackers',
      currentPlayers: []
    });

    expect(aiMocks.generateContent).toHaveBeenCalledWith([
      expect.stringContaining('Unknown CSV header "Favorite Snack"')
    ]);
    expect(result.source).toBe('csv');
    expect(result.rows[0].fields).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: 'unknown.favoriteSnack',
        value: 'Crackers'
      })
    ]));
    expect(result.rows[0].errors[0]).toContain('unknown roster field');
  });

  it('preserves PDF as the roster document source for chat artifacts', () => {
    const result = normalizeRosterAiImportResponse({
      operations: [{ action: 'add', player: { name: 'Taylor Ten', number: '10' } }]
    }, {
      imageFile: new File(['pdf'], 'roster.pdf', { type: 'application/pdf' })
    });

    expect(result.source).toBe('ai-document');
    expect(buildRosterAiImportPrompt({
      imageFile: new File(['pdf'], 'roster.pdf', { type: 'application/pdf' })
    })).toContain('A roster PDF is attached');
  });

  it('returns actionable errors for empty input and malformed responses', async () => {
    await expect(generateRosterAiImportRows({ text: '  ' })).resolves.toMatchObject({
      rows: [],
      errors: [expect.stringContaining('Paste roster text, attach a CSV, or upload')]
    });
    expect(aiMocks.generateContent).not.toHaveBeenCalled();
    expect(normalizeRosterAiImportResponse({ nope: [] }).errors[0]).toContain('operations array');
    expect(normalizeRosterAiImportResponse({ operations: [] }).errors[0]).toContain('did not find any players');
  });
});
