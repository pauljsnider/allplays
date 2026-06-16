import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  cancelParentScheduleRideRequest,
  createParentScheduleRideOffer,
  loadParentScheduleRideOffers,
  requestParentScheduleRideSpot,
  setParentScheduleRideOfferStatus,
  summarizeParentScheduleRideOffers,
  updateParentScheduleRideRequestStatus,
  type RideOfferInput,
  type RideRequestChildInput
} from '../../lib/scheduleService';
import {
  type ParentScheduleEvent,
  type RideOfferDirection,
  type RideRequestStatus,
  type ScheduleRideOffer
} from '../../lib/scheduleLogic';
import { useScheduleEventDetailContext } from '../../pages/schedule/ScheduleEventDetailContext';

type RideChildChoice = {
  childId: string;
  childName: string;
};

function getRideChildChoices(events: ParentScheduleEvent[]): RideChildChoice[] {
  const byId = new Map<string, RideChildChoice>();
  events.forEach((event) => {
    if (!event.childId || byId.has(event.childId)) return;
    byId.set(event.childId, {
      childId: event.childId,
      childName: event.childName || 'Player'
    });
  });
  return [...byId.values()];
}

function resolveRideChildIdForOffer(
  offer: ScheduleRideOffer,
  event: ParentScheduleEvent,
  childChoices: RideChildChoice[],
  selectedChildId: string | undefined,
  userId: string
) {
  const validChildIds = new Set(childChoices.map((child) => child.childId));
  if (selectedChildId && validChildIds.has(selectedChildId)) return selectedChildId;
  if (event.childId && validChildIds.has(event.childId)) return event.childId;
  const ownRequest = offer.requests.find((request) => request.parentUserId === userId && request.childId && validChildIds.has(request.childId));
  if (ownRequest?.childId) return ownRequest.childId;
  return childChoices[0]?.childId || '';
}

export function useScheduleRideOffers() {
  const { auth, event, childEvents, updateEvents } = useScheduleEventDetailContext();
  const [offers, setOffers] = useState<ScheduleRideOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [seatCapacity, setSeatCapacity] = useState('3');
  const [direction, setDirection] = useState<RideOfferDirection>('to');
  const [note, setNote] = useState('');
  const [selectedChildByOffer, setSelectedChildByOffer] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const eventRef = useRef(event);
  const updateEventsRef = useRef(updateEvents);

  useEffect(() => {
    eventRef.current = event;
    updateEventsRef.current = updateEvents;
  }, [event, updateEvents]);

  const childChoices = useMemo(() => getRideChildChoices(childEvents), [childEvents]);
  const summary = loading && !offers.length ? event.rideshareSummary : summarizeParentScheduleRideOffers(offers);

  const syncSummary = useCallback((nextOffers: ScheduleRideOffer[]) => {
    const currentEvent = eventRef.current;
    const rideshareSummary = summarizeParentScheduleRideOffers(nextOffers);
    updateEventsRef.current((current) => current.map((entry) => (
      entry.teamId === currentEvent.teamId && entry.id === currentEvent.id
        ? { ...entry, rideshareSummary }
        : entry
    )));
  }, []);

  const refreshOffers = useCallback(async (showLoading = true) => {
    const currentEvent = eventRef.current;
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const loaded = await loadParentScheduleRideOffers(currentEvent);
      setOffers(loaded);
      syncSummary(loaded);
    } catch (loadError: any) {
      setError(loadError?.message || 'Unable to load rideshare offers.');
      setOffers([]);
      syncSummary([]);
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [syncSummary]);

  useEffect(() => {
    setSelectedChildByOffer({});
    setMessage(null);
    refreshOffers();
  }, [event.teamId, event.id, refreshOffers]);

  const runRideAction = useCallback(async (actionKey: string, action: () => Promise<void>, successMessage: string) => {
    setSubmitting(actionKey);
    setMessage(null);
    setError(null);
    try {
      await action();
      await refreshOffers(false);
      setMessage(successMessage);
    } catch (actionError: any) {
      setError(actionError?.message || 'Unable to update rideshare.');
    } finally {
      setSubmitting(null);
    }
  }, [refreshOffers]);

  const submit = async () => {
    if (!auth.user) return;
    const input: RideOfferInput = {
      seatCapacity: Number.parseInt(seatCapacity, 10) || 0,
      direction,
      note
    };

    await runRideAction('create-offer', async () => {
      await createParentScheduleRideOffer(event, auth.user!, input);
      setFormOpen(false);
      setSeatCapacity('3');
      setDirection('to');
      setNote('');
    }, 'Ride offer saved.');
  };

  const selectChildForOffer = (offerId: string, childId: string) => {
    setSelectedChildByOffer((current) => ({
      ...current,
      [offerId]: childId
    }));
  };

  const requestSpot = (offer: ScheduleRideOffer, child: RideRequestChildInput) => runRideAction(
    `request-${offer.id}`,
    () => requestParentScheduleRideSpot(event, offer, auth.user!, child),
    `Ride requested for ${child.childName}.`
  );

  const cancelRequest = (offer: ScheduleRideOffer, requestId: string) => runRideAction(
    `cancel-${offer.id}-${requestId}`,
    () => cancelParentScheduleRideRequest(event, offer, requestId),
    'Ride request cancelled.'
  );

  const updateRequestStatus = (offer: ScheduleRideOffer, requestId: string, status: RideRequestStatus) => runRideAction(
    `decision-${offer.id}-${requestId}-${status}`,
    () => updateParentScheduleRideRequestStatus(event, offer, requestId, status),
    `Ride request ${status}.`
  );

  const toggleOfferStatus = (offer: ScheduleRideOffer) => {
    const nextStatus = offer.status === 'open' ? 'closed' : 'open';
    return runRideAction(
      `offer-status-${offer.id}`,
      () => setParentScheduleRideOfferStatus(event, offer, nextStatus),
      nextStatus === 'open' ? 'Ride offer reopened.' : 'Ride offer closed.'
    );
  };

  const canManageOffer = (offer: ScheduleRideOffer) => {
    if (!auth.user?.uid) return false;
    return offer.driverUserId === auth.user.uid || event.isTeamAdmin === true || auth.isAdmin || auth.isPlatformAdmin;
  };

  const resolveSelectedChildId = (offer: ScheduleRideOffer) => resolveRideChildIdForOffer(
    offer,
    event,
    childChoices,
    selectedChildByOffer[offer.id],
    auth.user?.uid || ''
  );

  return {
    offers,
    loading,
    formOpen,
    setFormOpen,
    seatCapacity,
    setSeatCapacity,
    direction,
    setDirection,
    note,
    setNote,
    childChoices,
    summary,
    submitting,
    message,
    error,
    submit,
    selectChildForOffer,
    requestSpot,
    cancelRequest,
    updateRequestStatus,
    toggleOfferStatus,
    canManageOffer,
    resolveSelectedChildId
  };
}
