import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const adapterMocks = vi.hoisted(() => ({
  path: vi.fn(),
  load: vi.fn(),
  save: vi.fn()
}));
const nativeMocks = vi.hoisted(() => ({
  isNativeRuntime: vi.fn(),
  load: vi.fn(),
  save: vi.fn()
}));

vi.mock('./adapters/legacyCoachesOnlyGameNotes', () => ({
  getLegacyCoachesOnlyGameNotePath: adapterMocks.path,
  loadLegacyCoachesOnlyGameNote: adapterMocks.load,
  saveLegacyCoachesOnlyGameNote: adapterMocks.save
}));
vi.mock('./nativeRuntime', () => ({ isNativeRuntime: nativeMocks.isNativeRuntime }));
vi.mock('./nativeCoachesOnlyGameNotes', () => ({
  loadNativeCoachesOnlyGameNote: nativeMocks.load,
  saveNativeCoachesOnlyGameNote: nativeMocks.save
}));

import {
  COACHES_ONLY_GAME_NOTE_MAX_LENGTH,
  isCoachesOnlyGameNoteSaveUncertainError,
  loadCoachesOnlyGameNoteForApp,
  saveCoachesOnlyGameNoteForApp
} from './coachesOnlyGameNotesService';

describe('coachesOnlyGameNotesService', () => {
  beforeEach(() => {
    adapterMocks.path.mockReset();
    adapterMocks.load.mockReset();
    adapterMocks.save.mockReset();
    nativeMocks.isNativeRuntime.mockReset().mockReturnValue(false);
    nativeMocks.load.mockReset();
    nativeMocks.save.mockReset();
    adapterMocks.path.mockResolvedValue(['teams', 'team-1', 'games', 'game-1', 'coachNotes', 'main']);
  });

  it('loads the exact team-scoped route game without entering the schedule read model', async () => {
    const updatedAt = new Date('2026-08-29T12:00:00.000Z');
    adapterMocks.load.mockResolvedValue({
      exists: true,
      text: 'Protect the weak side.',
      updatedAt: { toDate: () => updatedAt },
      updatedBy: 'coach-1'
    });

    await expect(
      loadCoachesOnlyGameNoteForApp({
        teamId: 'team-1',
        gameId: 'sharedh_bounded-route-id',
        userId: 'coach-1',
        sharedGamePath: 'tournaments/tournament-1/sharedGames/game-7'
      })
    ).resolves.toEqual({
      exists: true,
      text: 'Protect the weak side.',
      updatedAt,
      updatedBy: 'coach-1'
    });
    expect(adapterMocks.load).toHaveBeenCalledWith('team-1', 'sharedh_bounded-route-id', 'tournaments/tournament-1/sharedGames/game-7');
    expect(COACHES_ONLY_GAME_NOTE_MAX_LENGTH).toBe(5000);
  });

  it('forces private-note reads to the server instead of a prior user cache', () => {
    const adapterSource = readFileSync('src/lib/adapters/legacyCoachesOnlyGameNotes.ts', 'utf8');
    expect(adapterSource).toContain('getDocFromServer as legacyGetDocFromServer');
    expect(adapterSource).not.toContain('getDoc as legacyGetDoc');
  });

  it('keeps the private panel outside child-scoped Game hub state and gates auth transitions', () => {
    const eventDetailSource = readFileSync('src/pages/ScheduleEventDetail.tsx', 'utf8');
    const gameHubSource = readFileSync('src/pages/schedule/ScheduleGameHubSection.tsx', 'utf8');
    expect(eventDetailSource).toContain('<GameHubPrivateNotes');
    expect(eventDetailSource.indexOf('<GameHubPrivateNotes')).toBeLessThan(eventDetailSource.indexOf('<GameHubSection'));
    expect(eventDetailSource).toContain("auth.user?.uid || 'signed-out'");
    expect(eventDetailSource).toContain('key={JSON.stringify([');
    expect(gameHubSource).toContain("if (auth.loading || !auth.user || event.type === 'practice'");
    expect(gameHubSource).toContain('key={buildCoachesOnlyGameNoteScopeKey(auth.user.uid, event.teamId, event.id, sharedGamePath)}');
  });

  it('keeps an authoritative missing note distinct from a failed read', async () => {
    adapterMocks.load.mockResolvedValueOnce({
      exists: false,
      text: '',
      updatedAt: null,
      updatedBy: null
    });
    await expect(loadCoachesOnlyGameNoteForApp({ teamId: 'team-1', gameId: 'game-1', userId: 'coach-1' })).resolves.toEqual({
      exists: false,
      text: '',
      updatedAt: null,
      updatedBy: null
    });

    adapterMocks.load.mockRejectedValueOnce(new Error('permission-denied'));
    await expect(loadCoachesOnlyGameNoteForApp({ teamId: 'team-1', gameId: 'game-1', userId: 'coach-1' })).rejects.toThrow(
      'permission-denied'
    );
  });

  it('saves only the explicit game, caller, and text supplied by the manager UI', async () => {
    adapterMocks.save.mockResolvedValue({ text: 'Switch on every cross.', updatedBy: 'coach.user:1' });
    await expect(
      saveCoachesOnlyGameNoteForApp({
        teamId: 'team-1',
        gameId: 'game-1',
        userId: 'coach.user:1',
        text: 'Switch on every cross.',
        sharedGamePath: 'organizations/org-1/sharedGames/game-1'
      })
    ).resolves.toEqual({
      text: 'Switch on every cross.',
      updatedBy: 'coach.user:1'
    });
    expect(adapterMocks.save).toHaveBeenCalledWith(
      'team-1',
      'game-1',
      'coach.user:1',
      'Switch on every cross.',
      'organizations/org-1/sharedGames/game-1'
    );
  });

  it('uses exact native REST reads for direct and physical shared-game paths', async () => {
    nativeMocks.isNativeRuntime.mockReturnValue(true);
    const sharedPath = ['organizations', 'org-1', 'sharedGames', 'game-7', 'coachNotes', 'team-1'];
    adapterMocks.path.mockResolvedValueOnce(sharedPath);
    nativeMocks.load.mockResolvedValueOnce({
      exists: true,
      text: 'Native private plan',
      updatedAt: new Date('2026-08-29T12:00:00.000Z'),
      updatedBy: 'coach-1'
    });

    await expect(
      loadCoachesOnlyGameNoteForApp({
        teamId: 'team-1',
        gameId: 'sharedh_route-alias',
        userId: 'coach-1',
        sharedGamePath: 'organizations/org-1/sharedGames/game-7'
      })
    ).resolves.toMatchObject({ text: 'Native private plan', updatedBy: 'coach-1' });

    expect(adapterMocks.path).toHaveBeenCalledWith('team-1', 'sharedh_route-alias', 'organizations/org-1/sharedGames/game-7');
    expect(nativeMocks.load).toHaveBeenCalledWith(sharedPath, 'coach-1');
    expect(adapterMocks.load).not.toHaveBeenCalled();
  });

  it('uses the native authenticated commit path without falling back to the web SDK', async () => {
    nativeMocks.isNativeRuntime.mockReturnValue(true);
    const directPath = ['teams', 'team-1', 'games', 'game-1', 'coachNotes', 'main'];
    adapterMocks.path.mockResolvedValueOnce(directPath);
    nativeMocks.save.mockResolvedValueOnce({ text: 'Native save', updatedBy: 'coach-1' });

    await expect(
      saveCoachesOnlyGameNoteForApp({
        teamId: 'team-1',
        gameId: 'game-1',
        userId: 'coach-1',
        text: 'Native save'
      })
    ).resolves.toEqual({ text: 'Native save', updatedBy: 'coach-1' });

    expect(nativeMocks.save).toHaveBeenCalledWith(directPath, 'coach-1', 'Native save');
    expect(adapterMocks.save).not.toHaveBeenCalled();
  });

  it('identifies only explicit may-have-saved failures as uncertain', () => {
    expect(isCoachesOnlyGameNoteSaveUncertainError(Object.assign(new Error('uncertain'), { mayHaveSaved: true }))).toBe(true);
    expect(isCoachesOnlyGameNoteSaveUncertainError(Object.assign(new Error('definite'), { mayHaveSaved: false }))).toBe(false);
    expect(isCoachesOnlyGameNoteSaveUncertainError(new Error('ordinary failure'))).toBe(false);
  });
});
