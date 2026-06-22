import type { RideRequestChildInput } from '../../lib/scheduleService';
import {
  canRequestScheduleRide,
  findScheduleRideRequestForChild,
  formatRideDirection,
  getScheduleRideRequestCounts,
  getScheduleRideSeatInfo,
  type ParentScheduleEvent,
  type RideRequestStatus,
  type ScheduleRideOffer
} from '../../lib/scheduleLogic';

type RideChildChoice = {
  childId: string;
  childName: string;
};

export function RideOfferCard({
  offer,
  event,
  userId,
  canManage,
  childChoices,
  selectedChildId,
  busyAction,
  onChildChange,
  onRequest,
  onCancel,
  onDecision,
  onToggleStatus
}: {
  offer: ScheduleRideOffer;
  event: ParentScheduleEvent;
  userId: string;
  canManage: boolean;
  childChoices: RideChildChoice[];
  selectedChildId: string;
  busyAction: string | null;
  onChildChange: (childId: string) => void;
  onRequest: (child: RideRequestChildInput) => Promise<void>;
  onCancel: (requestId: string) => Promise<void>;
  onDecision: (requestId: string, status: RideRequestStatus) => Promise<void>;
  onToggleStatus: () => Promise<void>;
}) {
  const seatInfo = getScheduleRideSeatInfo(offer);
  const requestCounts = getScheduleRideRequestCounts(offer);
  const selectedChild = childChoices.find((child) => child.childId === selectedChildId) || null;
  const myRequest = selectedChild ? findScheduleRideRequestForChild(offer, userId, selectedChild.childId) : null;
  const canRequest = selectedChild ? canRequestScheduleRide(offer, userId, selectedChild.childId) : false;
  const isDriver = offer.driverUserId === userId;
  const requestBusy = busyAction === `request-${offer.id}`;
  const cancelBusy = myRequest ? busyAction === `cancel-${offer.id}-${myRequest.id}` : false;
  const toggleBusy = busyAction === `offer-status-${offer.id}`;

  return (
    <article className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-black text-gray-950">{offer.driverName || 'Driver'}</div>
          <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-1 text-xs font-semibold text-gray-500">
            <span>{formatRideDirection(offer.direction)}</span>
            <span>{seatInfo.seatCountConfirmed}/{seatInfo.seatCapacity} confirmed</span>
            <span>{seatInfo.seatsLeft} left</span>
            {offer.status !== 'open' ? <span className="font-black text-orange-700">Closed</span> : null}
          </div>
          {offer.note ? <div className="mt-1 text-xs font-semibold italic text-gray-500">{offer.note}</div> : null}
        </div>
        {canManage ? (
          <button
            type="button"
            className={`min-h-8 flex-none rounded-full border px-3 text-xs font-black ${
              offer.status === 'open'
                ? 'border-orange-200 bg-orange-50 text-orange-700'
                : 'border-emerald-200 bg-emerald-50 text-emerald-700'
            }`}
            onClick={onToggleStatus}
            disabled={Boolean(busyAction)}
          >
            {toggleBusy ? 'Saving' : offer.status === 'open' ? 'Close' : 'Reopen'}
          </button>
        ) : null}
      </div>

      <div className="mt-3 rounded-xl border border-gray-100 bg-gray-50 p-2.5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="text-[11px] font-extrabold uppercase tracking-[0.04em] text-gray-500">Ride request</div>
            {childChoices.length > 1 ? (
              <select
                className="auth-input mt-1 min-h-9 !px-3 !py-1.5 text-sm"
                value={selectedChildId}
                onChange={(selectEvent) => onChildChange(selectEvent.target.value)}
              >
                {childChoices.map((child) => <option key={child.childId} value={child.childId}>{child.childName}</option>)}
              </select>
            ) : (
              <div className="mt-1 text-sm font-black text-gray-950">{selectedChild?.childName || event.childName}</div>
            )}
          </div>
          <div className="flex flex-wrap gap-2 sm:justify-end">
            {isDriver ? (
              <span className="inline-flex min-h-8 items-center rounded-full border border-primary-100 bg-primary-50 px-3 text-xs font-black text-primary-700">Your offer</span>
            ) : null}
            {canRequest && selectedChild ? (
              <button
                type="button"
                className="min-h-8 rounded-full border border-emerald-200 bg-emerald-50 px-3 text-xs font-black text-emerald-700"
                onClick={() => onRequest(selectedChild)}
                disabled={Boolean(busyAction)}
              >
                {requestBusy ? 'Requesting' : 'Request spot'}
              </button>
            ) : null}
            {myRequest ? (
              <button
                type="button"
                className="min-h-8 rounded-full border border-gray-200 bg-white px-3 text-xs font-black text-gray-700"
                onClick={() => onCancel(myRequest.id)}
                disabled={Boolean(busyAction)}
              >
                {cancelBusy ? 'Cancelling' : 'Cancel'}
              </button>
            ) : null}
          </div>
        </div>
        {myRequest ? (
          <div className={`mt-2 text-xs font-black ${getRideRequestStatusClass(myRequest.status)}`}>
            Your request for {myRequest.childName || selectedChild?.childName || 'Player'}: {formatRideRequestStatus(myRequest.status)}
          </div>
        ) : !isDriver && !canRequest ? (
          <div className="mt-2 text-xs font-semibold text-gray-500">{getRideUnavailableText(offer, selectedChildId, userId)}</div>
        ) : null}
      </div>

      {canManage && offer.requests.length ? (
        <div className="mt-3 border-t border-gray-100 pt-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-[11px] font-extrabold uppercase tracking-[0.04em] text-gray-500">Requests</div>
            <div className="text-[11px] font-bold text-gray-500">
              {requestCounts.pending} pending · {requestCounts.confirmed} confirmed
            </div>
          </div>
          <div className="space-y-2">
            {offer.requests.map((request) => (
              <div key={request.id} className="rounded-lg border border-gray-100 bg-gray-50 p-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-black text-gray-900">{request.childName || 'Player'}</div>
                    <div className={`mt-0.5 text-xs font-black ${getRideRequestStatusClass(request.status)}`}>{formatRideRequestStatus(request.status)}</div>
                  </div>
                  <div className="flex flex-wrap justify-end gap-1">
                    {(['confirmed', 'waitlisted', 'declined'] as const).map((status) => (
                      <button
                        key={status}
                        type="button"
                        className={`min-h-7 rounded-full border px-2 text-[11px] font-black ${getRideDecisionButtonClass(status, request.status)}`}
                        onClick={() => onDecision(request.id, status)}
                        disabled={Boolean(busyAction)}
                      >
                        {busyAction === `decision-${offer.id}-${request.id}-${status}` ? 'Saving' : getRideDecisionLabel(status)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </article>
  );
}

function formatRideRequestStatus(status: unknown) {
  const normalized = String(status || 'pending').toLowerCase();
  if (normalized === 'confirmed') return 'confirmed';
  if (normalized === 'waitlisted') return 'waitlisted';
  if (normalized === 'declined') return 'declined';
  return 'pending';
}

function getRideRequestStatusClass(status: unknown) {
  const normalized = formatRideRequestStatus(status);
  if (normalized === 'confirmed') return 'text-emerald-700';
  if (normalized === 'waitlisted') return 'text-amber-700';
  if (normalized === 'declined') return 'text-rose-700';
  return 'text-gray-600';
}

function getRideDecisionLabel(status: RideRequestStatus) {
  if (status === 'confirmed') return 'Confirm';
  if (status === 'waitlisted') return 'Waitlist';
  return 'Decline';
}

function getRideDecisionButtonClass(status: RideRequestStatus, currentStatus: unknown) {
  const active = formatRideRequestStatus(currentStatus) === status;
  if (status === 'confirmed') return active ? 'border-emerald-300 bg-emerald-100 text-emerald-800' : 'border-emerald-200 bg-white text-emerald-700';
  if (status === 'waitlisted') return active ? 'border-amber-300 bg-amber-100 text-amber-800' : 'border-amber-200 bg-white text-amber-700';
  return active ? 'border-rose-300 bg-rose-100 text-rose-800' : 'border-rose-200 bg-white text-rose-700';
}

function getRideUnavailableText(offer: ScheduleRideOffer, selectedChildId: string, userId: string) {
  if (!selectedChildId) return 'Select a child first.';
  if (offer.status !== 'open') return 'This ride offer is closed.';
  if (getScheduleRideSeatInfo(offer).seatsLeft <= 0) return 'This ride is full.';
  const existing = findScheduleRideRequestForChild(offer, userId, selectedChildId);
  if (existing) return `Request is ${formatRideRequestStatus(existing.status)}.`;
  return 'Request unavailable.';
}
