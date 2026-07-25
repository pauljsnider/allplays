import { getAI, getApp, getGenerativeModel, GoogleAIBackend, Schema } from './adapters/legacyRosterAi';
import {
  getRosterAiImportFieldCatalog,
  planRosterAiImport,
  planRosterCsvImport
} from './adapters/legacyRosterImport';
import type {
  RosterImportPlannedOperationForApp,
  TeamRosterFieldDefinition
} from './teamDetailService';

export type RosterAiImportCurrentPlayer = {
  id?: string;
  name?: string | null;
  number?: string | number | null;
  active?: boolean;
  profile?: Record<string, any>;
  privateProfileRosterFields?: Record<string, any>;
  privateProfileParents?: Array<Record<string, any>>;
  privateProfileContacts?: Array<Record<string, any>>;
};

export type RosterAiImportInput = {
  text?: string;
  csvText?: string;
  imageFile?: File | null;
  currentPlayers?: RosterAiImportCurrentPlayer[];
  rosterFields?: TeamRosterFieldDefinition[];
};

export type RosterAiImportPreviewField = {
  key: string;
  label: string;
  type: 'text' | 'menu' | 'checkbox' | 'date';
  section?: string;
  value: unknown;
  options?: Array<{ value: string; label: string }>;
};

export type RosterAiImportPreviewContact = {
  name?: string;
  email?: string;
  phone?: string;
  relation?: string;
  bucket?: string;
  providedKeys?: string[];
};

export type RosterAiImportPreviewRow = {
  rowNumber: number;
  action: 'add' | 'update' | 'deactivate' | 'reactivate';
  playerId: string;
  name: string;
  number: string;
  reason: string;
  fields: RosterAiImportPreviewField[];
  contacts: RosterAiImportPreviewContact[];
  inviteCount: number;
  duplicatePlayerId: string;
  duplicatePlayerName: string;
  errors: string[];
  operation: RosterImportPlannedOperationForApp;
  rawOperation?: Record<string, any>;
};

export type RosterAiImportResult = {
  rows: RosterAiImportPreviewRow[];
  errors: string[];
  source: 'csv' | 'ai-text' | 'ai-image' | 'ai-document';
};

export type RosterAiImportCommitPlan = {
  operations: RosterImportPlannedOperationForApp[];
  addPlayers: Array<{ name: string; number: string }>;
  skippedRows: RosterAiImportPreviewRow[];
};

const maxContextPlayers = 120;

export async function generateRosterAiImportRows(input: RosterAiImportInput): Promise<RosterAiImportResult> {
  const sourceText = String(input.text || '').trim();
  const text = compactText(input.text || '');
  const explicitCsvText = String(input.csvText || '').trim();
  const csvText = explicitCsvText || extractPastedRosterCsv(sourceText);
  const imageFile = input.imageFile || null;
  if (!text && !csvText && !imageFile) {
    return {
      rows: [],
      errors: ['Paste roster text, attach a CSV, or upload a roster image before using AI import.'],
      source: 'ai-text'
    };
  }

  if (csvText) {
    const plan = planRosterCsvImport({
      csvText,
      fields: input.rosterFields || [],
      existingPlayers: input.currentPlayers || []
    });
    const deterministic = normalizeRosterImportPlan(plan, input, 'csv');
    const shouldUseAiFallback = deterministic.errors.length > 0
      && !deterministic.errors.some((error) => (
        error.includes('CSV is empty')
        || error.includes('Import at most 200 roster rows')
      ));
    if (!shouldUseAiFallback) return deterministic;

    try {
      const fallbackText = [
        text,
        'The deterministic CSV parser reported these structural errors:',
        ...deterministic.errors.map((error) => `- ${error}`),
        'Interpret the CSV using the supported roster contract. Preserve every supplied column and value. If a column is unknown, include its original header as a property so it stays visible as a review error rather than dropping it.',
        `CSV content:\n${csvText}`
      ].filter(Boolean).join('\n');
      const model = getRosterAiImportModel(input.rosterFields || []);
      const result = await model.generateContent([buildRosterAiImportPrompt({
        ...input,
        text: fallbackText,
        csvText: ''
      })]);
      const response = JSON.parse(compactText(result?.response?.text?.() || '') || '{}');
      const fallback = normalizeRosterAiImportResponse(response, {
        ...input,
        csvText: '',
        imageFile: null
      });
      return {
        ...fallback,
        source: 'csv'
      };
    } catch (error: any) {
      return {
        ...deterministic,
        errors: [
          ...deterministic.errors,
          error?.message
            ? `AI fallback could not interpret the CSV: ${error.message}`
            : 'AI fallback could not interpret the CSV.'
        ]
      };
    }
  }

  const deterministicTextMutation = parseSimpleRosterTextMutation(sourceText);
  if (deterministicTextMutation) {
    return normalizeRosterAiImportResponse(deterministicTextMutation, input);
  }

  try {
    const model = getRosterAiImportModel(input.rosterFields || []);
    const promptParts: any[] = [buildRosterAiImportPrompt({ ...input, text })];
    if (imageFile) promptParts.push(await fileToGenerativePart(imageFile));

    const result = await model.generateContent(promptParts);
    const responseText = compactText(result?.response?.text?.() || '');
    const response = JSON.parse(responseText || '{}');
    return normalizeRosterAiImportResponse(
      sourceText ? repairRosterAiResponseFromText(response, sourceText, input) : response,
      input
    );
  } catch (error: any) {
    return {
      rows: [],
      errors: [error?.message ? `AI could not parse the roster: ${error.message}` : 'AI could not parse the roster. Try clearer text, a sharper image, or a text-based PDF.'],
      source: getRosterAiSource(imageFile)
    };
  }
}

function parseSimpleRosterTextMutation(value: string): { operations: Array<Record<string, any>> } | null {
  const text = compactText(value);
  const updateNumberPatterns = [
    /\bupdate(?:\s+only)?\s+(.+?)['’]s\s+jersey(?:\s+number)?\s+(?:from\s+#?[A-Z0-9-]+\s+)?to\s+#?([A-Z0-9-]{1,12})\b/i,
    /\bupdate(?:\s+only)?(?:\s+player)?\s+(.+?)\s+jersey(?:\s+number)?\s+(?:from\s+#?[A-Z0-9-]+\s+)?to\s+#?([A-Z0-9-]{1,12})\b/i
  ];
  const updateNumberMatch = updateNumberPatterns
    .map((pattern) => text.match(pattern))
    .find(Boolean);
  if (!updateNumberMatch) return null;

  const name = compactText(updateNumberMatch[1]).replace(/^player\s+/i, '');
  const number = normalizeJerseyNumber(updateNumberMatch[2]);
  if (!name || !number) return null;
  return {
    operations: [{
      action: 'update',
      changes: { name, number },
      reason: 'Explicit jersey-number update'
    }]
  };
}

export function extractPastedRosterCsv(value: string): string {
  const lines = String(value || '').split(/\r?\n/);
  if (lines.length < 2) return '';

  const headerIndex = lines.findIndex((line) => isRosterCsvHeader(line));
  if (headerIndex < 0) return '';

  const csvLines = [lines[headerIndex].trim()];
  for (const line of lines.slice(headerIndex + 1)) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (csvLines.length > 1) break;
      continue;
    }
    if (csvLines.length > 1 && !trimmed.includes(',')) break;
    csvLines.push(line.trimEnd());
  }
  return csvLines.length > 1 ? csvLines.join('\n').trim() : '';
}

function isRosterCsvHeader(value: string): boolean {
  if (!value.includes(',')) return false;
  const headers = value
    .split(',')
    .map((header) => header.trim().replace(/^"|"$/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim());
  const nameHeaders = new Set(['name', 'player', 'player name', 'athlete', 'athlete name']);
  const rosterHeaders = new Set([
    'number',
    'jersey',
    'jersey number',
    'parent name',
    'parent email',
    'parent phone',
    'parent relation',
    'guardian name',
    'guardian email',
    'contact name',
    'contact email',
    'roster status'
  ]);
  return headers.some((header) => nameHeaders.has(header))
    && headers.some((header) => rosterHeaders.has(header));
}

export function buildRosterAiImportPrompt(input: RosterAiImportInput): string {
  const currentPlayers = normalizeCurrentPlayers(input.currentPlayers || []).slice(0, maxContextPlayers);
  const fieldCatalog = getRosterAiImportFieldCatalog(input.rosterFields || []);
  const text = compactText(input.text || '');
  const hasImage = Boolean(input.imageFile);
  const attachmentLabel = input.imageFile && (
    input.imageFile.type === 'application/pdf'
    || input.imageFile.name.toLowerCase().endsWith('.pdf')
  ) ? 'PDF' : 'image';

  return `Parse this roster or team-management request for ALL PLAYS.

CONTEXT:
- Current players in roster: ${currentPlayers.length}
- Current player records: ${JSON.stringify(currentPlayers)}
- Supported roster field contract: ${JSON.stringify(fieldCatalog)}

INPUT:
${hasImage ? `- A roster ${attachmentLabel} is attached. Extract visible player and family-contact rows.` : '- Roster text or instructions are pasted below.'}
${text ? `- Pasted roster text or instructions:\n${text}` : '- No extra text instructions were provided.'}

OUTPUT RULES:
1. Return strict JSON only with an operations array.
2. Use only supported field keys. Preserve suffixes, punctuation, and visible values.
3. Include a property only when it appears in the source or the instructions explicitly request changing or clearing it. Never add empty placeholder fields.
4. Put address parts in address. Put every parent, guardian, emergency, or family contact in the same player's familyContacts array with only the contact properties actually supplied. Never defer contacts to another turn.
5. Compare against current players. Use add for new players, update with playerId for matches, and deactivate/reactivate only when requested.
6. Treat delete/remove as a recoverable deactivate request.
7. Preserve explicit false checkbox values and explicit clears because property presence is intentional.
8. Put OCR uncertainty or skipped-row context in reason.
9. Every email address visible in the source must appear in exactly one familyContacts entry. Do not silently omit an email.
10. "number" is the player's jersey number. Use jerseySize only when the source explicitly labels a clothing size. Never put a team name, roster heading, instruction, or null placeholder into a player field.
11. If no players are found, return {"operations":[]}.

JSON shape:
{"operations":[{"action":"add","player":{"name":"John Smith","number":"10","position":"Forward","familyContacts":[{"name":"Pat Smith","relation":"Parent","email":"pat@example.com","kind":"parent"}]},"reason":"read from row 1"}]}`;
}

function repairRosterAiResponseFromText(
  response: unknown,
  sourceText: string,
  input: Partial<RosterAiImportInput>
): unknown {
  if (!response || typeof response !== 'object' || !Array.isArray((response as any).operations)) return response;
  const repaired = structuredCloneSafe(response as Record<string, any>);
  const operations = repaired.operations as Array<Record<string, any>>;
  const normalizedSource = sourceText.toLowerCase();
  const currentPlayers = Array.isArray(input.currentPlayers) ? input.currentPlayers : [];
  const fieldCatalog = getRosterAiImportFieldCatalog(input.rosterFields || []);
  const operationNames = operations.map((operation) => {
    const action = normalizeAction(operation.action);
    const draft = action === 'add' ? operation.player : operation.changes;
    const playerId = compactText(operation.playerId);
    const currentPlayer = currentPlayers.find((player) => compactText(player.id) === playerId);
    return compactText(draft?.name || currentPlayer?.name);
  });
  const operationStarts = operationNames.map((name) => name
    ? normalizedSource.indexOf(name.toLowerCase())
    : -1);
  const sourceEmails = extractRosterEmails(sourceText);

  operations.forEach((operation, operationIndex) => {
    const action = normalizeAction(operation.action);
    if (action === 'deactivate' || action === 'reactivate') return;
    const draftKey = action === 'add' ? 'player' : 'changes';
    if (!operation[draftKey] || typeof operation[draftKey] !== 'object') operation[draftKey] = {};
    const draft = operation[draftKey] as Record<string, any>;
    pruneRosterAiPlaceholders(draft);

    const start = operationStarts[operationIndex];
    const nextStart = operationStarts
      .slice(operationIndex + 1)
      .find((candidate) => candidate > start);
    const segment = start >= 0
      ? sourceText.slice(start, nextStart && nextStart > start ? nextStart : sourceText.length)
      : operations.length === 1
        ? sourceText
        : '';

    const explicitNumber = extractRosterNumber(segment);
    if (explicitNumber) {
      draft.number = explicitNumber;
      if (!/\bjersey\s+size\b/i.test(segment) && compactText(draft.jerseySize) === explicitNumber) {
        delete draft.jerseySize;
      }
    }

    pruneUnsupportedRosterAiFields(draft, segment, fieldCatalog);

    const segmentEmails = extractRosterEmails(segment);
    const assignedEmails = segmentEmails.length
      ? segmentEmails
      : sourceEmails.length === operations.length && sourceEmails[operationIndex]
        ? [sourceEmails[operationIndex]]
        : [];
    if (!assignedEmails.length) return;

    const familyContacts = Array.isArray(draft.familyContacts)
      ? draft.familyContacts.filter((contact: unknown) => contact && typeof contact === 'object')
      : [];
    assignedEmails.forEach((email) => {
      const existing = familyContacts.find((contact: Record<string, any>) => compactText(contact.email).toLowerCase() === email);
      const recovered = recoverRosterContactFromText(segment || sourceText, email);
      if (existing) {
        if (!compactText(existing.name) && recovered.name) existing.name = recovered.name;
        if (!compactText(existing.relation) && recovered.relation) existing.relation = recovered.relation;
        existing.email = email;
        if (!compactText(existing.kind)) existing.kind = 'parent';
        return;
      }
      familyContacts.push({
        ...(recovered.name ? { name: recovered.name } : {}),
        email,
        relation: recovered.relation || 'Parent',
        kind: 'parent'
      });
    });
    draft.familyContacts = familyContacts;
  });

  repaired.operations = operations.filter((operation) => {
    const action = normalizeAction(operation.action);
    if (action !== 'update') return true;
    const changes = operation.changes;
    return Boolean(changes && typeof changes === 'object' && Object.keys(changes).length);
  });

  return repaired;
}

function extractRosterEmails(value: string): string[] {
  const matches = String(value || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  return Array.from(new Set(matches.map((email) => email.toLowerCase())));
}

function extractRosterNumber(segment: string): string {
  const match = String(segment || '').match(/\b(?:jersey(?:\s+number)?|number)\s*(?:is|:|#)?\s*#?([A-Z0-9-]{1,12})\b/i);
  return normalizeJerseyNumber(match?.[1]);
}

function recoverRosterContactFromText(segment: string, email: string): { name: string; relation: string } {
  const emailIndex = segment.toLowerCase().indexOf(email.toLowerCase());
  if (emailIndex < 0) return { name: '', relation: 'Parent' };
  const before = segment.slice(Math.max(0, emailIndex - 220), emailIndex);
  const after = segment.slice(emailIndex + email.length, emailIndex + email.length + 180);
  const namePatterns = [
    /\bname\s*:\s*([A-Z][A-Z .'-]{0,80}?)\s*(?:[-,]\s*)?(?:email\s*:\s*)$/i,
    /\b(?:family\s+contact|parent\s*\/\s*guardian|parent|guardian|emergency\s+contact)\s*:?\s*([A-Z][A-Z .'-]{0,80}?)\s*,?\s*$/i,
    /([A-Z][A-Z .'-]{1,80})\s*,\s*$/i
  ];
  const name = namePatterns
    .map((pattern) => compactText(before.match(pattern)?.[1]))
    .find(Boolean) || '';
  const relationMatch = after.match(/\brelation\s*:?\s*([A-Z][A-Z -]{0,30}?)(?=[.,;\n]|(?:\s+-\s+kind\b)|$)/i);
  const knownRelation = after.match(/\b(Mother|Father|Mom|Dad|Parent|Guardian|Grandparent|Caregiver|Other)\b/i)
    || before.match(/\b(Mother|Father|Mom|Dad|Guardian|Grandparent|Caregiver)\b/i);
  return {
    name,
    relation: compactText(relationMatch?.[1] || knownRelation?.[1] || 'Parent')
  };
}

function pruneRosterAiPlaceholders(draft: Record<string, any>) {
  Object.keys(draft).forEach((key) => {
    const value = draft[key];
    if (value == null || (typeof value === 'string' && ['null', 'undefined'].includes(value.trim().toLowerCase()))) {
      delete draft[key];
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => {
        if (item && typeof item === 'object') pruneRosterAiPlaceholders(item);
      });
      if (!value.length) delete draft[key];
      return;
    }
    if (typeof value === 'object') {
      pruneRosterAiPlaceholders(value);
      if (!Object.keys(value).length) delete draft[key];
    }
  });
}

function pruneUnsupportedRosterAiFields(
  draft: Record<string, any>,
  segment: string,
  fieldCatalog: Array<Record<string, any>>
) {
  if (!segment) return;
  const normalizedSegment = compactText(segment).toLowerCase();
  const protectedKeys = new Set(['name', 'number', 'address', 'familyContacts']);
  Object.keys(draft).forEach((key) => {
    if (protectedKeys.has(key) || typeof draft[key] !== 'string') return;
    if (key === 'rosterStatus') {
      if (!/\b(roster\s+status|non-player|nonplayer|staff)\b/i.test(segment)) delete draft[key];
      return;
    }
    const definition = fieldCatalog.find((field) => compactText(field.key) === key);
    const fieldPhrases = [key, definition?.label]
      .map((value) => compactText(value).toLowerCase())
      .filter(Boolean);
    const fieldMentioned = fieldPhrases.some((phrase) => normalizedSegment.includes(phrase));
    const value = compactText(draft[key]).toLowerCase();
    if (!fieldMentioned && value && !normalizedSegment.includes(value)) delete draft[key];
  });
}

export function normalizeRosterAiImportResponse(
  response: unknown,
  input: Partial<RosterAiImportInput> = {}
): RosterAiImportResult {
  const operations = Array.isArray((response as any)?.operations)
    ? (response as any).operations as Array<Record<string, any>>
    : null;
  const source = getRosterAiSource(input.imageFile || null);
  if (!operations) {
    return { rows: [], errors: ['AI response did not include an operations array.'], source };
  }
  if (!operations.length) {
    return {
      rows: [],
      errors: ['AI did not find any players to import. Try adding more roster details or a clearer image.'],
      source
    };
  }

  const plan = planRosterAiImport({
    aiOperations: operations,
    fields: input.rosterFields || [],
    existingPlayers: input.currentPlayers || [],
    source: 'roster-ai'
  });
  return normalizeRosterImportPlan(plan, input, source, operations);
}

function getRosterAiSource(file: File | null): RosterAiImportResult['source'] {
  if (!file) return 'ai-text';
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
    ? 'ai-document'
    : 'ai-image';
}

export function buildRosterAiImportCommitPlan(
  rows: RosterAiImportPreviewRow[] = [],
  selectedRowNumbers?: number[]
): RosterAiImportCommitPlan {
  const selected = selectedRowNumbers ? new Set(selectedRowNumbers) : null;
  const operations: RosterImportPlannedOperationForApp[] = [];
  const skippedRows: RosterAiImportPreviewRow[] = [];

  rows.forEach((row) => {
    if (selected && !selected.has(row.rowNumber)) return;
    if (row.errors.length) {
      skippedRows.push(row);
      return;
    }
    operations.push(row.operation);
  });

  return {
    operations,
    addPlayers: operations
      .filter((operation) => operation.type === 'add')
      .map((operation) => ({
        name: compactText(operation.payload?.name),
        number: normalizeJerseyNumber(operation.payload?.number)
      })),
    skippedRows
  };
}

export function updateRosterAiImportPreviewRow(
  rows: RosterAiImportPreviewRow[] = [],
  rowNumber: number,
  changes: { name?: string; number?: string },
  currentPlayers: RosterAiImportCurrentPlayer[] = [],
  rosterFields: TeamRosterFieldDefinition[] = []
): RosterAiImportPreviewRow[] {
  let nextRows = rows;
  if (Object.prototype.hasOwnProperty.call(changes, 'name')) {
    nextRows = updateRosterAiImportPreviewField(nextRows, rowNumber, 'name', compactText(changes.name), currentPlayers, rosterFields);
  }
  if (Object.prototype.hasOwnProperty.call(changes, 'number')) {
    nextRows = updateRosterAiImportPreviewField(nextRows, rowNumber, 'number', normalizeJerseyNumber(changes.number), currentPlayers, rosterFields);
  }
  return nextRows;
}

export function updateRosterAiImportPreviewField(
  rows: RosterAiImportPreviewRow[] = [],
  rowNumber: number,
  fieldKey: string,
  value: unknown,
  currentPlayers: RosterAiImportCurrentPlayer[] = [],
  rosterFields: TeamRosterFieldDefinition[] = []
): RosterAiImportPreviewRow[] {
  const rawOperations = rows.map((row) => cloneRawOperation(row));
  const targetIndex = rows.findIndex((row) => row.rowNumber === rowNumber);
  if (targetIndex < 0) return rows;
  const raw = rawOperations[targetIndex];
  const draftKey = normalizeAction(raw.action) === 'add' ? 'player' : 'changes';
  if (!raw[draftKey] || typeof raw[draftKey] !== 'object') raw[draftKey] = {};
  if (fieldKey.startsWith('unknown.') && value === '') {
    delete raw[draftKey][fieldKey.slice('unknown.'.length)];
  } else {
    setDraftField(raw[draftKey], fieldKey, value);
  }
  const plan = planRosterAiImport({
    aiOperations: rawOperations,
    fields: rosterFields,
    existingPlayers: currentPlayers,
    source: 'roster-ai'
  });
  return normalizePlanRows(plan.operations, currentPlayers, rawOperations, rosterFields);
}

export function updateRosterAiImportPreviewContact(
  rows: RosterAiImportPreviewRow[] = [],
  rowNumber: number,
  contactIndex: number,
  contactKey: 'name' | 'email' | 'phone' | 'relation',
  value: string,
  currentPlayers: RosterAiImportCurrentPlayer[] = [],
  rosterFields: TeamRosterFieldDefinition[] = []
): RosterAiImportPreviewRow[] {
  const rawOperations = rows.map((row) => cloneRawOperation(row));
  const targetIndex = rows.findIndex((row) => row.rowNumber === rowNumber);
  if (targetIndex < 0) return rows;
  const raw = rawOperations[targetIndex];
  const draftKey = normalizeAction(raw.action) === 'add' ? 'player' : 'changes';
  if (!raw[draftKey] || typeof raw[draftKey] !== 'object') raw[draftKey] = {};
  if (!Array.isArray(raw[draftKey].familyContacts)) raw[draftKey].familyContacts = [];
  if (!raw[draftKey].familyContacts[contactIndex]) raw[draftKey].familyContacts[contactIndex] = {};
  raw[draftKey].familyContacts[contactIndex][contactKey] = value;
  const plan = planRosterAiImport({
    aiOperations: rawOperations,
    fields: rosterFields,
    existingPlayers: currentPlayers,
    source: 'roster-ai'
  });
  return normalizePlanRows(plan.operations, currentPlayers, rawOperations, rosterFields);
}

export function changeRosterAiImportPreviewAction(
  rows: RosterAiImportPreviewRow[] = [],
  rowNumber: number,
  action: RosterAiImportPreviewRow['action'],
  currentPlayers: RosterAiImportCurrentPlayer[] = [],
  rosterFields: TeamRosterFieldDefinition[] = []
): RosterAiImportPreviewRow[] {
  const rawOperations = rows.map((row) => cloneRawOperation(row));
  const targetIndex = rows.findIndex((row) => row.rowNumber === rowNumber);
  if (targetIndex < 0) return rows;

  const raw = rawOperations[targetIndex];
  const currentAction = normalizeAction(raw.action);
  const draft = structuredCloneSafe(
    (currentAction === 'add' ? raw.player : raw.changes)
      || raw.player
      || raw.changes
      || {}
  );
  raw.action = action;

  if (action === 'add') {
    raw.player = draft;
    delete raw.changes;
    delete raw.playerId;
  } else {
    raw.changes = draft;
    delete raw.player;
  }

  const plan = planRosterAiImport({
    aiOperations: rawOperations,
    fields: rosterFields,
    existingPlayers: currentPlayers,
    source: 'roster-ai'
  });
  return normalizePlanRows(plan.operations, currentPlayers, rawOperations, rosterFields);
}

export function removeRosterAiImportPreviewRow(
  rows: RosterAiImportPreviewRow[] = [],
  rowNumber: number
): RosterAiImportPreviewRow[] {
  return rows.filter((row) => row.rowNumber !== rowNumber);
}

export function buildRosterAiImportSchema(rosterFields: TeamRosterFieldDefinition[] = []) {
  const addressProperties = {
    address1: Schema.string(),
    address2: Schema.string(),
    street: Schema.string(),
    city: Schema.string(),
    state: Schema.string(),
    zip: Schema.string()
  };
  const contactProperties = {
    name: Schema.string(),
    relation: Schema.string(),
    email: Schema.string(),
    phone: Schema.string(),
    kind: Schema.string()
  };
  const playerProperties: Record<string, any> = {
    name: Schema.string(),
    number: Schema.string(),
    address: Schema.object({
      properties: addressProperties,
      optionalProperties: Object.keys(addressProperties)
    }),
    rosterStatus: Schema.string(),
    familyContacts: Schema.array({
      items: Schema.object({
        properties: contactProperties,
        optionalProperties: Object.keys(contactProperties)
      })
    })
  };
  getRosterAiImportFieldCatalog(rosterFields).forEach((field: any) => {
    if (['name', 'number', 'rosterStatus', 'familyContacts'].includes(field.key) || String(field.key).startsWith('address.')) return;
    playerProperties[field.key] = field.type === 'checkbox' ? Schema.boolean() : Schema.string();
  });
  const playerOptional = Object.keys(playerProperties).filter((key) => key !== 'name');
  const changeOptional = Object.keys(playerProperties);

  return Schema.object({
    properties: {
      operations: Schema.array({
        items: Schema.object({
          properties: {
            action: Schema.string(),
            player: Schema.object({
              properties: playerProperties,
              optionalProperties: playerOptional
            }),
            playerId: Schema.string(),
            changes: Schema.object({
              properties: playerProperties,
              optionalProperties: changeOptional
            }),
            reason: Schema.string()
          },
          optionalProperties: ['player', 'playerId', 'changes', 'reason']
        })
      })
    }
  });
}

function normalizeRosterImportPlan(
  plan: { errors?: string[]; operations?: Array<Record<string, any>> },
  input: Partial<RosterAiImportInput>,
  source: RosterAiImportResult['source'],
  rawOperations: Array<Record<string, any>> = []
): RosterAiImportResult {
  if (plan.errors?.length) return { rows: [], errors: plan.errors, source };
  const operations = plan.operations || [];
  if (!operations.length) {
    return { rows: [], errors: ['No roster rows were available to import.'], source };
  }
  return {
    rows: normalizePlanRows(operations, input.currentPlayers || [], rawOperations, input.rosterFields || []),
    errors: [],
    source
  };
}

function normalizePlanRows(
  operations: Array<Record<string, any>>,
  currentPlayers: RosterAiImportCurrentPlayer[],
  rawOperations: Array<Record<string, any>> = [],
  rosterFields: TeamRosterFieldDefinition[] = []
): RosterAiImportPreviewRow[] {
  return operations.map((operation, index) => {
    const existing = currentPlayers.find((player) => compactText(player.id) === compactText(operation.playerId));
    const providedFields = Array.isArray(operation.providedFields)
      ? operation.providedFields as RosterAiImportPreviewField[]
      : deriveProvidedFields(operation);
    const fields = providedFields.map((field) => {
      const definition = rosterFields.find((item) => item.key === field.key);
      return definition?.options?.length ? { ...field, options: definition.options } : field;
    });
    const nameField = fields.find((field) => field.key === 'name');
    const numberField = fields.find((field) => field.key === 'number');
    return {
      rowNumber: index + 1,
      action: normalizeAction(operation.type || operation.action),
      playerId: compactText(operation.playerId),
      name: compactText(nameField?.value ?? operation.payload?.name ?? existing?.name),
      number: normalizeJerseyNumber(numberField?.value ?? operation.payload?.number ?? existing?.number),
      reason: compactText(operation.reason),
      fields,
      contacts: Array.isArray(operation.providedContacts) ? operation.providedContacts : [],
      inviteCount: Array.isArray(operation.inviteRequests) ? operation.inviteRequests.length : 0,
      duplicatePlayerId: '',
      duplicatePlayerName: '',
      errors: Array.isArray(operation.errors) ? operation.errors : [],
      operation: operation as RosterImportPlannedOperationForApp,
      ...(rawOperations[index] ? { rawOperation: rawOperations[index] } : {})
    };
  });
}

function deriveProvidedFields(operation: Record<string, any>): RosterAiImportPreviewField[] {
  const fields: RosterAiImportPreviewField[] = [];
  const append = (key: string, label: string, value: unknown, type: RosterAiImportPreviewField['type'] = 'text') => {
    fields.push({ key, label, value, type });
  };
  if (Object.prototype.hasOwnProperty.call(operation.payload || {}, 'name')) append('name', 'Name', operation.payload.name);
  if (Object.prototype.hasOwnProperty.call(operation.payload || {}, 'number')) append('number', 'Number', operation.payload.number);
  Object.entries(operation.payload?.profile?.customFields || {}).forEach(([key, value]) => append(key, key, value));
  Object.entries(operation.privateRosterFields || {}).forEach(([key, value]) => {
    if (key === 'address' && value && typeof value === 'object') {
      Object.entries(value as Record<string, unknown>).forEach(([addressKey, addressValue]) => append(`address.${addressKey}`, addressKey, addressValue));
    } else {
      append(key, key, value, typeof value === 'boolean' ? 'checkbox' : 'text');
    }
  });
  return fields;
}

function cloneRawOperation(row: RosterAiImportPreviewRow): Record<string, any> {
  if (row.rawOperation) return structuredCloneSafe(row.rawOperation);
  const draft: Record<string, any> = {};
  row.fields.forEach((field) => setDraftField(draft, field.key, field.value));
  if (row.contacts.length) {
    draft.familyContacts = row.contacts.map((contact) => {
      const next: Record<string, unknown> = {};
      (contact.providedKeys || ['name', 'relation', 'email', 'phone']).forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(contact, key)) next[key] = (contact as any)[key];
      });
      if (contact.bucket === 'contacts') next.kind = 'contact';
      return next;
    });
  }
  return {
    action: row.action,
    ...(row.playerId ? { playerId: row.playerId } : {}),
    ...(row.action === 'add' ? { player: draft } : { changes: draft }),
    reason: row.reason
  };
}

function setDraftField(draft: Record<string, any>, fieldKey: string, value: unknown) {
  if (fieldKey.startsWith('address.')) {
    if (!draft.address || typeof draft.address !== 'object') draft.address = {};
    draft.address[fieldKey.slice('address.'.length)] = value;
    return;
  }
  draft[fieldKey] = value;
}

function structuredCloneSafe<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function normalizeAction(value: unknown): RosterAiImportPreviewRow['action'] {
  const action = compactText(value).toLowerCase();
  if (action === 'update') return 'update';
  if (action === 'deactivate' || action === 'delete' || action === 'remove') return 'deactivate';
  if (action === 'reactivate' || action === 'restore') return 'reactivate';
  return 'add';
}

type NormalizedCurrentPlayer = {
  id: string;
  name: string;
  number: string;
  active: boolean;
};

function normalizeCurrentPlayers(players: RosterAiImportCurrentPlayer[]): NormalizedCurrentPlayer[] {
  return (Array.isArray(players) ? players : [])
    .map((player) => ({
      id: compactText(player.id || ''),
      name: compactText(player.name || ''),
      number: normalizeJerseyNumber(player.number),
      active: player.active !== false
    }))
    .filter((player) => player.id && player.name);
}

function getRosterAiImportModel(rosterFields: TeamRosterFieldDefinition[]) {
  const firebaseApp = getApp();
  const ai = getAI(firebaseApp, { backend: new GoogleAIBackend() });
  return getGenerativeModel(ai, {
    model: 'gemini-2.5-flash',
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: buildRosterAiImportSchema(rosterFields)
    }
  });
}

async function fileToGenerativePart(file: File) {
  const data = await fileToBase64(file);
  return {
    inlineData: {
      data,
      mimeType: file.type || 'image/png'
    }
  };
}

async function fileToBase64(file: File): Promise<string> {
  if (typeof FileReader !== 'undefined') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(String(reader.result || '').split(',')[1] || '');
      reader.onerror = () => reject(new Error('Could not read the roster image.'));
      reader.readAsDataURL(file);
    });
  }

  const buffer = await file.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buffer);
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function normalizeJerseyNumber(value: unknown): string {
  return compactText(value).replace(/^#/, '');
}

function compactText(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}
