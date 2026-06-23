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
      string: vi.fn((config?: any) => makeSchema('string', config))
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
  generateRosterAiImportRows,
  normalizeRosterAiImportResponse,
  removeRosterAiImportPreviewRow,
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
    expect(prompt).toContain('roster is attached as an image');
    expect(prompt).toContain('Only varsity players');
    expect(prompt).toContain('Use action "add" for each extracted player row');
    expect(prompt).toContain('Do not update, delete, deactivate, or reactivate');
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
      {
        rowNumber: 1,
        action: 'add',
        name: 'Jordan New',
        number: '23',
        reason: 'new row',
        duplicatePlayerId: '',
        duplicatePlayerName: '',
        errors: []
      },
      {
        rowNumber: 2,
        action: 'add',
        name: 'Avery Ace Jr.',
        number: '11',
        reason: 'same player corrected number',
        duplicatePlayerId: '',
        duplicatePlayerName: '',
        errors: []
      }
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

  it('flags likely duplicate adds and excludes errored rows from the commit plan', () => {
    const result = normalizeRosterAiImportResponse({
      operations: [
        { action: 'add', player: { name: 'Avery Ace', number: '10' } },
        { action: 'add', player: { name: 'Avary Ace', number: '10' } },
        { action: 'add', player: { name: 'Avery Ace', number: '11' } },
        { action: 'add', player: { name: 'Riley Runner', number: '12' } }
      ]
    }, {
      currentPlayers: [{ id: 'p1', name: 'Avery Ace', number: '10' }]
    });

    expect(result.rows[0].errors[0]).toContain('Possible duplicate');
    expect(result.rows[0].duplicatePlayerId).toBe('p1');
    expect(result.rows[1].errors[0]).toContain('Possible duplicate');
    expect(result.rows[1].duplicatePlayerId).toBe('p1');
    expect(result.rows[2].errors).toEqual([]);

    const plan = buildRosterAiImportCommitPlan(result.rows);
    expect(plan.addPlayers).toEqual([
      { name: 'Avery Ace', number: '11' },
      { name: 'Riley Runner', number: '12' }
    ]);
    expect(plan.skippedRows.map((row) => row.rowNumber)).toEqual([1, 2]);
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

  it('returns actionable errors for empty input and malformed responses', async () => {
    await expect(generateRosterAiImportRows({ text: '  ' })).resolves.toMatchObject({
      rows: [],
      errors: [expect.stringContaining('Paste roster text or upload')]
    });
    expect(aiMocks.generateContent).not.toHaveBeenCalled();
    expect(normalizeRosterAiImportResponse({ nope: [] }).errors[0]).toContain('operations array');
    expect(normalizeRosterAiImportResponse({ operations: [] }).errors[0]).toContain('did not find any players');
  });
});
