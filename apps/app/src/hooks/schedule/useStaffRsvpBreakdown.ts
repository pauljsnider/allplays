import { useCallback, useEffect, useState } from 'react';
import {
  submitStaffScheduleRsvpOverride,
  type StaffRsvpAvailabilityLoader,
  type StaffScheduleRsvpBreakdown,
  type StaffScheduleRsvpRow
} from '../../lib/scheduleService';
import { type RsvpResponse } from '../../lib/scheduleLogic';
import { rsvpLabels } from '../../components/schedule/AvailabilityPanels';
import { useScheduleEventDetailContext } from '../../pages/schedule/ScheduleEventDetailContext';

export type StaffRsvpOverrideStatus = {
  tone: 'success' | 'error';
  playerId: string;
  message: string;
};

export function useStaffRsvpBreakdown(staffRsvpLoader: StaffRsvpAvailabilityLoader) {
  const { auth, event, updateEvents } = useScheduleEventDetailContext();
  const [breakdown, setBreakdown] = useState<StaffScheduleRsvpBreakdown | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submittingPlayerId, setSubmittingPlayerId] = useState<string | null>(null);
  const [status, setStatus] = useState<StaffRsvpOverrideStatus | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  const refreshBreakdown = useCallback(async (showLoading = true) => {
    if (!auth.user || !event.isTeamAdmin || !event.isDbGame) {
      setBreakdown(null);
      setError(null);
      return null;
    }
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const nextBreakdown = await staffRsvpLoader.loadBreakdown(event, auth.user);
      setBreakdown(nextBreakdown);
      return nextBreakdown;
    } catch (loadError: any) {
      setBreakdown(null);
      setError(loadError?.message || 'Unable to load staff RSVP breakdown.');
      return null;
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [auth.user, event.eventKey, event.teamId, event.id, event.isTeamAdmin, event.isDbGame, staffRsvpLoader]);

  useEffect(() => {
    setStatus(null);
    setSubmittingPlayerId(null);
    if (!event.isTeamAdmin || !event.isDbGame) {
      setBreakdown(null);
      setError(null);
      setLoading(false);
      return;
    }
    refreshBreakdown();
  }, [refreshBreakdown, event.eventKey]);

  const submitOverride = async (player: StaffScheduleRsvpRow, response: Exclude<RsvpResponse, 'not_responded'>) => {
    if (!auth.user) return;
    setSubmittingPlayerId(player.playerId);
    setStatus(null);
    setError(null);
    try {
      await submitStaffScheduleRsvpOverride(event, auth.user, player.playerId, response);
      staffRsvpLoader.invalidateEvent(event);
      const nextBreakdown = await refreshBreakdown(false);
      if (nextBreakdown) {
        updateEvents((current) => current.map((currentEvent) => {
          if (currentEvent.teamId !== event.teamId || currentEvent.id !== event.id) return currentEvent;
          return {
            ...currentEvent,
            myRsvp: currentEvent.childId === player.playerId ? response : currentEvent.myRsvp,
            rsvpSummary: nextBreakdown.counts
          };
        }));
      }
      setRefreshToken((current) => current + 1);
      setStatus({ tone: 'success', playerId: player.playerId, message: `${player.playerName} marked ${rsvpLabels[response].toLowerCase()}.` });
    } catch (submitError: any) {
      setStatus({ tone: 'error', playerId: player.playerId, message: submitError?.message || 'Unable to update player RSVP.' });
    } finally {
      setSubmittingPlayerId(null);
    }
  };

  return {
    breakdown,
    loading,
    error,
    submittingPlayerId,
    status,
    refreshToken,
    submitOverride
  };
}
