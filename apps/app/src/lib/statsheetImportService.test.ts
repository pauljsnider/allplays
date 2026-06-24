import { beforeEach, describe, expect, it, vi } from 'vitest'

const firebaseMocks = vi.hoisted(() => {
  const batch = {
    update: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
    commit: vi.fn(async () => undefined)
  }
  return {
    batch,
    getDocs: vi.fn(),
    deleteDoc: vi.fn(async () => undefined),
    writeBatch: vi.fn(() => batch),
    doc: vi.fn((_db: unknown, ...parts: string[]) => ({ path: parts.join('/') })),
    collection: vi.fn((_db: unknown, path: string) => ({ path })),
    db: {}
  }
})

const dbMocks = vi.hoisted(() => ({
  uploadStatSheetPhoto: vi.fn(async () => 'https://img.test/statsheet.png'),
  getConfigs: vi.fn(),
  getGame: vi.fn(),
  getPlayers: vi.fn(),
  getTeam: vi.fn()
}))

const firebaseAppMocks = vi.hoisted(() => ({
  getApp: vi.fn(() => ({ name: 'test-app' }))
}))

const firebaseAiMocks = vi.hoisted(() => ({
  generateContent: vi.fn(),
  getAI: vi.fn(() => ({ kind: 'ai' })),
  getGenerativeModel: vi.fn(() => ({ generateContent: firebaseAiMocks.generateContent })),
  GoogleAIBackend: class GoogleAIBackend {},
  Schema: {
    object: vi.fn((value) => value),
    array: vi.fn((value) => value),
    string: vi.fn(() => ({ type: 'string' })),
    number: vi.fn(() => ({ type: 'number' }))
  }
}))

vi.mock('../../../../js/firebase.js', () => firebaseMocks)
vi.mock('../../../../js/db.js', () => dbMocks)
vi.mock('../../../../js/vendor/firebase-app.js', () => firebaseAppMocks)
vi.mock('../../../../js/vendor/firebase-ai.js', () => firebaseAiMocks)
vi.mock('./profilePhotoService', () => ({ acquireProfilePhoto: vi.fn() }))
vi.mock('../../../../js/live-tracker-save-complete.js', () => ({
  addAggregatedStatsWritesToBatch: vi.fn(({ aggregatedStatsWrites = [], batch, db, currentTeamId, currentGameId, createDocRef }: any) => {
    aggregatedStatsWrites.forEach(({ playerId, data }: any) => {
      batch.set(createDocRef(db, `teams/${currentTeamId}/games/${currentGameId}/aggregatedStats`, playerId), data)
    })
  })
}))

import { analyzeTrackStatsheetPhoto, applyTrackStatsheetImportForApp, buildTrackStatsheetReviewModel } from './statsheetImportService'

beforeEach(() => {
  vi.clearAllMocks()
  firebaseMocks.batch.commit.mockResolvedValue(undefined)
})

describe('buildTrackStatsheetReviewModel', () => {
  it('swaps sides when visitor rows match the roster better and auto-assigns players', () => {
    const review = buildTrackStatsheetReviewModel({
      scores: { homeFinal: 41, visitorFinal: 53 },
      homePlayers: [{ number: '99', name: 'Unknown', totalPoints: 2, fouls: 1 }],
      visitorPlayers: [{ number: '12', name: 'Avery Smith', totalPoints: 10, fouls: 3 }]
    }, [
      { id: 'p1', number: '12', name: 'Avery Smith' }
    ])

    expect(review.shouldSwap).toBe(true)
    expect(review.homeRows).toEqual([
      expect.objectContaining({ number: '12', name: 'Avery Smith', include: true, mappedPlayerId: 'p1', totalPoints: 10, fouls: 3 })
    ])
    expect(review.visitorRows).toEqual([
      expect.objectContaining({ number: '99', name: 'Unknown', mappedPlayerId: '' })
    ])
    expect(review.homeScore).toBe(41)
    expect(review.awayScore).toBe(53)
  })

  it('defaults unmatched home rows to review-only while including unique roster matches', () => {
    const review = buildTrackStatsheetReviewModel({
      scores: { homeFinal: 19, visitorFinal: 24 },
      homePlayers: [
        { number: '12', name: 'Avery Smith', totalPoints: 10, fouls: 3 },
        { number: '55', name: 'Mystery Player', totalPoints: 7, fouls: 1 }
      ],
      visitorPlayers: [{ number: '10', name: 'River Stone', totalPoints: 24, fouls: 2 }]
    }, [
      { id: 'p1', number: '12', name: 'Avery Smith' },
      { id: 'p2', number: '5', name: 'Mia Diaz' }
    ])

    expect(review.homeRows).toEqual([
      expect.objectContaining({ name: 'Avery Smith', include: true, mappedPlayerId: 'p1' }),
      expect.objectContaining({ name: 'Mystery Player', include: false, mappedPlayerId: '' })
    ])
    expect(review.visitorRows).toEqual([
      expect.objectContaining({ name: 'River Stone', include: true, mappedPlayerId: '' })
    ])
  })

  it('leaves all home rows review-only when no unique roster matches are found', () => {
    const review = buildTrackStatsheetReviewModel({
      homePlayers: [
        { number: '55', name: 'Mystery Player', totalPoints: 7, fouls: 1 },
        { number: '56', name: 'Unknown Guard', totalPoints: 4, fouls: 0 }
      ]
    }, [
      { id: 'p1', number: '12', name: 'Avery Smith' }
    ])

    expect(review.homeMatches).toBe(0)
    expect(review.homeRows).toEqual([
      expect.objectContaining({ name: 'Mystery Player', include: false, mappedPlayerId: '' }),
      expect.objectContaining({ name: 'Unknown Guard', include: false, mappedPlayerId: '' })
    ])
  })
})

describe('analyzeTrackStatsheetPhoto', () => {
  it('falls back to an empty review model when the AI response JSON is malformed', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const originalFileReader = globalThis.FileReader
    globalThis.FileReader = class FileReader {
      result: string | ArrayBuffer | null = null
      onloadend: null | (() => void) = null

      readAsDataURL() {
        this.result = 'data:image/png;base64,c2hlZXQ='
        this.onloadend?.()
      }
    } as unknown as typeof FileReader
    firebaseAiMocks.generateContent.mockResolvedValue({
      response: {
        text: () => '{not-json'
      }
    })

    const review = await analyzeTrackStatsheetPhoto(new File(['sheet'], 'statsheet.png', { type: 'image/png' }), [
      { id: 'p1', number: '12', name: 'Avery Smith' }
    ])

    expect(review).toEqual({
      homeRows: [],
      visitorRows: [],
      homeScore: 0,
      awayScore: 0,
      shouldSwap: false,
      homeMatches: 0,
      visitorMatches: 0
    })
    expect(warnSpy).toHaveBeenCalledWith('[statsheetImportService] Failed to parse AI response.', expect.objectContaining({
      error: expect.objectContaining({ name: 'SyntaxError' })
    }))

    warnSpy.mockRestore()
    globalThis.FileReader = originalFileReader
  })
})

describe('applyTrackStatsheetImportForApp', () => {
  it('batches replacement cleanup into the same commit as the new statsheet writes', async () => {
    firebaseMocks.getDocs
      .mockResolvedValueOnce({ size: 1, docs: [{ id: 'event-1', ref: { path: 'teams/team-1/games/game-1/events/event-1' } }] })
      .mockResolvedValueOnce({ size: 1, docs: [{ id: 'p2', ref: { path: 'teams/team-1/games/game-1/aggregatedStats/p2' } }] })
      .mockResolvedValueOnce({ size: 1, docs: [{ id: 'p2', ref: { path: 'teams/team-1/games/game-1/privatePlayerStats/p2' } }] })

    await applyTrackStatsheetImportForApp({
      teamId: 'team-1',
      gameId: 'game-1',
      roster: [{ id: 'p1', name: 'Avery Smith', number: '12' }],
      columns: ['PTS'],
      homeRows: [{ number: '12', name: 'Avery Smith', fouls: 2, totalPoints: 10, include: true, mappedPlayerId: 'p1' }],
      visitorRows: [],
      homeScore: 50,
      awayScore: 42,
      file: null,
      replaceExisting: true
    })

    expect(firebaseMocks.writeBatch).toHaveBeenCalledTimes(1)
    expect(firebaseMocks.batch.delete).toHaveBeenCalledTimes(3)
    expect(firebaseMocks.batch.commit).toHaveBeenCalledTimes(1)
  })

  it('prevents saving when every home row is still review-only', async () => {
    await expect(applyTrackStatsheetImportForApp({
      teamId: 'team-1',
      gameId: 'game-1',
      roster: [{ id: 'p1', name: 'Avery Smith', number: '12' }],
      columns: ['PTS'],
      homeRows: [{ number: '55', name: 'Mystery Player', fouls: 1, totalPoints: 7, include: false, mappedPlayerId: '' }],
      visitorRows: [],
      homeScore: 7,
      awayScore: 0,
      file: null
    })).rejects.toThrow('Please review or map at least one home player before applying.')

    expect(firebaseMocks.getDocs).not.toHaveBeenCalled()
    expect(firebaseMocks.writeBatch).not.toHaveBeenCalled()
  })

  it('returns a replacement confirmation instead of writing over existing game data', async () => {
    firebaseMocks.getDocs
      .mockResolvedValueOnce({ size: 1, docs: [{ ref: { path: 'event-1' } }] })
      .mockResolvedValueOnce({ size: 0, docs: [] })
      .mockResolvedValueOnce({ size: 0, docs: [] })

    const result = await applyTrackStatsheetImportForApp({
      teamId: 'team-1',
      gameId: 'game-1',
      roster: [{ id: 'p1', name: 'Avery Smith', number: '12' }],
      columns: ['PTS'],
      homeRows: [{ number: '12', name: 'Avery Smith', fouls: 2, totalPoints: 10, include: true, mappedPlayerId: 'p1' }],
      visitorRows: [],
      homeScore: 50,
      awayScore: 42,
      file: null
    })

    expect(result).toMatchObject({ requiresReplaceConfirmation: true, hasExistingTrackedData: true })
    expect(firebaseMocks.writeBatch).not.toHaveBeenCalled()
  })

  it('requires replacement when only private tracked stats already exist', async () => {
    firebaseMocks.getDocs
      .mockResolvedValueOnce({ size: 0, docs: [] })
      .mockResolvedValueOnce({ size: 0, docs: [] })
      .mockResolvedValueOnce({ size: 1, docs: [{ ref: { path: 'private-stats-1' } }] })

    const result = await applyTrackStatsheetImportForApp({
      teamId: 'team-1',
      gameId: 'game-1',
      roster: [{ id: 'p1', name: 'Avery Smith', number: '12' }],
      columns: ['PTS'],
      homeRows: [{ number: '12', name: 'Avery Smith', fouls: 2, totalPoints: 10, include: true, mappedPlayerId: 'p1' }],
      visitorRows: [],
      homeScore: 50,
      awayScore: 42,
      file: null
    })

    expect(result).toMatchObject({ requiresReplaceConfirmation: true, hasExistingTrackedData: true })
    expect(firebaseMocks.writeBatch).not.toHaveBeenCalled()
  })

  it('does not create a second cleanup batch for private stats already handled by the apply plan', async () => {
    firebaseMocks.getDocs
      .mockResolvedValueOnce({ size: 0, docs: [] })
      .mockResolvedValueOnce({ size: 0, docs: [] })
      .mockResolvedValueOnce({ size: 1, docs: [{ id: 'p1', ref: { path: 'teams/team-1/games/game-1/privatePlayerStats/p1' } }] })

    await applyTrackStatsheetImportForApp({
      teamId: 'team-1',
      gameId: 'game-1',
      roster: [{ id: 'p1', name: 'Avery Smith', number: '12' }],
      columns: ['PTS'],
      homeRows: [{ number: '12', name: 'Avery Smith', fouls: 2, totalPoints: 10, include: true, mappedPlayerId: 'p1' }],
      visitorRows: [],
      homeScore: 50,
      awayScore: 42,
      file: null,
      replaceExisting: true
    })

    expect(firebaseMocks.writeBatch).toHaveBeenCalledTimes(1)
    expect(firebaseMocks.batch.delete).not.toHaveBeenCalled()
    expect(firebaseMocks.batch.commit).toHaveBeenCalledTimes(1)
  })

  it('uploads and applies replacement writes plus cleanup in a single commit', async () => {
    firebaseMocks.getDocs
      .mockResolvedValueOnce({ size: 1, docs: [{ id: 'event-1', ref: { path: 'teams/team-1/games/game-1/events/event-1' } }] })
      .mockResolvedValueOnce({ size: 1, docs: [{ id: 'p2', ref: { path: 'teams/team-1/games/game-1/aggregatedStats/p2' } }] })
      .mockResolvedValueOnce({ size: 1, docs: [{ id: 'p2', ref: { path: 'teams/team-1/games/game-1/privatePlayerStats/p2' } }] })

    const file = new File(['sheet'], 'statsheet.png', { type: 'image/png' })
    const result = await applyTrackStatsheetImportForApp({
      teamId: 'team-1',
      gameId: 'game-1',
      roster: [{ id: 'p1', name: 'Avery Smith', number: '12' }],
      columns: ['PTS'],
      homeRows: [{ number: '12', name: 'Avery Smith', fouls: 2, totalPoints: 10, include: true, mappedPlayerId: 'p1' }],
      visitorRows: [{ number: '5', name: 'Visitor', fouls: 1, totalPoints: 8, include: true, mappedPlayerId: '' }],
      homeScore: 50,
      awayScore: 42,
      file,
      replaceExisting: true
    })

    expect(dbMocks.uploadStatSheetPhoto).toHaveBeenCalledWith('team-1', file)
    expect(firebaseMocks.writeBatch).toHaveBeenCalled()
    expect(firebaseMocks.batch.update).toHaveBeenCalledWith(
      { path: 'teams/team-1/games/game-1' },
      expect.objectContaining({ homeScore: 50, awayScore: 42, statSheetPhotoUrl: 'https://img.test/statsheet.png' })
    )
    expect(firebaseMocks.batch.delete).toHaveBeenCalledTimes(3)
    expect(firebaseMocks.batch.delete).toHaveBeenCalledWith({ path: 'teams/team-1/games/game-1/privatePlayerStats/p2' })
    expect(firebaseMocks.batch.commit).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ requiresReplaceConfirmation: false, uploadedPhotoUrl: 'https://img.test/statsheet.png' })
  })
})
