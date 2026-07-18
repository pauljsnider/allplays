import { getAI, getApp, getGenerativeModel, GoogleAIBackend } from './adapters/legacyGenerativeAi';
import {
  containsUnsafeOpportunityAiText,
  opportunityAvailabilityOptions,
  type ManagedOpportunityTeam,
  type OpportunityInput
} from './opportunityLogic';

export type OpportunityAiSuggestion = Partial<Pick<
  OpportunityInput,
  | 'title'
  | 'description'
  | 'sport'
  | 'role'
  | 'ageGroup'
  | 'competitiveLevel'
  | 'division'
  | 'city'
  | 'state'
  | 'zip'
  | 'availability'
  | 'startDate'
  | 'compensationType'
  | 'compensationSummary'
>>;

const textLimits: Partial<Record<keyof OpportunityAiSuggestion, number>> = {
  title: 100,
  description: 1500,
  sport: 60,
  role: 80,
  ageGroup: 40,
  competitiveLevel: 60,
  division: 60,
  city: 80,
  state: 40,
  zip: 10,
  availability: 240,
  startDate: 20,
  compensationSummary: 160
};
const compensationTypes = new Set<OpportunityInput['compensationType']>(['paid', 'volunteer', 'either', 'not_applicable']);
let opportunityAiModel: ReturnType<typeof getGenerativeModel> | null = null;

function compact(value: unknown, maxLength: number) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

export function assertOpportunityAiDraftSafe(
  input: OpportunityInput,
  team: ManagedOpportunityTeam | null
) {
  const unsafeDraftValue = [...Object.values(input), ...Object.values(team || {})]
    .find((value) => typeof value === 'string' && containsUnsafeOpportunityAiText(value));
  if (unsafeDraftValue) {
    throw new Error('Remove contact, school, birth, or exact-address details before using AI. Your draft was not sent.');
  }
}

export function parseOpportunityAiSuggestion(responseText: string): OpportunityAiSuggestion {
  const source = String(responseText || '').trim();
  const objectStart = source.indexOf('{');
  const objectEnd = source.lastIndexOf('}');
  if (objectStart < 0 || objectEnd <= objectStart) {
    throw new Error('AI did not return a usable opportunity draft.');
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(source.slice(objectStart, objectEnd + 1));
  } catch {
    throw new Error('AI did not return a usable opportunity draft.');
  }

  const suggestion: OpportunityAiSuggestion = {};
  Object.entries(textLimits).forEach(([key, maxLength]) => {
    const value = compact(parsed[key], maxLength || 0);
    if (value) (suggestion as Record<string, unknown>)[key] = value;
  });
  if (compensationTypes.has(parsed.compensationType as OpportunityInput['compensationType'])) {
    suggestion.compensationType = parsed.compensationType as OpportunityInput['compensationType'];
  }
  if (suggestion.availability && !opportunityAvailabilityOptions.includes(suggestion.availability as typeof opportunityAvailabilityOptions[number])) {
    delete suggestion.availability;
  }

  if (Object.values(suggestion).some(containsUnsafeOpportunityAiText)) {
    throw new Error('AI returned details that are not safe for a public listing. Your draft was not changed.');
  }
  if (!suggestion.title && !suggestion.description) {
    throw new Error('AI did not return a usable opportunity draft.');
  }
  return suggestion;
}

export function applyOpportunityAiSuggestion(input: OpportunityInput, suggestion: OpportunityAiSuggestion): OpportunityInput {
  return {
    ...input,
    ...suggestion,
    kind: input.kind,
    teamId: input.teamId,
    guardianAttested: input.guardianAttested
  };
}

async function getOpportunityAiModel() {
  if (opportunityAiModel) return opportunityAiModel;
  const ai = getAI(getApp(), { backend: new GoogleAIBackend() });
  opportunityAiModel = getGenerativeModel(ai, { model: 'gemini-2.5-flash' });
  return opportunityAiModel;
}

export async function enhanceOpportunityDraft(input: OpportunityInput, team: ManagedOpportunityTeam | null) {
  assertOpportunityAiDraftSafe(input, team);
  const prompt = [
    'You improve public youth-sports opportunity listings for ALL PLAYS.',
    'Return one JSON object only. Do not use Markdown.',
    'Improve the title and description, and fill only fields supported by the supplied draft/team data.',
    'Never invent or include email, phone, exact street address, a minor name, birth information, school details, employment guarantees, or unsupported claims.',
    `Allowed availability values: ${opportunityAvailabilityOptions.join(', ')}.`,
    'Allowed compensationType values: paid, volunteer, either, not_applicable.',
    'Allowed JSON keys: title, description, sport, role, ageGroup, competitiveLevel, division, city, state, zip, availability, startDate, compensationType, compensationSummary.',
    `LISTING_KIND: ${input.kind}`,
    `TEAM: ${JSON.stringify(team || {})}`,
    `CURRENT_DRAFT: ${JSON.stringify(input)}`
  ].join('\n');
  const model = await getOpportunityAiModel();
  const result = await model.generateContent(prompt);
  return parseOpportunityAiSuggestion(result.response.text());
}
