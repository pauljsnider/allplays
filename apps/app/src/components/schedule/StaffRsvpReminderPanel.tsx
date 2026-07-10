import { useCallback, useEffect, useState } from 'react';
import {
  sendStaffRsvpReminder,
  type StaffRsvpAvailabilityLoader,
  type StaffRsvpReminderSendResult
} from '../../lib/scheduleService';
import { type StaffRsvpReminderPreview } from '../../lib/scheduleLogic';
import { useScheduleEventDetailContext } from '../../pages/schedule/ScheduleEventDetailContext';

export function StaffRsvpReminderPanel({ refreshToken = 0, staffRsvpLoader }: { refreshToken?: number; staffRsvpLoader: StaffRsvpAvailabilityLoader }) {
  const { auth, event } = useScheduleEventDetailContext();
  const [preview, setPreview] = useState<StaffRsvpReminderPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasSentReminder, setHasSentReminder] = useState(false);
  const [showPlayersWithoutEmail, setShowPlayersWithoutEmail] = useState(false);

  const canLoad = Boolean(auth.user && event.isTeamRsvpReminderManager && event.isDbGame && !event.isCancelled);

  const refreshPreview = useCallback(async () => {
    if (!auth.user || !canLoad) return;
    setLoading(true);
    setError(null);
    try {
      setPreview(await staffRsvpLoader.loadReminderPreview(event, auth.user));
    } catch (loadError: any) {
      setError(loadError?.message || 'Unable to load RSVP reminder preview.');
      setPreview(null);
    } finally {
      setLoading(false);
    }
  }, [auth.user, canLoad, event.eventKey, event.teamId, event.id, staffRsvpLoader]);

  useEffect(() => {
    setStatus(null);
    setHasSentReminder(false);
    setShowPlayersWithoutEmail(false);
    if (canLoad) {
      refreshPreview();
    } else {
      setPreview(null);
      setLoading(false);
    }
  }, [canLoad, refreshPreview, refreshToken]);

  if (!event.isTeamRsvpReminderManager || !event.isDbGame || event.isCancelled) return null;
  if (loading && !preview) {
    return <div className="mt-3 rounded-xl border border-gray-200 bg-white p-3 text-sm font-semibold text-gray-600">Loading staff RSVP reminder preview…</div>;
  }
  if (!preview || preview.missingPlayerCount <= 0) return null;

  const playersWithoutEmail = preview.players.filter((player) => (
    player.hasEligibleParentEmail === false
    || !Array.isArray(player.parentEmails)
    || player.parentEmails.length === 0
  ));
  const uncoveredPlayerCount = playersWithoutEmail.length;
  const deliveryConfirmation = preview.eligibleEmailCount === 0
    ? 'No parent/guardian emails will be sent. The reminder will post to team chat only.'
    : uncoveredPlayerCount > 0
      ? `${preview.eligibleEmailCount} eligible parent/guardian ${preview.eligibleEmailCount === 1 ? 'email' : 'emails'} will be targeted. ${uncoveredPlayerCount} no-response ${uncoveredPlayerCount === 1 ? 'player has' : 'players have'} no eligible parent/guardian email. The reminder will also post to team chat.`
      : `${preview.eligibleEmailCount} eligible parent/guardian ${preview.eligibleEmailCount === 1 ? 'email' : 'emails'} will be targeted.`;

  const sendReminder = async () => {
    if (!auth.user || sending) return;
    const confirmed = window.confirm(`Send an RSVP reminder to ${preview.missingPlayerCount} no-response ${preview.missingPlayerCount === 1 ? 'player' : 'players'}? ${deliveryConfirmation}`);
    if (!confirmed) return;
    setSending(true);
    setError(null);
    setStatus(null);
    try {
      const result: StaffRsvpReminderSendResult = await sendStaffRsvpReminder(event, auth.user, auth.profile || {});
      setPreview(result);
      setHasSentReminder(true);
      setStatus(result.emailSentCount > 0
        ? `RSVP reminder sent to team chat and ${result.emailSentCount} parent/guardian ${result.emailSentCount === 1 ? 'email' : 'emails'}.`
        : 'RSVP reminder sent to team chat. No parent/guardian emails were sent.');
    } catch (sendError: any) {
      setError(sendError?.message || 'Unable to send RSVP reminder.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mt-3 rounded-xl border border-primary-200 bg-primary-50 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-black text-gray-950">Staff RSVP reminder</div>
          <div className="mt-1 text-xs font-semibold leading-5 text-gray-600">
            {preview.missingPlayerCount} no-response {preview.missingPlayerCount === 1 ? 'player' : 'players'} · {preview.eligibleEmailCount} eligible parent/guardian {preview.eligibleEmailCount === 1 ? 'email' : 'emails'}.
          </div>
        </div>
        {hasSentReminder ? (
          <div className="flex flex-none flex-col items-end gap-1">
            <div className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-black text-emerald-800">Sent</div>
            <button
              type="button"
              className="text-xs font-bold text-primary-700 underline-offset-2 hover:underline disabled:text-gray-400"
              disabled={sending || loading}
              onClick={sendReminder}
            >
              {sending ? 'Sending…' : 'Send again'}
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="primary-button min-h-9 flex-none px-3 text-xs"
            disabled={sending || loading}
            onClick={sendReminder}
          >
            {sending ? 'Sending…' : 'Send reminder'}
          </button>
        )}
      </div>
      {uncoveredPlayerCount > 0 ? (
        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs font-semibold leading-5 text-amber-900">
          <div>
            {preview.eligibleEmailCount === 0
              ? `No eligible parent/guardian emails for ${uncoveredPlayerCount} no-response ${uncoveredPlayerCount === 1 ? 'player' : 'players'}. Reminder will post to team chat only.`
              : `${uncoveredPlayerCount} no-response ${uncoveredPlayerCount === 1 ? 'player has' : 'players have'} no eligible parent/guardian email. Reminder still posts to team chat; emails only reach eligible guardians.`}
          </div>
          <button
            type="button"
            className="mt-1 font-black text-amber-900 underline underline-offset-2"
            aria-expanded={showPlayersWithoutEmail}
            onClick={() => setShowPlayersWithoutEmail((current) => !current)}
          >
            {showPlayersWithoutEmail ? 'Hide players without email' : 'Review players without email'}
          </button>
          {showPlayersWithoutEmail ? (
            <ul className="mt-1 list-disc pl-5" aria-label="Players without eligible parent or guardian email">
              {playersWithoutEmail.map((player) => <li key={player.playerId}>{player.playerName}</li>)}
            </ul>
          ) : null}
        </div>
      ) : null}
      {status ? <div className="mt-2 text-xs font-bold text-emerald-700">{status}</div> : null}
      {error ? <div className="mt-2 text-xs font-bold text-rose-700">{error}</div> : null}
    </div>
  );
}
