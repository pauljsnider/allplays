import { acquireProfilePhoto } from './profilePhotoService'
import {
  addAggregatedStatsWritesToBatch,
  buildTrackStatsheetApplyPlan,
  collection,
  db,
  deleteDoc,
  doc,
  getAI,
  getApp,
  getConfigs,
  getDocs,
  getGame,
  getGenerativeModel,
  getPlayers,
  getTeam,
  GoogleAIBackend,
  Schema,
  uploadStatSheetPhoto,
  validateTrackStatsheetApplyRows,
  writeBatch
} from './adapters/legacyStatsheetImport'

export type TrackStatsheetReviewRow = {
  number: string;
  name: string;
  fouls: number;
  totalPoints: number;
  include: boolean;
  mappedPlayerId: string;
}

export type TrackStatsheetReviewModel = {
  homeRows: TrackStatsheetReviewRow[];
  visitorRows: TrackStatsheetReviewRow[];
  homeScore: number;
  awayScore: number;
  shouldSwap: boolean;
  homeMatches: number;
  visitorMatches: number;
}

type TrackStatsheetAiResponse = {
  scores?: {
    homeFinal?: number;
    visitorFinal?: number;
  };
  homePlayers?: Array<Record<string, unknown>>;
  visitorPlayers?: Array<Record<string, unknown>>;
}

type TrackStatsheetRosterPlayer = {
  id: string;
  name?: string;
  number?: string | number;
}

export function normalizeTrackStatsheetNumber(value: unknown) {
  return String(value || '').replace(/\s+/g, '').trim()
}

export function normalizeTrackStatsheetName(value: unknown) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function clampTrackStatsheetFouls(value: unknown) {
  const num = Number(value || 0)
  if (!Number.isFinite(num)) return 0
  return Math.min(Math.max(num, 0), 5)
}

export function sanitizeTrackStatsheetRow(row: Record<string, any> = {}): TrackStatsheetReviewRow {
  const computedTotal = Number.isFinite(row.totalPoints)
    ? Number(row.totalPoints)
    : Number(row.firstHalfPoints || 0) + Number(row.secondHalfPoints || 0) + Number(row.otPoints || 0)
  return {
    number: String(row.number || ''),
    name: String(row.name || ''),
    fouls: clampTrackStatsheetFouls(row.fouls),
    totalPoints: Number(row.totalPoints || computedTotal || 0) || 0,
    include: true,
    mappedPlayerId: ''
  }
}

export function pickTrackStatsheetRosterMatch(row: Partial<TrackStatsheetReviewRow>, roster: TrackStatsheetRosterPlayer[] = [], usedIds = new Set<string>()) {
  const normalizedNumber = normalizeTrackStatsheetNumber(row.number)
  if (normalizedNumber) {
    const numberMatches = roster.filter((player) => normalizeTrackStatsheetNumber(player.number) === normalizedNumber)
    if (numberMatches.length === 1 && !usedIds.has(numberMatches[0].id)) {
      return numberMatches[0].id
    }
  }

  const normalizedName = normalizeTrackStatsheetName(row.name)
  if (normalizedName) {
    const nameTokens = normalizedName.split(' ').filter(Boolean)
    const lastName = nameTokens[nameTokens.length - 1] || ''
    const matches = roster.filter((player) => {
      const rosterName = normalizeTrackStatsheetName(player.name)
      if (!rosterName) return false
      if (rosterName === normalizedName) return true
      if (normalizedName.length > 2 && rosterName.includes(normalizedName)) return true
      if (lastName && rosterName.includes(lastName)) return true
      return false
    })
    const availableMatches = matches.filter((player) => !usedIds.has(player.id))
    if (availableMatches.length === 1) {
      return availableMatches[0].id
    }
  }

  return ''
}

export function countTrackStatsheetRosterMatches(rows: TrackStatsheetReviewRow[] = [], roster: TrackStatsheetRosterPlayer[] = []) {
  const usedIds = new Set<string>()
  let count = 0
  rows.forEach((row) => {
    const match = pickTrackStatsheetRosterMatch(row, roster, usedIds)
    if (match) {
      usedIds.add(match)
      count += 1
    }
  })
  return count
}

export function autoAssignTrackStatsheetRosterMatches(rows: TrackStatsheetReviewRow[] = [], roster: TrackStatsheetRosterPlayer[] = []) {
  const usedIds = new Set<string>()
  return rows.map((row) => {
    const mappedPlayerId = pickTrackStatsheetRosterMatch(row, roster, usedIds)
    if (mappedPlayerId) {
      usedIds.add(mappedPlayerId)
    }
    return {
      ...row,
      mappedPlayerId
    }
  })
}

export function buildTrackStatsheetReviewModel(response: TrackStatsheetAiResponse, roster: TrackStatsheetRosterPlayer[] = []): TrackStatsheetReviewModel {
  const parsedHomeRows = (Array.isArray(response?.homePlayers) ? response.homePlayers : [])
    .map((row) => sanitizeTrackStatsheetRow(row || {}))
    .filter((row) => row.name || row.number || row.totalPoints || row.fouls)
  const parsedVisitorRows = (Array.isArray(response?.visitorPlayers) ? response.visitorPlayers : [])
    .map((row) => sanitizeTrackStatsheetRow(row || {}))
    .filter((row) => row.name || row.number || row.totalPoints || row.fouls)

  const homeMatches = countTrackStatsheetRosterMatches(parsedHomeRows, roster)
  const visitorMatches = countTrackStatsheetRosterMatches(parsedVisitorRows, roster)
  const shouldSwap = visitorMatches > homeMatches

  return {
    homeRows: autoAssignTrackStatsheetRosterMatches(shouldSwap ? parsedVisitorRows : parsedHomeRows, roster),
    visitorRows: shouldSwap ? parsedHomeRows : parsedVisitorRows,
    homeScore: Number(response?.scores?.homeFinal || 0),
    awayScore: Number(response?.scores?.visitorFinal || 0),
    shouldSwap,
    homeMatches,
    visitorMatches
  }
}

async function fileToGenerativePart(file: File) {
  const base64EncodedData = await new Promise<string>((resolve) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(String(reader.result || '').split(',')[1] || '')
    reader.readAsDataURL(file)
  })

  return {
    inlineData: {
      data: base64EncodedData,
      mimeType: file.type
    }
  }
}

function buildTrackStatsheetResponseSchema() {
  return Schema.object({
    properties: {
      metadata: Schema.object({
        properties: {
          date: Schema.string(),
          time: Schema.string(),
          location: Schema.string(),
          homeCoach: Schema.string(),
          visitorCoach: Schema.string()
        },
        optionalProperties: ['date', 'time', 'location', 'homeCoach', 'visitorCoach']
      }),
      scores: Schema.object({
        properties: {
          homeFirstHalf: Schema.number(),
          visitorFirstHalf: Schema.number(),
          homeSecondHalf: Schema.number(),
          visitorSecondHalf: Schema.number(),
          homeFinal: Schema.number(),
          visitorFinal: Schema.number()
        },
        optionalProperties: ['homeFirstHalf', 'visitorFirstHalf', 'homeSecondHalf', 'visitorSecondHalf', 'homeFinal', 'visitorFinal']
      }),
      homePlayers: Schema.array({
        items: Schema.object({
          properties: {
            number: Schema.string(),
            name: Schema.string(),
            fouls: Schema.number(),
            firstHalfPoints: Schema.number(),
            secondHalfPoints: Schema.number(),
            otPoints: Schema.number(),
            totalPoints: Schema.number()
          },
          optionalProperties: ['number', 'name', 'fouls', 'firstHalfPoints', 'secondHalfPoints', 'otPoints', 'totalPoints']
        })
      }),
      visitorPlayers: Schema.array({
        items: Schema.object({
          properties: {
            number: Schema.string(),
            name: Schema.string(),
            fouls: Schema.number(),
            firstHalfPoints: Schema.number(),
            secondHalfPoints: Schema.number(),
            otPoints: Schema.number(),
            totalPoints: Schema.number()
          },
          optionalProperties: ['number', 'name', 'fouls', 'firstHalfPoints', 'secondHalfPoints', 'otPoints', 'totalPoints']
        })
      })
    },
    optionalProperties: ['metadata', 'scores', 'homePlayers', 'visitorPlayers']
  })
}

const trackStatsheetPromptText = `You are reading a basketball official scoresheet photo. Extract stats in strict JSON.

SHEET LAYOUT RULES:
- The home team roster table is on the LEFT. The visitor team roster table is on the RIGHT.
- Each roster table has columns: No, Name, Fouls, 1st Half Scoring, 2nd Half Scoring, Overtime, Total Pts.
- Fouls are tally marks inside the FOULS column boxes; count only those marks (ignore running score grids).
- Fouls per player should be 0-5. If unclear, prefer the lower count.
- Use the Total Pts column when present. If it is blank, sum the 1st half, 2nd half, and overtime tallies.
- The score box at the top-right includes 1st Half, 2nd Half, and Final scores for Home and Visitor.
- Ignore running score grids, timeouts, and technicals.

RETURN JSON:
- homePlayers and visitorPlayers should include number, name, fouls, totalPoints.
- scores should include homeFinal and visitorFinal if present.
- Use 0 when a numeric value is blank.
`

export async function analyzeTrackStatsheetPhoto(file: File, roster: TrackStatsheetRosterPlayer[] = []) {
  const firebaseApp = getApp()
  const ai = getAI(firebaseApp, { backend: new GoogleAIBackend() })
  const model = getGenerativeModel(ai, {
    model: 'gemini-2.5-flash',
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: buildTrackStatsheetResponseSchema()
    }
  })

  const imagePart = await fileToGenerativePart(file)
  const result = await model.generateContent([trackStatsheetPromptText, imagePart])
  let response: TrackStatsheetAiResponse = {}
  try {
    response = JSON.parse(result.response.text() || '{}')
  } catch (parseError) {
    console.warn('[statsheetImportService] Failed to parse AI response', parseError)
  }
  return buildTrackStatsheetReviewModel(response, roster)
}

export async function acquireTrackStatsheetPhoto(source: 'camera' | 'photos') {
  return acquireProfilePhoto(source)
}

async function loadTrackStatsheetContext(teamId: string, gameId: string) {
  const [team, game, roster, configs] = await Promise.all([
    getTeam(teamId),
    getGame(teamId, gameId),
    getPlayers(teamId),
    getConfigs(teamId).catch(() => [])
  ])

  if (!game) {
    throw new Error('Game not found.')
  }

  const config = game.statTrackerConfigId
    ? (Array.isArray(configs) ? configs.find((entry: any) => entry?.id === game.statTrackerConfigId) : null)
    : null

  return {
    team,
    game,
    roster: Array.isArray(roster) ? roster : [],
    config: config || { name: 'Default', columns: ['PTS', 'REB', 'AST', 'STL', 'TO'] }
  }
}

export async function loadTrackStatsheetContextForApp(teamId: string, gameId: string) {
  return loadTrackStatsheetContext(teamId, gameId)
}

export async function applyTrackStatsheetImportForApp({
  teamId,
  gameId,
  roster,
  columns,
  homeRows,
  visitorRows,
  homeScore,
  awayScore,
  file,
  uploadedPhotoUrl = '',
  replaceExisting = false
}: {
  teamId: string;
  gameId: string;
  roster: TrackStatsheetRosterPlayer[];
  columns: string[];
  homeRows: TrackStatsheetReviewRow[];
  visitorRows: TrackStatsheetReviewRow[];
  homeScore: number;
  awayScore: number;
  file: File | null;
  uploadedPhotoUrl?: string;
  replaceExisting?: boolean;
}) {
  const validation = validateTrackStatsheetApplyRows(homeRows)
  if (!validation.ok) {
    throw new Error(validation.alertMessage)
  }

  const includedVisitor = (visitorRows || []).filter((row) => row?.include)
  const eventsSnap = await getDocs(collection(db, `teams/${teamId}/games/${gameId}/events`))
  const statsSnap = await getDocs(collection(db, `teams/${teamId}/games/${gameId}/aggregatedStats`))
  const hasExistingTrackedData = eventsSnap.size > 0 || statsSnap.size > 0

  if (hasExistingTrackedData && !replaceExisting) {
    return {
      requiresReplaceConfirmation: true,
      hasExistingTrackedData: true,
      uploadedPhotoUrl
    }
  }

  let statSheetPhotoUrl = String(uploadedPhotoUrl || '')
  if (file && !statSheetPhotoUrl) {
    statSheetPhotoUrl = await uploadStatSheetPhoto(teamId, file)
  }

  if (hasExistingTrackedData) {
    await Promise.all(eventsSnap.docs.map((entry: any) => deleteDoc(entry.ref)))
    await Promise.all(statsSnap.docs.map((entry: any) => deleteDoc(entry.ref)))
  }

  const applyPlan = buildTrackStatsheetApplyPlan({
    includedHome: validation.includedHome,
    includedVisitor,
    roster,
    columns,
    homeScore,
    awayScore,
    statSheetPhotoUrl: statSheetPhotoUrl || null
  })

  const batch = writeBatch(db)
  addAggregatedStatsWritesToBatch({
    aggregatedStatsWrites: applyPlan.aggregatedStatsWrites,
    batch,
    db,
    currentTeamId: teamId,
    currentGameId: gameId,
    createDocRef: doc
  })
  const gameRef = doc(db, `teams/${teamId}/games`, gameId)
  batch.update(gameRef, applyPlan.gameUpdate)
  await batch.commit()

  return {
    requiresReplaceConfirmation: false,
    hasExistingTrackedData,
    uploadedPhotoUrl: statSheetPhotoUrl,
    applyPlan
  }
}
