// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COACHES_ONLY_GAME_NOTE_MAX_LENGTH as LEGACY_COACHES_ONLY_GAME_NOTE_MAX_LENGTH } from '@legacy/coaches-only-game-notes.js';

const authMocks = vi.hoisted(() => ({
  getNativeAuthIdToken: vi.fn(),
  getNativeAuthUserId: vi.fn(),
  firebaseAuth: {
    app: { options: { projectId: 'primary-project' } }
  }
}));
const appCheckMocks = vi.hoisted(() => ({
  getPrimaryAppCheckHeaders: vi.fn(async (headers: Record<string, string>) => ({
    ...headers,
    'X-Firebase-AppCheck': 'app-check-token'
  }))
}));

vi.mock('./authService', () => authMocks);
vi.mock('./adapters/legacyFirebaseAppCheck', () => appCheckMocks);

import {
  loadNativeCoachesOnlyGameNote,
  NativeCoachesOnlyGameNoteSaveUncertainError,
  saveNativeCoachesOnlyGameNote
} from './nativeCoachesOnlyGameNotes';
import { COACHES_ONLY_GAME_NOTE_MAX_LENGTH } from './coachesOnlyGameNotesContract';

const directNotePath = ['teams', 'team 1', 'games', 'game 7', 'coachNotes', 'main'];
const directDocumentName = 'projects/primary-project/databases/(default)/documents/teams/team 1/games/game 7/coachNotes/main';
const directDocumentUrl =
  'https://firestore.googleapis.com/v1/projects/primary-project/databases/(default)/documents/teams/team%201/games/game%207/coachNotes/main';
const organizationSharedNotePath = ['organizations', 'organization 1', 'sharedGames', 'shared%game 7', 'coachNotes', 'team 1'];
const organizationSharedDocumentName =
  'projects/primary-project/databases/(default)/documents/organizations/organization 1/sharedGames/shared%game 7/coachNotes/team 1';
const organizationSharedDocumentUrl =
  'https://firestore.googleapis.com/v1/projects/primary-project/databases/(default)/documents/organizations/organization%201/sharedGames/shared%25game%207/coachNotes/team%201';
const tournamentSharedNotePath = ['tournaments', 'tournament 1', 'sharedGames', 'shared game 9', 'coachNotes', 'team 2'];
const tournamentSharedDocumentName =
  'projects/primary-project/databases/(default)/documents/tournaments/tournament 1/sharedGames/shared game 9/coachNotes/team 2';
const tournamentSharedDocumentUrl =
  'https://firestore.googleapis.com/v1/projects/primary-project/databases/(default)/documents/tournaments/tournament%201/sharedGames/shared%20game%209/coachNotes/team%202';
const commitUrl = 'https://firestore.googleapis.com/v1/projects/primary-project/databases/(default)/documents:commit';

function jsonResponse(status: number, payload: Record<string, unknown> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn(async () => payload)
  } as unknown as Response;
}

function noteDocument(text = 'Protect the weak side.', updatedBy = 'coach.user:1', name = directDocumentName) {
  return {
    name,
    fields: {
      text: { stringValue: text },
      updatedAt: { timestampValue: '2026-08-29T12:00:00.000Z' },
      updatedBy: { stringValue: updatedBy }
    }
  };
}

describe('native coaches-only game note transport', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    authMocks.getNativeAuthUserId.mockReturnValue('coach.user:1');
    authMocks.getNativeAuthIdToken.mockResolvedValue('native-id-token');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(200, noteDocument()))
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('keeps the native text limit aligned with the legacy and Rules contract', () => {
    expect(COACHES_ONLY_GAME_NOTE_MAX_LENGTH).toBe(LEGACY_COACHES_ONLY_GAME_NOTE_MAX_LENGTH);
  });

  it.each([
    ['direct team game', directNotePath, directDocumentUrl, directDocumentName],
    ['organization shared game', organizationSharedNotePath, organizationSharedDocumentUrl, organizationSharedDocumentName],
    ['tournament shared game', tournamentSharedNotePath, tournamentSharedDocumentUrl, tournamentSharedDocumentName]
  ])('loads one exact encoded %s document without a query or web SDK', async (_label, path, documentUrl, documentName) => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, noteDocument('Protect the weak side.', 'coach.user:1', documentName)));

    await expect(loadNativeCoachesOnlyGameNote(path, 'coach.user:1')).resolves.toEqual({
      exists: true,
      text: 'Protect the weak side.',
      updatedAt: new Date('2026-08-29T12:00:00.000Z'),
      updatedBy: 'coach.user:1'
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      documentUrl,
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer native-id-token',
          'X-Firebase-AppCheck': 'app-check-token'
        }),
        signal: expect.any(AbortSignal)
      })
    );
    expect(String(vi.mocked(fetch).mock.calls[0][0])).not.toContain('runQuery');
    expect(String(vi.mocked(fetch).mock.calls[0][0])).not.toContain('pageToken');
  });

  it('treats an exact 404 as authoritative absence', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(404, { error: { message: 'Not found.' } }));

    await expect(loadNativeCoachesOnlyGameNote(directNotePath, 'coach.user:1')).resolves.toEqual({
      exists: false,
      text: '',
      updatedAt: null,
      updatedBy: null
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('refreshes auth exactly once after a 401', async () => {
    authMocks.getNativeAuthIdToken.mockResolvedValueOnce('cached-token').mockResolvedValueOnce('refreshed-token');
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(401, { error: { message: 'Unauthenticated.' } }))
      .mockResolvedValueOnce(jsonResponse(200, noteDocument()));

    await expect(loadNativeCoachesOnlyGameNote(directNotePath, 'coach.user:1')).resolves.toMatchObject({ exists: true });

    expect(authMocks.getNativeAuthIdToken).toHaveBeenNthCalledWith(1, false);
    expect(authMocks.getNativeAuthIdToken).toHaveBeenNthCalledWith(2, true);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetch).mock.calls[1][1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer refreshed-token' })
      })
    );
  });

  it.each([
    ['missing', null],
    ['mismatched', 'different-user']
  ])('rejects a %s native principal before reading', async (_label, currentUserId) => {
    authMocks.getNativeAuthUserId.mockReturnValue(currentUserId);

    await expect(loadNativeCoachesOnlyGameNote(directNotePath, 'coach.user:1')).rejects.toThrow(/auth user/i);
    expect(authMocks.getNativeAuthIdToken).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects an absent native auth token before reading', async () => {
    authMocks.getNativeAuthIdToken.mockResolvedValueOnce(null);

    await expect(loadNativeCoachesOnlyGameNote(directNotePath, 'coach.user:1')).rejects.toThrow('Native auth token is unavailable');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('commits only text and caller identity plus a server request-time transform', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, { writeResults: [] }));

    await expect(saveNativeCoachesOnlyGameNote(directNotePath, 'coach.user:1', 'Press left.\r\nProtect the middle.')).resolves.toEqual({
      text: 'Press left.\nProtect the middle.',
      updatedBy: 'coach.user:1'
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(commitUrl, expect.objectContaining({ method: 'POST' }));
    const request = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    const payload = JSON.parse(String(request.body));
    expect(payload).toEqual({
      writes: [
        {
          update: {
            name: directDocumentName,
            fields: {
              text: { stringValue: 'Press left.\nProtect the middle.' },
              updatedBy: { stringValue: 'coach.user:1' }
            }
          },
          updateMask: { fieldPaths: ['text', 'updatedBy'] },
          updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }]
        }
      ]
    });
    expect(Object.keys(payload.writes[0].update.fields)).toEqual(['text', 'updatedBy']);
    expect(payload.writes[0].updateTransforms.map((item: { fieldPath: string }) => item.fieldPath)).toEqual(['updatedAt']);
  });

  it.each([
    ['organization', organizationSharedNotePath, organizationSharedDocumentName],
    ['tournament', tournamentSharedNotePath, tournamentSharedDocumentName]
  ])('commits a %s shared note to the team-ID document', async (_label, path, documentName) => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, { writeResults: [] }));

    await expect(saveNativeCoachesOnlyGameNote(path, 'coach.user:1', 'Switch to zone.')).resolves.toEqual({
      text: 'Switch to zone.',
      updatedBy: 'coach.user:1'
    });

    const request = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    const payload = JSON.parse(String(request.body));
    expect(payload.writes[0].update.name).toBe(documentName);
  });

  it.each([
    ['arbitrary root', ['users', 'user-1', 'games', 'game-1', 'coachNotes', 'main']],
    ['shared collection below a team', ['teams', 'team-1', 'sharedGames', 'shared-1', 'coachNotes', 'team-1']],
    ['direct collection below an organization', ['organizations', 'org-1', 'games', 'game-1', 'coachNotes', 'main']],
    ['wrong shared notes collection', ['tournaments', 'tournament-1', 'sharedGames', 'shared-1', 'notes', 'team-1']],
    ['team-ID document on a direct game', ['teams', 'team-1', 'games', 'game-1', 'coachNotes', 'team-1']]
  ])('rejects an invalid path shape with %s', async (_label, path) => {
    await expect(loadNativeCoachesOnlyGameNote(path, 'coach.user:1')).rejects.toThrow('Coaches-only note document path is invalid.');
    expect(authMocks.getNativeAuthIdToken).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reconciles an ambiguous write as successful only when exact text and caller match', async () => {
    vi.mocked(fetch)
      .mockRejectedValueOnce(new TypeError('Commit transport failed'))
      .mockResolvedValueOnce(jsonResponse(200, noteDocument('Switch to zone.', 'coach.user:1')));

    await expect(saveNativeCoachesOnlyGameNote(directNotePath, 'coach.user:1', 'Switch to zone.')).resolves.toEqual({
      text: 'Switch to zone.',
      updatedBy: 'coach.user:1'
    });

    expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual([commitUrl, directDocumentUrl]);
  });

  it.each([
    ['an absent document', jsonResponse(404, { error: { message: 'Not found.' } })],
    ['different text', jsonResponse(200, noteDocument('A different note.', 'coach.user:1'))],
    ['a different writer', jsonResponse(200, noteDocument('Switch to zone.', 'another-coach'))]
  ])('keeps an ambiguous write uncertain when immediate reconciliation finds %s', async (_label, reconciliation) => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('Commit transport failed')).mockResolvedValueOnce(reconciliation);

    const error = await saveNativeCoachesOnlyGameNote(directNotePath, 'coach.user:1', 'Switch to zone.').catch((caught) => caught);

    expect(error).toBeInstanceOf(NativeCoachesOnlyGameNoteSaveUncertainError);
    expect(error).toMatchObject({ commitStateUnknown: true, mayHaveSaved: true });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual([commitUrl, directDocumentUrl]);
  });

  it('distinguishes a may-have-saved result when authoritative reconciliation is unavailable', async () => {
    vi.mocked(fetch)
      .mockRejectedValueOnce(new TypeError('Commit transport failed'))
      .mockRejectedValueOnce(new TypeError('Reconciliation transport failed'));

    const error = await saveNativeCoachesOnlyGameNote(directNotePath, 'coach.user:1', 'Switch to zone.').catch((caught) => caught);

    expect(error).toBeInstanceOf(NativeCoachesOnlyGameNoteSaveUncertainError);
    expect(error).toMatchObject({ commitStateUnknown: true, mayHaveSaved: true });
    expect(error.message).toContain('may have saved');
  });

  it('reconciles a server-side ambiguous response instead of reporting a definite failure', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(503, { error: { message: 'Backend unavailable.' } }))
      .mockResolvedValueOnce(jsonResponse(200, noteDocument('Switch to zone.', 'coach.user:1')));

    await expect(saveNativeCoachesOnlyGameNote(directNotePath, 'coach.user:1', 'Switch to zone.')).resolves.toEqual({
      text: 'Switch to zone.',
      updatedBy: 'coach.user:1'
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not reconcile a definite permission denial', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(403, { error: { message: 'Permission denied.' } }));

    await expect(saveNativeCoachesOnlyGameNote(directNotePath, 'coach.user:1', 'Switch to zone.')).rejects.toThrow('Permission denied.');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('bounds auth preparation before a read is dispatched', async () => {
    vi.useFakeTimers();
    authMocks.getNativeAuthIdToken.mockReturnValueOnce(new Promise(() => {}));
    const load = loadNativeCoachesOnlyGameNote(directNotePath, 'coach.user:1', 10);
    const assertion = expect(load).rejects.toThrow('timed out before it was sent');

    await vi.advanceTimersByTimeAsync(10);

    await assertion;
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reconciles a dispatched write timeout before reporting success', async () => {
    vi.useFakeTimers();
    vi.mocked(fetch)
      .mockReturnValueOnce(new Promise(() => {}))
      .mockResolvedValueOnce(jsonResponse(200, noteDocument('Switch to zone.', 'coach.user:1')));
    const save = saveNativeCoachesOnlyGameNote(directNotePath, 'coach.user:1', 'Switch to zone.', 10);
    const assertion = expect(save).resolves.toEqual({ text: 'Switch to zone.', updatedBy: 'coach.user:1' });

    await vi.advanceTimersByTimeAsync(10);

    await assertion;
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual([commitUrl, directDocumentUrl]);
  });
});
