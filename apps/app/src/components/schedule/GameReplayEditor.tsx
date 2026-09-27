import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ExternalLink, Link2, Trash2, Video } from 'lucide-react';
import {
  linkGameYouTubeReplayForApp,
  removeGameReplayForApp
} from '../../lib/scheduleService';
import { openPublicUrl } from '../../lib/publicActions';
import type { ParentScheduleEvent } from '../../lib/scheduleLogic';
import type { AuthState } from '../../lib/types';
import {
  getReplayArchiveState,
  hasReplayArchiveEvidence,
  hasReplayVideoSourceEvidence,
  isCompletedGameForReplay,
  normalizeStoredYouTubeReplay,
  normalizeYouTubeReplayUrl,
  type ReplayArchiveState,
  type YouTubeReplayVideo
} from '../../lib/youtubeReplay';

function isSharedReplayEvent(event: ParentScheduleEvent) {
  return event.id.startsWith('shared_')
    || event.id.startsWith('sharedh_')
    || event.id.startsWith('shared::')
    || event.isSharedGame === true
    || event.hasReplayShareMarker === true
    || Boolean(event.sharedScheduleId)
    || Boolean(event.sharedScheduleSourceTeamId)
    || Boolean(event.sharedScheduleOpponentTeamId)
    || Boolean(event.sharedScheduleOpponentGameId);
}

function getEventReplayState(event: ParentScheduleEvent) {
  return event.rawReplayState !== undefined
    ? getReplayArchiveState(event.rawReplayState)
    : getReplayArchiveState({ replayVideo: event.replayVideo });
}

function hasReplayManagementAccess(event: ParentScheduleEvent, auth: AuthState) {
  return Boolean(
    auth.user?.uid
    && event.type === 'game'
    && event.isDbGame
    && !isSharedReplayEvent(event)
    && (event.isTeamAdmin || event.canManageReplayVideo || event.canManageReplayVideoAsFullManager)
  );
}

export function canManageGameReplay(event: ParentScheduleEvent, auth: AuthState) {
  if (!hasReplayManagementAccess(event, auth)) return false;
  const rawReplayState = getEventReplayState(event);
  if (!event.isCancelled && isCompletedGameForReplay(event)) return true;
  const hasReplayEvidence = hasReplayArchiveEvidence(rawReplayState)
    || (isCompletedGameForReplay(event) && hasReplayVideoSourceEvidence({ ...event, rawReplayState }));
  return (event.isTeamAdmin === true || event.canManageReplayVideoAsFullManager === true)
    && hasReplayEvidence;
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function GameReplayEditor({
  auth,
  event,
  onReplayVideoUpdated
}: {
  auth: AuthState;
  event: ParentScheduleEvent;
  onReplayVideoUpdated: (replayVideo: YouTubeReplayVideo | null, replayState: ReplayArchiveState) => void;
}) {
  const eventRawReplayState = event.rawReplayState;
  const eventReplayVideo = event.replayVideo;
  const incomingRawReplayState = useMemo(
    () => eventRawReplayState !== undefined
      ? getReplayArchiveState(eventRawReplayState)
      : getReplayArchiveState({ replayVideo: eventReplayVideo }),
    [eventRawReplayState, eventReplayVideo]
  );
  const incomingReplay = useMemo(
    () => incomingRawReplayState.replayVideoFallbackDisabled === true
      ? null
      : normalizeStoredYouTubeReplay(incomingRawReplayState.replayVideo),
    [incomingRawReplayState]
  );
  const [replayVideo, setReplayVideo] = useState<YouTubeReplayVideo | null>(incomingReplay);
  const [rawReplayState, setRawReplayState] = useState<ReplayArchiveState>(incomingRawReplayState);
  const [editorOpen, setEditorOpen] = useState(false);
  const [replayUrl, setReplayUrl] = useState(incomingReplay?.publicUrl || '');
  const [replaceOtherReplayAcknowledged, setReplaceOtherReplayAcknowledged] = useState(false);
  const [savingAction, setSavingAction] = useState<'link' | 'remove' | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const disclosureButtonRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const restoreFocusAfterActionRef = useRef(false);
  const visibilityRef = useRef({ eventKey: event.eventKey, wasManageable: canManageGameReplay(event, auth) });
  const replayFormId = `game-replay-form-${event.id.replace(/[^A-Za-z0-9_-]/g, '-')}`;

  useEffect(() => {
    setReplayVideo(incomingReplay);
    setRawReplayState(incomingRawReplayState);
    setReplayUrl(incomingReplay?.publicUrl || '');
    setReplaceOtherReplayAcknowledged(false);
  }, [incomingRawReplayState, incomingReplay]);

  useEffect(() => {
    if (savingAction !== null || !restoreFocusAfterActionRef.current) return;
    restoreFocusAfterActionRef.current = false;
    (disclosureButtonRef.current || headingRef.current)?.focus();
  }, [editorOpen, replayVideo, savingAction]);

  const isManageable = canManageGameReplay(event, auth);
  if (visibilityRef.current.eventKey !== event.eventKey) {
    visibilityRef.current = { eventKey: event.eventKey, wasManageable: isManageable };
  } else if (isManageable) {
    visibilityRef.current.wasManageable = true;
  }
  const retainRemovedReplayNotice = visibilityRef.current.wasManageable
    && hasReplayManagementAccess(event, auth)
    && !incomingReplay;

  if (!isManageable && !retainRemovedReplayNotice) return null;
  const canLinkOrReplace = !event.isCancelled && isCompletedGameForReplay(event);
  const hasArchiveReplay = hasReplayArchiveEvidence(rawReplayState)
    || (isCompletedGameForReplay(event) && hasReplayVideoSourceEvidence({ ...event, rawReplayState }));
  const hasOtherReplay = hasArchiveReplay && !replayVideo;

  const saveReplay = async (submitEvent: FormEvent<HTMLFormElement>) => {
    submitEvent.preventDefault();
    if (!auth.user || savingAction || !canLinkOrReplace) return;

    if (hasOtherReplay && !replaceOtherReplayAcknowledged) {
      setNotice({
        tone: 'error',
        message: 'Confirm that you want to replace the current non-YouTube replay.'
      });
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

    const replacing = Boolean(replayVideo || hasOtherReplay);
    setSavingAction('link');
    setNotice(null);
    try {
      const savedReplay = await linkGameYouTubeReplayForApp(
        event.teamId,
        event.id,
        normalized.publicUrl,
        auth.user,
        { expectedReplayState: rawReplayState }
      );
      setReplayVideo(savedReplay);
      const nextReplayState: ReplayArchiveState = {
        ...(rawReplayState.videoUrl !== undefined ? { videoUrl: rawReplayState.videoUrl } : {}),
        replayVideo: savedReplay
      };
      setRawReplayState(nextReplayState);
      setReplayUrl(savedReplay.publicUrl);
      setReplaceOtherReplayAcknowledged(false);
      restoreFocusAfterActionRef.current = true;
      setEditorOpen(false);
      onReplayVideoUpdated(savedReplay, nextReplayState);
      setNotice({
        tone: 'success',
        message: replacing ? 'YouTube replay replaced.' : 'YouTube replay linked.'
      });
    } catch (error: unknown) {
      setNotice({
        tone: 'error',
        message: getErrorMessage(error, 'The replay update could not be confirmed. Refresh this game before trying again.')
      });
    } finally {
      setSavingAction(null);
    }
  };

  const removeReplay = async () => {
    if (!auth.user || !hasArchiveReplay || savingAction) return;
    const confirmed = window.confirm(replayVideo
      ? 'Remove this YouTube replay from the game? Viewers will no longer see the linked video, but the video will remain on YouTube.'
      : 'Remove this replay from the game? Viewers will no longer see the linked replay. Provider media will not be deleted.');
    if (!confirmed) return;

    setSavingAction('remove');
    setNotice(null);
    try {
      await removeGameReplayForApp(event.teamId, event.id, auth.user, rawReplayState);
      setReplayVideo(null);
      const nextReplayState: ReplayArchiveState = {
        ...(rawReplayState.videoUrl !== undefined ? { videoUrl: rawReplayState.videoUrl } : {}),
        replayVideoFallbackDisabled: true
      };
      setRawReplayState(nextReplayState);
      setReplayUrl('');
      restoreFocusAfterActionRef.current = true;
      setEditorOpen(false);
      onReplayVideoUpdated(null, nextReplayState);
      setNotice({ tone: 'success', message: replayVideo ? 'YouTube replay removed.' : 'Replay removed from this game.' });
    } catch (error: unknown) {
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
    <section className="app-card p-3 sm:p-4" aria-labelledby="game-replay-heading" aria-busy={savingAction !== null}>
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-red-50 text-red-600">
          <Video className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-black uppercase tracking-[0.04em] text-red-700">Post-game video</div>
              <h2 ref={headingRef} id="game-replay-heading" tabIndex={-1} className="mt-1 text-base font-black text-gray-950">YouTube replay</h2>
              <p className="mt-1 text-sm font-semibold leading-6 text-gray-500">
                {replayVideo
                  ? 'This exact video is attached to the game for replay.'
                  : hasOtherReplay
                    ? canLinkOrReplace
                      ? 'Another replay is attached. Replacing it with YouTube requires confirmation.'
                      : 'Another replay is attached. Removing this game link will not delete the provider media.'
                    : canLinkOrReplace
                      ? 'Attach the finished broadcast so families can watch it with the game replay.'
                      : 'The replay was removed. Mark the game final before linking another video.'}
              </p>
            </div>
            {hasArchiveReplay ? (
              <span className="inline-flex min-h-6 items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 text-[11px] font-extrabold uppercase tracking-[0.04em] text-emerald-700">
                {replayVideo ? 'Linked' : 'Attached'}
              </span>
            ) : null}
          </div>

          {replayVideo ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className="secondary-button min-h-10 px-3 text-sm" onClick={openReplay} disabled={savingAction !== null}>
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
                Open video
              </button>
              {canLinkOrReplace ? (
                <button
                  ref={disclosureButtonRef}
                  type="button"
                  className="secondary-button min-h-10 px-3 text-sm"
                  onClick={() => { setEditorOpen(true); setNotice(null); }}
                  disabled={savingAction !== null}
                  aria-expanded={editorOpen}
                  aria-controls={replayFormId}
                >
                  <Link2 className="h-4 w-4" aria-hidden="true" />
                  Replace link
                </button>
              ) : null}
              <button type="button" className="ghost-button min-h-10 px-3 text-sm text-rose-700" onClick={removeReplay} disabled={savingAction !== null}>
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
                  onClick={() => { setEditorOpen(true); setReplaceOtherReplayAcknowledged(false); setNotice(null); }}
                  disabled={savingAction !== null}
                  aria-expanded={editorOpen}
                  aria-controls={replayFormId}
                >
                  <Link2 className="h-4 w-4" aria-hidden="true" />
                  {hasOtherReplay ? 'Replace with YouTube replay' : 'Link YouTube replay'}
                </button>
              ) : null}
              {hasOtherReplay ? (
                <button type="button" className="ghost-button min-h-10 px-3 text-sm text-rose-700" onClick={removeReplay} disabled={savingAction !== null}>
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  {savingAction === 'remove' ? 'Removing' : 'Remove'}
                </button>
              ) : null}
            </div>
          ) : null}

          {editorOpen && canLinkOrReplace ? (
            <form id={replayFormId} className="mt-3 space-y-3 rounded-2xl border border-gray-200 bg-gray-50 p-3" onSubmit={saveReplay}>
              <label htmlFor="game-replay-url" className="block text-xs font-bold uppercase tracking-wide text-gray-600">
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
              <p id="game-replay-url-help" className="text-xs font-semibold leading-5 text-gray-500">
                Paste the finished video, not your channel page or generic live-feed link.
              </p>
              {hasOtherReplay ? (
                <label className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold leading-5 text-amber-900">
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
                <button type="submit" className="primary-button min-h-10 px-4 text-sm" disabled={savingAction !== null || (hasOtherReplay && !replaceOtherReplayAcknowledged)}>
                  {savingAction === 'link' ? 'Saving replay' : replayVideo || hasOtherReplay ? 'Replace replay' : 'Save replay'}
                </button>
                <button type="button" className="ghost-button min-h-10 px-3 text-sm" onClick={cancelEditor} disabled={savingAction !== null}>
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
