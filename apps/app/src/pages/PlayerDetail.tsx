import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  AlertCircle,
  Award,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  DollarSign,
  Edit3,
  ExternalLink,
  FileVideo,
  Mail,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Shield,
  Share2,
  Sparkles,
  Trash2,
  Trophy,
  UserRound,
  Users,
  type LucideIcon
} from 'lucide-react';
import {
  loadParentPlayerDetail,
  markParentPlayerIncentivePaid,
  retireParentPlayerIncentiveRule,
  saveParentAthleteProfileDraft,
  saveParentPlayerIncentiveCap,
  saveParentPlayerIncentiveRule,
  sendParentCoParentInvite,
  toggleParentPlayerIncentiveRule,
  updateParentPlayerEditableProfile,
  type ParentPlayerDetailData,
  type ParentPlayerStatRow
} from '../lib/playerService';
import { getEventDetailPath } from '../lib/homeLogic';
import {
  formatEventDateLabel,
  formatEventTimeLabel,
  getOpenScheduleAssignments,
  getScheduleTitle,
  normalizeRsvpResponse,
  type ParentScheduleEvent,
  type RsvpResponse
} from '../lib/scheduleLogic';
import { sharePublicUrl } from '../lib/publicActions';
import type { AuthState } from '../lib/types';

type PlayerSectionId = 'overview' | 'schedule' | 'performance' | 'profile';

const playerSections: Array<{ id: PlayerSectionId; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'schedule', label: 'Schedule' },
  { id: 'performance', label: 'Reports' },
  { id: 'profile', label: 'Profile' }
];

const rsvpBadgeClasses: Record<RsvpResponse, string> = {
  going: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  maybe: 'border-amber-200 bg-amber-50 text-amber-700',
  not_going: 'border-rose-200 bg-rose-50 text-rose-700',
  not_responded: 'border-primary-200 bg-primary-50 text-primary-700'
};

function getPersistedPublicProfileUrl(profile: Record<string, any> | null | undefined, shareUrl: string | null | undefined) {
  const normalizedShareUrl = String(shareUrl || '').trim();
  return profile?.privacy === 'public' && normalizedShareUrl ? normalizedShareUrl : '';
}

function hasPersistedPublicProfile(profile: Record<string, any> | null | undefined, shareUrl: string | null | undefined) {
  return !!getPersistedPublicProfileUrl(profile, shareUrl);
}

export function PlayerDetail({ auth }: { auth: AuthState }) {
  const { teamId = '', playerId = '' } = useParams();
  const [data, setData] = useState<ParentPlayerDetailData | null>(null);
  const [activeSection, setActiveSection] = useState<PlayerSectionId>('overview');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const refreshPlayer = async ({ showLoading = data === null }: { showLoading?: boolean } = {}) => {
    const fullPageLoading = showLoading || data === null;
    if (fullPageLoading) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }
    setError('');
    try {
      setData(await loadParentPlayerDetail(auth.user, teamId, playerId));
    } catch (loadError: any) {
      if (fullPageLoading) {
        setData(null);
      }
      setError(loadError?.message || 'Unable to load player.');
    } finally {
      if (fullPageLoading) {
        setLoading(false);
      } else {
        setRefreshing(false);
      }
    }
  };

  useEffect(() => {
    refreshPlayer({ showLoading: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.user?.uid, teamId, playerId]);

  const selectSection = (sectionId: PlayerSectionId) => {
    setActiveSection(sectionId);
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  };

  if (loading) {
    return (
      <div className="app-card p-6 text-center">
        <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary-600" aria-hidden="true" />
        <div className="mt-3 text-sm font-black text-gray-900">Loading player</div>
        <div className="mt-1 text-xs font-semibold text-gray-500">Pulling schedule, stats, clips, and profile links.</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-3">
        <Link to="/home" className="ghost-button min-h-9 px-3 text-xs">
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          Home
        </Link>
        <Status tone="error" message={error || 'This player is not available for your account.'} />
      </div>
    );
  }

  const playerName = data.player.name || data.child.playerName || 'Player';
  const jersey = data.player.number ? `#${data.player.number}` : '';
  const teamName = data.team?.name || data.child.teamName || data.child.teamId;

  return (
    <div className="player-detail-page space-y-3">
      <section className="app-card player-summary-card overflow-hidden">
        <div className="flex items-center gap-3 px-3 py-2 sm:px-4">
          <Link to="/home" className="ghost-button !h-9 !min-h-9 !w-9 !flex-none !p-0" aria-label="Back to Home" title="Back to Home">
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </Link>
          <div className="flex h-11 w-11 flex-none items-center justify-center overflow-hidden rounded-2xl bg-primary-50 text-base font-black text-primary-700">
            {data.player.photoUrl ? <img src={data.player.photoUrl} alt="" className="h-full w-full object-cover" /> : <span>{jersey || getInitials(playerName)}</span>}
          </div>
          <div className="min-w-0 flex-1">
            <div className="app-label">Player</div>
            <h1 className="truncate text-xl font-black leading-tight text-gray-950">{playerName}</h1>
            <p className="mt-0.5 truncate text-xs font-semibold text-gray-600">{[jersey, teamName].filter(Boolean).join(' · ')}</p>
          </div>
          <button type="button" className="ghost-button !h-9 !min-h-9 !w-9 !flex-none !p-0 sm:!w-auto sm:!px-3 text-xs" onClick={() => refreshPlayer({ showLoading: false })} disabled={refreshing} aria-label="Refresh player" title="Refresh player">
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
        <div className="flex gap-1.5 overflow-x-auto border-t border-gray-100 px-3 py-1.5 sm:px-4">
          <SignalChip icon={ClipboardCheck} label="RSVP" value={String(data.actionCounts.rsvpNeeded)} urgent={data.actionCounts.rsvpNeeded > 0} />
          <SignalChip icon={ClipboardCheck} label="Packets" value={String(data.actionCounts.packetsReady)} urgent={data.actionCounts.packetsReady > 0} />
          <SignalChip icon={CheckCircle2} label="Tasks" value={String(data.actionCounts.openAssignments)} urgent={data.actionCounts.openAssignments > 0} />
        </div>
      </section>

      <div className="player-section-nav sticky top-24 z-30 -mx-1 overflow-x-auto bg-gray-50/95 py-2 backdrop-blur">
        <div className="grid min-w-max grid-cols-4 gap-1 rounded-2xl border border-gray-200 bg-white p-1 shadow-sm">
          {playerSections.map((section) => {
            const active = activeSection === section.id;
            return (
              <button
                key={section.id}
                type="button"
                className={`min-h-10 rounded-xl px-3 text-sm font-black transition ${active ? 'bg-primary-600 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-950'}`}
                onClick={() => selectSection(section.id)}
                aria-pressed={active}
              >
                {section.label}
              </button>
            );
          })}
        </div>
      </div>

      {error ? <Status tone="error" message={error} /> : null}
      {activeSection === 'overview' ? <OverviewSection data={data} /> : null}
      {activeSection === 'schedule' ? <PlayerScheduleSection events={data.events} /> : null}
      {activeSection === 'performance' ? <ReportsSection data={data} /> : null}
      {activeSection === 'profile' ? <PlayerProfileSection data={data} auth={auth} onChanged={refreshPlayer} /> : null}
    </div>
  );
}

function OverviewSection({ data }: { data: ParentPlayerDetailData }) {
  const nextAction = getPlayerAction(data);
  return (
    <div className="player-section-content space-y-3">
      {nextAction ? (
        <Link to={nextAction.to} className={`flex items-center justify-between gap-3 rounded-xl border p-3 ${nextAction.className}`}>
          <span className="min-w-0">
            <span className="block text-sm font-black text-gray-950">{nextAction.title}</span>
            <span className="mt-0.5 block truncate text-xs font-semibold">{nextAction.detail}</span>
          </span>
          <ChevronRight className="h-5 w-5 flex-none" aria-hidden="true" />
        </Link>
      ) : (
        <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
          <CheckCircle2 className="mt-0.5 h-5 w-5 flex-none text-emerald-700" aria-hidden="true" />
          <div>
            <div className="text-sm font-black text-emerald-900">Caught up</div>
            <div className="mt-0.5 text-xs font-semibold text-emerald-700">No open parent actions for this player.</div>
          </div>
        </div>
      )}

      {data.nextEvent ? <PlayerEventCard event={data.nextEvent} featured /> : <EmptyCard icon={CalendarDays} title="No upcoming events" detail="This player's schedule is clear." />}

      <section className="grid gap-3 sm:grid-cols-3">
        <InfoCard icon={CalendarDays} title="Events" detail={`${data.events.length} total`} />
        <InfoCard icon={BarChart3} title="Reports" detail={`${data.statRows.length} recent games`} />
        <InfoCard icon={FileVideo} title="Clips" detail={`${data.clips.length} clips`} />
      </section>
    </div>
  );
}

function PlayerScheduleSection({ events }: { events: ParentScheduleEvent[] }) {
  const upcoming = useMemo(() => events.filter((event) => event.date.getTime() >= startOfDay(new Date()).getTime()), [events]);
  const recent = useMemo(() => events.filter((event) => event.date.getTime() < startOfDay(new Date()).getTime()).slice().sort((a, b) => b.date.getTime() - a.date.getTime()).slice(0, 6), [events]);
  return (
    <div className="player-section-content space-y-4">
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="app-section-title">Upcoming</h2>
          <Link to="/schedule" className="text-sm font-black text-primary-700">Full schedule</Link>
        </div>
        {upcoming.length ? upcoming.map((event) => (
          <PlayerEventCard key={event.eventKey} event={event} />
        )) : <EmptyCard icon={CalendarDays} title="No upcoming events" detail="Nothing scheduled for this player yet." />}
      </section>
      {recent.length ? (
        <section className="space-y-3">
          <h2 className="app-section-title">Recent</h2>
          {recent.map((event) => (
            <PlayerEventCard key={event.eventKey} event={event} />
          ))}
        </section>
      ) : null}
    </div>
  );
}

type ReportPanelId = 'games' | 'season' | 'events' | 'clips';

const reportPanels: Array<{ id: ReportPanelId; label: string }> = [
  { id: 'games', label: 'Game Stats' },
  { id: 'season', label: 'Season Averages' },
  { id: 'events', label: 'Game Events' },
  { id: 'clips', label: 'Video Clips' }
];

function ReportsSection({ data }: { data: ParentPlayerDetailData }) {
  const [activePanel, setActivePanel] = useState<ReportPanelId>('games');
  const trackingRows = Array.isArray(data.trackingSummary) ? data.trackingSummary[0]?.items || [] : [];
  return (
    <div className="player-section-content space-y-4">
      <section className="app-card p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="app-label">Player reports</div>
            <h2 className="mt-1 app-section-title">Game history and performance</h2>
          </div>
          <BarChart3 className="h-5 w-5 text-primary-600" aria-hidden="true" />
        </div>
        <div className="mt-3 flex gap-1.5 overflow-x-auto rounded-2xl border border-gray-200 bg-gray-50 p-1">
          {reportPanels.map((panel) => {
            const active = activePanel === panel.id;
            return (
              <button
                key={panel.id}
                type="button"
                className={`min-h-9 flex-none rounded-xl px-3 text-xs font-black transition ${active ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-600 hover:text-gray-950'}`}
                onClick={() => setActivePanel(panel.id)}
                aria-pressed={active}
              >
                {panel.label}
              </button>
            );
          })}
        </div>

        <div className="mt-3">
          {activePanel === 'games' ? <GameStatsPanel rows={data.statRows} /> : null}
          {activePanel === 'season' ? <SeasonAveragesPanel rows={data.statRows} /> : null}
          {activePanel === 'events' ? <GameEventsPanel events={data.events} /> : null}
          {activePanel === 'clips' ? <ClipsPanel clips={data.clips} /> : null}
        </div>
      </section>

      {trackingRows.length ? (
        <section className="app-card p-4">
          <div className="flex items-center gap-2 text-sm font-black text-primary-800">
            <Trophy className="h-4 w-4" aria-hidden="true" />
            Tracking
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {trackingRows.map((item: any) => (
              <div key={item.id} className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                <div className="text-sm font-black text-gray-950">{item.title}</div>
                <div className={`mt-1 text-xs font-bold ${item.isComplete ? 'text-emerald-700' : 'text-gray-500'}`}>{item.isComplete ? 'Complete' : 'Open'}</div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function GameStatsPanel({ rows }: { rows: ParentPlayerStatRow[] }) {
  return (
    <div className="space-y-2">
      {rows.length ? rows.map((row) => (
        <StatRow key={row.event.eventKey} row={row} />
      )) : <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm font-semibold text-gray-500">No tracked game stats yet.</div>}
    </div>
  );
}

function SeasonAveragesPanel({ rows }: { rows: ParentPlayerStatRow[] }) {
  const averages = getSeasonAverages(rows);
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {averages.length ? averages.map(([key, value]) => (
        <div key={key} className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-center">
          <div className="text-xl font-black text-gray-950">{value}</div>
          <div className="mt-1 truncate text-[10px] font-black uppercase tracking-[0.04em] text-gray-500">{key}</div>
        </div>
      )) : <div className="col-span-full rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm font-semibold text-gray-500">No season averages yet.</div>}
    </div>
  );
}

function GameEventsPanel({ events }: { events: ParentScheduleEvent[] }) {
  const gameEvents = events.filter((event) => event.type === 'game').slice().sort((a, b) => b.date.getTime() - a.date.getTime());
  return (
    <div className="space-y-2">
      {gameEvents.length ? gameEvents.map((event) => (
        <PlayerEventCard key={event.eventKey} event={event} />
      )) : <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm font-semibold text-gray-500">No game events recorded yet.</div>}
    </div>
  );
}

function ClipsPanel({ clips }: { clips: Array<Record<string, any>> }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {clips.length ? clips.map((clip) => (
        <a key={`${clip.url}-${clip.title}`} href={clip.url} target="_blank" rel="noreferrer" className="rounded-xl border border-gray-200 bg-gray-50 p-3 transition hover:border-primary-200 hover:bg-primary-50/40">
          <div className="flex items-center gap-2 text-sm font-black text-gray-950">
            <FileVideo className="h-4 w-4 flex-none text-primary-600" aria-hidden="true" />
            <span className="truncate">{clip.title || 'Game clip'}</span>
          </div>
          <div className="mt-0.5 truncate text-xs font-semibold text-gray-500">{clip.gameLabel || clip.game || 'Game'}{clip.gameDate ? ` · ${clip.gameDate}` : ''}</div>
        </a>
      )) : <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm font-semibold text-gray-500">No clips yet.</div>}
    </div>
  );
}

type ProfilePanelId = 'edit' | 'athlete' | 'family' | 'incentives';

const profilePanels: Array<{ id: ProfilePanelId; label: string }> = [
  { id: 'edit', label: 'Edit Profile' },
  { id: 'athlete', label: 'Athlete Profile' },
  { id: 'family', label: 'Family' },
  { id: 'incentives', label: 'Incentives' }
];

function PlayerProfileSection({ data, auth, onChanged }: { data: ParentPlayerDetailData; auth: AuthState; onChanged: () => Promise<void> }) {
  const [activePanel, setActivePanel] = useState<ProfilePanelId>('edit');
  const persistedPublicProfileUrl = getPersistedPublicProfileUrl(data.athleteProfile.profile, data.athleteProfile.shareUrl);
  const persistedPublicProfileAvailable = hasPersistedPublicProfile(data.athleteProfile.profile, data.athleteProfile.shareUrl);
  return (
    <div className="player-section-content space-y-3">
      <section className="app-card p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="app-label">Profile tools</div>
            <h2 className="mt-1 app-section-title">Player profile</h2>
          </div>
          <Shield className="h-5 w-5 text-primary-600" aria-hidden="true" />
        </div>
        <div className="mt-3 flex gap-1.5 overflow-x-auto rounded-2xl border border-gray-200 bg-gray-50 p-1">
          {profilePanels.map((panel) => {
            const active = activePanel === panel.id;
            return (
              <button
                key={panel.id}
                type="button"
                className={`min-h-9 flex-none rounded-xl px-3 text-xs font-black transition ${active ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-600 hover:text-gray-950'}`}
                onClick={() => setActivePanel(panel.id)}
                aria-pressed={active}
              >
                {panel.label}
              </button>
            );
          })}
        </div>
      </section>

      {activePanel === 'edit' ? <EditablePlayerProfileCard data={data} auth={auth} onChanged={onChanged} /> : null}
      {activePanel === 'athlete' ? <AthleteProfileBuilderCard data={data} auth={auth} onChanged={onChanged} /> : null}
      {activePanel === 'family' ? <CoParentInviteCard data={data} auth={auth} /> : null}
      {activePanel === 'incentives' ? <IncentivesCard data={data} auth={auth} onChanged={onChanged} /> : null}

      <section className="grid gap-3 sm:grid-cols-3">
        <a href={data.athleteProfile.builderUrl} target="_blank" rel="noreferrer" className="app-card flex items-start gap-3 p-4 transition hover:border-primary-200 hover:shadow-app-lg">
          <IconBox icon={Sparkles} />
          <CardText title="Full builder" detail="Open the legacy builder for headshot and highlight uploads." />
          <ExternalLink className="h-4 w-4 flex-none text-gray-400" aria-hidden="true" />
        </a>
        <a
          href={persistedPublicProfileUrl || '#'}
          target={persistedPublicProfileAvailable ? '_blank' : undefined}
          rel={persistedPublicProfileAvailable ? 'noreferrer' : undefined}
          aria-disabled={!persistedPublicProfileAvailable}
          tabIndex={persistedPublicProfileAvailable ? undefined : -1}
          onClick={persistedPublicProfileAvailable ? undefined : (event) => event.preventDefault()}
          className={`app-card flex items-start gap-3 p-4 transition hover:border-primary-200 hover:shadow-app-lg ${persistedPublicProfileAvailable ? '' : 'pointer-events-none opacity-60'}`}
        >
          <IconBox icon={Share2} />
          <CardText title="Public athlete profile" detail={persistedPublicProfileAvailable ? 'Open the shareable athlete profile.' : 'Save a public profile to enable sharing.'} />
          <ExternalLink className="h-4 w-4 flex-none text-gray-400" aria-hidden="true" />
        </a>
        <Link to="/parent-tools/certificates" className="app-card flex items-start gap-3 p-4 transition hover:border-primary-200 hover:shadow-app-lg">
          <IconBox icon={Award} />
          <CardText title="Certificates" detail={`${data.certificates.length} published award${data.certificates.length === 1 ? '' : 's'}.`} />
          <ChevronRight className="h-4 w-4 flex-none text-gray-400" aria-hidden="true" />
        </Link>
      </section>
    </div>
  );
}

function EditablePlayerProfileCard({ data, auth, onChanged }: { data: ParentPlayerDetailData; auth: AuthState; onChanged: () => Promise<void> }) {
  const [emergencyName, setEmergencyName] = useState(data.privateProfile?.emergencyContact?.name || '');
  const [emergencyPhone, setEmergencyPhone] = useState(data.privateProfile?.emergencyContact?.phone || '');
  const [medicalInfo, setMedicalInfo] = useState(data.privateProfile?.medicalInfo || '');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ tone: 'error' | 'success'; message: string } | null>(null);
  const playerName = data.player.name || data.child.playerName || 'Player';
  const previewUrl = useMemo(() => photoFile ? URL.createObjectURL(photoFile) : (data.player.photoUrl || ''), [photoFile, data.player.photoUrl]);

  useEffect(() => {
    return () => {
      if (previewUrl.startsWith('blob:')) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setStatus(null);
    try {
      await updateParentPlayerEditableProfile({
        user: auth.user,
        teamId: data.child.teamId,
        playerId: data.child.playerId,
        emergencyContactName: emergencyName,
        emergencyContactPhone: emergencyPhone,
        medicalInfo,
        photoFile
      });
      setPhotoFile(null);
      setStatus({ tone: 'success', message: 'Player profile saved.' });
      await onChanged();
    } catch (error: any) {
      setStatus({ tone: 'error', message: error?.message || 'Unable to save player profile.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="app-card p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-14 w-14 flex-none items-center justify-center overflow-hidden rounded-2xl bg-primary-50 text-sm font-black text-primary-700">
          {previewUrl ? <img src={previewUrl} alt="" className="h-full w-full object-cover" /> : getInitials(playerName)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-black text-gray-950">
            <Edit3 className="h-4 w-4 text-primary-600" aria-hidden="true" />
            Edit Profile
          </div>
          <p className="mt-1 text-xs font-semibold leading-5 text-gray-500">Parents can update the player photo and private emergency/medical details.</p>
        </div>
      </div>

      <form className="mt-4 space-y-3" onSubmit={submit}>
        <label className="block">
          <span className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">Player photo</span>
          <input
            type="file"
            accept="image/*"
            className="mt-1 block w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-semibold text-gray-700"
            onChange={(event) => setPhotoFile(event.currentTarget.files?.[0] || null)}
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Emergency contact" value={emergencyName} onChange={setEmergencyName} placeholder="Name" />
          <TextField label="Emergency phone" value={emergencyPhone} onChange={setEmergencyPhone} placeholder="Phone" type="tel" />
        </div>
        <label className="block">
          <span className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">Medical info / notes</span>
          <textarea
            value={medicalInfo}
            onChange={(event) => setMedicalInfo(event.currentTarget.value)}
            rows={3}
            className="mt-1 block w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-semibold text-gray-800 outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-100"
            placeholder="Allergies, conditions, or notes"
          />
        </label>
        {status ? <Status tone={status.tone} message={status.message} /> : null}
        <button type="submit" className="primary-button w-full justify-center" disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
          {saving ? 'Saving' : 'Save Profile'}
        </button>
      </form>
    </section>
  );
}

function AthleteProfileBuilderCard({ data, auth, onChanged }: { data: ParentPlayerDetailData; auth: AuthState; onChanged: () => Promise<void> }) {
  const existing = data.athleteProfile.profile;
  const currentSeasonKey = `${data.child.teamId || ''}::${data.child.playerId || ''}`;
  const seasonOptions = useMemo(() => {
    if (Array.isArray(data.athleteProfile.seasonOptions) && data.athleteProfile.seasonOptions.length) {
      return data.athleteProfile.seasonOptions;
    }
    if (!data.child.teamId || !data.child.playerId) {
      return [];
    }
    return [{
      seasonKey: currentSeasonKey,
      teamId: data.child.teamId,
      teamName: data.child.teamName || data.team?.name || 'Team',
      playerId: data.child.playerId,
      playerName: data.child.playerName || data.player.name || 'Athlete'
    }];
  }, [currentSeasonKey, data.athleteProfile.seasonOptions, data.child.playerId, data.child.playerName, data.child.teamId, data.child.teamName, data.player.name, data.team?.name]);
  const initialSelectedSeasonKeys = useMemo(() => {
    const existingKeys = Array.isArray(existing?.seasons)
      ? existing.seasons
        .map((season: any) => {
          const seasonKey = String(season?.seasonKey || '').trim();
          if (seasonKey) {
            return seasonKey;
          }
          const seasonTeamId = String(season?.teamId || '').trim();
          const seasonPlayerId = String(season?.playerId || '').trim();
          return seasonTeamId && seasonPlayerId ? `${seasonTeamId}::${seasonPlayerId}` : '';
        })
        .filter(Boolean)
      : [];
    if (existingKeys.length) {
      return [...new Set(existingKeys)];
    }
    return currentSeasonKey ? [currentSeasonKey] : [];
  }, [currentSeasonKey, existing]);
  const [name, setName] = useState(existing?.athlete?.name || data.player.name || data.child.playerName || '');
  const [headline, setHeadline] = useState(existing?.athlete?.headline || '');
  const [position, setPosition] = useState(existing?.bio?.position || '');
  const [graduationYear, setGraduationYear] = useState(existing?.bio?.graduationYear || '');
  const [hometown, setHometown] = useState(existing?.bio?.hometown || '');
  const [dominantHand, setDominantHand] = useState(existing?.bio?.dominantHand || '');
  const [achievements, setAchievements] = useState(existing?.bio?.achievements || '');
  const [privacy, setPrivacy] = useState(existing?.privacy === 'public' ? 'public' : 'private');
  const [selectedSeasonKeys, setSelectedSeasonKeys] = useState<string[]>(initialSelectedSeasonKeys);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ tone: 'error' | 'success'; message: string } | null>(null);
  const [headshotFile, setHeadshotFile] = useState<File | null>(null);
  const [headshotError, setHeadshotError] = useState('');
  const [resetHeadshot, setResetHeadshot] = useState(false);
  const [highlightClipFile, setHighlightClipFile] = useState<File | null>(null);
  const [highlightClipError, setHighlightClipError] = useState('');
  const persistedPrivacy = existing?.privacy === 'public' ? 'public' : 'private';
  const existingHeadshotUrl = existing?.profilePhotoUrl || '';
  const linkedHeadshotUrl = data.player.photoUrl || '';
  const headshotPreviewUrl = useMemo(() => {
    if (headshotFile) return URL.createObjectURL(headshotFile);
    if (resetHeadshot) return linkedHeadshotUrl;
    return existingHeadshotUrl || linkedHeadshotUrl;
  }, [existingHeadshotUrl, headshotFile, linkedHeadshotUrl, resetHeadshot]);
  const headshotLabel = headshotFile
    ? 'New headshot selected. Save to publish it.'
    : (existingHeadshotUrl && !resetHeadshot ? 'Custom athlete profile headshot' : 'Using linked season photo');
  const publicSummary = useMemo(() => {
    const items = [
      name || data.child.playerName || 'Athlete name',
      headline,
      position,
      graduationYear ? `Class of ${graduationYear}` : '',
      hometown,
      dominantHand ? `${dominantHand} hand` : '',
      achievements,
      selectedSeasonKeys.length ? `${selectedSeasonKeys.length} season${selectedSeasonKeys.length === 1 ? '' : 's'} of stats and game clips` : '',
      (existing?.clips?.length || 0) + (highlightClipFile ? 1 : 0) ? `${(existing?.clips?.length || 0) + (highlightClipFile ? 1 : 0)} highlight clip${(existing?.clips?.length || 0) + (highlightClipFile ? 1 : 0) === 1 ? '' : 's'}` : ''
    ].filter(Boolean);
    return items;
  }, [achievements, data.child.playerName, dominantHand, existing?.clips?.length, graduationYear, headline, highlightClipFile, hometown, name, position, selectedSeasonKeys.length]);
  const normalizedExistingName = existing?.athlete?.name || data.player.name || data.child.playerName || '';
  const normalizedExistingHeadline = existing?.athlete?.headline || '';
  const normalizedExistingPosition = existing?.bio?.position || '';
  const normalizedExistingGraduationYear = existing?.bio?.graduationYear || '';
  const normalizedExistingHometown = existing?.bio?.hometown || '';
  const normalizedExistingDominantHand = existing?.bio?.dominantHand || '';
  const normalizedExistingAchievements = existing?.bio?.achievements || '';
  const normalizedInitialSelectedSeasonKeys = [...initialSelectedSeasonKeys].sort();
  const normalizedSelectedSeasonKeys = [...selectedSeasonKeys].sort();
  const hasUnsavedPublishChanges = (
    privacy !== persistedPrivacy ||
    name !== normalizedExistingName ||
    headline !== normalizedExistingHeadline ||
    position !== normalizedExistingPosition ||
    graduationYear !== normalizedExistingGraduationYear ||
    hometown !== normalizedExistingHometown ||
    dominantHand !== normalizedExistingDominantHand ||
    achievements !== normalizedExistingAchievements ||
    normalizedInitialSelectedSeasonKeys.length !== normalizedSelectedSeasonKeys.length ||
    normalizedInitialSelectedSeasonKeys.some((seasonKey, index) => seasonKey !== normalizedSelectedSeasonKeys[index]) ||
    !!headshotFile ||
    resetHeadshot ||
    !!highlightClipFile
  );
  const persistedPublicProfileUrl = getPersistedPublicProfileUrl(existing, data.athleteProfile.shareUrl);
  const persistedPublicProfileAvailable = hasPersistedPublicProfile(existing, data.athleteProfile.shareUrl);
  const canPreviewPublishedPublicProfile = persistedPublicProfileAvailable && !hasUnsavedPublishChanges;
  const canSharePublicProfile = persistedPublicProfileAvailable && !hasUnsavedPublishChanges && !saving;

  useEffect(() => {
    return () => {
      if (headshotPreviewUrl.startsWith('blob:')) URL.revokeObjectURL(headshotPreviewUrl);
    };
  }, [headshotPreviewUrl]);

  useEffect(() => {
    setSelectedSeasonKeys(initialSelectedSeasonKeys);
  }, [initialSelectedSeasonKeys]);

  const toggleSeasonKey = (seasonKey: string) => {
    setSelectedSeasonKeys((current) => (
      current.includes(seasonKey)
        ? current.filter((key) => key !== seasonKey)
        : [...current, seasonKey]
    ));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (headshotError || highlightClipError) return;
    if (!selectedSeasonKeys.length) {
      setStatus({ tone: 'error', message: 'Select at least one linked season to build an athlete profile.' });
      return;
    }
    setSaving(true);
    setStatus(null);
    try {
      await saveParentAthleteProfileDraft({
        user: auth.user,
        teamId: data.child.teamId,
        playerId: data.child.playerId,
        profileId: existing?.id || null,
        draft: {
          athlete: { name, headline },
          bio: { position, graduationYear, hometown, dominantHand, achievements },
          privacy,
          selectedSeasonKeys,
          clips: existing?.clips || [],
          profilePhoto: existing?.profilePhotoUrl ? {
            url: existing.profilePhotoUrl,
            storagePath: existing.profilePhotoPath,
            mimeType: existing.profilePhotoMimeType,
            sizeBytes: existing.profilePhotoSizeBytes,
            uploadedAtMs: existing.profilePhotoUploadedAtMs
          } : null
        },
        profilePhotoFile: headshotFile,
        resetProfilePhoto: resetHeadshot,
        highlightClipFile
      });
      setHeadshotFile(null);
      setResetHeadshot(false);
      setHighlightClipFile(null);
      setStatus({ tone: 'success', message: 'Athlete profile saved.' });
      await onChanged();
    } catch (error: any) {
      setStatus({ tone: 'error', message: error?.message || 'Unable to save athlete profile.' });
    } finally {
      setSaving(false);
    }
  };

  const shareProfile = async () => {
    if (!canSharePublicProfile) return;
    try {
      const result = await sharePublicUrl({
        title: `${name || data.child.playerName || 'Athlete'} profile`,
        text: 'Take a look at this athlete profile on ALL PLAYS.',
        url: persistedPublicProfileUrl
      });
      if (result === 'shared') {
        setStatus({ tone: 'success', message: 'Public athlete profile shared.' });
        return;
      }
      if (result === 'copied') {
        setStatus({ tone: 'success', message: 'Public athlete profile link copied.' });
        return;
      }
      if (result === 'cancelled') {
        return;
      }
      setStatus({ tone: 'error', message: 'Unable to share the public athlete profile right now.' });
    } catch (error: any) {
      setStatus({ tone: 'error', message: error?.message || 'Unable to share the public athlete profile right now.' });
    }
  };

  return (
    <section className="app-card athlete-profile-editor p-3 sm:p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-black text-primary-800">
            <Sparkles className="h-4 w-4 flex-none" aria-hidden="true" />
            <span className="truncate">Athlete Profile Builder</span>
          </div>
          <p className="mt-1 text-xs font-semibold leading-5 text-gray-500">Native quick edit for the parent-managed public profile, including the public headshot and one highlight clip.</p>
        </div>
        {status?.tone === 'success' ? (
          <span className="flex-none rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.04em] text-emerald-700">Saved</span>
        ) : null}
      </div>
      <form className="mt-4 space-y-3" onSubmit={submit}>
        <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3">
          <div className="flex items-center gap-3">
            <div className="flex h-16 w-16 flex-none items-center justify-center overflow-hidden rounded-2xl bg-white text-sm font-black text-primary-700">
              {headshotPreviewUrl ? <img src={headshotPreviewUrl} alt="Athlete profile headshot preview" className="h-full w-full object-cover" /> : getInitials(name || data.child.playerName || 'Athlete')}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">Public headshot</div>
              <p className="mt-1 text-sm font-semibold text-gray-700">{headshotLabel}</p>
              {headshotFile ? <p className="mt-1 text-xs font-semibold text-primary-700">{headshotFile.name}</p> : null}
            </div>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <label className="secondary-button justify-center">
              <span>Choose headshot</span>
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0] || null;
                  if (file && !String(file.type || '').startsWith('image/')) {
                    setHeadshotFile(null);
                    setHeadshotError('Choose an image file for the athlete headshot.');
                    return;
                  }
                  setHeadshotFile(file);
                  setResetHeadshot(false);
                  setHeadshotError('');
                }}
              />
            </label>
            <button
              type="button"
              className="secondary-button justify-center"
              onClick={() => {
                setHeadshotFile(null);
                setResetHeadshot(true);
                setHeadshotError('');
              }}
            >
              Use linked season photo
            </button>
          </div>
          {headshotError ? <p className="mt-2 text-xs font-bold text-rose-600">{headshotError}</p> : null}
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-3">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 flex-none items-center justify-center rounded-2xl bg-primary-50 text-primary-700">
              <FileVideo className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">Manual highlight clip</div>
              <p className="mt-1 text-sm font-semibold text-gray-700">Add one image or video highlight. It publishes when you save.</p>
              {highlightClipFile ? <p className="mt-1 truncate text-xs font-semibold text-primary-700">{highlightClipFile.name} selected. Save to publish it.</p> : null}
              {existing?.clips?.length ? <p className="mt-1 text-xs font-semibold text-gray-500">Existing clips stay on the profile.</p> : null}
            </div>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <label className="secondary-button justify-center">
              <span>Choose highlight clip</span>
              <input
                type="file"
                accept="video/*,image/*"
                className="sr-only"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0] || null;
                  if (file) {
                    const fileType = String(file.type || '');
                    if (!fileType.startsWith('image/') && !fileType.startsWith('video/')) {
                      setHighlightClipFile(null);
                      setHighlightClipError('Choose an image or video file for the highlight clip.');
                      return;
                    }
                    if (file.size > 100 * 1024 * 1024) {
                      setHighlightClipFile(null);
                      setHighlightClipError('Choose a highlight clip under 100 MB.');
                      return;
                    }
                  }
                  setHighlightClipFile(file);
                  setHighlightClipError('');
                }}
              />
            </label>
            <button
              type="button"
              className="secondary-button justify-center"
              disabled={!highlightClipFile && !highlightClipError}
              onClick={() => {
                setHighlightClipFile(null);
                setHighlightClipError('');
              }}
            >
              Clear selected clip
            </button>
          </div>
          {highlightClipError ? <p className="mt-2 text-xs font-bold text-rose-600">{highlightClipError}</p> : null}
        </div>
        <div className="athlete-profile-grid grid gap-3 sm:grid-cols-2">
          <TextField label="Athlete name" value={name} onChange={setName} placeholder="Athlete name" />
          <TextField label="Headline" value={headline} onChange={setHeadline} placeholder="2028 Guard" />
          <TextField label="Position" value={position} onChange={setPosition} placeholder="Guard / Wing" />
          <TextField label="Graduation year" value={graduationYear} onChange={setGraduationYear} placeholder="2028" />
          <TextField label="Hometown" value={hometown} onChange={setHometown} placeholder="Kansas City, MO" />
          <TextField label="Dominant hand" value={dominantHand} onChange={setDominantHand} placeholder="Right" />
        </div>
        <label className="block">
          <span className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">Achievements</span>
          <textarea
            value={achievements}
            onChange={(event) => setAchievements(event.currentTarget.value)}
            rows={3}
            className="mt-1 block w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-semibold text-gray-800 outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-100"
            placeholder="Captains, honors, goals, recruiting notes"
          />
        </label>
        <div className="rounded-2xl border border-gray-200 bg-white p-3">
          <div className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">Selected seasons</div>
          <p className="mt-1 text-sm font-semibold text-gray-700">Choose which linked seasons roll into the public athlete profile.</p>
          <div className="mt-3 space-y-2">
            {seasonOptions.map((option) => {
              const checked = selectedSeasonKeys.includes(option.seasonKey);
              return (
                <label key={option.seasonKey} className={`flex items-start gap-3 rounded-xl border p-3 ${checked ? 'border-primary-300 bg-primary-50' : 'border-gray-200 bg-gray-50'}`}>
                  <input
                    type="checkbox"
                    aria-label={`${option.playerName} ${option.teamName}`}
                    checked={checked}
                    onChange={() => toggleSeasonKey(option.seasonKey)}
                    className="mt-1 h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-black text-gray-900">{option.playerName}</span>
                    <span className="block text-xs font-semibold text-gray-500">{option.teamName}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </div>
        <div className="rounded-2xl border border-primary-100 bg-primary-50/60 p-3">
          <div className="text-xs font-black uppercase tracking-[0.04em] text-primary-700">What others see</div>
          <p className="mt-1 text-sm font-semibold text-gray-700">Publishing makes this read-only athlete profile public at the share link.</p>
          <ul className="mt-3 space-y-1 text-xs font-semibold text-gray-600">
            {publicSummary.map((item) => <li key={item}>• {item}</li>)}
          </ul>
          <p className="mt-3 text-xs font-semibold text-gray-500">Private keeps the profile off the public page. Public matches the legacy athlete profile share behavior.</p>
        </div>
        <div className="athlete-profile-privacy grid grid-cols-2 gap-2">
          {(['private', 'public'] as const).map((option) => (
            <button
              key={option}
              type="button"
              className={`min-h-11 rounded-xl border px-3 text-sm font-black capitalize ${privacy === option ? 'border-primary-300 bg-primary-50 text-primary-700' : 'border-gray-200 bg-white text-gray-600'}`}
              onClick={() => setPrivacy(option)}
            >
              {option}
            </button>
          ))}
        </div>
        {status?.tone === 'error' ? <Status tone={status.tone} message={status.message} /> : null}
        <div className="athlete-profile-actions grid gap-2 sm:grid-cols-2">
          <button type="submit" className="primary-button justify-center" disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
            {saving ? 'Saving' : privacy === 'public' ? 'Publish Athlete Profile' : 'Save Athlete Profile'}
          </button>
          {canSharePublicProfile ? (
            <button type="button" className="secondary-button justify-center" onClick={shareProfile}>
              <Share2 className="h-4 w-4" aria-hidden="true" />
              Share Public Profile
            </button>
          ) : hasUnsavedPublishChanges ? (
            <button type="button" className="secondary-button justify-center" disabled>
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
              Save to publish before sharing
            </button>
          ) : (
            <a href={canPreviewPublishedPublicProfile ? persistedPublicProfileUrl : data.athleteProfile.builderUrl} target="_blank" rel="noreferrer" className="secondary-button justify-center">
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
              {canPreviewPublishedPublicProfile ? 'Preview Public Page' : 'Open Full Builder'}
            </a>
          )}
        </div>
        {privacy === 'public' && hasUnsavedPublishChanges ? (
          <p className="text-center text-xs font-semibold text-gray-500">Publish this profile before the public share link becomes available.</p>
        ) : null}
      </form>
    </section>
  );
}

function CoParentInviteCard({ data, auth }: { data: ParentPlayerDetailData; auth: AuthState }) {
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<{ tone: 'error' | 'success'; message: string } | null>(null);
  const [code, setCode] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSending(true);
    setStatus(null);
    setCode('');
    try {
      const result = await sendParentCoParentInvite({
        user: auth.user,
        teamId: data.child.teamId,
        playerId: data.child.playerId,
        playerName: data.player.name || data.child.playerName,
        email
      });
      setCode(result?.code || '');
      setStatus({ tone: 'success', message: `Invite created for ${email.trim().toLowerCase()}.` });
      setEmail('');
    } catch (error: any) {
      setStatus({ tone: 'error', message: error?.message || 'Unable to send co-parent invite.' });
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="app-card p-4">
      <div className="flex items-center gap-2 text-sm font-black text-primary-800">
        <Users className="h-4 w-4" aria-hidden="true" />
        Invite Co-Parent
      </div>
      <p className="mt-1 text-xs font-semibold leading-5 text-gray-500">Creates the same co-parent invite code as the parent dashboard.</p>
      <form className="mt-4 space-y-3" onSubmit={submit}>
        <TextField label="Co-parent email" value={email} onChange={setEmail} placeholder="co-parent@example.com" type="email" />
        {status ? <Status tone={status.tone} message={status.message} /> : null}
        {code ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
            <div className="text-xs font-black uppercase tracking-[0.04em] text-emerald-700">Invite code</div>
            <div className="mt-1 font-mono text-lg font-black text-emerald-950">{code}</div>
          </div>
        ) : null}
        <button type="submit" className="primary-button w-full justify-center" disabled={sending}>
          {sending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Mail className="h-4 w-4" aria-hidden="true" />}
          {sending ? 'Creating Invite' : 'Create Invite'}
        </button>
      </form>
    </section>
  );
}

type IncentivePanelId = 'overview' | 'rules' | 'history';

const incentivePanels: Array<{ id: IncentivePanelId; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'rules', label: 'Rules' },
  { id: 'history', label: 'Payouts' }
];

function IncentivesCard({ data, auth, onChanged }: { data: ParentPlayerDetailData; auth: AuthState; onChanged: () => Promise<void> }) {
  const incentives = data.incentives;
  const statOptions = incentives.statOptions.length ? incentives.statOptions : defaultStatOptions;
  const activeRules = incentives.currentRules.filter((rule) => rule.active !== false);
  const pendingEarnings = incentives.seasonGameEarnings.filter((earning) => !earning.paid && earning.totalCents !== 0);
  const hasRules = incentives.currentRules.length > 0;
  const hasHistory = incentives.seasonGameEarnings.length > 0;
  const [activePanel, setActivePanel] = useState<IncentivePanelId>(pendingEarnings.length ? 'overview' : (hasRules ? 'rules' : 'overview'));
  const [builderOpen, setBuilderOpen] = useState(!hasRules);
  const [statKey, setStatKey] = useState(statOptions[0]?.key || 'pts');
  const [type, setType] = useState<'per_unit' | 'threshold'>('per_unit');
  const [amount, setAmount] = useState('1.00');
  const [threshold, setThreshold] = useState('3');
  const [thresholdOp, setThresholdOp] = useState<'gt' | 'gte'>('gt');
  const [editingRule, setEditingRule] = useState<Record<string, any> | null>(null);
  const [cap, setCap] = useState(incentives.maxPerGameCents !== null ? String(Math.round(incentives.maxPerGameCents / 100)) : '');
  const [busy, setBusy] = useState('');
  const [status, setStatus] = useState<{ tone: 'error' | 'success'; message: string } | null>(null);

  useEffect(() => {
    setCap(incentives.maxPerGameCents !== null ? String(Math.round(incentives.maxPerGameCents / 100)) : '');
  }, [incentives.maxPerGameCents]);

  const run = async (label: string, action: () => Promise<unknown>, success = 'Incentives updated.') => {
    setBusy(label);
    setStatus(null);
    try {
      await action();
      setStatus({ tone: 'success', message: success });
      await onChanged();
    } catch (error: any) {
      setStatus({ tone: 'error', message: error?.message || 'Unable to update incentives.' });
    } finally {
      setBusy('');
    }
  };

  const saveRule = () => run('rule', async () => {
    const amountCents = Math.round(Number(amount || 0) * 100);
    if (!statKey || !Number.isFinite(amountCents) || amountCents === 0) {
      throw new Error('Choose a stat and enter a non-zero amount.');
    }
    const thresholdValue = Number(threshold || 0);
    if (type === 'threshold' && (!Number.isFinite(thresholdValue) || thresholdValue <= 0)) {
      throw new Error('Enter the stat target for this bonus.');
    }
    await saveParentPlayerIncentiveRule({
      user: auth.user,
      teamId: data.child.teamId,
      playerId: data.child.playerId,
      playerName: data.player.name || data.child.playerName,
      rule: {
        ...(editingRule?.id ? { id: editingRule.id } : {}),
        statKey,
        type,
        amountCents,
        threshold: type === 'threshold' ? thresholdValue : null,
        thresholdOp,
        active: editingRule ? editingRule.active !== false : true
      }
    });
    closeBuilder();
  }, editingRule ? 'Rule saved.' : 'Rule added.');

  const startNewRule = () => {
    setEditingRule(null);
    setStatKey(statOptions[0]?.key || 'pts');
    setType('per_unit');
    setAmount('1.00');
    setThreshold('3');
    setThresholdOp('gt');
    setBuilderOpen(true);
    setActivePanel('rules');
  };

  const closeBuilder = () => {
    setEditingRule(null);
    setBuilderOpen(false);
  };

  const editRule = (rule: Record<string, any>) => {
    setEditingRule(rule);
    setStatKey(rule.statKey || statOptions[0]?.key || 'pts');
    setType(rule.type === 'threshold' ? 'threshold' : 'per_unit');
    setAmount((Number(rule.amountCents || 0) / 100).toFixed(2));
    setThreshold(String(rule.threshold || 3));
    setThresholdOp(rule.thresholdOp === 'gte' ? 'gte' : 'gt');
    setBuilderOpen(true);
    setActivePanel('rules');
  };

  const saveCap = () => run('cap', async () => {
    const raw = cap.trim();
    const numeric = raw ? Number(raw) : null;
    if (raw && (!Number.isFinite(numeric) || Number(numeric) < 0)) throw new Error('Enter a valid cap amount.');
    const cents = numeric === null ? null : Math.round(Number(numeric) * 100);
    await saveParentPlayerIncentiveCap(auth.user, data.child.teamId, data.child.playerId, cents);
  });

  const removeCap = () => run('cap-remove', async () => {
    setCap('');
    await saveParentPlayerIncentiveCap(auth.user, data.child.teamId, data.child.playerId, null);
  }, 'Game limit removed.');

  const openPayouts = () => {
    setActivePanel('history');
    window.requestAnimationFrame(() => {
      document.getElementById('player-incentive-content')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
  };

  const ruleDraftPreview = formatIncentiveDraft({
    statKey,
    type,
    amountCents: Math.round(Number(amount || 0) * 100),
    threshold,
    thresholdOp
  }, statOptions);

  return (
    <section className="app-card overflow-hidden">
      <div className="bg-[linear-gradient(135deg,#111827_0%,#4338ca_52%,#047857_100%)] p-4 text-white">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.06em] text-white/70">
              <DollarSign className="h-4 w-4" aria-hidden="true" />
              Incentive wallet
            </div>
            <div className="mt-3 text-3xl font-black leading-none">{formatMoney(Math.max(incentives.unpaidCents, 0), false)}</div>
            <div className="mt-1 text-sm font-bold text-white/80">
              {pendingEarnings.length ? `${pendingEarnings.length} game${pendingEarnings.length === 1 ? '' : 's'} ready to settle` : 'No unpaid game payouts'}
            </div>
          </div>
          <button type="button" className="inline-flex min-h-9 flex-none items-center justify-center gap-2 rounded-xl bg-white/95 px-3 text-xs font-black text-gray-950 shadow-sm" onClick={startNewRule}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Rule
          </button>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <MiniMoney label="Earned" cents={incentives.totalEarnedCents} inverse />
          <MiniMoney label="Paid" cents={incentives.totalPaidCents} inverse />
          <MiniMoney label="Active rules" value={String(activeRules.length)} inverse />
        </div>
      </div>

      {status ? <div className="px-4 pt-4"><Status tone={status.tone} message={status.message} /></div> : null}

      <div className="border-b border-gray-100 px-3 pt-3">
        <div className="flex gap-1 overflow-x-auto rounded-2xl border border-gray-200 bg-gray-50 p-1">
          {incentivePanels.map((panel) => {
            const active = activePanel === panel.id;
            return (
              <button
                key={panel.id}
                type="button"
                className={`min-h-9 flex-1 rounded-xl px-3 text-xs font-black transition ${active ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-600 hover:text-gray-950'}`}
                onClick={() => setActivePanel(panel.id)}
                aria-pressed={active}
              >
                {panel.label}
              </button>
            );
          })}
        </div>
      </div>

      <div id="player-incentive-content" className="space-y-4 p-4">
        {activePanel === 'overview' ? (
          <>
            {pendingEarnings.length ? (
              <button type="button" className="flex w-full items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-left" onClick={openPayouts}>
                <span className="min-w-0">
                  <span className="block text-sm font-black text-amber-950">Payouts need attention</span>
                  <span className="mt-0.5 block truncate text-xs font-semibold text-amber-700">{getScheduleTitle(pendingEarnings[0].event)} · {formatMoney(pendingEarnings[0].totalCents)}</span>
                </span>
                <ChevronRight className="h-5 w-5 flex-none text-amber-700" aria-hidden="true" />
              </button>
            ) : (
              <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                <CheckCircle2 className="mt-0.5 h-5 w-5 flex-none text-emerald-700" aria-hidden="true" />
                <div>
                  <div className="text-sm font-black text-emerald-900">Payouts are current</div>
                  <div className="mt-0.5 text-xs font-semibold text-emerald-700">{hasHistory ? 'Every tracked game is settled.' : 'Game payouts appear here after stats are tracked.'}</div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-3 gap-2">
              <MiniMoney label="Earned" cents={incentives.totalEarnedCents} />
              <MiniMoney label="Paid" cents={incentives.totalPaidCents} />
              <MiniMoney label="Unpaid" cents={incentives.unpaidCents} warn={incentives.unpaidCents > 0} />
            </div>

            <div className="rounded-xl border border-gray-200 bg-white p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-black text-gray-950">Active rules</div>
                  <div className="mt-0.5 text-xs font-semibold text-gray-500">{activeRules.length ? `${activeRules.length} rule${activeRules.length === 1 ? '' : 's'} applying to future games` : 'No active rules yet'}</div>
                </div>
                <button type="button" className="secondary-button !min-h-9 text-xs" onClick={startNewRule}>
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Add
                </button>
              </div>
              {activeRules.length ? (
                <div className="mt-3 space-y-2">
                  {activeRules.slice(0, 2).map((rule) => (
                    <div key={rule.id} className="flex items-center justify-between gap-3 rounded-lg bg-gray-50 px-3 py-2">
                      <span className="truncate text-xs font-black text-gray-800">{formatIncentiveRule(rule, statOptions)}</span>
                      <button type="button" className="text-xs font-black text-primary-700" onClick={() => editRule(rule)}>Edit</button>
                    </div>
                  ))}
                  {activeRules.length > 2 ? <button type="button" className="text-xs font-black text-primary-700" onClick={() => setActivePanel('rules')}>View all rules</button> : null}
                </div>
              ) : (
                <div className="mt-3 rounded-lg border border-dashed border-gray-200 bg-gray-50 p-3 text-xs font-semibold text-gray-500">Create a rule for tracked stats such as points, assists, goals, or custom team stats.</div>
              )}
            </div>

            <button type="button" className="flex w-full items-center justify-between rounded-xl border border-gray-200 bg-gray-50 p-3 text-left" onClick={() => setActivePanel('rules')}>
              <span>
                <span className="block text-sm font-black text-gray-950">Game limit</span>
                <span className="mt-0.5 block text-xs font-semibold text-gray-500">{incentives.maxPerGameCents !== null ? `Capped at ${formatMoney(incentives.maxPerGameCents, false)} per game` : 'No max per game'}</span>
              </span>
              <ChevronRight className="h-5 w-5 text-gray-400" aria-hidden="true" />
            </button>
          </>
        ) : null}

        {activePanel === 'rules' ? (
          <>
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-black text-gray-950">Rules and limits</h3>
                <p className="mt-0.5 text-xs font-semibold text-gray-500">Rules apply to future tracked games.</p>
              </div>
              {!builderOpen ? (
                <button type="button" className="secondary-button !min-h-9 text-xs" onClick={startNewRule}>
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Add Rule
                </button>
              ) : null}
            </div>

            {builderOpen ? (
              <div className="rounded-xl border border-primary-200 bg-primary-50 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-black text-primary-950">{editingRule ? 'Edit rule' : 'New rule'}</div>
                    <div className="mt-0.5 text-xs font-semibold text-primary-700">{ruleDraftPreview}</div>
                  </div>
                  {hasRules ? <button type="button" className="text-xs font-black text-primary-700" onClick={closeBuilder}>Cancel</button> : null}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {statOptions.map((option) => (
                    <button key={option.key} type="button" className={`rounded-lg border px-2.5 py-1.5 text-xs font-black ${statKey === option.key ? 'border-primary-500 bg-primary-600 text-white' : 'border-gray-200 bg-white text-gray-600'}`} onClick={() => setStatKey(option.key)}>
                      {option.label}
                    </button>
                  ))}
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <label className="block">
                    <span className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">Type</span>
                    <select value={type} onChange={(event) => setType(event.currentTarget.value as 'per_unit' | 'threshold')} className="mt-1 block min-h-10 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-800">
                      <option value="per_unit">Per stat</option>
                      <option value="threshold">Goal bonus</option>
                    </select>
                  </label>
                  <TextField label={type === 'threshold' ? 'Bonus amount' : 'Amount'} value={amount} onChange={setAmount} placeholder="1.00" type="number" />
                </div>
                {type === 'threshold' ? (
                  <div className="mt-2 grid grid-cols-[1fr_1fr] gap-2">
                    <label className="block">
                      <span className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">Condition</span>
                      <select value={thresholdOp} onChange={(event) => setThresholdOp(event.currentTarget.value as 'gt' | 'gte')} className="mt-1 block min-h-10 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-800">
                        <option value="gt">Greater than</option>
                        <option value="gte">At least</option>
                      </select>
                    </label>
                    <TextField label="Target" value={threshold} onChange={setThreshold} placeholder="3" type="number" />
                  </div>
                ) : null}
                <button type="button" className="primary-button mt-3 w-full justify-center" disabled={busy === 'rule'} onClick={saveRule}>
                  {busy === 'rule' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
                  {editingRule ? 'Save Rule' : 'Add Rule'}
                </button>
              </div>
            ) : null}

            <div className="space-y-2">
              {incentives.currentRules.length ? incentives.currentRules.map((rule) => (
                <div key={rule.id} className={`rounded-xl border p-3 ${rule.active === false ? 'border-gray-200 bg-gray-50' : 'border-gray-200 bg-white'}`}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className={`truncate text-sm font-black ${rule.active === false ? 'text-gray-500' : 'text-gray-950'}`}>{formatIncentiveRule(rule, statOptions)}</div>
                      <div className={`mt-0.5 text-xs font-bold ${rule.active === false ? 'text-gray-400' : 'text-emerald-700'}`}>{rule.active === false ? 'Disabled for future games' : 'Active for future games'}</div>
                    </div>
                    <div className="flex flex-none gap-1">
                      <button type="button" className="ghost-button !h-8 !min-h-8 !px-2 text-xs" onClick={() => editRule(rule)}>
                        <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                        Edit
                      </button>
                      <button type="button" className="ghost-button !h-8 !min-h-8 !px-2 text-xs" disabled={busy === `toggle-${rule.id}`} onClick={() => run(`toggle-${rule.id}`, () => toggleParentPlayerIncentiveRule(auth.user, data.child.teamId, data.child.playerId, rule))}>{rule.active === false ? 'Enable' : 'Disable'}</button>
                      <button type="button" className="ghost-button !h-8 !min-h-8 !px-2 text-xs" disabled={busy === `retire-${rule.id}`} onClick={() => run(`retire-${rule.id}`, () => retireParentPlayerIncentiveRule(auth.user, data.child.teamId, data.child.playerId, rule.id), 'Rule stopped.')}>
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </div>
              )) : <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-4 text-center text-sm font-semibold text-gray-500">No incentive rules yet.</div>}
            </div>

            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-black text-gray-950">Max earned per game</div>
                  <div className="mt-0.5 text-xs font-semibold text-gray-500">Optional parent-only limit across all rules.</div>
                </div>
                {incentives.maxPerGameCents !== null ? <button type="button" className="text-xs font-black text-rose-600" disabled={busy === 'cap-remove'} onClick={removeCap}>Remove</button> : null}
              </div>
              <div className="mt-3 flex items-end gap-2">
                <div className="min-w-0 flex-1">
                  <TextField label="Limit" value={cap} onChange={setCap} placeholder="No cap" type="number" />
                </div>
                <button type="button" className="secondary-button !min-h-10" disabled={busy === 'cap'} onClick={saveCap}>
                  {busy === 'cap' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                  Save
                </button>
              </div>
            </div>
          </>
        ) : null}

        {activePanel === 'history' ? (
          <>
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-black text-gray-950">Game payouts</h3>
                <p className="mt-0.5 text-xs font-semibold text-gray-500">{hasHistory ? `${incentives.seasonGameEarnings.length} tracked game${incentives.seasonGameEarnings.length === 1 ? '' : 's'}` : 'No tracked games yet.'}</p>
              </div>
              <MiniMoney label="Unpaid" cents={incentives.unpaidCents} warn={incentives.unpaidCents > 0} />
            </div>
            {incentives.seasonGameEarnings.length ? (
              <div className="space-y-2">
                {incentives.seasonGameEarnings.map((earning) => (
                  <div key={earning.event.eventKey} className="rounded-xl border border-gray-200 bg-white p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-black text-gray-950">{getScheduleTitle(earning.event)}</div>
                        <div className="mt-0.5 text-xs font-semibold text-gray-500">{formatEventDateLabel(earning.event.date)}{earning.wasCapped ? ` · capped at ${formatMoney(earning.totalCents, false)}` : ''}</div>
                      </div>
                      <div className="text-right">
                        <div className={`text-sm font-black ${earning.totalCents >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{formatMoney(earning.totalCents)}</div>
                        {earning.paid ? <div className="text-xs font-black text-emerald-700">Paid</div> : <div className="text-xs font-black text-amber-700">Unpaid</div>}
                      </div>
                    </div>
                    {earning.breakdown.length ? (
                      <div className="mt-3 space-y-1 rounded-lg bg-gray-50 px-3 py-2">
                        {earning.breakdown.slice(0, 4).map((line, index) => (
                          <div key={`${earning.event.eventKey}-${index}`} className="text-xs font-semibold text-gray-600">{formatIncentiveBreakdownLine(line)}</div>
                        ))}
                      </div>
                    ) : null}
                    {!earning.paid && earning.totalCents !== 0 ? (
                      <button type="button" className="secondary-button mt-2 !min-h-9 w-full justify-center text-xs" disabled={busy === `paid-${earning.event.id}`} onClick={() => run(`paid-${earning.event.id}`, () => markParentPlayerIncentivePaid(auth.user, data.child.teamId, data.child.playerId, earning.event.id, earning.totalCents), 'Marked paid.')}>
                        {busy === `paid-${earning.event.id}` ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
                        Mark Paid
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-4 text-center text-sm font-semibold text-gray-500">Game payouts appear after tracked games have stats.</div>
            )}
          </>
        ) : null}
      </div>
    </section>
  );
}

function TextField({ label, value, onChange, placeholder = '', type = 'text' }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: string }) {
  return (
    <label className="block">
      <span className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        placeholder={placeholder}
        className="mt-1 block w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-semibold text-gray-800 outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-100"
      />
    </label>
  );
}

function MiniMoney({ label, cents = 0, value, warn = false, inverse = false }: { label: string; cents?: number; value?: string; warn?: boolean; inverse?: boolean }) {
  const display = typeof value === 'string' ? value : formatMoney(cents, false);
  return (
    <div className={`rounded-xl border p-3 text-center ${inverse ? 'border-white/15 bg-white/10' : warn ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-gray-50'}`}>
      <div className={`text-base font-black ${inverse ? 'text-white' : warn ? 'text-amber-800' : 'text-gray-950'}`}>{display}</div>
      <div className={`mt-0.5 text-[10px] font-black uppercase tracking-[0.04em] ${inverse ? 'text-white/65' : 'text-gray-500'}`}>{label}</div>
    </div>
  );
}

function PlayerEventCard({ event, featured = false }: { event: ParentScheduleEvent; featured?: boolean }) {
  const rsvp = normalizeRsvpResponse(event.myRsvp);
  const openAssignments = getOpenScheduleAssignments(event.assignments).length;
  return (
    <Link to={getEventDetailPath(event)} className={`app-card block p-3 transition hover:border-primary-200 hover:shadow-app-lg ${featured ? 'border-primary-100' : ''}`}>
      <div className="flex items-start gap-3">
        <DateTile date={event.date} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-xs font-black uppercase tracking-[0.04em] text-gray-500">{event.teamName}</span>
            <span className={`flex-none rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${event.type === 'practice' ? 'bg-amber-100 text-amber-800' : 'bg-primary-100 text-primary-800'}`}>{event.type}</span>
          </div>
          <h3 className="mt-1 truncate text-base font-black text-gray-950">{getScheduleTitle(event)}</h3>
          <div className="mt-0.5 truncate text-xs font-semibold text-gray-500">{formatEventTimeLabel(event.date)} · {event.location || 'TBD'}</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.04em] ${rsvpBadgeClasses[rsvp]}`}>{rsvp === 'not_responded' ? 'RSVP' : rsvp.replace('_', ' ')}</span>
            {event.practiceHomePacketSummary ? <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.04em] text-blue-700">Packet</span> : null}
            {openAssignments ? <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.04em] text-emerald-700">{openAssignments} tasks</span> : null}
          </div>
        </div>
        <ChevronRight className="mt-1 h-5 w-5 flex-none text-gray-400" aria-hidden="true" />
      </div>
    </Link>
  );
}

function StatRow({ row }: { row: ParentPlayerStatRow }) {
  const statEntries = Object.entries(row.stats || {})
    .filter(([, value]) => Number.isFinite(Number(value)))
    .slice(0, 5);
  return (
    <Link to={getEventDetailPath(row.event, 'game')} className="block rounded-xl border border-gray-200 bg-gray-50 p-3 transition hover:border-primary-200 hover:bg-primary-50/40">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-black text-gray-950">{getScheduleTitle(row.event)}</div>
          <div className="mt-0.5 truncate text-xs font-semibold text-gray-500">{formatEventDateLabel(row.event.date)}</div>
        </div>
        <ChevronRight className="h-4 w-4 flex-none text-gray-400" aria-hidden="true" />
      </div>
      {statEntries.length ? (
        <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
          {statEntries.map(([key, value]) => (
            <div key={key} className="rounded-lg border border-gray-200 bg-white p-2 text-center">
              <div className="text-base font-black text-gray-950">{String(value)}</div>
              <div className="mt-0.5 truncate text-[10px] font-black uppercase tracking-[0.04em] text-gray-500">{key}</div>
            </div>
          ))}
        </div>
      ) : <div className="mt-2 text-xs font-semibold text-gray-500">No stat line recorded.</div>}
    </Link>
  );
}

function SignalChip({ icon: Icon, label, value, urgent = false }: { icon: LucideIcon; label: string; value: string; urgent?: boolean }) {
  return (
    <div className={`flex min-h-7 flex-none items-center gap-1.5 rounded-full border px-2.5 text-xs font-black ${urgent ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-gray-200 bg-gray-50 text-gray-700'}`}>
      <Icon className={`h-3.5 w-3.5 ${urgent ? 'text-amber-700' : 'text-primary-600'}`} aria-hidden="true" />
      <span>{label}</span>
      <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${urgent ? 'bg-amber-200/70 text-amber-950' : 'bg-white text-gray-950'}`}>{value}</span>
    </div>
  );
}

function InfoCard({ icon: Icon, title, detail }: { icon: LucideIcon; title: string; detail: string }) {
  return (
    <div className="app-card p-4">
      <Icon className="h-5 w-5 text-primary-600" aria-hidden="true" />
      <div className="mt-3 text-sm font-black text-gray-950">{title}</div>
      <div className="mt-1 text-xs font-semibold leading-5 text-gray-600">{detail}</div>
    </div>
  );
}

function EmptyCard({ icon: Icon, title, detail }: { icon: LucideIcon; title: string; detail: string }) {
  return (
    <section className="app-card p-5 text-center">
      <Icon className="mx-auto h-8 w-8 text-gray-300" aria-hidden="true" />
      <div className="mt-3 text-sm font-black text-gray-900">{title}</div>
      <div className="mt-1 text-xs font-semibold text-gray-500">{detail}</div>
    </section>
  );
}

function DateTile({ date }: { date: Date }) {
  return (
    <div className="flex h-12 w-12 flex-none flex-col items-center justify-center rounded-xl bg-gray-50 shadow-inner ring-1 ring-gray-200">
      <div className="text-[10px] font-black uppercase leading-none tracking-[0.06em] text-gray-500">{date.toLocaleDateString('en-US', { month: 'short' })}</div>
      <div className="mt-0.5 text-lg font-black leading-none text-gray-950">{date.getDate()}</div>
      <div className="mt-0.5 text-[10px] font-black uppercase leading-none tracking-[0.06em] text-gray-500">{date.toLocaleDateString('en-US', { weekday: 'short' })}</div>
    </div>
  );
}

function IconBox({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <div className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-primary-50 text-primary-700">
      <Icon className="h-5 w-5" aria-hidden="true" />
    </div>
  );
}

function CardText({ title, detail }: { title: string; detail: string }) {
  return (
    <span className="min-w-0 flex-1">
      <span className="block text-sm font-black text-gray-950">{title}</span>
      <span className="mt-1 block text-xs font-semibold leading-5 text-gray-600">{detail}</span>
    </span>
  );
}

function Status({ tone, message }: { tone: 'error' | 'success'; message: string }) {
  const isError = tone === 'error';
  return (
    <div className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-sm font-semibold ${isError ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
      {isError ? <AlertCircle className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />}
      {message}
    </div>
  );
}

const defaultStatOptions = [
  { key: 'pts', label: 'PTS' },
  { key: 'reb', label: 'REB' },
  { key: 'ast', label: 'AST' },
  { key: 'stl', label: 'STL' },
  { key: 'blk', label: 'BLK' },
  { key: 'to', label: 'TO' },
  { key: 'fouls', label: 'FOULS' }
];

function getSeasonAverages(rows: ParentPlayerStatRow[]) {
  const totals = new Map<string, number>();
  rows.forEach((row) => {
    Object.entries(row.stats || {}).forEach(([key, value]) => {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return;
      totals.set(key, (totals.get(key) || 0) + numeric);
    });
  });
  const games = Math.max(rows.length, 1);
  return [...totals.entries()]
    .map(([key, total]) => [key.toUpperCase(), formatAverage(total / games)] as [string, string])
    .slice(0, 8);
}

function formatAverage(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatMoney(cents: number, sign = true) {
  const safeCents = Number.isFinite(Number(cents)) ? Number(cents) : 0;
  const dollars = `$${(Math.abs(safeCents) / 100).toFixed(2)}`;
  if (!sign) return dollars;
  return safeCents >= 0 ? `+${dollars}` : `-${dollars}`;
}

function getIncentiveStatLabel(statOptions: Array<{ key: string; label: string }>, statKey: string) {
  return statOptions.find((option) => option.key === statKey)?.label || String(statKey || '').toUpperCase() || 'STAT';
}

function formatIncentiveRule(rule: Record<string, any>, statOptions = defaultStatOptions) {
  const stat = getIncentiveStatLabel(statOptions, rule.statKey || '');
  const amount = formatMoney(Number(rule.amountCents || 0));
  if (rule.type === 'threshold') {
    return `${stat} ${rule.thresholdOp === 'gte' ? '>=' : '>'} ${rule.threshold || 0} -> ${amount}`;
  }
  return `${stat}: ${amount} per ${stat.toLowerCase()}`;
}

function formatIncentiveDraft(draft: { statKey: string; type: 'per_unit' | 'threshold'; amountCents: number; threshold: string; thresholdOp: 'gt' | 'gte' }, statOptions: Array<{ key: string; label: string }>) {
  const stat = getIncentiveStatLabel(statOptions, draft.statKey);
  if (!draft.statKey || !Number.isFinite(draft.amountCents) || draft.amountCents === 0) {
    return 'Choose a stat and amount.';
  }
  const amount = formatMoney(draft.amountCents);
  if (draft.type === 'threshold') {
    return `${stat} ${draft.thresholdOp === 'gte' ? '>=' : '>'} ${draft.threshold || 0}: ${amount} bonus`;
  }
  return `${stat}: ${amount} per ${stat.toLowerCase()}`;
}

function formatIncentiveBreakdownLine(line: Record<string, any>) {
  const rule = line.rule || {};
  const stat = String(rule.statKey || '').toUpperCase() || 'STAT';
  const statValue = Number(line.statValue || 0);
  const earned = Number(line.earned || 0);
  if (rule.type === 'threshold') {
    const threshold = Number(rule.threshold || 0);
    const met = rule.thresholdOp === 'gte' ? statValue >= threshold : statValue > threshold;
    return `${stat} ${rule.thresholdOp === 'gte' ? '>=' : '>'} ${threshold}: ${statValue} ${met ? 'met' : 'not met'} -> ${formatMoney(earned)}`;
  }
  return `${statValue} ${stat} x ${formatMoney(Number(rule.amountCents || 0), false)} = ${formatMoney(earned)}`;
}

function getPlayerAction(data: ParentPlayerDetailData) {
  const event = data.events.find((candidate) => (
    !candidate.isCancelled &&
    candidate.isDbGame &&
    !candidate.availabilityLocked &&
    normalizeRsvpResponse(candidate.myRsvp) === 'not_responded' &&
    candidate.date.getTime() >= startOfDay(new Date()).getTime()
  ));
  if (event) {
    return {
      title: 'Availability needed',
      detail: `${getScheduleTitle(event)} · ${formatEventDateLabel(event.date)}`,
      to: getEventDetailPath(event, 'availability'),
      className: 'border-amber-200 bg-amber-50 text-amber-800'
    };
  }

  const packet = data.events.find((candidate) => (
    !candidate.isCancelled &&
    candidate.type === 'practice' &&
    candidate.practiceHomePacketSummary &&
    candidate.date.getTime() >= startOfDay(new Date()).getTime()
  ));
  if (packet) {
    return {
      title: 'Practice packet ready',
      detail: packet.practiceHomePacketSummary || 'Packet ready',
      to: getEventDetailPath(packet, 'game'),
      className: 'border-blue-200 bg-blue-50 text-blue-800'
    };
  }

  const assignment = data.events.find((candidate) => (
    !candidate.isCancelled &&
    getOpenScheduleAssignments(candidate.assignments).length > 0 &&
    candidate.date.getTime() >= startOfDay(new Date()).getTime()
  ));
  if (assignment) {
    return {
      title: 'Open assignment',
      detail: `${getOpenScheduleAssignments(assignment.assignments).length} task${getOpenScheduleAssignments(assignment.assignments).length === 1 ? '' : 's'} available`,
      to: getEventDetailPath(assignment, 'assignments'),
      className: 'border-emerald-200 bg-emerald-50 text-emerald-800'
    };
  }

  return null;
}

function getInitials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'P';
}

function startOfDay(date: Date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}
