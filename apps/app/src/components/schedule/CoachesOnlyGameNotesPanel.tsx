import { useCallback, useEffect, useRef, useState } from 'react';

import {
  COACHES_ONLY_GAME_NOTE_MAX_LENGTH,
  isCoachesOnlyGameNoteSaveUncertainError,
  loadCoachesOnlyGameNoteForApp,
  saveCoachesOnlyGameNoteForApp
} from '../../lib/coachesOnlyGameNotesService';

type LoadState = 'loading' | 'ready' | 'error';

export function buildCoachesOnlyGameNoteScopeKey(userId: string, teamId: string, gameId: string, sharedGamePath = '') {
  return JSON.stringify([userId, teamId, gameId, sharedGamePath]);
}

export function CoachesOnlyGameNotesPanel({
  teamId,
  gameId,
  userId,
  sharedGamePath = ''
}: {
  teamId: string;
  gameId: string;
  userId: string;
  sharedGamePath?: string;
}) {
  const scopeKey = buildCoachesOnlyGameNoteScopeKey(userId, teamId, gameId, sharedGamePath);
  const requestGeneration = useRef(0);
  const [stateScopeKey, setStateScopeKey] = useState(scopeKey);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [savedText, setSavedText] = useState('');
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('Loading private note…');
  const [statusIsError, setStatusIsError] = useState(false);

  const loadNote = useCallback(async () => {
    const generation = ++requestGeneration.current;
    setLoadState('loading');
    setSaving(false);
    setStatus('Loading private note…');
    setStatusIsError(false);
    try {
      const note = await loadCoachesOnlyGameNoteForApp({ teamId, gameId, userId, sharedGamePath });
      if (requestGeneration.current !== generation) return;
      setSavedText(note.text);
      setDraft(note.text);
      setLoadState('ready');
      setStatus(note.exists ? 'Private note loaded.' : 'No private note yet.');
    } catch {
      if (requestGeneration.current !== generation) return;
      setLoadState('error');
      setStatus('Private note could not be loaded. Editing is disabled.');
      setStatusIsError(true);
    }
  }, [gameId, sharedGamePath, teamId, userId]);

  useEffect(() => {
    setStateScopeKey(scopeKey);
    setSavedText('');
    setDraft('');
    void loadNote();
    return () => {
      requestGeneration.current += 1;
    };
  }, [loadNote, scopeKey]);

  const saveNote = async () => {
    if (stateScopeKey !== scopeKey || loadState !== 'ready' || saving || draft === savedText) return;
    const generation = requestGeneration.current;
    const textToSave = draft;
    setSaving(true);
    setStatus('Saving private note…');
    setStatusIsError(false);
    try {
      const saved = await saveCoachesOnlyGameNoteForApp({
        teamId,
        gameId,
        userId,
        text: textToSave,
        sharedGamePath
      });
      if (requestGeneration.current !== generation) return;
      setSavedText(saved.text);
      setDraft(saved.text);
      setStatus('Private note saved.');
    } catch (error) {
      if (requestGeneration.current !== generation) return;
      if (isCoachesOnlyGameNoteSaveUncertainError(error)) {
        setLoadState('error');
        setStatus(
          'The private note may have saved, but confirmation is unavailable. Your draft is still here; reload before trying again.'
        );
      } else {
        setStatus('Save failed. Your draft is still here; try again.');
      }
      setStatusIsError(true);
    } finally {
      if (requestGeneration.current === generation) setSaving(false);
    }
  };

  const scopeIsCurrent = stateScopeKey === scopeKey;
  const visibleDraft = scopeIsCurrent ? draft : '';
  const visibleStatus = scopeIsCurrent ? status : 'Loading private note…';
  const editorDisabled = !scopeIsCurrent || loadState !== 'ready' || saving;
  const saveDisabled = editorDisabled || draft === savedText || draft.length > COACHES_ONLY_GAME_NOTE_MAX_LENGTH;

  return (
    <section className="app-card border-amber-200 bg-amber-50" data-testid="coaches-only-game-notes-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="app-section-title text-amber-950">Coaches-only notes</h2>
          <p id="coaches-only-game-note-privacy" className="mt-1 text-sm font-semibold text-amber-900">
            Visible only to team owners and admins. These notes are not included in family views, game-helper access, recaps, or AI
            summaries.
          </p>
        </div>
        <span className="rounded-full border border-amber-300 bg-white px-2 py-1 text-[11px] font-black tracking-[0.04em] text-amber-800 uppercase">
          Private
        </span>
      </div>

      <label className="sr-only" htmlFor="coaches-only-game-note">
        Coaches-only notes
      </label>
      <textarea
        id="coaches-only-game-note"
        rows={4}
        maxLength={COACHES_ONLY_GAME_NOTE_MAX_LENGTH}
        aria-describedby="coaches-only-game-note-privacy coaches-only-game-note-count coaches-only-game-note-status"
        disabled={editorDisabled}
        value={visibleDraft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="Private observations, reminders, or plans for team managers…"
        className="mt-3 w-full resize-y rounded-2xl border border-amber-200 bg-white px-3 py-3 text-sm font-semibold text-gray-900 transition outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-200 disabled:cursor-not-allowed disabled:bg-amber-100 disabled:text-gray-500"
      />

      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 text-xs font-bold">
          <span id="coaches-only-game-note-count" className="text-amber-800">
            {visibleDraft.length} / {COACHES_ONLY_GAME_NOTE_MAX_LENGTH}
          </span>
          <span id="coaches-only-game-note-status" className={statusIsError ? 'text-red-700' : 'text-amber-800'} role="status">
            {visibleStatus}
          </span>
          {loadState === 'error' ? (
            <button
              type="button"
              className="inline-flex min-h-11 items-center px-2 text-amber-900 underline hover:text-amber-700"
              onClick={() => void loadNote()}
            >
              Retry
            </button>
          ) : null}
        </div>
        <button
          type="button"
          className="primary-button min-h-11 bg-amber-700 px-4 text-sm hover:bg-amber-800 disabled:opacity-50"
          disabled={saveDisabled}
          onClick={() => void saveNote()}
        >
          {saving ? 'Saving private note' : 'Save private note'}
        </button>
      </div>
    </section>
  );
}
