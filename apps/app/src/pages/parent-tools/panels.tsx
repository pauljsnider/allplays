import { memo, useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
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
  KeyRound,
  Loader2,
  RefreshCw,
  Share2,
  Shield,
  Ticket,
  Users
} from 'lucide-react';
import { exportCalendarIcsFile, openPublicUrl, sharePublicUrl } from '../../lib/publicActions';
import { redeemSignedInInvite } from '../../lib/inviteRedemption';
import { toAppServiceError, type AppServiceError } from '../../lib/appErrors';
import {
  loadParentAccessModel,
  loadParentAccessPlayers,
  loadParentAccessTeams,
  submitParentAccessRequest,
  type ParentAccessPlayer,
  type ParentAccessRequest,
  type ParentAccessTeam
} from '../../lib/parentToolsAccessService';
import {
  buildParentScheduleIcs,
  createParentFamilyShare,
  createParentHouseholdMemberInvite,
  getAppleCalendarFeedUrl,
  getGoogleCalendarFeedUrl,
  getPrivateTeamCalendarFeedUrl,
  initiateParentTeamFeeCheckout,
  loadFamilyShareModel,
  loadParentCalendarTools,
  loadParentCertificates,
  loadParentFeesForApp,
  loadParentHouseholdInviteModel,
  loadParentRegistrations,
  revokeParentFamilyShare,
  updateParentFamilyShareCalendars,
  type FamilyShareTokenCard,
  type ParentCalendarTeam,
  type ParentCertificateCard,
  type ParentFeeAppRecord,
  type ParentHouseholdFamilyMember,
  type ParentHouseholdLinkedPlayer,
  type ParentRegistrationCard
} from '../../lib/parentToolsService';
import { getCalendarEventShareText } from '../../lib/parentToolsService';
import { useAsyncOperation } from '../../lib/useAsyncOperation';
import type { ParentScheduleEvent } from '../../lib/scheduleLogic';
import type { AuthState } from '../../lib/types';

type ParentToolId = 'access' | 'household' | 'fees' | 'calendar' | 'share' | 'registrations' | 'certificates';

declare global {
  var __ALLPLAYS_PARENT_TOOLS_RENDER_TRACKER__: ((toolId: ParentToolId) => void) | undefined;
}

const tools: Array<{ id: ParentToolId; label: string; icon: LucideIcon }> = [
  { id: 'access', label: 'Access', icon: Shield },
  { id: 'household', label: 'Household', icon: Users },
  { id: 'fees', label: 'Fees', icon: DollarSign },
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'share', label: 'Share', icon: Share2 },
  { id: 'registrations', label: 'Register', icon: Ticket },
  { id: 'certificates', label: 'Awards', icon: Award }
];

const validToolIds = new Set(tools.map((tool) => tool.id));
const accessDependentToolIds = tools.map((tool) => tool.id).filter((id): id is ParentToolId => id !== 'access');
const initialToolRefreshVersions = Object.fromEntries(tools.map((tool) => [tool.id, 0])) as Record<ParentToolId, number>;

function trackParentToolRender(toolId: ParentToolId) {
  globalThis.__ALLPLAYS_PARENT_TOOLS_RENDER_TRACKER__?.(toolId);
}

const MemoizedAccessTool = memo(function MemoizedAccessTool(props: { auth: AuthState; onAccessChanged: () => void }) {
  trackParentToolRender('access');
  return <AccessTool {...props} />;
});

const MemoizedHouseholdInviteTool = memo(function MemoizedHouseholdInviteTool(props: { auth: AuthState; refreshVersion: number }) {
  trackParentToolRender('household');
  return <HouseholdInviteTool {...props} />;
});

const MemoizedFeesTool = memo(function MemoizedFeesTool(props: { auth: AuthState; refreshVersion: number }) {
  trackParentToolRender('fees');
  return <FeesTool {...props} />;
});

const MemoizedCalendarTool = memo(function MemoizedCalendarTool(props: { auth: AuthState; refreshVersion: number }) {
  trackParentToolRender('calendar');
  return <CalendarTool {...props} />;
});

const MemoizedFamilyShareTool = memo(function MemoizedFamilyShareTool(props: { auth: AuthState; refreshVersion: number }) {
  trackParentToolRender('share');
  return <FamilyShareTool {...props} />;
});

const MemoizedRegistrationsTool = memo(function MemoizedRegistrationsTool(props: { auth: AuthState; refreshVersion: number }) {
  trackParentToolRender('registrations');
  return <RegistrationsTool {...props} />;
});

const MemoizedCertificatesTool = memo(function MemoizedCertificatesTool(props: { auth: AuthState; refreshVersion: number }) {
  trackParentToolRender('certificates');
  return <CertificatesTool {...props} />;
});

export function ParentTools({ auth }: { auth: AuthState }) {
  const { toolId = 'access' } = useParams();
  const navigate = useNavigate();
  const activeTool = validToolIds.has(toolId as ParentToolId) ? toolId as ParentToolId : null;
  const [visitedTools, setVisitedTools] = useState<ParentToolId[]>(() => activeTool ? [activeTool] : ['access']);
  const [toolRefreshVersions, setToolRefreshVersions] = useState<Record<ParentToolId, number>>(initialToolRefreshVersions);
  const [staleTools, setStaleTools] = useState<Set<ParentToolId>>(() => new Set());
  const activeToolRef = useRef<ParentToolId | null>(activeTool);
  const visitedToolsRef = useRef<ParentToolId[]>(visitedTools);
  const staleToolsRef = useRef(staleTools);

  useEffect(() => {
    activeToolRef.current = activeTool;
  }, [activeTool]);

  useEffect(() => {
    visitedToolsRef.current = visitedTools;
  }, [visitedTools]);

  useEffect(() => {
    staleToolsRef.current = staleTools;
  }, [staleTools]);

  useEffect(() => {
    if (!activeTool) return;
    setVisitedTools((current) => (current.includes(activeTool) ? current : [...current, activeTool]));

    if (!staleToolsRef.current.has(activeTool)) return;

    setStaleTools((current) => {
      if (!current.has(activeTool)) return current;
      const next = new Set(current);
      next.delete(activeTool);
      return next;
    });
    setToolRefreshVersions((current) => ({
      ...current,
      [activeTool]: current[activeTool] + 1
    }));
  }, [activeTool]);

  const setTool = useCallback((nextTool: ParentToolId) => {
    navigate(`/parent-tools/${nextTool}`);
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }, [navigate]);

  const handleAccessChanged = useCallback(() => {
    const currentActiveTool = activeToolRef.current;
    const currentVisitedTools = visitedToolsRef.current;

    setToolRefreshVersions((current) => currentActiveTool && currentActiveTool !== 'access' && accessDependentToolIds.includes(currentActiveTool) ? {
      ...current,
      [currentActiveTool]: current[currentActiveTool] + 1
    } : current);
    setStaleTools(() => new Set(accessDependentToolIds.filter((id) => id !== currentActiveTool && currentVisitedTools.includes(id))));
  }, []);

  if (!activeTool) return <Navigate to="/parent-tools/access" replace />;

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
            <p className="mt-0.5 truncate text-xs font-semibold text-gray-600">Access, household invites, payments, calendars, sharing, registration, and awards.</p>
          </div>
        </div>
      </section>

      <div className="parent-tools-nav sticky top-24 z-30 -mx-1 overflow-x-auto bg-gray-50/95 py-2 backdrop-blur">
        <div className="grid min-w-max grid-cols-7 gap-1 rounded-2xl border border-gray-200 bg-white p-1 shadow-sm">
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

      <KeepAliveTool active={activeTool === 'access'} mounted={visitedTools.includes('access')}><MemoizedAccessTool auth={auth} onAccessChanged={handleAccessChanged} /></KeepAliveTool>
      <KeepAliveTool active={activeTool === 'household'} mounted={visitedTools.includes('household')}><MemoizedHouseholdInviteTool auth={auth} refreshVersion={toolRefreshVersions.household} /></KeepAliveTool>
      <KeepAliveTool active={activeTool === 'fees'} mounted={visitedTools.includes('fees')}><MemoizedFeesTool auth={auth} refreshVersion={toolRefreshVersions.fees} /></KeepAliveTool>
      <KeepAliveTool active={activeTool === 'calendar'} mounted={visitedTools.includes('calendar')}><MemoizedCalendarTool auth={auth} refreshVersion={toolRefreshVersions.calendar} /></KeepAliveTool>
      <KeepAliveTool active={activeTool === 'share'} mounted={visitedTools.includes('share')}><MemoizedFamilyShareTool auth={auth} refreshVersion={toolRefreshVersions.share} /></KeepAliveTool>
      <KeepAliveTool active={activeTool === 'registrations'} mounted={visitedTools.includes('registrations')}><MemoizedRegistrationsTool auth={auth} refreshVersion={toolRefreshVersions.registrations} /></KeepAliveTool>
      <KeepAliveTool active={activeTool === 'certificates'} mounted={visitedTools.includes('certificates')}><MemoizedCertificatesTool auth={auth} refreshVersion={toolRefreshVersions.certificates} /></KeepAliveTool>
    </div>
  );
}

function KeepAliveTool({ active, mounted, children }: { active: boolean; mounted: boolean; children: ReactNode }) {
  if (!mounted) return null;
  return <div hidden={!active}>{children}</div>;
}

type ParentToolAsyncOptions<T> = {
  onSuccess?: (value: T) => void | Promise<void>;
  onError?: (error: AppServiceError) => void | Promise<void>;
  clearError?: boolean;
};

function useParentToolAsyncOperation() {
  const { loading, clearError: clearOperationError, run: runOperation } = useAsyncOperation();
  const [error, setError] = useState<AppServiceError | null>(null);

  const clearError = useCallback(() => {
    setError(null);
    clearOperationError();
  }, [clearOperationError]);

  const run = useCallback(async function runParentToolAsyncOperation<T>(
    task: () => Promise<T>,
    fallbackMessage: string,
    options: ParentToolAsyncOptions<T> = {}
  ) {
    if (options.clearError ?? true) {
      setError(null);
      clearOperationError();
    }

    return runOperation(task, {
      rethrow: false,
      getErrorMessage: (taskError) => getParentToolErrorMessage(toAppServiceError(taskError, fallbackMessage), fallbackMessage),
      onSuccess: async (value) => {
        setError(null);
        await options.onSuccess?.(value);
      },
      onError: async (taskError) => {
        const appError = toAppServiceError(taskError, fallbackMessage);
        setError(appError);
        await options.onError?.(appError);
      }
    });
  }, [clearOperationError, runOperation]);

  return {
    loading,
    error,
    setError,
    clearError,
    run
  };
}

export function AccessTool({ auth, onAccessChanged }: { auth: AuthState; onAccessChanged: () => void }) {
  const [teams, setTeams] = useState<ParentAccessTeam[]>([]);
  const [requests, setRequests] = useState<ParentAccessRequest[]>([]);
  const [players, setPlayers] = useState<ParentAccessPlayer[]>([]);
  const [manualRequestOpen, setManualRequestOpen] = useState(false);
  const [selectedTeamId, setSelectedTeamId] = useState('');
  const [selectedPlayerId, setSelectedPlayerId] = useState('');
  const [relation, setRelation] = useState('Parent');
  const [redeemCode, setRedeemCode] = useState('');
  const [message, setMessage] = useState('');
  const [loadError, setLoadError] = useState<AppServiceError | null>(null);
  const [manualLookupError, setManualLookupError] = useState<AppServiceError | null>(null);
  const [actionError, setActionError] = useState<AppServiceError | null>(null);
  const accessLoadOperation = useAsyncOperation();
  const teamLoadOperation = useAsyncOperation();
  const playerLoadOperation = useAsyncOperation();
  const submitOperation = useAsyncOperation();
  const redeemOperation = useAsyncOperation();

  const loading = accessLoadOperation.loading;
  const loadingTeams = teamLoadOperation.loading;
  const loadingPlayers = playerLoadOperation.loading;
  const saving = submitOperation.loading;
  const redeeming = redeemOperation.loading;

  const loadTeams = useCallback(async () => {
    setManualLookupError(null);
    setActionError(null);
    return teamLoadOperation.run(
      () => loadParentAccessTeams(),
      {
        rethrow: false,
        getErrorMessage: (error) => getParentToolErrorMessage(toAppServiceError(error, 'Unable to load public teams.'), 'Unable to load public teams.'),
        onSuccess: (rows) => {
          setTeams(rows);
          setSelectedTeamId((current) => rows.some((team) => team.id === current) ? current : '');
        },
        onError: (error) => {
          setManualLookupError(toAppServiceError(error, 'Unable to load public teams.'));
        }
      }
    );
  }, [teamLoadOperation]);

  const openManualRequest = useCallback(() => {
    setManualRequestOpen(true);
    if (!teams.length && !loadingTeams) {
      void loadTeams();
    }
  }, [loadTeams, loadingTeams, teams.length]);

  const refresh = useCallback(async () => {
    setLoadError(null);
    setManualLookupError(null);
    setActionError(null);
    setMessage('');
    return accessLoadOperation.run(
      () => loadParentAccessModel(auth.user),
      {
        rethrow: false,
        getErrorMessage: (error) => getParentToolErrorMessage(toAppServiceError(error, 'Unable to load team access.'), 'Unable to load team access.'),
        onSuccess: (model) => {
          setRequests(model.requests);
        },
        onError: (error) => {
          setLoadError(toAppServiceError(error, 'Unable to load team access.'));
        }
      }
    );
  }, [accessLoadOperation, auth.user]);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.user?.uid]);

  useEffect(() => {
    setManualRequestOpen(false);
    setTeams([]);
    setPlayers([]);
    setSelectedTeamId('');
    setSelectedPlayerId('');
  }, [auth.user?.uid]);

  const loadPlayersForTeam = useCallback(async (teamId: string) => {
    setManualLookupError(null);
    const rows = await playerLoadOperation.run(
      () => loadParentAccessPlayers(teamId),
      {
        rethrow: false,
        getErrorMessage: (error) => getParentToolErrorMessage(toAppServiceError(error, 'Unable to load players for this team.'), 'Unable to load players for this team.')
      }
    );
    if (rows) {
      setPlayers(rows);
      setSelectedPlayerId(rows[0]?.id || '');
      return;
    }
    setManualLookupError(toAppServiceError(playerLoadOperation.error || new Error('Unable to load players for this team.'), 'Unable to load players for this team.'));
  }, [playerLoadOperation]);

  useEffect(() => {
    let cancelled = false;
    async function loadPlayers() {
      setPlayers([]);
      setSelectedPlayerId('');
      if (!selectedTeamId) return;
      const rows = await playerLoadOperation.run(
        () => loadParentAccessPlayers(selectedTeamId),
        {
          rethrow: false,
          getErrorMessage: (error) => getParentToolErrorMessage(toAppServiceError(error, 'Unable to load players for this team.'), 'Unable to load players for this team.')
        }
      );
      if (!cancelled && rows) {
        setManualLookupError(null);
        setPlayers(rows);
        setSelectedPlayerId(rows[0]?.id || '');
      }
      if (!cancelled && !rows) {
        setManualLookupError(toAppServiceError(playerLoadOperation.error || new Error('Unable to load players for this team.'), 'Unable to load players for this team.'));
      }
    }
    void loadPlayers();
    return () => {
      cancelled = true;
    };
  }, [selectedTeamId]);

  const redeem = async (event: FormEvent) => {
    event.preventDefault();
    const currentUser = auth.user;
    if (!currentUser?.uid) {
      setActionError(toAppServiceError(new Error('Sign in to redeem an invite code.'), 'Sign in to redeem an invite code.'));
      return;
    }

    setActionError(null);
    setMessage('');
    await redeemOperation.run(
      () => redeemSignedInInvite({
        userId: currentUser.uid,
        code: redeemCode,
        email: currentUser.email,
        refresh: auth.refresh
      }),
      {
        rethrow: false,
        getErrorMessage: (error) => getParentToolErrorMessage(toAppServiceError(error, 'Unable to redeem this invite code.'), 'Unable to redeem this invite code.'),
        onSuccess: async (result) => {
          await refresh();
          onAccessChanged();
          setRedeemCode('');
          setMessage(result.message);
        },
        onError: (error) => {
          setActionError(toAppServiceError(error, 'Unable to redeem this invite code.'));
        }
      }
    );
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedTeamId || !selectedPlayerId) {
      setActionError(toAppServiceError(new Error('Choose a team and player first.'), 'Choose a team and player first.'));
      return;
    }
    setActionError(null);
    setMessage('');
    await submitOperation.run(
      () => submitParentAccessRequest(selectedTeamId, selectedPlayerId, relation),
      {
        rethrow: false,
        getErrorMessage: (error) => getParentToolErrorMessage(toAppServiceError(error, 'Unable to send access request.'), 'Unable to send access request.'),
        onSuccess: async () => {
          await refresh();
          onAccessChanged();
          setMessage('Access request sent.');
        },
        onError: (error) => {
          setActionError(toAppServiceError(error, 'Unable to send access request.'));
        }
      }
    );
  };

  return (
    <div className="space-y-3">
      <section className="app-card p-4">
        <ToolHeader icon={Shield} title="Request player access" detail="Use this when you do not have an invite code." action={<button type="button" className="ghost-button !min-h-9 text-xs" onClick={refresh} disabled={loading || redeeming}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />Refresh</button>} />
        {loadError ? <RetryableStatus error={loadError} fallbackMessage="Unable to load team access." onRetry={refresh} retrying={loading} /> : null}
        {actionError ? <Status tone="error" message={getParentToolErrorMessage(actionError, 'Unable to complete that action.')} /> : null}
        {message ? <Status tone="success" message={message} /> : null}
        {loading ? <LoadingBlock label="Loading access tools" /> : (
          <>
            <form className="mt-3 rounded-2xl border border-primary-100 bg-primary-50/60 p-3" onSubmit={redeem}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <label className="min-w-0 flex-1">
                  <span className="app-label">Invite code</span>
                  <input
                    className="auth-input mt-1 text-center font-mono uppercase tracking-[0.3em]"
                    value={redeemCode}
                    onChange={(event) => setRedeemCode(event.target.value.toUpperCase())}
                    maxLength={8}
                    placeholder="XXXXXXXX"
                    inputMode="text"
                    autoCapitalize="characters"
                    autoComplete="one-time-code"
                    enterKeyHint="go"
                    disabled={redeeming || saving}
                  />
                </label>
                <button type="submit" className="primary-button sm:min-w-[10rem]" disabled={redeeming || saving}>
                  {redeeming ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <KeyRound className="h-4 w-4" aria-hidden="true" />}
                  {redeeming ? 'Redeeming...' : 'Redeem code'}
                </button>
              </div>
              <p className="mt-2 text-xs font-semibold text-gray-600">Already have an 8-character player invite? Redeem it here and stay in Parent Tools.</p>
            </form>
            {manualRequestOpen ? (
              <form className="mt-3 grid gap-3 lg:grid-cols-[1fr_1fr_auto]" onSubmit={submit}>
                {manualLookupError ? <div className="lg:col-span-3"><RetryableStatus error={manualLookupError} fallbackMessage="Unable to load public teams." onRetry={selectedTeamId ? () => { void loadPlayersForTeam(selectedTeamId); } : loadTeams} retrying={loadingTeams || loadingPlayers} /></div> : null}
                <div className="min-w-0">
                  <label className="app-label" htmlFor="parent-access-team">Team</label>
                  <select id="parent-access-team" aria-label="Team" className="auth-input mt-1" value={selectedTeamId} onChange={(event) => setSelectedTeamId(event.target.value)} disabled={loadingTeams || !teams.length}>
                    <option value="">{loadingTeams ? 'Loading public teams...' : teams.length ? 'Choose a team' : 'No public teams'}</option>
                    {teams.map((team) => (
                      <option key={team.id} value={team.id}>{team.name}{team.sport ? ` - ${team.sport}` : ''}</option>
                    ))}
                  </select>
                  {!loadingTeams && !teams.length ? (
                    <button type="button" className="ghost-button mt-2 !min-h-9 text-xs" onClick={loadTeams} disabled={redeeming || saving}>
                      Retry loading public teams
                    </button>
                  ) : null}
                </div>
                <div className="min-w-0">
                  <label className="app-label" htmlFor="parent-access-player">Player</label>
                  <select id="parent-access-player" aria-label="Player" className="auth-input mt-1" value={selectedPlayerId} onChange={(event) => setSelectedPlayerId(event.target.value)} disabled={!selectedTeamId || loadingPlayers}>
                    <option value="">{selectedTeamId ? (loadingPlayers ? 'Loading players...' : players.length ? 'Choose a player' : 'No players found') : 'Choose a team first'}</option>
                    {players.map((player) => (
                      <option key={player.id} value={player.id}>{player.number ? `#${player.number} ` : ''}{player.name}</option>
                    ))}
                  </select>
                </div>
                <div className="min-w-0">
                  <label className="app-label" htmlFor="parent-access-relation">Relationship</label>
                  <select id="parent-access-relation" aria-label="Relationship" className="auth-input mt-1" value={relation} onChange={(event) => setRelation(event.target.value)}>
                    <option value="Parent">Parent</option>
                    <option value="Guardian">Guardian</option>
                    <option value="Grandparent">Grandparent</option>
                    <option value="Family">Family</option>
                  </select>
                </div>
                <button type="submit" className="primary-button lg:col-span-3" disabled={saving || redeeming || loadingTeams || loadingPlayers || !selectedTeamId || !selectedPlayerId}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Shield className="h-4 w-4" aria-hidden="true" />}
                  Send request
                </button>
              </form>
            ) : (
              <div className="mt-3 rounded-2xl border border-dashed border-gray-200 bg-white p-3">
                <div className="text-sm font-black text-gray-950">Need manual access?</div>
                <p className="mt-1 text-xs font-semibold text-gray-600">Open the manual request form only when you need to search public teams and request access to a player.</p>
                <button type="button" className="secondary-button mt-3" onClick={openManualRequest} disabled={redeeming || saving || loadingTeams}>
                  {loadingTeams ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Shield className="h-4 w-4" aria-hidden="true" />}
                  {loadingTeams ? 'Loading public teams...' : 'Request access without a code'}
                </button>
              </div>
            )}
          </>
        )}
      </section>

      <section className="app-card p-4">
        <ToolHeader icon={Users} title="Access requests" detail="Pending and decided requests from your account." action={<Link to="/accept-invite" className="secondary-button !min-h-9 text-xs">Open full invite flow</Link>} />
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {requests.length ? requests.map((request) => <AccessRequestCard key={request.id || `${request.teamId}-${request.playerId}`} request={request} />) : (
            <EmptyState icon={Shield} title="No requests yet" detail="Invite codes can be redeemed here, or you can open the full invite flow." />
          )}
        </div>
      </section>
    </div>
  );
}

export function FeesTool({ auth, refreshVersion }: { auth: AuthState; refreshVersion: number }) {
  const [searchParams] = useSearchParams();
  const [fees, setFees] = useState<ParentFeeAppRecord[]>([]);
  const [filter, setFilter] = useState<'open' | 'all' | 'paid'>('open');
  const [payingFeeId, setPayingFeeId] = useState('');
  const [feeErrors, setFeeErrors] = useState<Record<string, string>>({});
  const { loading, error, run: runLoad } = useParentToolAsyncOperation();
  const payOperation = useAsyncOperation();
  const requestedTeamId = String(searchParams.get('teamId') || '').trim();
  const requestedBatchId = String(searchParams.get('batchId') || '').trim();
  const requestedRecipientId = String(searchParams.get('recipientId') || '').trim();
  const hasRequestedFee = Boolean(requestedTeamId || requestedBatchId || requestedRecipientId);

  const refresh = useCallback(async () => {
    return runLoad(
      () => loadParentFeesForApp(auth.user),
      'Unable to load fees.',
      {
        onSuccess: (result) => {
          setFees(result);
        }
      }
    );
  }, [auth.user, runLoad]);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.user?.uid, refreshVersion]);

  useEffect(() => {
    if (!hasRequestedFee) return;
    setFilter((current) => (current === 'open' ? 'all' : current));
  }, [hasRequestedFee, requestedBatchId, requestedRecipientId, requestedTeamId]);

  const visibleFees = useMemo(() => {
    const filteredFees = fees.filter((fee) => {
      if (filter === 'all') return true;
      if (filter === 'paid') return fee.status === 'paid';
      return !['paid', 'canceled', 'cancelled'].includes(String(fee.status || '').toLowerCase());
    });

    if (!hasRequestedFee) {
      return filteredFees;
    }

    const matchingFees = filteredFees.filter((fee) => {
      if (requestedTeamId && String(fee.teamId || '') !== requestedTeamId) return false;
      if (requestedBatchId && String(fee.batchId || '') !== requestedBatchId) return false;
      if (requestedRecipientId && String(fee.recipientId || '') !== requestedRecipientId) return false;
      return true;
    });

    return matchingFees.length ? matchingFees : filteredFees;
  }, [fees, filter, hasRequestedFee, requestedBatchId, requestedRecipientId, requestedTeamId]);

  const openCount = fees.filter((fee) => !['paid', 'canceled', 'cancelled'].includes(String(fee.status || '').toLowerCase())).length;
  const balanceCents = visibleFees.reduce((sum, fee) => sum + Number(fee.balanceDueCents ?? fee.amountDueCents ?? 0), 0);
  const payFee = async (fee: ParentFeeAppRecord) => {
    const feeKey = getFeeCardKey(fee);
    const checkoutStatus = String(fee.checkoutStatus || '').toLowerCase();
    const reusableCheckoutUrl = Boolean(fee.checkoutUrl) && (!checkoutStatus || checkoutStatus === 'open');
    setPayingFeeId(feeKey);
    setFeeErrors((current) => ({ ...current, [feeKey]: '' }));
    await payOperation.run(
      async () => {
        if (fee.paymentAction === 'checkoutUrl' || (!fee.paymentAction && reusableCheckoutUrl)) {
          await openPublicUrl(String(fee.checkoutUrl));
          return;
        }
        if (fee.paymentAction === 'createCheckout' || (!fee.paymentAction && fee.checkoutInitiatable)) {
          const checkout = await initiateParentTeamFeeCheckout(String(fee.teamId || ''), String(fee.batchId || ''), String(fee.recipientId || ''));
          await openPublicUrl(checkout.checkoutUrl);
          return;
        }
        if (!reusableCheckoutUrl) {
          throw new Error('Checkout is not available for this fee.');
        }
        await openPublicUrl(String(fee.checkoutUrl));
      },
      {
        rethrow: false,
        getErrorMessage: (payError) => getParentToolErrorMessage(toAppServiceError(payError, 'Unable to open checkout. Please try again.'), 'Unable to open checkout. Please try again.'),
        onError: (payError) => {
          setFeeErrors((current) => ({ ...current, [feeKey]: getParentToolErrorMessage(toAppServiceError(payError, 'Unable to open checkout. Please try again.'), 'Unable to open checkout. Please try again.') }));
        },
        onFinally: () => {
          setPayingFeeId('');
        }
      }
    );
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

      {error ? <RetryableStatus error={error} fallbackMessage="Unable to load fees." onRetry={refresh} retrying={loading} /> : null}
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

export function CalendarTool({ auth, refreshVersion }: { auth: AuthState; refreshVersion: number }) {
  const [events, setEvents] = useState<ParentScheduleEvent[]>([]);
  const [teams, setTeams] = useState<ParentCalendarTeam[]>([]);
  const [busyTeamId, setBusyTeamId] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState<AppServiceError | null>(null);
  const loadOperation = useAsyncOperation();
  const exportOperation = useAsyncOperation();
  const feedOperation = useAsyncOperation();
  const loading = loadOperation.loading;
  const exporting = exportOperation.loading;

  const refresh = useCallback(async (options: { force?: boolean } = {}) => {
    setError(null);
    setMessage('');
    return loadOperation.run(
      () => loadParentCalendarTools(auth.user, options),
      {
        rethrow: false,
        getErrorMessage: (loadError) => getParentToolErrorMessage(toAppServiceError(loadError, 'Unable to load calendar tools.'), 'Unable to load calendar tools.'),
        onSuccess: (model) => {
          setEvents(model.events);
          setTeams(model.teams);
        },
        onError: (loadError) => {
          setError(toAppServiceError(loadError, 'Unable to load calendar tools.'));
        }
      }
    );
  }, [auth.user, loadOperation]);

  useEffect(() => {
    void refresh(refreshVersion > 0 ? { force: true } : {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.user?.uid, refreshVersion]);

  const download = async () => {
    if (!events.length) {
      setMessage('No events to export yet.');
      return;
    }
    setError(null);
    setMessage('');
    await exportOperation.run(
      () => exportCalendarIcsFile('all-plays-family-schedule.ics', buildParentScheduleIcs(events)),
      {
        rethrow: false,
        getErrorMessage: (downloadError) => getParentToolErrorMessage(toAppServiceError(downloadError, 'Unable to export the calendar file. Try again or use the Apple or Google calendar links instead.'), 'Unable to export the calendar file. Try again or use the Apple or Google calendar links instead.'),
        onSuccess: () => {
          setMessage('Calendar file ready to share.');
        },
        onError: (downloadError) => {
          setError(toAppServiceError(downloadError, 'Unable to export the calendar file. Try again or use the Apple or Google calendar links instead.'));
        }
      }
    );
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
    setError(null);
    setMessage('');
    await feedOperation.run(
      async () => {
        const feedUrl = await getPrivateTeamCalendarFeedUrl(team.teamId);
        if (!feedUrl) throw new Error('Unable to create private calendar feed. Sign in again and retry.');
        if (target === 'copy') {
          await copyText(feedUrl, setMessage);
          return;
        }
        await openPublicUrl(target === 'apple' ? getAppleCalendarFeedUrl(feedUrl) : getGoogleCalendarFeedUrl(feedUrl));
      },
      {
        rethrow: false,
        getErrorMessage: (feedError) => getParentToolErrorMessage(toAppServiceError(feedError, 'Unable to open calendar feed.'), 'Unable to open calendar feed.'),
        onError: (feedError) => {
          setError(toAppServiceError(feedError, 'Unable to open calendar feed.'));
        },
        onFinally: () => {
          setBusyTeamId('');
        }
      }
    );
  };

  return (
    <div className="space-y-3">
      <section className="app-card p-4">
        <ToolHeader icon={CalendarDays} title="Calendar tools" detail="Download your family schedule or subscribe by team." action={<button type="button" className="ghost-button !min-h-9 text-xs" onClick={() => { void refresh({ force: true }); }} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />Refresh</button>} />
        {error ? <RetryableStatus error={error} fallbackMessage="Unable to load calendar tools." onRetry={loading ? undefined : () => refresh({ force: true })} retrying={loading} /> : null}
        {message ? <Status tone="success" message={message} /> : null}
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <button type="button" className="secondary-button justify-center" onClick={() => { void download(); }} disabled={loading || exporting}>
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}
            {exporting ? 'Preparing .ics' : 'Download .ics'}
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


export function HouseholdInviteTool({ auth, refreshVersion }: { auth: AuthState; refreshVersion: number }) {
  const [linkedPlayers, setLinkedPlayers] = useState<ParentHouseholdLinkedPlayer[]>([]);
  const [members, setMembers] = useState<ParentHouseholdFamilyMember[]>([]);
  const [playerKey, setPlayerKey] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [relation, setRelation] = useState('');
  const [createdInvite, setCreatedInvite] = useState<{ code: string; inviteUrl: string } | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState<AppServiceError | null>(null);
  const loadOperation = useAsyncOperation();
  const submitOperation = useAsyncOperation();
  const loading = loadOperation.loading;
  const saving = submitOperation.loading;

  const pendingMembers = useMemo(() => members.filter((member) => String(member.status || '').toLowerCase() === 'pending'), [members]);

  const refresh = useCallback(async () => {
    setError(null);
    return loadOperation.run(
      () => loadParentHouseholdInviteModel(auth.user),
      {
        rethrow: false,
        getErrorMessage: (loadError) => getParentToolErrorMessage(toAppServiceError(loadError, 'Unable to load household invites.'), 'Unable to load household invites.'),
        onSuccess: (model) => {
          setLinkedPlayers(model.linkedPlayers);
          setMembers(model.members);
          setPlayerKey((current) => current || (model.linkedPlayers[0] ? `${model.linkedPlayers[0].teamId}::${model.linkedPlayers[0].playerId}` : ''));
        },
        onError: (loadError) => {
          setError(toAppServiceError(loadError, 'Unable to load household invites.'));
        }
      }
    );
  }, [auth.user, loadOperation]);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.user?.uid, refreshVersion]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmedEmail = email.trim();
    const trimmedRelation = relation.trim();
    if (!playerKey) {
      setError(toAppServiceError(new Error('Choose a linked player first.'), 'Choose a linked player first.'));
      return;
    }
    if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError(toAppServiceError(new Error('Enter a valid email for the household contact.'), 'Enter a valid email for the household contact.'));
      return;
    }
    if (!trimmedRelation) {
      setError(toAppServiceError(new Error('Enter the household contact relation.'), 'Enter the household contact relation.'));
      return;
    }
    setError(null);
    setMessage('');
    setCreatedInvite(null);
    await submitOperation.run(
      () => createParentHouseholdMemberInvite(auth.user, {
        playerKey,
        displayName,
        email: trimmedEmail,
        relation: trimmedRelation
      }),
      {
        rethrow: false,
        getErrorMessage: (createError) => getParentToolErrorMessage(toAppServiceError(createError, 'Unable to create household invite.'), 'Unable to create household invite.'),
        onSuccess: async (result) => {
          setCreatedInvite(result);
          setMessage('Household invite created.');
          setDisplayName('');
          setEmail('');
          setRelation('');
          await refresh();
        },
        onError: (createError) => {
          setError(toAppServiceError(createError, 'Unable to create household invite.'));
        }
      }
    );
  };

  return (
    <div className="space-y-3">
      <section className="app-card p-4">
        <ToolHeader icon={Users} title="Household member invite" detail="Create one pending family plan invite for a linked player. This is separate from co-parent and token share links." action={<button type="button" className="ghost-button !min-h-9 text-xs" onClick={refresh} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />Refresh</button>} />
        {error ? <RetryableStatus error={error} fallbackMessage="Unable to load household invites." onRetry={loading ? undefined : refresh} retrying={loading} /> : null}
        {message ? <Status tone="success" message={message} /> : null}
        {createdInvite ? (
          <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
            <div className="font-black">Invite code: <span className="font-mono">{createdInvite.code}</span></div>
            <div className="mt-1 break-all text-xs font-semibold">{createdInvite.inviteUrl}</div>
            <button type="button" className="ghost-button mt-2 !min-h-8 text-xs" onClick={() => copyText(createdInvite.inviteUrl, setMessage)}><Copy className="h-4 w-4" aria-hidden="true" />Copy invite link</button>
          </div>
        ) : null}
        {loading ? <LoadingBlock label="Loading household invites" /> : (
          <form className="mt-3 grid gap-3" onSubmit={submit}>
            <label>
              <span className="app-label">Linked player</span>
              <select className="auth-input mt-1" value={playerKey} onChange={(event) => setPlayerKey(event.target.value)} disabled={!linkedPlayers.length || saving}>
                {linkedPlayers.length ? linkedPlayers.map((player) => (
                  <option key={`${player.teamId}-${player.playerId}`} value={`${player.teamId}::${player.playerId}`}>{player.playerName || 'Player'}{player.playerNumber ? ` #${player.playerNumber}` : ''}{player.teamName ? ` - ${player.teamName}` : ''}</option>
                )) : <option value="">No linked players</option>}
              </select>
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <input className="auth-input" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Name (optional)" autoComplete="name" enterKeyHint="next" disabled={saving || !linkedPlayers.length} />
              <input className="auth-input" type="email" inputMode="email" autoComplete="email" enterKeyHint="send" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Household contact email" disabled={saving || !linkedPlayers.length} />
            </div>
            <input className="auth-input" value={relation} onChange={(event) => setRelation(event.target.value)} placeholder="Relation, like grandparent or guardian" autoComplete="off" enterKeyHint="next" disabled={saving || !linkedPlayers.length} />
            <button type="submit" className="primary-button" disabled={saving || loading || !linkedPlayers.length}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Users className="h-4 w-4" aria-hidden="true" />}
              Create household invite
            </button>
          </form>
        )}
      </section>

      <section className="app-card p-4">
        <ToolHeader icon={Users} title="Pending household invites" detail="Family membership invites that have not been redeemed or removed." />
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          {pendingMembers.length ? pendingMembers.map((member) => (
            <div key={member.id} className="rounded-xl border border-gray-200 bg-gray-50 p-3">
              <div className="text-sm font-black text-gray-950">{member.displayName || member.email}</div>
              <div className="mt-0.5 text-xs font-semibold text-gray-500">{member.email}</div>
              <div className="mt-1 text-xs font-semibold text-gray-600">{member.relation || 'Household contact'} for {member.playerName || 'Player'}{member.playerNumber ? ` #${member.playerNumber}` : ''}{member.teamName ? ` - ${member.teamName}` : ''}</div>
              {member.accessCode ? <div className="mt-2 text-xs font-semibold text-gray-600">Code <span className="font-mono">{member.accessCode}</span></div> : null}
            </div>
          )) : <EmptyState icon={Users} title="No pending household invites" detail="Create an invite when a household member needs account-based access to a linked player." />}
        </div>
      </section>
    </div>
  );
}

export function FamilyShareTool({ auth, refreshVersion }: { auth: AuthState; refreshVersion: number }) {
  const [tokens, setTokens] = useState<FamilyShareTokenCard[]>([]);
  const [children, setChildren] = useState<any[]>([]);
  const [label, setLabel] = useState('');
  const [calendarText, setCalendarText] = useState('');
  const [editingTokenId, setEditingTokenId] = useState('');
  const [pendingRevokeToken, setPendingRevokeToken] = useState<FamilyShareTokenCard | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState<AppServiceError | null>(null);
  const loadOperation = useAsyncOperation();
  const saveOperation = useAsyncOperation();
  const loading = loadOperation.loading;
  const saving = saveOperation.loading;

  const refresh = useCallback(async () => {
    setError(null);
    return loadOperation.run(
      () => loadFamilyShareModel(auth.user),
      {
        rethrow: false,
        getErrorMessage: (loadError) => getParentToolErrorMessage(toAppServiceError(loadError, 'Unable to load family share links.'), 'Unable to load family share links.'),
        onSuccess: (model) => {
          setChildren(model.children);
          setTokens(model.tokens);
        },
        onError: (loadError) => {
          setError(toAppServiceError(loadError, 'Unable to load family share links.'));
        }
      }
    );
  }, [auth.user, loadOperation]);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.user?.uid, refreshVersion]);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setMessage('');
    await saveOperation.run(
      () => createParentFamilyShare(auth.user, label || 'Family share', splitLines(calendarText)),
      {
        rethrow: false,
        getErrorMessage: (createError) => getParentToolErrorMessage(toAppServiceError(createError, 'Unable to create family share link.'), 'Unable to create family share link.'),
        onSuccess: async (result) => {
          setMessage('Family link created.');
          setLabel('');
          setCalendarText('');
          await copyText(result.url, setMessage);
          await refresh();
        },
        onError: (createError) => {
          setError(toAppServiceError(createError, 'Unable to create family share link.'));
        }
      }
    );
  };

  const revoke = async (tokenId: string) => {
    setError(null);
    setMessage('');
    await saveOperation.run(
      () => revokeParentFamilyShare(tokenId),
      {
        rethrow: false,
        getErrorMessage: (revokeError) => getParentToolErrorMessage(toAppServiceError(revokeError, 'Unable to revoke family share link.'), 'Unable to revoke family share link.'),
        onSuccess: async () => {
          setMessage('Family link revoked.');
          await refresh();
        },
        onError: (revokeError) => {
          setError(toAppServiceError(revokeError, 'Unable to revoke family share link.'));
        },
        onFinally: () => {
          setPendingRevokeToken(null);
        }
      }
    );
  };

  const saveCalendars = async (tokenId: string, value: string) => {
    setError(null);
    setMessage('');
    await saveOperation.run(
      () => updateParentFamilyShareCalendars(tokenId, splitLines(value)),
      {
        rethrow: false,
        getErrorMessage: (saveError) => getParentToolErrorMessage(toAppServiceError(saveError, 'Unable to update calendar links.'), 'Unable to update calendar links.'),
        onSuccess: async () => {
          setEditingTokenId('');
          setMessage('Calendar links updated.');
          await refresh();
        },
        onError: (saveError) => {
          setError(toAppServiceError(saveError, 'Unable to update calendar links.'));
        }
      }
    );
  };

  return (
    <div className="space-y-3">
      <section className="app-card p-4">
        <ToolHeader icon={Share2} title="Family share" detail="Share a private family page with relatives and caregivers." action={<button type="button" className="ghost-button !min-h-9 text-xs" onClick={refresh} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />Refresh</button>} />
        {error ? <RetryableStatus error={error} fallbackMessage="Unable to load family share links." onRetry={loading ? undefined : refresh} retrying={loading} /> : null}
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
              onRevoke={() => setPendingRevokeToken(token)}
              onSaveCalendars={saveCalendars}
            />
          )) : <EmptyState icon={Share2} title="No family links" detail="Create a link when someone needs schedule access without a full account." />}
        </div>
      )}

      {pendingRevokeToken ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-gray-950/40 px-4 py-5 sm:items-center" role="presentation">
          <div className="w-full max-w-sm rounded-2xl bg-white p-4 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="family-share-revoke-title">
            <h3 id="family-share-revoke-title" className="text-base font-black text-gray-950">Revoke this share link?</h3>
            <p className="mt-2 text-sm font-semibold leading-6 text-gray-600">
              Anyone using the family share link{pendingRevokeToken.label ? ` for ${pendingRevokeToken.label}` : ''} will lose access.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button type="button" className="secondary-button justify-center text-xs" onClick={() => setPendingRevokeToken(null)} disabled={saving}>Cancel</button>
              <button type="button" className="primary-button justify-center text-xs !bg-rose-600 hover:!bg-rose-700" onClick={() => revoke(pendingRevokeToken.id)} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                Revoke link
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function RegistrationsTool({ auth, refreshVersion }: { auth: AuthState; refreshVersion: number }) {
  const [cards, setCards] = useState<ParentRegistrationCard[]>([]);
  const { loading, error, run: runLoad } = useParentToolAsyncOperation();

  const refresh = useCallback(async () => {
    return runLoad(
      () => loadParentRegistrations(auth.user),
      'Unable to load registrations.',
      {
        onSuccess: (result) => {
          setCards(result);
        }
      }
    );
  }, [auth.user, runLoad]);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.user?.uid, refreshVersion]);

  return (
    <div className="space-y-3">
      <section className="app-card p-4">
        <ToolHeader icon={Ticket} title="Registrations" detail="Published team registration forms linked to your family." action={<button type="button" className="ghost-button !min-h-9 text-xs" onClick={refresh} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />Refresh</button>} />
        {error ? <RetryableStatus error={error} fallbackMessage="Unable to load registrations." onRetry={refresh} retrying={loading} /> : null}
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

export function CertificatesTool({ auth, refreshVersion }: { auth: AuthState; refreshVersion: number }) {
  const [cards, setCards] = useState<ParentCertificateCard[]>([]);
  const { loading, error, run: runLoad } = useParentToolAsyncOperation();

  const refresh = useCallback(async () => {
    return runLoad(
      () => loadParentCertificates(auth.user),
      'Unable to load awards.',
      {
        onSuccess: (result) => {
          setCards(result);
        }
      }
    );
  }, [auth.user, runLoad]);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.user?.uid, refreshVersion]);

  return (
    <div className="space-y-3">
      <section className="app-card p-4">
        <ToolHeader icon={Award} title="Awards" detail="Published certificates for linked players." action={<button type="button" className="ghost-button !min-h-9 text-xs" onClick={refresh} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />Refresh</button>} />
        {error ? <RetryableStatus error={error} fallbackMessage="Unable to load awards." onRetry={refresh} retrying={loading} /> : null}
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
  const shareUrl = card.appUrl || card.url;
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
        <button type="button" className="secondary-button justify-center text-xs sm:col-span-2" onClick={() => sharePublicUrl({ title: card.programName, text: `${card.teamName} registration`, url: shareUrl })}>
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

function RetryableStatus({
  error,
  fallbackMessage,
  onRetry,
  retrying,
  buttonLabel = 'Retry'
}: {
  error: AppServiceError | null;
  fallbackMessage: string;
  onRetry?: () => void;
  retrying?: boolean;
  buttonLabel?: string;
}) {
  return (
    <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800">
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />
        <div className="min-w-0 flex-1">{getParentToolErrorMessage(error, fallbackMessage)}</div>
        {onRetry ? (
          <button type="button" className="ghost-button !min-h-8 !px-2 text-xs" onClick={onRetry} disabled={retrying}>
            <RefreshCw className={`h-4 w-4 ${retrying ? 'animate-spin' : ''}`} aria-hidden="true" />
            {buttonLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function getParentToolErrorMessage(error: AppServiceError | null, fallbackMessage: string) {
  if (!error) return fallbackMessage;
  return String(error.message || '').trim() || fallbackMessage;
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
