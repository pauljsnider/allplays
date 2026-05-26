import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import {
  AlertCircle,
  Award,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  Copy,
  DollarSign,
  Download,
  ExternalLink,
  Loader2,
  RefreshCw,
  Share2,
  Shield,
  Ticket,
  Users
} from 'lucide-react';
import { openPublicUrl, sharePublicUrl } from '../lib/publicActions';
import {
  buildParentScheduleIcs,
  createParentFamilyShare,
  downloadIcs,
  getAppleCalendarFeedUrl,
  getGoogleCalendarFeedUrl,
  getPrivateTeamCalendarFeedUrl,
  initiateParentTeamFeeCheckout,
  loadFamilyShareModel,
  loadParentAccessModel,
  loadParentAccessPlayers,
  loadParentCalendarTools,
  loadParentCertificates,
  loadParentFeesForApp,
  loadParentRegistrations,
  revokeParentFamilyShare,
  submitParentAccessRequest,
  updateParentFamilyShareCalendars,
  type FamilyShareTokenCard,
  type ParentAccessPlayer,
  type ParentAccessRequest,
  type ParentAccessTeam,
  type ParentCalendarTeam,
  type ParentCertificateCard,
  type ParentFeeAppRecord,
  type ParentRegistrationCard
} from '../lib/parentToolsService';
import { getCalendarEventShareText } from '../lib/parentToolsService';
import type { ParentScheduleEvent } from '../lib/scheduleLogic';
import type { AuthState } from '../lib/types';

type ParentToolId = 'access' | 'fees' | 'calendar' | 'share' | 'registrations' | 'certificates';

const tools: Array<{ id: ParentToolId; label: string; icon: LucideIcon }> = [
  { id: 'access', label: 'Access', icon: Shield },
  { id: 'fees', label: 'Fees', icon: DollarSign },
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'share', label: 'Share', icon: Share2 },
  { id: 'registrations', label: 'Register', icon: Ticket },
  { id: 'certificates', label: 'Awards', icon: Award }
];

const validToolIds = new Set(tools.map((tool) => tool.id));

export function ParentTools({ auth }: { auth: AuthState }) {
  const { toolId = 'access' } = useParams();
  const navigate = useNavigate();
  const activeTool = validToolIds.has(toolId as ParentToolId) ? toolId as ParentToolId : null;

  if (!activeTool) return <Navigate to="/parent-tools/access" replace />;

  const setTool = (nextTool: ParentToolId) => {
    navigate(`/parent-tools/${nextTool}`);
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  };

  return (
    <div className="parent-tools-page space-y-3">
      <section className="app-card overflow-hidden">
        <div className="flex items-center gap-3 px-3 py-3 sm:px-4">
          <Link to="/home" className="ghost-button !h-9 !min-h-9 !w-9 !flex-none !p-0" aria-label="Back to Home" title="Back to Home">
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </Link>
          <div className="min-w-0 flex-1">
            <div className="app-label">Parent tools</div>
            <h1 className="truncate text-xl font-black leading-tight text-gray-950">Family workflows</h1>
            <p className="mt-0.5 truncate text-xs font-semibold text-gray-600">Access, payments, calendars, sharing, registration, and awards.</p>
          </div>
        </div>
      </section>

      <div className="parent-tools-nav sticky top-24 z-30 -mx-1 overflow-x-auto bg-gray-50/95 py-2 backdrop-blur">
        <div className="grid min-w-max grid-cols-6 gap-1 rounded-2xl border border-gray-200 bg-white p-1 shadow-sm">
          {tools.map((tool) => {
            const Icon = tool.icon;
            const active = tool.id === activeTool;
            return (
              <button
                key={tool.id}
                type="button"
                className={`flex min-h-10 items-center justify-center gap-1.5 rounded-xl px-3 text-xs font-black transition sm:text-sm ${active ? 'bg-primary-600 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-950'}`}
                onClick={() => setTool(tool.id)}
                aria-pressed={active}
              >
                <Icon className="h-4 w-4 flex-none" aria-hidden="true" />
                <span>{tool.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {activeTool === 'access' ? <AccessTool auth={auth} /> : null}
      {activeTool === 'fees' ? <FeesTool auth={auth} /> : null}
      {activeTool === 'calendar' ? <CalendarTool auth={auth} /> : null}
      {activeTool === 'share' ? <FamilyShareTool auth={auth} /> : null}
      {activeTool === 'registrations' ? <RegistrationsTool auth={auth} /> : null}
      {activeTool === 'certificates' ? <CertificatesTool auth={auth} /> : null}
    </div>
  );
}

function AccessTool({ auth }: { auth: AuthState }) {
  const [teams, setTeams] = useState<ParentAccessTeam[]>([]);
  const [requests, setRequests] = useState<ParentAccessRequest[]>([]);
  const [players, setPlayers] = useState<ParentAccessPlayer[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState('');
  const [selectedPlayerId, setSelectedPlayerId] = useState('');
  const [relation, setRelation] = useState('Parent');
  const [loading, setLoading] = useState(true);
  const [loadingPlayers, setLoadingPlayers] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const refresh = async () => {
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const model = await loadParentAccessModel(auth.user);
      setTeams(model.teams);
      setRequests(model.requests);
      setSelectedTeamId((current) => current || model.teams[0]?.id || '');
    } catch (loadError: any) {
      setError(loadError?.message || 'Unable to load team access.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.user?.uid]);

  useEffect(() => {
    let cancelled = false;
    async function loadPlayers() {
      setPlayers([]);
      setSelectedPlayerId('');
      if (!selectedTeamId) return;
      setLoadingPlayers(true);
      try {
        const rows = await loadParentAccessPlayers(selectedTeamId);
        if (!cancelled) {
          setPlayers(rows);
          setSelectedPlayerId(rows[0]?.id || '');
        }
      } catch (loadError: any) {
        if (!cancelled) setError(loadError?.message || 'Unable to load players for this team.');
      } finally {
        if (!cancelled) setLoadingPlayers(false);
      }
    }
    void loadPlayers();
    return () => {
      cancelled = true;
    };
  }, [selectedTeamId]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedTeamId || !selectedPlayerId) {
      setError('Choose a team and player first.');
      return;
    }
    setSaving(true);
    setError('');
    setMessage('');
    try {
      await submitParentAccessRequest(selectedTeamId, selectedPlayerId, relation);
      setMessage('Access request sent.');
      const model = await loadParentAccessModel(auth.user);
      setRequests(model.requests);
    } catch (submitError: any) {
      setError(submitError?.message || 'Unable to send access request.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <section className="app-card p-4">
        <ToolHeader icon={Shield} title="Request player access" detail="Use this when you do not have an invite code." action={<button type="button" className="ghost-button !min-h-9 text-xs" onClick={refresh} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />Refresh</button>} />
        {error ? <Status tone="error" message={error} /> : null}
        {message ? <Status tone="success" message={message} /> : null}
        {loading ? <LoadingBlock label="Loading teams" /> : (
          <form className="mt-3 grid gap-3 lg:grid-cols-[1fr_1fr_auto]" onSubmit={submit}>
            <label className="min-w-0">
              <span className="app-label">Team</span>
              <select className="auth-input mt-1" value={selectedTeamId} onChange={(event) => setSelectedTeamId(event.target.value)}>
                {teams.length ? teams.map((team) => (
                  <option key={team.id} value={team.id}>{team.name}{team.sport ? ` - ${team.sport}` : ''}</option>
                )) : <option value="">No public teams</option>}
              </select>
            </label>
            <label className="min-w-0">
              <span className="app-label">Player</span>
              <select className="auth-input mt-1" value={selectedPlayerId} onChange={(event) => setSelectedPlayerId(event.target.value)} disabled={!selectedTeamId || loadingPlayers}>
                {loadingPlayers ? <option value="">Loading players...</option> : players.length ? players.map((player) => (
                  <option key={player.id} value={player.id}>{player.number ? `#${player.number} ` : ''}{player.name}</option>
                )) : <option value="">No players found</option>}
              </select>
            </label>
            <label className="min-w-0">
              <span className="app-label">Relationship</span>
              <select className="auth-input mt-1" value={relation} onChange={(event) => setRelation(event.target.value)}>
                <option value="Parent">Parent</option>
                <option value="Guardian">Guardian</option>
                <option value="Grandparent">Grandparent</option>
                <option value="Family">Family</option>
              </select>
            </label>
            <button type="submit" className="primary-button lg:col-span-3" disabled={saving || loadingPlayers || !selectedTeamId || !selectedPlayerId}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Shield className="h-4 w-4" aria-hidden="true" />}
              Send request
            </button>
          </form>
        )}
      </section>

      <section className="app-card p-4">
        <ToolHeader icon={Users} title="Access requests" detail="Pending and decided requests from your account." action={<Link to="/accept-invite" className="secondary-button !min-h-9 text-xs">Accept invite</Link>} />
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {requests.length ? requests.map((request) => <AccessRequestCard key={request.id || `${request.teamId}-${request.playerId}`} request={request} />) : (
            <EmptyState icon={Shield} title="No requests yet" detail="Invite codes can still be redeemed from Accept invite." />
          )}
        </div>
      </section>
    </div>
  );
}

function FeesTool({ auth }: { auth: AuthState }) {
  const [fees, setFees] = useState<ParentFeeAppRecord[]>([]);
  const [filter, setFilter] = useState<'open' | 'all' | 'paid'>('open');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [payingFeeId, setPayingFeeId] = useState('');
  const [feeErrors, setFeeErrors] = useState<Record<string, string>>({});

  const refresh = async () => {
    setLoading(true);
    setError('');
    try {
      setFees(await loadParentFeesForApp(auth.user));
    } catch (loadError: any) {
      setError(loadError?.message || 'Unable to load fees.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.user?.uid]);

  const visibleFees = useMemo(() => fees.filter((fee) => {
    if (filter === 'all') return true;
    if (filter === 'paid') return fee.status === 'paid';
    return !['paid', 'canceled', 'cancelled'].includes(String(fee.status || '').toLowerCase());
  }), [fees, filter]);

  const openCount = fees.filter((fee) => !['paid', 'canceled', 'cancelled'].includes(String(fee.status || '').toLowerCase())).length;
  const balanceCents = visibleFees.reduce((sum, fee) => sum + Number(fee.balanceDueCents ?? fee.amountDueCents ?? 0), 0);
  const payFee = async (fee: ParentFeeAppRecord) => {
    const feeKey = getFeeCardKey(fee);
    setPayingFeeId(feeKey);
    setFeeErrors((current) => ({ ...current, [feeKey]: '' }));
    try {
      if (fee.checkoutUrl) {
        await openPublicUrl(String(fee.checkoutUrl));
        return;
      }
      const checkout = await initiateParentTeamFeeCheckout(String(fee.teamId || ''), String(fee.batchId || ''), String(fee.recipientId || ''));
      await openPublicUrl(checkout.checkoutUrl);
    } catch (payError: any) {
      setFeeErrors((current) => ({ ...current, [feeKey]: payError?.message || 'Unable to open checkout. Please try again.' }));
    } finally {
      setPayingFeeId('');
    }
  };

  return (
    <div className="space-y-3">
      <section className="app-card p-4">
        <ToolHeader icon={DollarSign} title="Team fees" detail="Balances, checkout links, installments, and payment history." action={<button type="button" className="ghost-button !min-h-9 text-xs" onClick={refresh} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />Refresh</button>} />
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <MetricCard label="Open" value={String(openCount)} />
          <MetricCard label="Showing" value={String(visibleFees.length)} />
          <MetricCard label="Balance" value={formatMoney(balanceCents)} urgent={balanceCents > 0} />
        </div>
        <div className="mt-3 grid grid-cols-3 gap-1 rounded-2xl border border-gray-200 bg-white p-1">
          {(['open', 'all', 'paid'] as const).map((option) => (
            <button key={option} type="button" className={`min-h-10 rounded-xl text-sm font-black capitalize ${filter === option ? 'bg-primary-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`} onClick={() => setFilter(option)} aria-pressed={filter === option}>
              {option}
            </button>
          ))}
        </div>
      </section>

      {error ? <Status tone="error" message={error} /> : null}
      {loading ? <LoadingBlock label="Loading fees" /> : (
        <div className="grid gap-3 lg:grid-cols-2">
          {visibleFees.length ? visibleFees.map((fee) => {
            const feeKey = getFeeCardKey(fee);
            return <FeeCard key={feeKey} fee={fee} onPay={payFee} paying={payingFeeId === feeKey} error={feeErrors[feeKey] || ''} />;
          }) : (
            <EmptyState icon={DollarSign} title="No fees in this view" detail="Paid and canceled items are available under All." />
          )}
        </div>
      )}
    </div>
  );
}

function getFeeCardKey(fee: ParentFeeAppRecord) {
  return `${fee.teamId || 'team'}-${fee.batchId || 'batch'}-${fee.recipientId || fee.id || fee.title || 'fee'}`;
}

function CalendarTool({ auth }: { auth: AuthState }) {
  const [events, setEvents] = useState<ParentScheduleEvent[]>([]);
  const [teams, setTeams] = useState<ParentCalendarTeam[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyTeamId, setBusyTeamId] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const refresh = async () => {
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const model = await loadParentCalendarTools(auth.user);
      setEvents(model.events);
      setTeams(model.teams);
    } catch (loadError: any) {
      setError(loadError?.message || 'Unable to load calendar tools.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.user?.uid]);

  const download = () => {
    if (!events.length) {
      setMessage('No events to export yet.');
      return;
    }
    downloadIcs('all-plays-family-schedule.ics', buildParentScheduleIcs(events));
    setMessage('Calendar download started.');
  };

  const copyAgenda = async () => {
    const text = events.slice(0, 20).map(getCalendarEventShareText).join('\n');
    if (!text) {
      setMessage('No events to copy yet.');
      return;
    }
    await copyText(text, setMessage);
  };

  const openFeed = async (team: ParentCalendarTeam, target: 'copy' | 'apple' | 'google') => {
    setBusyTeamId(team.teamId);
    setError('');
    setMessage('');
    try {
      const feedUrl = await getPrivateTeamCalendarFeedUrl(team.teamId);
      if (!feedUrl) throw new Error('Unable to create private calendar feed. Sign in again and retry.');
      if (target === 'copy') {
        await copyText(feedUrl, setMessage);
      } else {
        await openPublicUrl(target === 'apple' ? getAppleCalendarFeedUrl(feedUrl) : getGoogleCalendarFeedUrl(feedUrl));
      }
    } catch (feedError: any) {
      setError(feedError?.message || 'Unable to open calendar feed.');
    } finally {
      setBusyTeamId('');
    }
  };

  return (
    <div className="space-y-3">
      <section className="app-card p-4">
        <ToolHeader icon={CalendarDays} title="Calendar tools" detail="Download your family schedule or subscribe by team." action={<button type="button" className="ghost-button !min-h-9 text-xs" onClick={refresh} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />Refresh</button>} />
        {error ? <Status tone="error" message={error} /> : null}
        {message ? <Status tone="success" message={message} /> : null}
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <button type="button" className="secondary-button justify-center" onClick={download} disabled={loading}>
            <Download className="h-4 w-4" aria-hidden="true" />
            Download .ics
          </button>
          <button type="button" className="secondary-button justify-center" onClick={copyAgenda} disabled={loading}>
            <Copy className="h-4 w-4" aria-hidden="true" />
            Copy agenda
          </button>
          <MetricCard label="Events" value={String(events.length)} />
        </div>
      </section>

      {loading ? <LoadingBlock label="Loading calendar teams" /> : (
        <section className="grid gap-3 lg:grid-cols-2">
          {teams.length ? teams.map((team) => (
            <div key={team.teamId} className="app-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-black text-gray-950">{team.teamName}</div>
                  <div className="mt-0.5 text-xs font-semibold text-gray-500">{team.eventCount} event{team.eventCount === 1 ? '' : 's'} on this schedule</div>
                </div>
                {busyTeamId === team.teamId ? <Loader2 className="h-5 w-5 animate-spin text-primary-600" aria-hidden="true" /> : <CalendarDays className="h-5 w-5 text-primary-600" aria-hidden="true" />}
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <button type="button" className="secondary-button !min-h-9 justify-center text-xs" onClick={() => openFeed(team, 'copy')} disabled={busyTeamId === team.teamId}>Copy</button>
                <button type="button" className="secondary-button !min-h-9 justify-center text-xs" onClick={() => openFeed(team, 'apple')} disabled={busyTeamId === team.teamId}>Apple</button>
                <button type="button" className="secondary-button !min-h-9 justify-center text-xs" onClick={() => openFeed(team, 'google')} disabled={busyTeamId === team.teamId}>Google</button>
              </div>
            </div>
          )) : <EmptyState icon={CalendarDays} title="No team schedules" detail="Schedules appear after a player or team is linked." />}
        </section>
      )}
    </div>
  );
}

function FamilyShareTool({ auth }: { auth: AuthState }) {
  const [tokens, setTokens] = useState<FamilyShareTokenCard[]>([]);
  const [children, setChildren] = useState<any[]>([]);
  const [label, setLabel] = useState('');
  const [calendarText, setCalendarText] = useState('');
  const [editingTokenId, setEditingTokenId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const refresh = async () => {
    setLoading(true);
    setError('');
    try {
      const model = await loadFamilyShareModel(auth.user);
      setChildren(model.children);
      setTokens(model.tokens);
    } catch (loadError: any) {
      setError(loadError?.message || 'Unable to load family share links.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.user?.uid]);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const result = await createParentFamilyShare(auth.user, label || 'Family share', splitLines(calendarText));
      setMessage('Family link created.');
      setLabel('');
      setCalendarText('');
      await copyText(result.url, setMessage);
      await refresh();
    } catch (createError: any) {
      setError(createError?.message || 'Unable to create family share link.');
    } finally {
      setSaving(false);
    }
  };

  const revoke = async (tokenId: string) => {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      await revokeParentFamilyShare(tokenId);
      setMessage('Family link revoked.');
      await refresh();
    } catch (revokeError: any) {
      setError(revokeError?.message || 'Unable to revoke family link.');
    } finally {
      setSaving(false);
    }
  };

  const saveCalendars = async (tokenId: string, value: string) => {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      await updateParentFamilyShareCalendars(tokenId, splitLines(value));
      setEditingTokenId('');
      setMessage('Calendar links updated.');
      await refresh();
    } catch (saveError: any) {
      setError(saveError?.message || 'Unable to update calendar links.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <section className="app-card p-4">
        <ToolHeader icon={Share2} title="Family share" detail="Share a private family page with relatives and caregivers." action={<button type="button" className="ghost-button !min-h-9 text-xs" onClick={refresh} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />Refresh</button>} />
        {error ? <Status tone="error" message={error} /> : null}
        {message ? <Status tone="success" message={message} /> : null}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {children.length ? children.map((child) => (
            <span key={`${child.teamId}-${child.playerId}`} className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-black text-gray-700">{child.playerName || 'Player'}</span>
          )) : <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-black text-amber-800">No linked players</span>}
        </div>
        <form className="mt-3 grid gap-3" onSubmit={create}>
          <input className="auth-input" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Label, like Grandma or babysitter" />
          <textarea className="auth-input min-h-24 resize-none" value={calendarText} onChange={(event) => setCalendarText(event.target.value)} placeholder="Optional external calendar feed URLs, one per line" />
          <button type="submit" className="primary-button" disabled={saving || loading || !children.length}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Share2 className="h-4 w-4" aria-hidden="true" />}
            Create share link
          </button>
        </form>
      </section>

      {loading ? <LoadingBlock label="Loading share links" /> : (
        <div className="grid gap-3 lg:grid-cols-2">
          {tokens.length ? tokens.map((token) => (
            <FamilyTokenCard
              key={token.id}
              token={token}
              editing={editingTokenId === token.id}
              saving={saving}
              onEdit={() => setEditingTokenId(token.id)}
              onCancel={() => setEditingTokenId('')}
              onCopy={(text) => copyText(text, setMessage)}
              onShare={() => sharePublicUrl({ title: 'ALL PLAYS family page', text: token.label || 'Family schedule', url: token.url })}
              onRevoke={() => revoke(token.id)}
              onSaveCalendars={saveCalendars}
            />
          )) : <EmptyState icon={Share2} title="No family links" detail="Create a link when someone needs schedule access without a full account." />}
        </div>
      )}
    </div>
  );
}

function RegistrationsTool({ auth }: { auth: AuthState }) {
  const [cards, setCards] = useState<ParentRegistrationCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = async () => {
    setLoading(true);
    setError('');
    try {
      setCards(await loadParentRegistrations(auth.user));
    } catch (loadError: any) {
      setError(loadError?.message || 'Unable to load registrations.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.user?.uid]);

  return (
    <div className="space-y-3">
      <section className="app-card p-4">
        <ToolHeader icon={Ticket} title="Registrations" detail="Published team registration forms linked to your family." action={<button type="button" className="ghost-button !min-h-9 text-xs" onClick={refresh} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />Refresh</button>} />
        {error ? <Status tone="error" message={error} /> : null}
      </section>
      {loading ? <LoadingBlock label="Loading registrations" /> : (
        <div className="grid gap-3 lg:grid-cols-2">
          {cards.length ? cards.map((card) => <RegistrationCard key={`${card.teamId}-${card.id}`} card={card} />) : (
            <EmptyState icon={Ticket} title="No open registrations" detail="Published registration forms will appear here." />
          )}
        </div>
      )}
    </div>
  );
}

function CertificatesTool({ auth }: { auth: AuthState }) {
  const [cards, setCards] = useState<ParentCertificateCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = async () => {
    setLoading(true);
    setError('');
    try {
      setCards(await loadParentCertificates(auth.user));
    } catch (loadError: any) {
      setError(loadError?.message || 'Unable to load awards.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.user?.uid]);

  return (
    <div className="space-y-3">
      <section className="app-card p-4">
        <ToolHeader icon={Award} title="Awards" detail="Published certificates for linked players." action={<button type="button" className="ghost-button !min-h-9 text-xs" onClick={refresh} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />Refresh</button>} />
        {error ? <Status tone="error" message={error} /> : null}
      </section>
      {loading ? <LoadingBlock label="Loading awards" /> : (
        <div className="grid gap-3 lg:grid-cols-2">
          {cards.length ? cards.map((card) => <CertificateCard key={`${card.teamId}-${card.playerId}-${card.id}`} card={card} />) : (
            <EmptyState icon={Award} title="No published awards" detail="Awards appear after a coach publishes certificates." />
          )}
        </div>
      )}
    </div>
  );
}

function AccessRequestCard({ request }: { request: ParentAccessRequest }) {
  const status = String(request.status || 'pending').toLowerCase();
  const statusClass = status === 'approved'
    ? 'bg-emerald-50 text-emerald-700'
    : status === 'denied' || status === 'rejected'
      ? 'bg-rose-50 text-rose-700'
      : 'bg-amber-50 text-amber-700';
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-black text-gray-950">{request.playerName}</div>
          <div className="mt-0.5 truncate text-xs font-semibold text-gray-500">{request.teamName} - {request.relation}</div>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${statusClass}`}>{request.status}</span>
      </div>
      {request.decisionNote ? <div className="mt-2 text-xs font-semibold text-gray-600">{request.decisionNote}</div> : null}
    </div>
  );
}

function getFeeMessage(...values: Array<unknown>): string {
  return values.map((value) => String(value || '').trim()).find(Boolean) || '';
}

function FeeMessageBlock({ title, message }: { title: string; message: string }) {
  return (
    <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs font-semibold leading-5 text-blue-900">
      <div className="font-black uppercase tracking-[0.04em] text-blue-700">{title}</div>
      <div className="mt-1 whitespace-pre-wrap break-words">{message}</div>
    </div>
  );
}

function FeeCard({ fee, onPay, paying, error }: { fee: ParentFeeAppRecord; onPay: (fee: ParentFeeAppRecord) => void | Promise<void>; paying: boolean; error: string }) {
  const notes = getFeeMessage(fee.notes, fee.feeNotes);
  const offlinePaymentInstructions = getFeeMessage(fee.offlinePaymentInstructions, fee.paymentInstructions);

  return (
    <section className="app-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-black text-gray-950">{fee.title || fee.feeName || 'Team fee'}</div>
          <div className="mt-0.5 truncate text-xs font-semibold text-gray-500">{fee.teamName || 'Team'}{fee.playerName ? ` - ${fee.playerName}` : ''}</div>
        </div>
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-black uppercase text-gray-700">{fee.statusLabel}</span>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <MetricCard label="Amount" value={fee.amountLabel} />
        <MetricCard label="Due" value={fee.dueLabel} />
        <MetricCard label="Balance" value={formatMoney(Number(fee.balanceDueCents ?? 0))} urgent={Number(fee.balanceDueCents ?? 0) > 0} />
      </div>
      {fee.lineItems.length ? <FeeDetailList title="Line items" rows={fee.lineItems} /> : null}
      {fee.installments.length ? <FeeDetailList title="Installments" rows={fee.installments} /> : null}
      {fee.ledgerEntries.length ? <FeeDetailList title="Payments and adjustments" rows={fee.ledgerEntries} /> : null}
      {notes ? <FeeMessageBlock title="Notes" message={notes} /> : null}
      {offlinePaymentInstructions ? <FeeMessageBlock title="Offline payment" message={offlinePaymentInstructions} /> : null}
      {fee.canPay ? (
        <button type="button" className="primary-button mt-3 w-full" onClick={() => onPay(fee)} disabled={paying}>
          {paying ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ExternalLink className="h-4 w-4" aria-hidden="true" />}
          {paying ? 'Opening checkout' : 'Pay fee'}
        </button>
      ) : null}
      {error ? <div className="mt-2 rounded-xl border border-rose-100 bg-rose-50 p-3 text-xs font-semibold text-rose-700">{error}</div> : null}
    </section>
  );
}

function FeeDetailList({ title, rows }: { title: string; rows: Array<Record<string, any>> }) {
  return (
    <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-3">
      <div className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">{title}</div>
      <div className="mt-2 space-y-1.5">
        {rows.slice(0, 4).map((row, index) => (
          <div key={`${title}-${index}`} className="flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2 text-xs">
            <span className="min-w-0 truncate font-black text-gray-800">{row.title || row.label || row.description || row.status || `Item ${index + 1}`}</span>
            <span className="flex-none font-black text-gray-600">{formatDetailAmount(row)}</span>
          </div>
        ))}
        {rows.length > 4 ? <div className="text-xs font-bold text-gray-500">+{rows.length - 4} more</div> : null}
      </div>
    </div>
  );
}

function RegistrationCard({ card }: { card: ParentRegistrationCard }) {
  return (
    <section className="app-card p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-primary-50 text-primary-700">
          <Ticket className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-black text-gray-950">{card.programName}</div>
          <div className="mt-0.5 truncate text-xs font-semibold text-gray-500">{card.teamName}{card.season ? ` - ${card.season}` : ''}</div>
          {card.description ? <div className="mt-2 line-clamp-2 text-sm font-semibold leading-5 text-gray-600">{card.description}</div> : null}
        </div>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <MetricCard label="Fee" value={card.feeLabel} />
        <MetricCard label="Options" value={String(card.options.length)} />
        <MetricCard label="Checkout" value={card.onlineCheckout ? 'Online' : 'Offline'} />
      </div>
      {card.paymentNotice ? <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs font-semibold text-blue-800">{card.paymentNotice}</div> : null}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Link to={`/parent-tools/registrations/${card.teamId}/${card.id}`} className="primary-button justify-center text-xs">
          <Ticket className="h-4 w-4" aria-hidden="true" />
          Review
        </Link>
        <button type="button" className="secondary-button justify-center text-xs" onClick={() => openPublicUrl(card.url)}>
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
          Legacy form
        </button>
        <button type="button" className="secondary-button justify-center text-xs sm:col-span-2" onClick={() => sharePublicUrl({ title: card.programName, text: `${card.teamName} registration`, url: card.url })}>
          <Share2 className="h-4 w-4" aria-hidden="true" />
          Share
        </button>
      </div>
    </section>
  );
}

function CertificateCard({ card }: { card: ParentCertificateCard }) {
  return (
    <section className="app-card p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-amber-50 text-amber-700">
          <Award className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-black text-gray-950">{card.title || card.awardTitle || 'Award'}</div>
          <div className="mt-0.5 truncate text-xs font-semibold text-gray-500">{card.playerName} - {card.teamName}</div>
          {card.narrative || card.description ? <div className="mt-2 line-clamp-2 text-sm font-semibold leading-5 text-gray-600">{card.narrative || card.description}</div> : null}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" className="secondary-button justify-center text-xs" onClick={() => openPublicUrl(card.url)}>
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
          Open
        </button>
        <button type="button" className="secondary-button justify-center text-xs" onClick={() => sharePublicUrl({ title: card.title || 'ALL PLAYS award', text: `${card.playerName} award`, url: card.url })}>
          <Share2 className="h-4 w-4" aria-hidden="true" />
          Share
        </button>
      </div>
    </section>
  );
}

function FamilyTokenCard({ token, editing, saving, onEdit, onCancel, onCopy, onShare, onRevoke, onSaveCalendars }: {
  token: FamilyShareTokenCard;
  editing: boolean;
  saving: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onCopy: (value: string) => void;
  onShare: () => void;
  onRevoke: () => void;
  onSaveCalendars: (tokenId: string, value: string) => void;
}) {
  const [calendarText, setCalendarText] = useState('');

  useEffect(() => {
    if (editing) setCalendarText((token.extraCalendarUrls || []).join('\n'));
  }, [editing, token.extraCalendarUrls]);

  return (
    <section className="app-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-black text-gray-950">{token.label || 'Family share link'}</div>
          <div className="mt-0.5 text-xs font-semibold text-gray-500">{token.childCount} player{token.childCount === 1 ? '' : 's'} included</div>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${token.revokedAt || token.revoked ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>
          {token.revokedAt || token.revoked ? 'Revoked' : 'Active'}
        </span>
      </div>
      <div className="mt-3 break-all rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs font-semibold text-gray-600">{token.url}</div>
      {editing ? (
        <div className="mt-3 space-y-2">
          <textarea className="auth-input min-h-24 resize-none" value={calendarText} onChange={(event) => setCalendarText(event.target.value)} placeholder="External calendar feed URLs, one per line" />
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="secondary-button justify-center text-xs" onClick={onCancel} disabled={saving}>Cancel</button>
            <button type="button" className="primary-button justify-center text-xs" onClick={() => onSaveCalendars(token.id, calendarText)} disabled={saving}>Save calendars</button>
          </div>
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-4 gap-2">
          <button type="button" className="secondary-button !min-h-9 justify-center text-xs" onClick={() => onCopy(token.url)}><Copy className="h-4 w-4" aria-hidden="true" />Copy</button>
          <button type="button" className="secondary-button !min-h-9 justify-center text-xs" onClick={onShare}><Share2 className="h-4 w-4" aria-hidden="true" />Share</button>
          <button type="button" className="secondary-button !min-h-9 justify-center text-xs" onClick={onEdit}>Feeds</button>
          <button type="button" className="ghost-button !min-h-9 justify-center text-xs text-rose-700" onClick={onRevoke} disabled={saving || token.revokedAt || token.revoked}>Revoke</button>
        </div>
      )}
    </section>
  );
}

function ToolHeader({ icon: Icon, title, detail, action }: { icon: LucideIcon; title: string; detail: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        <div className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-primary-50 text-primary-700">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-black text-gray-950">{title}</h2>
          <p className="mt-0.5 text-xs font-semibold leading-5 text-gray-500">{detail}</p>
        </div>
      </div>
      {action ? <div className="flex-none">{action}</div> : null}
    </div>
  );
}

function MetricCard({ label, value, urgent = false }: { label: string; value: string; urgent?: boolean }) {
  return (
    <div className={`rounded-xl border p-2 ${urgent ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-gray-50'}`}>
      <div className={`text-[10px] font-black uppercase tracking-[0.04em] ${urgent ? 'text-amber-700' : 'text-gray-500'}`}>{label}</div>
      <div className="mt-1 truncate text-sm font-black text-gray-950">{value}</div>
    </div>
  );
}

function Status({ tone, message }: { tone: 'error' | 'success'; message: string }) {
  const Icon = tone === 'error' ? AlertCircle : CheckCircle2;
  return (
    <div className={`mt-3 flex items-start gap-2 rounded-xl border p-3 text-sm font-semibold ${tone === 'error' ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
      <Icon className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}

function LoadingBlock({ label }: { label: string }) {
  return (
    <section className="app-card p-6 text-center">
      <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary-600" aria-hidden="true" />
      <div className="mt-3 text-sm font-black text-gray-900">{label}</div>
    </section>
  );
}

function EmptyState({ icon: Icon, title, detail }: { icon: LucideIcon; title: string; detail: string }) {
  return (
    <div className="app-card p-5 text-center">
      <Icon className="mx-auto h-8 w-8 text-gray-400" aria-hidden="true" />
      <div className="mt-3 text-sm font-black text-gray-950">{title}</div>
      <div className="mt-1 text-xs font-semibold text-gray-500">{detail}</div>
    </div>
  );
}

async function copyText(value: string, setMessage: (message: string) => void) {
  try {
    await navigator.clipboard.writeText(value);
    setMessage('Copied.');
  } catch {
    setMessage('Copy is not available in this browser.');
  }
}

function splitLines(value: string) {
  return String(value || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function formatMoney(cents: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((Number(cents) || 0) / 100);
}

function formatDetailAmount(row: Record<string, any>) {
  const cents = row.amountCents ?? row.balanceDueCents ?? row.paidAmountCents ?? row.adjustmentCents ?? row.totalCents;
  if (typeof cents === 'number') return formatMoney(cents);
  if (row.amount) return String(row.amount);
  if (row.dueDate) return String(row.dueDate);
  if (row.createdAt) return 'Recorded';
  return '';
}
