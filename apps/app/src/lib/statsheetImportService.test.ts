import { describe, expect, it, vi } from 'vitest'

const firebaseMocks = vi.hoisted(() => {
  const batch = {
    update: vi.fn(),
    set: vi.fn(),
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
vi.mock('./profileService', () => ({ acquireProfilePhoto: vi.fn() }))
vi.mock('../../../../js/live-tracker-save-complete.js', () => ({
  addAggregatedStatsWritesToBatch: vi.fn(({ aggregatedStatsWrites = [], batch, db, currentTeamId, currentGameId, createDocRef }: any) => {
    aggregatedStatsWrites.forEach(({ playerId, data }: any) => {
      batch.set(createDocRef(db, `teams/${currentTeamId}/games/${currentGameId}/aggregatedStats`, playerId), data)
    })
  })
}))

import { analyzeTrackStatsheetPhoto, applyTrackStatsheetImportForApp, buildTrackStatsheetReviewModel } from './statsheetImportService'

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
      expect.objectContaining({ number: '12', name: 'Avery Smith', mappedPlayerId: 'p1', totalPoints: 10, fouls: 3 })
    ])
    expect(review.visitorRows).toEqual([
      expect.objectContaining({ number: '99', name: 'Unknown', mappedPlayerId: '' })
    ])
    expect(review.homeScore).toBe(41)
    expect(review.awayScore).toBe(53)
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
    expect(warnSpy).toHaveBeenCalledWith('[statsheetImportService] Failed to parse AI response', expect.any(SyntaxError))

    warnSpy.mockRestore()
    globalThis.FileReader = originalFileReader
  })
})

describe('applyTrackStatsheetImportForApp', () => {
  it('returns a replacement confirmation instead of writing over existing game data', async () => {
    firebaseMocks.getDocs
      .mockResolvedValueOnce({ size: 1, docs: [{ ref: { path: 'event-1' } }] })
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

  it('uploads, clears existing stats, and writes the legacy apply plan through the shared batch helper', async () => {
    firebaseMocks.getDocs
      .mockResolvedValueOnce({ size: 1, docs: [{ ref: { path: 'event-1' } }] })
      .mockResolvedValueOnce({ size: 1, docs: [{ ref: { path: 'stats-1' } }] })

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
    expect(firebaseMocks.deleteDoc).toHaveBeenCalledTimes(2)
    expect(firebaseMocks.writeBatch).toHaveBeenCalled()
    expect(firebaseMocks.batch.update).toHaveBeenCalledWith(
      { path: 'teams/team-1/games/game-1' },
      expect.objectContaining({ homeScore: 50, awayScore: 42, statSheetPhotoUrl: 'https://img.test/statsheet.png' })
    )
    expect(firebaseMocks.batch.commit).toHaveBeenCalled()
    expect(result).toMatchObject({ requiresReplaceConfirmation: false, uploadedPhotoUrl: 'https://img.test/statsheet.png' })
  })
})
