import { getAI, getApp, getGenerativeModel, GoogleAIBackend, Schema } from './adapters/legacyRosterAi';

export type RosterAiImportCurrentPlayer = {
  id?: string;
  name?: string | null;
  number?: string | number | null;
  active?: boolean;
};

export type RosterAiImportInput = {
  text?: string;
  imageFile?: File | null;
  currentPlayers?: RosterAiImportCurrentPlayer[];
};

export type RosterAiImportPreviewRow = {
  rowNumber: number;
  action: 'add';
  name: string;
  number: string;
  reason: string;
  duplicatePlayerId: string;
  duplicatePlayerName: string;
  errors: string[];
};

export type RosterAiImportResult = {
  rows: RosterAiImportPreviewRow[];
  errors: string[];
};

export type RosterAiImportCommitPlan = {
  addPlayers: Array<{ name: string; number: string }>;
  skippedRows: RosterAiImportPreviewRow[];
};

type RosterAiOperation = {
  action?: string;
  player?: Record<string, unknown>;
  reason?: string;
};

const maxContextPlayers = 80;

export async function generateRosterAiImportRows(input: RosterAiImportInput): Promise<RosterAiImportResult> {
  const text = compactText(input.text || '');
  const imageFile = input.imageFile || null;
  if (!text && !imageFile) {
    return { rows: [], errors: ['Paste roster text or upload a roster image before using AI import.'] };
  }

  try {
    const model = getRosterAiImportModel();
    const promptParts: any[] = [buildRosterAiImportPrompt({ ...input, text })];
    if (imageFile) {
      promptParts.push(await fileToGenerativePart(imageFile));
    }

    const result = await model.generateContent(promptParts);
    const responseText = compactText(result?.response?.text?.() || '');
    const response = JSON.parse(responseText || '{}');
    return normalizeRosterAiImportResponse(response, input);
  } catch (error: any) {
    return {
      rows: [],
      errors: [error?.message ? `AI could not parse the roster: ${error.message}` : 'AI could not parse the roster. Try clearer text or a sharper image.']
    };
  }
}

export function buildRosterAiImportPrompt(input: RosterAiImportInput): string {
  const currentPlayers = normalizeCurrentPlayers(input.currentPlayers || []).slice(0, maxContextPlayers);
  const text = compactText(input.text || '');
  const hasImage = Boolean(input.imageFile);

  return `Parse this roster/player list and extract player information for ALL PLAYS.

CONTEXT:
- Current players in roster: ${currentPlayers.length}
- Current player records: ${JSON.stringify(currentPlayers)}

INPUT:
${hasImage ? '- The roster is attached as an image. Extract visible player rows from the image.' : '- Roster text is pasted below.'}
${text ? `- Pasted roster text or instructions:\n${text}` : '- No extra text instructions were provided.'}

OUTPUT RULES:
1. Return strict JSON only with an operations array.
2. Extract all players from the ${hasImage ? 'image' : 'text'} using common formats like "#10 John Smith", "23 Jane Doe", "Name - 15", and "Name (15)".
3. Skip headers, blank lines, team names, coaches, guardians, phone numbers, emails, and non-player text.
4. Preserve suffixes and punctuation in names, including Jr., III, hyphens, and apostrophes.
5. Leave number empty when no jersey number is provided.
6. Use action "add" for each extracted player row. Do not update, delete, deactivate, or reactivate existing players.
7. Put uncertainty, filters used, OCR ambiguity, or skipped-row notes in reason.
8. If no players are found, return {"operations":[]}.

JSON shape:
{"operations":[{"action":"add","player":{"name":"John Smith","number":"10"},"reason":"read from row 1"}]}`;
}

export function normalizeRosterAiImportResponse(response: unknown, input: Partial<RosterAiImportInput> = {}): RosterAiImportResult {
  const operations = Array.isArray((response as any)?.operations) ? (response as any).operations as RosterAiOperation[] : null;
  if (!operations) {
    return { rows: [], errors: ['AI response did not include an operations array.'] };
  }

  const currentPlayers = normalizeCurrentPlayers(input.currentPlayers || []);
  const rows = operations
    .map((operation, index) => normalizeRosterAiOperation(operation, index + 1, currentPlayers))
    .filter((row: RosterAiImportPreviewRow | null): row is RosterAiImportPreviewRow => Boolean(row));

  if (!rows.length) {
    return { rows: [], errors: ['AI did not find any players to import. Try adding more roster details or a clearer image.'] };
  }

  return { rows, errors: [] };
}

export function buildRosterAiImportCommitPlan(rows: RosterAiImportPreviewRow[] = [], selectedRowNumbers?: number[]): RosterAiImportCommitPlan {
  const selected = selectedRowNumbers ? new Set(selectedRowNumbers) : null;
  const addPlayers: RosterAiImportCommitPlan['addPlayers'] = [];
  const skippedRows: RosterAiImportPreviewRow[] = [];

  rows.forEach((row) => {
    if (selected && !selected.has(row.rowNumber)) return;
    if (row.errors.length) {
      skippedRows.push(row);
      return;
    }
    if (row.action === 'add') {
      addPlayers.push({ name: row.name, number: row.number });
    }
  });

  return { addPlayers, skippedRows };
}

export function updateRosterAiImportPreviewRow(
  rows: RosterAiImportPreviewRow[] = [],
  rowNumber: number,
  changes: { name?: string; number?: string },
  currentPlayers: RosterAiImportCurrentPlayer[] = []
): RosterAiImportPreviewRow[] {
  const nextRows = rows.map((row) => row.rowNumber === rowNumber
    ? {
        ...row,
        name: Object.prototype.hasOwnProperty.call(changes, 'name') ? compactText(changes.name) : row.name,
        number: Object.prototype.hasOwnProperty.call(changes, 'number') ? normalizeJerseyNumber(changes.number) : row.number
      }
    : row);
  return validateRosterAiPreviewRows(nextRows, normalizeCurrentPlayers(currentPlayers));
}

export function removeRosterAiImportPreviewRow(rows: RosterAiImportPreviewRow[] = [], rowNumber: number): RosterAiImportPreviewRow[] {
  return rows.filter((row) => row.rowNumber !== rowNumber);
}

export function buildRosterAiImportSchema() {
  return Schema.object({
    properties: {
      operations: Schema.array({
        items: Schema.object({
          properties: {
            action: Schema.string(),
            player: Schema.object({
              properties: {
                name: Schema.string(),
                number: Schema.string()
              },
              optionalProperties: ['number']
            }),
            reason: Schema.string()
          },
          optionalProperties: ['player', 'reason']
        })
      })
    }
  });
}

function normalizeRosterAiOperation(
  operation: RosterAiOperation,
  rowNumber: number,
  currentPlayers: NormalizedCurrentPlayer[]
): RosterAiImportPreviewRow | null {
  const action = compactText(operation?.action || '').toLowerCase();
  const reason = compactText(operation?.reason || '');
  if (action === 'add') {
    const name = compactText(operation.player?.name || '');
    const number = normalizeJerseyNumber(operation.player?.number);
    return validateRosterAiPreviewRow({
      rowNumber,
      action: 'add',
      name,
      number,
      reason,
      duplicatePlayerId: '',
      duplicatePlayerName: '',
      errors: []
    }, currentPlayers);
  }
  return null;
}

type NormalizedCurrentPlayer = {
  id: string;
  name: string;
  normalizedName: string;
  number: string;
  active: boolean;
};

function normalizeCurrentPlayers(players: RosterAiImportCurrentPlayer[]): NormalizedCurrentPlayer[] {
  return (Array.isArray(players) ? players : [])
    .map((player) => ({
      id: compactText(player.id || ''),
      name: compactText(player.name || ''),
      normalizedName: normalizeName(player.name || ''),
      number: normalizeJerseyNumber(player.number),
      active: player.active !== false
    }))
    .filter((player) => player.id && player.name);
}

function validateAddPlayer(name: string, number: string, currentPlayers: NormalizedCurrentPlayer[]) {
  const errors: string[] = [];
  if (!name) errors.push('Player name is required.');
  const normalizedName = normalizeName(name);
  const duplicate = findExistingPlayerDuplicate(normalizedName, number, currentPlayers);
  if (duplicate) {
    errors.push(`Possible duplicate of existing roster player ${duplicate.name}${duplicate.number ? ` #${duplicate.number}` : ''}.`);
  }
  return errors;
}

function validateRosterAiPreviewRows(rows: RosterAiImportPreviewRow[], currentPlayers: NormalizedCurrentPlayer[]) {
  return rows.map((row) => validateRosterAiPreviewRow(row, currentPlayers));
}

function validateRosterAiPreviewRow(row: RosterAiImportPreviewRow, currentPlayers: NormalizedCurrentPlayer[]): RosterAiImportPreviewRow {
  const name = compactText(row.name);
  const number = normalizeJerseyNumber(row.number);
  const normalizedName = normalizeName(name);
  const duplicate = findExistingPlayerDuplicate(normalizedName, number, currentPlayers);
  return {
    ...row,
    name,
    number,
    duplicatePlayerId: duplicate?.id || '',
    duplicatePlayerName: duplicate?.name || '',
    errors: validateAddPlayer(name, number, currentPlayers)
  };
}

function findExistingPlayerDuplicate(normalizedName: string, number: string, currentPlayers: NormalizedCurrentPlayer[]) {
  return currentPlayers.find((player) => {
    if (!player.active || !normalizedName) return false;
    if (number && player.number === number) return true;
    if (player.normalizedName !== normalizedName) return false;
    return number ? player.number === number : !player.number;
  });
}

function getRosterAiImportModel() {
  const firebaseApp = getApp();
  const ai = getAI(firebaseApp, { backend: new GoogleAIBackend() });
  return getGenerativeModel(ai, {
    model: 'gemini-2.5-flash',
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: buildRosterAiImportSchema()
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

function normalizeName(value: unknown): string {
  return compactText(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function compactText(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}
