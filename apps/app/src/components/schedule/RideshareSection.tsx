import { type FormEvent } from 'react';
import { AlertCircle, Car, CheckCircle2, RefreshCw } from 'lucide-react';
import { useScheduleRideOffers } from '../../hooks/schedule/useScheduleRideOffers';
import { useScheduleEventDetailContext } from '../../pages/schedule/ScheduleEventDetailContext';
import { type RideOfferDirection } from '../../lib/scheduleLogic';
import { RideOfferCard } from './RideOfferCard';

const rideDirectionOptions: Array<{ value: RideOfferDirection; label: string }> = [
  { value: 'to', label: 'To event' },
  { value: 'from', label: 'From event' },
  { value: 'round-trip', label: 'Round trip' }
];

export function RideshareSection() {
  const { auth, event } = useScheduleEventDetailContext();
  const rideOffers = useScheduleRideOffers();

  const submitRideOffer = async (formEvent: FormEvent) => {
    formEvent.preventDefault();
    await rideOffers.submit();
  };

  return (
    <section className="app-card overflow-hidden p-0">
      <div className="border-b border-gray-100 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-black text-primary-800">
              <Car className="h-5 w-5 text-primary-600" aria-hidden="true" />
              Rideshare
            </div>
            <h2 className="mt-1 app-section-title">Rideshare</h2>
            <div className="mt-0.5 text-xs font-semibold text-gray-500">Coordinate seats for this event.</div>
          </div>
          <button
            type="button"
            className="secondary-button !min-h-9 flex-none !px-3 !py-2 text-xs"
            onClick={() => rideOffers.setFormOpen(!rideOffers.formOpen)}
            disabled={!event.isDbGame || event.isCancelled || rideOffers.submitting === 'create-offer'}
          >
            Offer Ride
          </button>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <DetailRow label="Seats open" value={rideOffers.summary ? String(rideOffers.summary.seatsLeft) : '0'} />
          <DetailRow label="Requests" value={rideOffers.summary ? String(rideOffers.summary.requests) : '0'} />
          <DetailRow label="Offers" value={rideOffers.summary ? String(rideOffers.summary.offerCount) : '0'} />
        </div>
      </div>

      {rideOffers.formOpen ? (
        <form className="border-b border-primary-100 bg-primary-50 p-3 sm:p-4" onSubmit={submitRideOffer}>
          <div className="grid grid-cols-[0.75fr_1.25fr] gap-2 sm:grid-cols-[0.6fr_1fr_2fr_auto]">
            <label className="min-w-0">
              <span className="app-label">Seats</span>
              <input
                className="auth-input mt-1 min-h-10 !px-3 !py-2 text-sm"
                type="number"
                min="1"
                max="12"
                value={rideOffers.seatCapacity}
                onChange={(inputEvent) => rideOffers.setSeatCapacity(inputEvent.target.value)}
              />
            </label>
            <label className="min-w-0">
              <span className="app-label">Direction</span>
              <select
                className="auth-input mt-1 min-h-10 !px-3 !py-2 text-sm"
                value={rideOffers.direction}
                onChange={(inputEvent) => rideOffers.setDirection(inputEvent.target.value as RideOfferDirection)}
              >
                {rideDirectionOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label className="col-span-2 min-w-0 sm:col-span-1">
              <span className="app-label">Note</span>
              <input
                className="auth-input mt-1 min-h-10 !px-3 !py-2 text-sm"
                value={rideOffers.note}
                maxLength={160}
                onChange={(inputEvent) => rideOffers.setNote(inputEvent.target.value)}
                placeholder="Optional"
              />
            </label>
            <button type="submit" className="primary-button col-span-2 !min-h-10 !py-2 text-sm sm:col-span-1 sm:self-end" disabled={rideOffers.submitting === 'create-offer'}>
              {rideOffers.submitting === 'create-offer' ? 'Saving' : 'Save'}
            </button>
          </div>
        </form>
      ) : null}

      <div className="p-3 sm:p-4">
        {rideOffers.message ? <Status tone="success" message={rideOffers.message} /> : null}
        {rideOffers.error ? <div className="mt-2"><Status tone="error" message={rideOffers.error} /></div> : null}
        {!event.isDbGame || event.isCancelled ? (
          <div className="mt-2 rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm font-semibold text-gray-500">Rideshare is available for active tracked schedule events.</div>
        ) : rideOffers.loading ? (
          <div className="mt-2 flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm font-bold text-gray-600">
            <RefreshCw className="h-4 w-4 animate-spin text-primary-600" aria-hidden="true" />
            Loading rideshare offers
          </div>
        ) : rideOffers.error && !rideOffers.offers.length ? (
          <div className="mt-2 rounded-xl border border-rose-200 bg-rose-50 p-3">
            <div className="text-sm font-semibold text-rose-700">Rideshare could not be loaded for this event.</div>
            <button
              type="button"
              className="secondary-button mt-3 min-h-9 w-fit px-3 text-xs"
              onClick={() => void rideOffers.retry()}
            >
              Retry rideshare
            </button>
          </div>
        ) : rideOffers.offers.length ? (
          <div className="mt-2 space-y-3">
            {rideOffers.offers.map((offer) => (
              <RideOfferCard
                key={offer.id}
                offer={offer}
                event={event}
                userId={auth.user?.uid || ''}
                canManage={rideOffers.canManageOffer(offer)}
                childChoices={rideOffers.childChoices}
                selectedChildId={rideOffers.resolveSelectedChildId(offer)}
                busyAction={rideOffers.submitting}
                onChildChange={(childId) => rideOffers.selectChildForOffer(offer.id, childId)}
                onRequest={(child) => rideOffers.requestSpot(offer, child)}
                onCancel={(requestId) => rideOffers.cancelRequest(offer, requestId)}
                onDecision={(requestId, status) => rideOffers.updateRequestStatus(offer, requestId, status)}
                onToggleStatus={() => rideOffers.toggleOfferStatus(offer)}
              />
            ))}
          </div>
        ) : (
          <div className="mt-2 rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm font-semibold text-gray-500">No ride offers yet for this event.</div>
        )}
      </div>
    </section>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
      <div className="text-[11px] font-extrabold uppercase tracking-[0.04em] text-gray-500">{label}</div>
      <div className="mt-1 text-sm font-black text-gray-950">{value}</div>
    </div>
  );
}

function Status({ tone, message }: { tone: 'success' | 'error'; message: string }) {
  const isError = tone === 'error';
  return (
    <div className={`flex items-start gap-2 rounded-xl border p-3 text-sm font-semibold ${isError ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
      {isError ? <AlertCircle className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />}
      {message}
    </div>
  );
}
