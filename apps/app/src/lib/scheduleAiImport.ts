import { getAI, getApp, getGenerativeModel, GoogleAIBackend, Schema } from './adapters/legacyGenerativeAi';
import { normalizeScheduleImportDraft, type ScheduleCsvImportPreviewRow } from './scheduleCsvImport';

export type ScheduleAiImportCurrentGame = {
  id?: string;
  date?: string | Date | null;
  opponent?: string | null;
  location?: string | null;
  status?: string | null;
};

export type ScheduleAiImportInput = {
  teamName: string;
  text?: string;
  imageFile?: File | null;
  currentGames?: ScheduleAiImportCurrentGame[];
  now?: Date;
};

export type ScheduleAiImportResult = {
  rows: ScheduleCsvImportPreviewRow[];
  errors: string[];
};

type ScheduleAiOperation = {
  action?: string;
  game?: Record<string, unknown>;
  reason?: string;
};

const maxContextGames = 30;

export async function generateScheduleAiImportRows(input: ScheduleAiImportInput): Promise<ScheduleAiImportResult> {
  const text = compactText(input.text || '');
  const imageFile = input.imageFile || null;
  if (!text && !imageFile) {
    return { rows: [], errors: ['Paste schedule text or upload a schedule image before using AI import.'] };
  }

  try {
    const model = getScheduleAiImportModel();
    const promptParts: any[] = [buildScheduleAiImportPrompt({ ...input, text })];
    if (imageFile) {
      promptParts.push(await fileToGenerativePart(imageFile));
    }

    const result = await model.generateContent(promptParts);
    const responseText = compactText(result?.response?.text?.() || '');
    const response = JSON.parse(responseText || '{}');
    return normalizeScheduleAiImportResponse(response, input);
  } catch (error: any) {
    return {
      rows: [],
      errors: [error?.message ? `AI could not parse the schedule: ${error.message}` : 'AI could not parse the schedule. Try clearer text or a sharper image.']
    };
  }
}

export function buildScheduleAiImportPrompt(input: ScheduleAiImportInput): string {
  const teamName = compactText(input.teamName) || 'the selected team';
  const now = input.now || new Date();
  const currentGames = (input.currentGames || []).slice(0, maxContextGames).map((game) => ({
    id: compactText(game.id || ''),
    date: normalizeContextDate(game.date),
    opponent: compactText(game.opponent || ''),
    location: compactText(game.location || ''),
    status: compactText(game.status || 'scheduled')
  }));
  const text = compactText(input.text || '');
  const hasImage = Boolean(input.imageFile);

  return `Parse this youth sports schedule into add-game draft rows for review in ALL PLAYS.

CONTEXT:
- Today: ${now.toISOString().split('T')[0]}
- Team: ${teamName}
- Current games in DB: ${currentGames.length}
- Current games JSON: ${JSON.stringify(currentGames)}

INPUT:
${hasImage ? '- The schedule is attached as an image. Extract visible game rows from the image.' : '- Schedule text is pasted below.'}
${text ? `- Pasted schedule text or instructions:\n${text}` : '- No extra text instructions were provided.'}

OUTPUT RULES:
1. Return strict JSON only with an operations array.
2. Only create operations with action "add". Do not update or delete existing games.
3. Each operation must include a game object with date, opponent, location, isHome, arrivalTime, notes, assignments, and status when known.
4. Convert dates to ISO 8601 local datetime strings like YYYY-MM-DDTHH:mm:ss. Use year ${now.getFullYear()} for future dates and ${now.getFullYear() + 1} for dates that have already passed.
5. Opponent is the team that is not "${teamName}". Skip rows where you cannot identify a real game opponent.
6. Use isHome true for home, false for away, and null/omit when unknown.
7. Put uncertainty, filters used, assignment details, and skipped-row explanations in notes or reason.
8. If no games are found, return {"operations":[]}.

JSON shape:
{"operations":[{"action":"add","game":{"date":"2026-06-01T18:00:00","opponent":"Rockets","location":"Field 1","isHome":true,"arrivalTime":"2026-06-01T17:30:00","notes":"Snack: Lee family","assignments":[{"role":"snack","value":"Lee family"}],"status":"scheduled"},"reason":"read from schedule row"}]}`;
}

export function normalizeScheduleAiImportResponse(response: unknown, input: Partial<Pick<ScheduleAiImportInput, 'teamName' | 'currentGames'>> = {}): ScheduleAiImportResult {
  const operations = Array.isArray((response as any)?.operations) ? (response as any).operations as ScheduleAiOperation[] : [];
  if (!Array.isArray((response as any)?.operations)) {
    return { rows: [], errors: ['AI response did not include an operations array.'] };
  }

  const rows = operations
    .filter((operation) => compactText(operation?.action || '').toLowerCase() === 'add' && operation.game)
    .map((operation, index) => {
      const draft = buildDraftFromAiGame(operation.game || {}, operation.reason);
      const preview = normalizeScheduleImportDraft(draft, {
        rowNumber: index + 1,
        teamName: input.teamName || ''
      }) as ScheduleCsvImportPreviewRow;
      const conflictErrors = findCurrentGameConflictErrors(preview, input.currentGames || []);
      return {
        ...preview,
        errors: [...preview.errors, ...conflictErrors]
      };
    });

  if (!rows.length) {
    return { rows: [], errors: ['AI did not find any games to import. Try adding more schedule details or a clearer image.'] };
  }

  return { rows, errors: [] };
}

export function buildScheduleAiImportSchema() {
  return Schema.object({
    properties: {
      operations: Schema.array({
        items: Schema.object({
          properties: {
            action: Schema.string(),
            game: Schema.object({
              properties: {
                date: Schema.string(),
                opponent: Schema.string(),
                location: Schema.string(),
                isHome: Schema.boolean({ nullable: true }),
                arrivalTime: Schema.string(),
                notes: Schema.string(),
                assignments: Schema.array({
                  items: Schema.object({
                    properties: {
                      role: Schema.string(),
                      value: Schema.string()
                    }
                  })
                }),
                status: Schema.string()
              },
              optionalProperties: ['location', 'isHome', 'arrivalTime', 'notes', 'assignments', 'status']
            }),
            reason: Schema.string()
          },
          optionalProperties: ['game', 'reason']
        })
      })
    }
  });
}

function getScheduleAiImportModel() {
  const firebaseApp = getApp();
  const ai = getAI(firebaseApp, { backend: new GoogleAIBackend() });
  return getGenerativeModel(ai, {
    model: 'gemini-2.5-flash',
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: buildScheduleAiImportSchema()
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
      reader.onerror = () => reject(new Error('Could not read the schedule image.'));
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

function buildDraftFromAiGame(game: Record<string, unknown>, reason?: string) {
  const assignments = Array.isArray(game.assignments)
    ? game.assignments
        .map((item: any) => `${compactText(item?.role || 'Assignment')}: ${compactText(item?.value || '')}`)
        .filter((item: string) => !item.endsWith(':'))
    : [];
  const noteParts = [compactText(game.notes), ...assignments, compactText(reason)].filter(Boolean);

  return {
    eventType: 'game',
    startsAt: compactText(game.date || game.startsAt || ''),
    endsAt: '',
    opponent: compactText(game.opponent || ''),
    title: '',
    location: compactText(game.location || ''),
    arrivalTime: compactText(game.arrivalTime || ''),
    isHome: game.isHome === true ? 'home' : game.isHome === false ? 'away' : '',
    notes: Array.from(new Set(noteParts)).join('\n')
  };
}

function findCurrentGameConflictErrors(row: ScheduleCsvImportPreviewRow, currentGames: ScheduleAiImportCurrentGame[]): string[] {
  const startsAt = row.normalized.startsAt ? new Date(row.normalized.startsAt) : null;
  if (!startsAt || Number.isNaN(startsAt.getTime())) return [];
  const rowOpponent = compactText(row.normalized.opponent || '').toLowerCase();

  const conflict = currentGames.find((game) => {
    const gameDate = normalizeContextDate(game.date);
    if (!gameDate) return false;
    const existing = new Date(gameDate);
    if (Number.isNaN(existing.getTime())) return false;
    const sameOpponent = rowOpponent && compactText(game.opponent || '').toLowerCase() === rowOpponent;
    const hoursApart = Math.abs(existing.getTime() - startsAt.getTime()) / (60 * 60 * 1000);
    return sameOpponent && hoursApart <= 24;
  });

  return conflict ? [`Possible duplicate/conflict with existing game vs ${compactText(conflict.opponent || 'opponent')} within 24 hours.`] : [];
}

function normalizeContextDate(value: unknown): string {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof (value as any)?.toDate === 'function') return (value as any).toDate().toISOString();
  return compactText(value);
}

function compactText(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}
