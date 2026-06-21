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

vi.mock('./adapters/legacyGenerativeAi', () => ({
  getApp: vi.fn(() => ({})),
  getAI: vi.fn(() => ({})),
  getGenerativeModel: aiMocks.getGenerativeModel,
  GoogleAIBackend: vi.fn(),
  Schema: aiMocks.Schema
}));

import {
  buildScheduleAiImportPrompt,
  generateScheduleAiImportRows,
  normalizeScheduleAiImportResponse
} from './scheduleAiImport';

describe('scheduleAiImport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds a prompt with team context, current games, and image/text instructions', () => {
    const prompt = buildScheduleAiImportPrompt({
      teamName: 'U10 Bears',
      text: 'only home games',
      imageFile: { name: 'schedule.png' } as File,
      currentGames: [{ id: 'g1', date: '2026-06-01T18:00:00', opponent: 'Rockets', location: 'Field 1' }],
      now: new Date('2026-05-31T12:00:00Z')
    });

    expect(prompt).toContain('Team: U10 Bears');
    expect(prompt).toContain('Current games in DB: 1');
    expect(prompt).toContain('Rockets');
    expect(prompt).toContain('schedule is attached as an image');
    expect(prompt).toContain('only home games');
    expect(prompt).toContain('Only create operations with action "add"');
  });

  it('normalizes valid add-game operations into import preview rows', () => {
    const result = normalizeScheduleAiImportResponse({
      operations: [{
        action: 'add',
        game: {
          date: '2026-06-05T18:30:00',
          opponent: 'Falcons',
          location: 'Main Field',
          isHome: true,
          arrivalTime: '2026-06-05T18:00:00',
          notes: 'Wear blue',
          assignments: [{ role: 'snack', value: 'Lee family' }]
        },
        reason: 'read from line 1'
      }]
    }, { teamName: 'Bears' });

    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].normalized).toMatchObject({
      eventType: 'game',
      startsAt: '2026-06-05T18:30',
      opponent: 'Falcons',
      location: 'Main Field',
      isHome: true,
      arrivalTime: '2026-06-05T18:00'
    });
    expect(result.rows[0].normalized.notes).toContain('snack: Lee family');
    expect(result.rows[0].errors).toEqual([]);
  });

  it('returns actionable errors for malformed or empty AI responses', () => {
    expect(normalizeScheduleAiImportResponse({ nope: [] }).errors[0]).toContain('operations array');
    expect(normalizeScheduleAiImportResponse({ operations: [] }).errors[0]).toContain('did not find any games');
  });

  it('generates rows through Firebase AI without persisting them', async () => {
    aiMocks.generateContent.mockResolvedValue({
      response: {
        text: () => JSON.stringify({
          operations: [{ action: 'add', game: { date: '2026-06-06T10:00:00', opponent: 'Tigers' } }]
        })
      }
    });

    const result = await generateScheduleAiImportRows({
      teamName: 'Bears',
      text: 'Sat 10am vs Tigers',
      now: new Date('2026-05-31T12:00:00Z')
    });

    expect(aiMocks.getGenerativeModel).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      model: 'gemini-2.5-flash',
      generationConfig: expect.objectContaining({ responseMimeType: 'application/json' })
    }));
    expect(aiMocks.generateContent).toHaveBeenCalledWith([expect.stringContaining('Sat 10am vs Tigers')]);
    expect(result.rows[0].normalized.opponent).toBe('Tigers');
  });

  it('does not call AI when both text and image are empty', async () => {
    const result = await generateScheduleAiImportRows({ teamName: 'Bears', text: '   ' });

    expect(result.rows).toEqual([]);
    expect(result.errors[0]).toContain('Paste schedule text or upload');
    expect(aiMocks.generateContent).not.toHaveBeenCalled();
  });
});
