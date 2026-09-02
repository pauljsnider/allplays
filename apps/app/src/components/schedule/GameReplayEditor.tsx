import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ExternalLink, Link2, RefreshCw, Trash2, Video } from 'lucide-react';
import {
  createReplayMutationId,
  isReplayMutationUnconfirmedError,
  linkGameYouTubeReplayForApp,
  readGameReplayArchiveForApp,
  removeGameReplayForApp,
  toSafeReplayArchiveState,
  type ManagedReplayArchiveState,
  type SafeReplayArchiveState
} from '../../lib/replayArchiveService';
import { openPublicUrl } from '../../lib/publicActions';
import type { ParentScheduleEvent } from '../../lib/scheduleLogic';
import type { AuthState } from '../../lib/types';
import { isCompletedGameForReplay, normalizeYouTubeReplayUrl } from '../../lib/youtubeReplay';

function isSharedReplayEvent(event: ParentScheduleEvent) {
  return (
    event.id.startsWith('shared_') ||
    event.id.startsWith('sharedh_') ||
    event.id.startsWith('shared::') ||
    event.isSharedGame === true ||
    event.hasReplayShareMarker === true ||
    Boolean(event.sharedScheduleId) ||
    Boolean(event.sharedScheduleSourceTeamId) ||
    Boolean(event.sharedScheduleOpponentTeamId) ||
    Boolean(event.sharedScheduleOpponentGameId)
  );
}

function hasReplayManagementAccess(event: ParentScheduleEvent, auth: AuthState) {
  return Boolean(
    auth.user?.uid &&
    event.type === 'game' &&
    event.isDbGame &&
    !isSharedReplayEvent(event) &&
    (event.isTeamAdmin || event.canManageReplayVideo || event.canManageReplayVideoAsFullManager)
  );
}

function hasSafeReplayMarker(event: ParentScheduleEvent) {
  return event.hasRecordedReplay === true || event.hasReplayVideo === true;
}

export function canManageGameReplay(event: ParentScheduleEvent, auth: AuthState) {
  if (!hasReplayManagementAccess(event, auth)) return false;
  if (!event.isCancelled && isCompletedGameForReplay(event)) return true;
  return (event.isTeamAdmin === true || event.canManageReplayVideoAsFullManager === true) && hasSafeReplayMarker(event);
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function getEventSafeReplayState(event: ParentScheduleEvent): SafeReplayArchiveState {
  const hasRecordedReplay = hasSafeReplayMarker(event);
  const state =
    event.replayArchiveState === 'ready' || event.replayArchiveState === 'removed' || event.replayArchiveState === 'none'
      ? event.replayArchiveState
      : hasRecordedReplay
        ? 'ready'
        : 'none';
  return {
    state,
    hasRecordedReplay,
    hasReplayVideo: hasRecordedReplay,
    replayArchiveRevision:
      typeof event.replayArchiveRevision === 'string' && event.replayArchiveRevision.trim() ? event.replayArchiveRevision.trim() : null
  };
}

export function GameReplayEditor({
  auth,
  event,
  onReplayArchiveUpdated
}: {
  auth: AuthState;
  event: ParentScheduleEvent;
  onReplayArchiveUpdated: (state: SafeReplayArchiveState) => void;
}) {
  const [managementState, setManagementState] = useState<ManagedReplayArchiveState | null>(null);
  const [loadingState, setLoadingState] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [replayUrl, setReplayUrl] = useState('');
  const [replaceOtherReplayAcknowledged, setReplaceOtherReplayAcknowledged] = useState(false);
  const [savingAction, setSavingAction] = useState<'link' | 'remove' | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const disclosureButtonRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const restoreFocusAfterActionRef = useRef(false);
  const visibilityRef = useRef({ eventKey: event.eventKey, wasManageable: canManageGameReplay(event, auth) });
  const replayFormId = `game-replay-form-${event.id.replace(/[^A-Za-z0-9_-]/g, '-')}`;
  const isManageable = canManageGameReplay(event, auth);
  const eventSafeState = getEventSafeReplayState(event);

  const loadManagementState = useCallback(async () => {
    if (!hasReplayManagementAccess(event, auth)) return;
    setLoadingState(true);
    setLoadError(null);
    try {
      const nextState = await readGameReplayArchiveForApp(event.teamId, event.id);
      setManagementState(nextState);
      setReplayUrl(nextState.replayVideo?.publicUrl || '');
    } catch (error) {
      setManagementState(null);
      setReplayUrl('');
      setLoadError(getErrorMessage(error, 'Unable to load replay management right now. Try again.'));
    } finally {
      setLoadingState(false);
    }
  }, [auth, event.id, event.teamId]);

  useEffect(() => {
    let active = true;
    if (!hasReplayManagementAccess(event, auth)) {
      setManagementState(null);
      setReplayUrl('');
      setLoadError(null);
      return undefined;
    }
    setLoadingState(true);
    setLoadError(null);
    setManagementState(null);
    setReplayUrl('');
    readGameReplayArchiveForApp(event.teamId, event.id)
      .then((nextState) => {
        if (!active) return;
        setManagementState(nextState);
        setReplayUrl(nextState.replayVideo?.publicUrl || '');
      })
      .catch((error) => {
        if (!active) return;
        setLoadError(getErrorMessage(error, 'Unable to load replay management right now. Try again.'));
      })
      .finally(() => {
        if (active) setLoadingState(false);
      });
    return () => {
      active = false;
    };
  }, [auth, event.eventKey, event.id, event.replayArchiveRevision, event.teamId]);

  useEffect(() => {
    if (savingAction !== null || !restoreFocusAfterActionRef.current) return;
    restoreFocusAfterActionRef.current = false;
    (disclosureButtonRef.current || headingRef.current)?.focus();
  }, [editorOpen, managementState, savingAction]);

  if (visibilityRef.current.eventKey !== event.eventKey) {
    visibilityRef.current = { eventKey: event.eventKey, wasManageable: isManageable };
  } else if (isManageable) {
    visibilityRef.current.wasManageable = true;
  }
  const retainRemovedReplayNotice =
    visibilityRef.current.wasManageable && hasReplayManagementAccess(event, auth) && !hasSafeReplayMarker(event);

  if (!isManageable && !retainRemovedReplayNotice) return null;
  const canLinkOrReplace = !event.isCancelled && isCompletedGameForReplay(event);
  const replayVideo = managementState?.replayVideo || null;
  const hasArchiveReplay = managementState?.hasRecordedReplay ?? eventSafeState.hasRecordedReplay;
  const hasOtherReplay = Boolean(managementState && hasArchiveReplay && !replayVideo);
  const controlsUnavailable = loadingState || Boolean(loadError) || !managementState;

  const saveReplay = async (submitEvent: FormEvent<HTMLFormElement>) => {
    submitEvent.preventDefault();
    if (!auth.user || savingAction || !canLinkOrReplace || !managementState) return;
    if (hasOtherReplay && !replaceOtherReplayAcknowledged) {
      setNotice({ tone: 'error', message: 'Confirm that you want to replace the current non-YouTube replay.' });
      return;
    }
    const normalized = normalizeYouTubeReplayUrl(replayUrl);
    if (!normalized) {
      setNotice({
        tone: 'error',
        message: 'Paste a complete YouTube video link. Channel pages and channel-level live links are not supported.'
      });
      return;
    }
    const replacing = hasArchiveReplay;
    setSavingAction('link');
    setNotice(null);
    try {
      const nextState = await linkGameYouTubeReplayForApp(event.teamId, event.id, normalized.publicUrl, {
        expectedRevision: managementState.replayArchiveRevision,
        mutationId: createReplayMutationId(),
        userId: auth.user.uid
      });
      setManagementState(nextState);
      setReplayUrl(nextState.replayVideo?.publicUrl || '');
      setReplaceOtherReplayAcknowledged(false);
      restoreFocusAfterActionRef.current = true;
      setEditorOpen(false);
      onReplayArchiveUpdated(toSafeReplayArchiveState(nextState));
      setNotice({ tone: 'success', message: replacing ? 'YouTube replay replaced.' : 'YouTube replay linked.' });
    } catch (error: unknown) {
      if (isReplayMutationUnconfirmedError(error)) {
        setManagementState(null);
        setReplayUrl('');
        setEditorOpen(false);
        setLoadError(getErrorMessage(error, 'The replay update could not be confirmed. Refresh this game before trying again.'));
        setNotice(null);
        return;
      }
      setNotice({
        tone: 'error',
        message: getErrorMessage(error, 'The replay update could not be confirmed. Refresh this game before trying again.')
      });
    } finally {
      setSavingAction(null);
    }
  };

  const removeReplay = async () => {
    if (!auth.user || !hasArchiveReplay || savingAction || !managementState) return;
    const confirmed = window.confirm(
      replayVideo
        ? 'Remove this YouTube replay from the game? Viewers will no longer see the linked video, but the video will remain on YouTube.'
        : 'Remove this replay from the game? Viewers will no longer see the linked replay. Provider media will not be deleted.'
    );
    if (!confirmed) return;
    setSavingAction('remove');
    setNotice(null);
    try {
      const nextState = await removeGameReplayForApp(event.teamId, event.id, {
        expectedRevision: managementState.replayArchiveRevision,
        mutationId: createReplayMutationId(),
        userId: auth.user.uid
      });
      setManagementState(nextState);
      setReplayUrl('');
      restoreFocusAfterActionRef.current = true;
      setEditorOpen(false);
      onReplayArchiveUpdated(toSafeReplayArchiveState(nextState));
      setNotice({ tone: 'success', message: replayVideo ? 'YouTube replay removed.' : 'Replay removed from this game.' });
    } catch (error: unknown) {
      if (isReplayMutationUnconfirmedError(error)) {
        setManagementState(null);
        setReplayUrl('');
        setEditorOpen(false);
        setLoadError(getErrorMessage(error, 'The replay removal could not be confirmed. Refresh this game before trying again.'));
        setNotice(null);
        return;
      }
      setNotice({
        tone: 'error',
        message: getErrorMessage(error, 'The replay removal could not be confirmed. Refresh this game before trying again.')
      });
    } finally {
      setSavingAction(null);
    }
  };

  const openReplay = async () => {
    if (!replayVideo) return;
    setNotice(null);
    try {
      await openPublicUrl(replayVideo.publicUrl);
    } catch {
      setNotice({ tone: 'error', message: 'Unable to open this YouTube replay on this device.' });
    }
  };

  const cancelEditor = () => {
    restoreFocusAfterActionRef.current = true;
    setEditorOpen(false);
    setReplayUrl(replayVideo?.publicUrl || '');
    setReplaceOtherReplayAcknowledged(false);
    setNotice(null);
  };

  return (
    <section className="app-card p-3 sm:p-4" aria-labelledby="game-replay-heading" aria-busy={savingAction !== null || loadingState}>
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-red-50 text-red-600">
          <Video className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-black tracking-[0.04em] text-red-700 uppercase">Post-game video</div>
              <h2 ref={headingRef} id="game-replay-heading" tabIndex={-1} className="mt-1 text-base font-black text-gray-950">
                YouTube replay
              </h2>
              <p className="mt-1 text-sm leading-6 font-semibold text-gray-500">
                {loadingState
                  ? 'Loading the protected replay link…'
                  : replayVideo
                    ? 'This exact video is attached to the game for replay.'
                    : hasArchiveReplay
                      ? canLinkOrReplace
                        ? 'Another replay is attached. Replacing it with YouTube requires confirmation.'
                        : 'Another replay is attached. Removing this game link will not delete the provider media.'
                      : canLinkOrReplace
                        ? 'Attach the finished broadcast so families can watch it with the game replay.'
                        : 'The replay was removed. Mark the game final before linking another video.'}
              </p>
            </div>
            {hasArchiveReplay ? (
              <span className="inline-flex min-h-6 items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 text-[11px] font-extrabold tracking-[0.04em] text-emerald-700 uppercase">
                {replayVideo ? 'Linked' : 'Attached'}
              </span>
            ) : null}
          </div>

          {loadError ? (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-900" role="alert">
              <p>{loadError}</p>
              <button
                type="button"
                className="secondary-button mt-2 min-h-10 px-3 text-sm"
                onClick={loadManagementState}
                disabled={loadingState}
              >
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                Retry
              </button>
            </div>
          ) : null}

          {replayVideo ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="secondary-button min-h-10 px-3 text-sm"
                onClick={openReplay}
                disabled={savingAction !== null || controlsUnavailable}
              >
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
                Open video
              </button>
              {canLinkOrReplace ? (
                <button
                  ref={disclosureButtonRef}
                  type="button"
                  className="secondary-button min-h-10 px-3 text-sm"
                  onClick={() => {
                    setEditorOpen(true);
                    setNotice(null);
                  }}
                  disabled={savingAction !== null || controlsUnavailable}
                  aria-expanded={editorOpen}
                  aria-controls={replayFormId}
                >
                  <Link2 className="h-4 w-4" aria-hidden="true" />
                  Replace link
                </button>
              ) : null}
              <button
                type="button"
                className="ghost-button min-h-10 px-3 text-sm text-rose-700"
                onClick={removeReplay}
                disabled={savingAction !== null || controlsUnavailable}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                {savingAction === 'remove' ? 'Removing' : 'Remove'}
              </button>
            </div>
          ) : canLinkOrReplace || hasOtherReplay ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {canLinkOrReplace ? (
                <button
                  ref={disclosureButtonRef}
                  type="button"
                  className="primary-button min-h-10 px-4 text-sm"
                  onClick={() => {
                    setEditorOpen(true);
                    setReplaceOtherReplayAcknowledged(false);
                    setNotice(null);
                  }}
                  disabled={savingAction !== null || controlsUnavailable}
                  aria-expanded={editorOpen}
                  aria-controls={replayFormId}
                >
                  <Link2 className="h-4 w-4" aria-hidden="true" />
                  {hasOtherReplay ? 'Replace with YouTube replay' : 'Link YouTube replay'}
                </button>
              ) : null}
              {hasOtherReplay ? (
                <button
                  type="button"
                  className="ghost-button min-h-10 px-3 text-sm text-rose-700"
                  onClick={removeReplay}
                  disabled={savingAction !== null || controlsUnavailable}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  {savingAction === 'remove' ? 'Removing' : 'Remove'}
                </button>
              ) : null}
            </div>
          ) : null}

          {editorOpen && canLinkOrReplace ? (
            <form id={replayFormId} className="mt-3 space-y-3 rounded-2xl border border-gray-200 bg-gray-50 p-3" onSubmit={saveReplay}>
              <label htmlFor="game-replay-url" className="block text-xs font-bold tracking-wide text-gray-600 uppercase">
                YouTube video URL
              </label>
              <input
                id="game-replay-url"
                type="url"
                inputMode="url"
                autoComplete="url"
                maxLength={2048}
                className="auth-input"
                value={replayUrl}
                onChange={(inputEvent) => setReplayUrl(inputEvent.target.value)}
                placeholder="https://youtu.be/..."
                aria-describedby="game-replay-url-help"
                disabled={savingAction !== null}
                autoFocus
              />
              <p id="game-replay-url-help" className="text-xs leading-5 font-semibold text-gray-500">
                Paste the finished video, not your channel page or generic live-feed link.
              </p>
              {hasOtherReplay ? (
                <label className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-5 font-bold text-amber-900">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 flex-none"
                    checked={replaceOtherReplayAcknowledged}
                    onChange={(inputEvent) => setReplaceOtherReplayAcknowledged(inputEvent.target.checked)}
                    disabled={savingAction !== null}
                  />
                  I understand this replaces the current non-YouTube replay.
                </label>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <button
                  type="submit"
                  className="primary-button min-h-10 px-4 text-sm"
                  disabled={savingAction !== null || (hasOtherReplay && !replaceOtherReplayAcknowledged)}
                >
                  {savingAction === 'link' ? 'Saving replay' : replayVideo || hasOtherReplay ? 'Replace replay' : 'Save replay'}
                </button>
                <button
                  type="button"
                  className="ghost-button min-h-10 px-3 text-sm"
                  onClick={cancelEditor}
                  disabled={savingAction !== null}
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : null}
        </div>
      </div>
      {notice ? (
        <div
          className={`mt-3 rounded-xl border px-3 py-2 text-sm font-bold ${notice.tone === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}
          role={notice.tone === 'error' ? 'alert' : 'status'}
        >
          {notice.message}
        </div>
      ) : null}
    </section>
  );
}
