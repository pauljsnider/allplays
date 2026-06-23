import { DRILL_TYPES } from './adapters/legacyDrills';
import type { PracticeTimelineBlock, PracticeTimelineDrillOption } from './practiceTimelineService';
import type { TeamDrillSummary } from './teamDrillsService';

export type PracticeAiCoachPlanScope = 'full-session' | 'append' | 'gap-fill';

export type PracticeAiCoachPromptInput = {
  teamName?: string | null;
  sport?: string | null;
  ageGroup?: string | null;
  skillLevel?: string | null;
  targetMinutes?: string | number | null;
  availableMinutes?: string | number | null;
  rosterSize?: string | number | null;
  coachRequest?: string | null;
  goals?: unknown[];
  focusSkills?: unknown[];
  constraints?: unknown[];
  currentBlocks?: PracticeTimelineBlock[];
  drillOptions?: PracticeTimelineDrillOption[];
  favoriteDrills?: TeamDrillSummary[];
  planScope?: PracticeAiCoachPlanScope;
};

export type PracticeAiCoachPrompt = {
  system: string;
  user: string;
};

export type PracticeAiCoachPlanResult = {
  assistantMessage: string;
  blocks: PracticeTimelineBlock[];
  errors: string[];
  rawText?: string;
};

const maxPromptDrills = 80;
const allowedDrillTypes = new Set(DRILL_TYPES as string[]);

function normalizeString(value: unknown) {
  return String(value ?? '').trim();
}

function normalizeWholeNumber(value: unknown, fallback: number) {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, parsed);
}

function parsePositiveWholeNumber(value: unknown) {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function normalizeList(values: unknown[] | undefined, fallback: string[]) {
  const normalized = Array.from(new Set((Array.isArray(values) ? values : [])
    .map((value) => normalizeString(value))
    .filter(Boolean)));
  return normalized.length ? normalized : fallback;
}

function normalizeDrillType(value: unknown) {
  const normalized = normalizeString(value);
  return allowedDrillTypes.has(normalized) ? normalized : 'Technical';
}

function compactDrillForPrompt(drill: PracticeTimelineDrillOption | TeamDrillSummary) {
  const summary = drill as TeamDrillSummary;
  return {
    id: normalizeString(drill.id),
    title: normalizeString(drill.title),
    type: normalizeDrillType(drill.type),
    duration: normalizeWholeNumber((drill as PracticeTimelineDrillOption).duration ?? summary.setup?.duration, 10),
    description: normalizeString((drill as PracticeTimelineDrillOption).description ?? summary.description),
    source: normalizeString((drill as PracticeTimelineDrillOption).source || summary.attribution?.source || 'library'),
    skills: Array.isArray(summary.skills) ? summary.skills.slice(0, 6).map(normalizeString).filter(Boolean) : []
  };
}

function buildPromptContext(input: PracticeAiCoachPromptInput) {
  const drillOptions = Array.isArray(input.drillOptions) ? input.drillOptions : [];
  const favoriteDrills = Array.isArray(input.favoriteDrills) ? input.favoriteDrills : [];
  const currentBlocks = Array.isArray(input.currentBlocks) ? input.currentBlocks : [];
  const drillCatalog = [
    ...favoriteDrills.map(compactDrillForPrompt),
    ...drillOptions.map(compactDrillForPrompt)
  ].filter((drill) => drill.id && drill.title);
  const dedupedCatalog = Array.from(new Map(drillCatalog.map((drill) => [drill.id, drill])).values()).slice(0, maxPromptDrills);

  return {
    team: {
      name: normalizeString(input.teamName) || 'Team',
      sport: normalizeString(input.sport) || 'Soccer',
      ageGroup: normalizeString(input.ageGroup) || 'Not specified',
      skillLevel: normalizeString(input.skillLevel) || 'All'
    },
    targetPlanMinutes: normalizeWholeNumber(input.targetMinutes ?? input.availableMinutes, 60),
    planScope: input.planScope || 'full-session',
    rosterSize: normalizeWholeNumber(input.rosterSize, 10),
    practiceGoals: normalizeList(input.goals, ['Build a balanced practice with warm-up, skill work, game-like reps, and a short wrap-up.']),
    focusSkills: normalizeList(input.focusSkills, ['fundamentals', 'teamwork']),
    constraints: normalizeList(input.constraints, ['Keep instructions concise and age-appropriate.']),
    currentTimeline: currentBlocks.map((block, index) => ({
      order: index,
      drillId: block.drillId || null,
      title: normalizeString(block.drillTitle),
      type: normalizeDrillType(block.type),
      duration: normalizeWholeNumber(block.duration, 10),
      notes: normalizeString(block.notes)
    })),
    drillLibraryCatalog: dedupedCatalog
  };
}

export function buildPracticeAiCoachPrompt(input: PracticeAiCoachPromptInput): PracticeAiCoachPrompt {
  const sport = normalizeString(input.sport) || 'Soccer';
  const targetMinutes = normalizeWholeNumber(input.targetMinutes ?? input.availableMinutes, 60);
  const context = buildPromptContext(input);
  const coachRequest = normalizeString(input.coachRequest) || 'Build a balanced practice plan.';

  return {
    system: `You are ALL PLAYS AI coach. Build a ${sport} practice plan from the provided context.`,
    user: `
You are ALL PLAYS AI coach. Build a ${sport} practice plan from the provided context.

Hard constraints:
- Use the drillLibraryCatalog ids when a proposed block matches a real drill.
- Use drillId null only for free-text blocks that do not map to a real catalog drill.
- Return at most 3 core drill blocks in "coreBlocks".
- The total planned drill durations must equal exactly ${targetMinutes} minutes.
- Keep durations practical for the configured target duration.
- Plan scope is "${context.planScope}".
- If plan scope is "full-session", include warm-up and cool-down considerations.

You may optionally wrap drill blocks in structure containers (warmup, stations, scrimmage, cooldown, custom).
Structure blocks group drills into logical practice phases. The app will flatten them into the native practice timeline.

Return ONLY valid JSON in this shape:
{
  "assistantMessage": "short coaching rationale",
  "coreBlocks": [
    { "drillId": "catalog-drill-id-or-null", "title": "string", "type": "Technical|Tactical|Physical|Game|Warm-up", "duration": 12, "description": "string", "notes": "string" },
    { "blockType": "structure", "structureType": "warmup|stations|scrimmage|cooldown|custom", "title": "string", "duration": 15, "notes": "string", "children": [
      { "drillId": "catalog-drill-id-or-null", "title": "string", "type": "Technical", "duration": 5, "description": "string", "notes": "string" }
    ]}
  ]
}

Context JSON:
${JSON.stringify(context)}

Coach request:
${coachRequest}
    `.trim()
  };
}

export function parsePracticeAiCoachPlanResponse(rawText: unknown, input: PracticeAiCoachPromptInput = {}): PracticeAiCoachPlanResult {
  const raw = normalizeString(rawText);
  if (!raw) {
    return { assistantMessage: '', blocks: [], errors: ['AI response was empty.'] };
  }

  let parsed: any;
  try {
    parsed = parseAiJson(raw);
  } catch (error: any) {
    return { assistantMessage: '', blocks: [], errors: [error?.message || 'AI response was not valid JSON.'], rawText: raw };
  }

  if (!parsed || !Array.isArray(parsed.coreBlocks)) {
    return { assistantMessage: '', blocks: [], errors: ['AI response did not include a coreBlocks array.'], rawText: raw };
  }

  const drillLookup = buildDrillLookup(input);
  const normalizedBlocks: PracticeTimelineBlock[] = [];
  for (const candidate of parsed.coreBlocks) {
    const nextBlocks = normalizeAiBlock(candidate, drillLookup);
    if (!nextBlocks) {
      return { assistantMessage: '', blocks: [], errors: ['AI response included an incomplete timeline block.'], rawText: raw };
    }
    normalizedBlocks.push(...nextBlocks);
  }

  if (!normalizedBlocks.length) {
    return { assistantMessage: '', blocks: [], errors: ['AI response did not include any timeline blocks.'], rawText: raw };
  }

  return {
    assistantMessage: normalizeString(parsed.assistantMessage) || 'Review the proposed practice plan before accepting it into the timeline.',
    blocks: normalizedBlocks.map((block, index) => ({ ...block, order: index })),
    errors: [],
    rawText: raw
  };
}

export async function generatePracticeAiCoachPlan(input: PracticeAiCoachPromptInput): Promise<PracticeAiCoachPlanResult> {
  const prompt = buildPracticeAiCoachPrompt(input);

  try {
    const { getAI, getApp, getGenerativeModel, GoogleAIBackend } = await import('./adapters/legacyGenerativeAi');
    const app = getApp();
    const ai = getAI(app, { backend: new GoogleAIBackend() });
    const model = getGenerativeModel(ai, {
      model: 'gemini-2.5-flash',
      generationConfig: {
        responseMimeType: 'application/json'
      }
    });
    const result = await model.generateContent(prompt.user);
    const raw = normalizeString(result?.response?.text?.());
    const parsed = parsePracticeAiCoachPlanResponse(raw, input);
    if (parsed.errors.length) return parsed;
    return parsed;
  } catch (error: any) {
    const message = normalizeString(error?.message);
    return {
      assistantMessage: '',
      blocks: [],
      errors: [message ? `AI practice coach could not generate a plan: ${message}` : 'AI practice coach could not generate a plan. Try again.']
    };
  }
}

function parseAiJson(raw: string) {
  const cleaned = raw.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (jsonError) {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw jsonError;
    return JSON.parse(match[0]);
  }
}

type DrillLookup = {
  byId: Map<string, PracticeTimelineDrillOption | TeamDrillSummary>;
  byTitle: Map<string, PracticeTimelineDrillOption | TeamDrillSummary>;
};

function buildDrillLookup(input: PracticeAiCoachPromptInput): DrillLookup {
  const drills = [
    ...(Array.isArray(input.favoriteDrills) ? input.favoriteDrills : []),
    ...(Array.isArray(input.drillOptions) ? input.drillOptions : [])
  ];
  const byId = new Map<string, PracticeTimelineDrillOption | TeamDrillSummary>();
  const byTitle = new Map<string, PracticeTimelineDrillOption | TeamDrillSummary>();
  drills.forEach((drill) => {
    const id = normalizeString(drill.id);
    const title = normalizeString(drill.title);
    if (id) byId.set(id, drill);
    if (title) byTitle.set(title.toLowerCase(), drill);
  });
  return { byId, byTitle };
}

function normalizeAiBlock(candidate: any, lookup: DrillLookup): PracticeTimelineBlock[] | null {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;

  if (candidate.blockType === 'structure' && Array.isArray(candidate.children) && candidate.children.length) {
    const children: PracticeTimelineBlock[] = [];
    for (const child of candidate.children) {
      const normalizedChild = normalizeLeafBlock(child, lookup, normalizeString(candidate.title));
      if (!normalizedChild) return null;
      children.push(normalizedChild);
    }
    return children;
  }

  const leaf = normalizeLeafBlock(candidate, lookup);
  return leaf ? [leaf] : null;
}

function normalizeLeafBlock(candidate: any, lookup: DrillLookup, parentTitle = ''): PracticeTimelineBlock | null {
  const title = normalizeString(candidate?.drillTitle || candidate?.title);
  const duration = parsePositiveWholeNumber(candidate?.duration);
  if (!title || !duration) return null;

  const drill = resolveDrill(candidate?.drillId, title, lookup);
  const drillSummary = drill ? compactDrillForPrompt(drill) : null;
  const notes = [parentTitle ? `Phase: ${parentTitle}` : '', normalizeString(candidate?.notes || candidate?.customInstructions)].filter(Boolean).join('\n');

  return {
    order: 0,
    drillId: drillSummary?.id || null,
    drillTitle: drillSummary?.title || title,
    type: normalizeDrillType(candidate?.type || drillSummary?.type),
    duration,
    description: normalizeString(candidate?.description) || drillSummary?.description || '',
    notes,
    notesLog: []
  };
}

function resolveDrill(drillId: unknown, title: string, lookup: DrillLookup) {
  const normalizedId = normalizeString(drillId);
  if (normalizedId && lookup.byId.has(normalizedId)) return lookup.byId.get(normalizedId);
  const normalizedTitle = normalizeString(title).toLowerCase();
  if (normalizedTitle && lookup.byTitle.has(normalizedTitle)) return lookup.byTitle.get(normalizedTitle);
  return null;
}
