import { AlertCircle, CalendarDays, CheckCircle2, Loader2, MapPin, Shield, UserRound } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { getEventDetailPath } from '../lib/homeLogic';
import { claimOfficialAssignmentItem, loadOfficialAssignments, respondToOfficialAssignmentItem, type OfficialAssignmentItem } from '../lib/scheduleService';
import { formatEventDateLabel, formatEventTimeLabel } from '../lib/scheduleLogic';
import type { AuthState } from '../lib/types';

export function Officials({ auth }: { auth: AuthState }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedTeamId = String(searchParams.get('teamId') || '').trim();
  const [items, setItems] = useState<OfficialAssignmentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState('');
  const [status, setStatus] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const [hasAccess, setHasAccess] = useState(true);

  const refresh = async () => {
    if (!auth.user) return;
    setLoading(true);
    setStatus(null);
    try {
      const result = await loadOfficialAssignments(auth.user, requestedTeamId ? { teamId: requestedTeamId } : {});
      if (!result.hasAccess) {
        setHasAccess(false);
        navigate('/home', { replace: true });
        return;
      }
      setHasAccess(true);
      setItems(result.assignments);
    } catch (error: any) {
      setStatus({ tone: 'error', message: error?.message || 'Unable to load officials assignments.' });
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.user?.uid, requestedTeamId]);

  const assigned = useMemo(() => items.filter((item) => item.kind === 'assigned'), [items]);
  const open = useMemo(() => items.filter((item) => item.kind === 'open'), [items]);

  const runAction = async (item: OfficialAssignmentItem, action: () => Promise<void>, successMessage: string) => {
    const key = `${item.teamId}:${item.gameId}:${item.slotId}`;
    setBusyKey(key);
    setStatus(null);
    try {
      await action();
      setStatus({ tone: 'success', message: successMessage });
      await refresh();
    } catch (error: any) {
      setStatus({ tone: 'error', message: error?.message || 'Unable to update assignment.' });
    } finally {
      setBusyKey('');
    }
  };

  if (!auth.user || !hasAccess) {
    return null;
  }

  return (
    <div className="space-y-3">
      <section className="app-card overflow-hidden p-0">
        <div className="flex items-center gap-3 border-b border-gray-100 p-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary-50 text-primary-700 ring-1 ring-primary-100">
            <Shield className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="app-label">Officials</div>
            <h1 className="mt-1 text-xl font-black text-gray-950">Assignments</h1>
            <p className="mt-1 text-sm font-semibold text-gray-600">Review upcoming games, respond to assignments, and claim open slots.</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-4">
          <SummaryCard label="Assigned" value={String(assigned.length)} />
          <SummaryCard label="Open" value={String(open.length)} />
          <SummaryCard label="Teams" value={String(new Set(items.map((item) => item.teamId)).size)} />
          <SummaryCard label="Pending" value={String(assigned.filter((item) => item.status === 'pending' || item.status === 'needs_review').length)} />
        </div>
      </section>

      {status ? <StatusBanner tone={status.tone} message={status.message} /> : null}

      <section className="app-card p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="app-label">My assignments</div>
            <h2 className="mt-1 app-section-title">Upcoming</h2>
          </div>
          {loading ? <Loader2 className="h-4 w-4 animate-spin text-primary-600" aria-hidden="true" /> : null}
        </div>
        <div className="mt-3 space-y-3">
          {!loading && !assigned.length ? (
            <EmptyState title="No upcoming assignments" detail="New officiating assignments will show up here as soon as they are posted to one of your linked teams." />
          ) : assigned.map((item) => {
            const key = `${item.teamId}:${item.gameId}:${item.slotId}`;
            return (
              <AssignmentCard
                key={key}
                item={item}
                busy={busyKey === key}
                onAccept={() => runAction(item, () => respondToOfficialAssignmentItem(item, 'accepted'), `${item.position} accepted.`)}
                onDecline={() => runAction(item, () => respondToOfficialAssignmentItem(item, 'declined'), `${item.position} declined.`)}
              />
            );
          })}
        </div>
      </section>

      <section className="app-card p-4">
        <div>
          <div className="app-label">Open slots</div>
          <h2 className="mt-1 app-section-title">Claimable games</h2>
        </div>
        <div className="mt-3 space-y-3">
          {!loading && !open.length ? (
            <EmptyState title="No open slots" detail="Open self-assignment slots only appear when a linked team has an eligible game and self-assignment enabled." />
          ) : open.map((item) => {
            const key = `${item.teamId}:${item.gameId}:${item.slotId}`;
            return (
              <AssignmentCard
                key={key}
                item={item}
                busy={busyKey === key}
                onClaim={() => runAction(item, () => claimOfficialAssignmentItem(item, auth.user!), `${item.position} claimed.`)}
              />
            );
          })}
        </div>
      </section>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-gray-50 px-3 py-2">
      <div className="text-[11px] font-black uppercase tracking-[0.04em] text-gray-500">{label}</div>
      <div className="mt-1 text-lg font-black text-gray-950">{value}</div>
    </div>
  );
}

function AssignmentCard({
  item,
  busy,
  onAccept,
  onDecline,
  onClaim
}: {
  item: OfficialAssignmentItem;
  busy: boolean;
  onAccept?: () => void;
  onDecline?: () => void;
  onClaim?: () => void;
}) {
  const detailPath = getEventDetailPath({ teamId: item.teamId, id: item.gameId, childId: '' }, 'game');
  const showResponseActions = item.kind === 'assigned' && (item.status === 'pending' || item.status === 'needs_review');

  return (
    <article className={`rounded-2xl border p-4 ${item.kind === 'open' ? 'border-primary-200 bg-primary-50/60' : 'border-gray-200 bg-white'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-gray-950 px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.04em] text-white">{item.teamName}</span>
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.04em] ${item.kind === 'open' ? 'bg-primary-100 text-primary-800' : 'bg-gray-100 text-gray-700'}`}>
              {item.kind === 'open' ? 'Open slot' : item.status.replace(/_/g, ' ')}
            </span>
            {item.scheduleReviewRequired ? <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.04em] text-amber-800">Needs review</span> : null}
          </div>
          <div>
            <div className="text-base font-black text-gray-950">{item.position} · vs. {item.opponent}</div>
            <div className="mt-1 flex flex-wrap gap-3 text-xs font-semibold text-gray-600">
              <span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />{formatEventDateLabel(item.date)} · {formatEventTimeLabel(item.date)}</span>
              <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" aria-hidden="true" />{item.location}</span>
            </div>
          </div>
        </div>
        <Link to={detailPath} className="text-xs font-black text-primary-700">Game</Link>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {showResponseActions ? (
          <>
            <button type="button" className="rounded-full bg-emerald-600 px-3 py-2 text-xs font-black text-white" onClick={onAccept} disabled={busy}>
              {busy ? 'Saving' : 'Accept'}
            </button>
            <button type="button" className="rounded-full border border-rose-200 bg-white px-3 py-2 text-xs font-black text-rose-700" onClick={onDecline} disabled={busy}>
              {busy ? 'Saving' : 'Decline'}
            </button>
          </>
        ) : null}
        {item.kind === 'open' && onClaim ? (
          <button type="button" className="rounded-full bg-primary-600 px-3 py-2 text-xs font-black text-white" onClick={onClaim} disabled={busy}>
            {busy ? 'Claiming' : 'Claim slot'}
          </button>
        ) : null}
        {!showResponseActions && item.kind === 'assigned' ? <div className="text-xs font-semibold text-gray-500">Status saved on the team schedule.</div> : null}
      </div>
    </article>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-4 text-center">
      <UserRound className="mx-auto h-5 w-5 text-gray-400" aria-hidden="true" />
      <div className="mt-2 text-sm font-black text-gray-900">{title}</div>
      <div className="mt-1 text-xs font-semibold text-gray-500">{detail}</div>
    </div>
  );
}

function StatusBanner({ tone, message }: { tone: 'success' | 'error'; message: string }) {
  return (
    <div className={`flex items-start gap-2 rounded-2xl border px-4 py-3 text-sm font-semibold ${tone === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}>
      {tone === 'success' ? <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" /> : <AlertCircle className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />}
      <span>{message}</span>
    </div>
  );
}
