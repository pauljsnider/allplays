import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildPracticeAiCoachPrompt, generatePracticeAiCoachPlan, parsePracticeAiCoachPlanResponse } from './practiceAiCoachService';

const genAiMocks = vi.hoisted(() => ({
  generateContent: vi.fn(),
  getAI: vi.fn(() => ({ ai: true })),
  getApp: vi.fn(() => ({ app: true })),
  getGenerativeModel: vi.fn()
}));

vi.mock('./adapters/legacyGenerativeAi', () => ({
  getAI: genAiMocks.getAI,
  getApp: genAiMocks.getApp,
  getGenerativeModel: genAiMocks.getGenerativeModel,
  GoogleAIBackend: class GoogleAIBackend {}
}));

const drillOptions = [
  {
    id: 'drill-1',
    title: 'Rondo 4v2',
    type: 'Technical',
    duration: 15,
    description: 'Keep the ball moving.',
    source: 'community' as const
  },
  {
    id: 'drill-2',
    title: 'Finishing ladder',
    type: 'Technical',
    duration: 12,
    description: 'Close-range finishing.',
    source: 'team' as const
  }
];

describe('practiceAiCoachService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    genAiMocks.getGenerativeModel.mockReturnValue({
      generateContent: genAiMocks.generateContent
    });
  });

  it('builds the legacy-style JSON practice-plan prompt with timeline and drill context', () => {
    const prompt = buildPracticeAiCoachPrompt({
      teamName: 'Bears',
      sport: 'Soccer',
      ageGroup: 'U12',
      skillLevel: 'Intermediate',
      targetMinutes: 60,
      coachRequest: 'Focus on shooting from wide service.',
      focusSkills: ['finishing', 'first touch'],
      currentBlocks: [{
        order: 0,
        drillId: 'drill-1',
        drillTitle: 'Rondo 4v2',
        type: 'Technical',
        duration: 15,
        description: 'Keep the ball moving.',
        notes: 'Current warm-up',
        notesLog: []
      }],
      drillOptions
    });

    expect(prompt.system).toContain('ALL PLAYS AI coach');
    expect(prompt.user).toContain('Return ONLY valid JSON in this shape');
    expect(prompt.user).toContain('"coreBlocks"');
    expect(prompt.user).toContain('The total planned drill durations must equal exactly 60 minutes');
    expect(prompt.user).toContain('"skillLevel":"Intermediate"');
    expect(prompt.user).toContain('"currentTimeline":[{"order":0,"drillId":"drill-1"');
    expect(prompt.user).toContain('"drillLibraryCatalog":[{"id":"drill-1","title":"Rondo 4v2"');
    expect(prompt.user).toContain('Focus on shooting from wide service.');
  });

  it('parses a well-formed AI fixture into native practice timeline blocks', () => {
    const result = parsePracticeAiCoachPlanResponse(`
      \`\`\`json
      {
        "assistantMessage": "Use touch quality before finishing.",
        "coreBlocks": [
          { "drillId": "drill-1", "title": "Rondo 4v2", "type": "Technical", "duration": 15, "notes": "Two-touch max" },
          { "title": "Free finishing wave", "type": "Game", "duration": 20, "description": "Unmapped free-text block" },
          { "blockType": "structure", "title": "Stations", "duration": 10, "children": [
            { "title": "Finishing ladder", "type": "Technical", "duration": 10, "notes": "Rotate lines" }
          ]}
        ]
      }
      \`\`\`
    `, { drillOptions });

    expect(result.errors).toEqual([]);
    expect(result.assistantMessage).toBe('Use touch quality before finishing.');
    expect(result.blocks).toEqual([
      expect.objectContaining({ order: 0, drillId: 'drill-1', drillTitle: 'Rondo 4v2', duration: 15 }),
      expect.objectContaining({ order: 1, drillId: null, drillTitle: 'Free finishing wave', type: 'Game', duration: 20 }),
      expect.objectContaining({ order: 2, drillId: 'drill-2', drillTitle: 'Finishing ladder', notes: 'Phase: Stations\nRotate lines' })
    ]);
  });

  it('returns a safe error with no partial timeline for malformed blocks', () => {
    const result = parsePracticeAiCoachPlanResponse(JSON.stringify({
      assistantMessage: 'Partial plan',
      coreBlocks: [
        { title: 'Warm-up', type: 'Warm-up', duration: 10 },
        { title: 'Missing duration', type: 'Technical' }
      ]
    }), { drillOptions });

    expect(result.blocks).toEqual([]);
    expect(result.errors).toEqual(['AI response included an incomplete timeline block.']);
  });

  it('lazy-loads GenAI at generation time and returns a retry-safe error on model failure', async () => {
    genAiMocks.generateContent.mockRejectedValue(new Error('network down'));

    const result = await generatePracticeAiCoachPlan({
      teamName: 'Bears',
      sport: 'Soccer',
      targetMinutes: 45,
      coachRequest: 'Shooting plan',
      drillOptions
    });

    expect(genAiMocks.getApp).toHaveBeenCalled();
    expect(genAiMocks.getGenerativeModel).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      model: 'gemini-2.5-flash',
      generationConfig: { responseMimeType: 'application/json' }
    }));
    expect(result.blocks).toEqual([]);
    expect(result.errors[0]).toContain('network down');
  });
});
