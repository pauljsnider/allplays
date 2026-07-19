import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type InputHTMLAttributes } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Award,
  BarChart3,
  CalendarDays,
  Camera,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  ClipboardCheck,
  DollarSign,
  Edit3,
  ExternalLink,
  FileVideo,
  ImagePlus,
  Link2,
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
  loadParentPlayerAthleteProfile,
  loadParentPlayerDetail,
  loadParentPlayerStatsDetail,
  loadParentPlayerVideoClips,
  markParentPlayerIncentivePaid,
  retireParentPlayerIncentiveRule,
  savePlayerCustomRosterFieldValues,
  saveParentAthleteProfileDraft,
  saveParentPlayerIncentiveCap,
  saveParentPlayerIncentiveRule,
  saveStaffPlayerRosterDetails,
  sendParentCoParentInvite,
  toggleParentPlayerIncentiveRule,
  updateParentPlayerEditableProfile,
  normalizeAthleteProfileHighlightClipUrl,
  type AthleteProfileHighlightClipDraft,
  type AthleteProfileHighlightClipUpload,
  type ParentAthleteProfileData,
  type ParentPlayerDetailData,
  type ParentPlayerStatRow,
  type ParentPlayerStatsDetailData,
  type PlayerVideoClip
} from '../lib/playerService';
import { AvatarImage } from '../components/AvatarImage';
import { DetailLoadErrorState } from '../components/DetailLoadErrorState';
import { getEventDetailPath } from '../lib/homeLogic';
import { toAppServiceError, type AppServiceError } from '../lib/appErrors';
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
import { completeParentCoreWorkflowTimer } from '../lib/parentWorkflowTiming';
import type { AuthState } from '../lib/types';
import type { ProfilePhotoSource } from '../lib/profilePhotoService';

type PlayerSectionId = 'overview' | 'schedule' | 'performance' | 'profile';
type AthleteProfilePrivacy = 'private' | 'public';
type PlayerStatsDetailLoadState = 'idle' | 'loading' | 'loaded' | 'error';
type AthleteProfileClipDraftState = {
  id: string;
  source: 'external' | 'upload';
  mediaType: 'link' | 'image' | 'video';
  title: string;
  label: string;
  url: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number | null;
  uploadedAtMs: number | null;
  pendingUpload: boolean;
  file: File | null;
};

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

function hasPersistedPrivateProfileShareUrl(profile: Record<string, any> | null | undefined, shareUrl: string | null | undefined) {
  return profile?.privacy !== 'public' && !!String(shareUrl || '').trim();
}

function hasPendingPublicProfilePublish({ hasUnsavedPublishChanges = false, saving = false }: { hasUnsavedPublishChanges?: boolean; saving?: boolean } = {}) {
  return hasUnsavedPublishChanges || saving;
}

function requiresSavedPublicProfileForSharing({
  draftPrivacy,
  persistedPrivacy,
  shareUrl,
  hasUnsavedPublishChanges = false,
  saving = false
}: {
  draftPrivacy: AthleteProfilePrivacy;
  persistedPrivacy: AthleteProfilePrivacy;
  shareUrl: string | null | undefined;
  hasUnsavedPublishChanges?: boolean;
  saving?: boolean;
}) {
  if (draftPrivacy === 'public') {
    return persistedPrivacy !== 'public' || hasPendingPublicProfilePublish({ hasUnsavedPublishChanges, saving });
  }
  return persistedPrivacy !== 'public' && !!String(shareUrl || '').trim();
}

function isPersistedPublicProfileReady(
  profile: Record<string, any> | null | undefined,
  shareUrl: string | null | undefined,
  options: { hasUnsavedPublishChanges?: boolean; saving?: boolean } = {}
) {
  return hasPersistedPublicProfile(profile, shareUrl) && !hasPendingPublicProfilePublish(options);
}

function createAthleteProfileClipId() {
  if (globalThis.crypto?.randomUUID) {
    return `clip_${globalThis.crypto.randomUUID()}`;
  }
  return `clip_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function compactString(value: unknown) {
  return String(value || '').trim();
}

function nullableNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function inferClipMediaTypeFromFile(file: File): 'image' | 'video' | 'link' {
  const type = compactString(file?.type).toLowerCase();
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  return 'link';
}

function normalizeExistingAthleteClip(clip: Record<string, any>, index: number): AthleteProfileClipDraftState | null {
  const url = compactString(clip?.url);
  if (!url) return null;
  const source = clip?.source === 'upload' ? 'upload' : 'external';
  const mediaType = ['image', 'video', 'link'].includes(compactString(clip?.mediaType).toLowerCase())
    ? compactString(clip?.mediaType).toLowerCase() as 'image' | 'video' | 'link'
    : source === 'upload' ? 'video' : 'link';

  return {
    id: compactString(clip?.id) || `clip_${index + 1}`,
    source,
    mediaType,
    title: compactString(clip?.title),
    label: compactString(clip?.label),
    url,
    storagePath: compactString(clip?.storagePath),
    mimeType: compactString(clip?.mimeType),
    sizeBytes: nullableNumber(clip?.sizeBytes),
    uploadedAtMs: nullableNumber(clip?.uploadedAtMs),
    pendingUpload: false,
    file: null
  };
}

function normalizeExistingAthleteClips(clips: unknown): AthleteProfileClipDraftState[] {
  return (Array.isArray(clips) ? clips : [])
    .map((clip, index) => normalizeExistingAthleteClip(clip, index))
    .filter((clip): clip is AthleteProfileClipDraftState => !!clip);
}

function createExternalAthleteClip(): AthleteProfileClipDraftState {
  return {
    id: createAthleteProfileClipId(),
    source: 'external',
    mediaType: 'link',
    title: '',
    label: '',
    url: '',
    storagePath: '',
    mimeType: '',
    sizeBytes: null,
    uploadedAtMs: null,
    pendingUpload: false,
    file: null
  };
}

function createPendingAthleteClip(file: File): AthleteProfileClipDraftState {
  const title = compactString(file.name).replace(/\.[^.]+$/, '');
  return {
    id: createAthleteProfileClipId(),
    source: 'upload',
    mediaType: inferClipMediaTypeFromFile(file),
    title,
    label: '',
    url: '',
    storagePath: '',
    mimeType: compactString(file.type),
    sizeBytes: nullableNumber(file.size),
    uploadedAtMs: null,
    pendingUpload: true,
    file
  };
}

function buildAthleteProfileClipSignature(clips: AthleteProfileClipDraftState[]) {
  return JSON.stringify(clips.map((clip) => ({
    id: clip.id,
    source: clip.source,
    mediaType: clip.mediaType,
    title: clip.title,
    label: clip.label,
    url: clip.url,
    storagePath: clip.storagePath,
    mimeType: clip.mimeType,
    sizeBytes: clip.sizeBytes,
    uploadedAtMs: clip.uploadedAtMs,
    pendingUpload: clip.pendingUpload,
    fileName: clip.file?.name || '',
    fileSize: clip.file?.size || null
  })));
}

function hasResolvedAthleteProfile(data: ParentAthleteProfileData | null | undefined) {
  return !!(data?.profile || String(data?.shareUrl || '').trim());
}

function buildAthleteProfileClipSaveState(clips: AthleteProfileClipDraftState[]) {
  const draftClips: AthleteProfileHighlightClipDraft[] = [];
  const highlightClipUploads: AthleteProfileHighlightClipUpload[] = [];

  clips.forEach((clip) => {
    if (clip.pendingUpload) {
      if (!clip.file) {
        throw new Error('One highlight clip could not be found. Re-add it and try again.');
      }
      draftClips.push({
        id: clip.id,
        source: 'upload',
        mediaType: clip.mediaType,
        title: clip.title,
        label: clip.label,
        pendingUpload: true
      });
      highlightClipUploads.push({
        id: clip.id,
        file: clip.file,
        title: clip.title,
        label: clip.label
      });
      return;
    }

    const url = clip.source === 'external'
      ? normalizeAthleteProfileHighlightClipUrl(clip.url)
      : compactString(clip.url);
    if (!url) return;

    draftClips.push({
      id: clip.id,
      source: clip.source,
      mediaType: clip.mediaType,
      title: clip.title,
      label: clip.label,
      url,
      storagePath: clip.storagePath,
      mimeType: clip.mimeType,
      sizeBytes: clip.sizeBytes,
      uploadedAtMs: clip.uploadedAtMs
    });
  });

  return { draftClips, highlightClipUploads };
}

export function PlayerDetail({ auth }: { auth: AuthState }) {
  const { teamId = '', playerId = '' } = useParams();
  const [data, setData] = useState<ParentPlayerDetailData | null>(null);
  const [activeSection, setActiveSection] = useState<PlayerSectionId>('overview');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<AppServiceError | null>(null);
  const [athleteProfileLoaded, setAthleteProfileLoaded] = useState(false);
  const [athleteProfileLoading, setAthleteProfileLoading] = useState(false);
  const [athleteProfileError, setAthleteProfileError] = useState<AppServiceError | null>(null);
  const [videoClipsLoaded, setVideoClipsLoaded] = useState(false);
  const [videoClipsLoading, setVideoClipsLoading] = useState(false);
  const [videoClipsError, setVideoClipsError] = useState<AppServiceError | null>(null);
  const [statsDetailState, setStatsDetailState] = useState<PlayerStatsDetailLoadState>('idle');
  const [statsDetailError, setStatsDetailError] = useState<AppServiceError | null>(null);
  const playerDetailRequestIdRef = useRef(0);
  const athleteProfileRequestKeyRef = useRef('');
  const videoClipsRequestKeyRef = useRef('');
  const statsDetailRequestKeyRef = useRef('');

  const loadStatsDetail = useCallback(async ({
    nextTeamId,
    nextPlayerId,
    force = false
  }: {
    nextTeamId: string;
    nextPlayerId: string;
    force?: boolean;
  }): Promise<ParentPlayerStatsDetailData | null> => {
    if (!auth.user?.uid) {
      return null;
    }
    if ((statsDetailState === 'loading' || statsDetailState === 'loaded' || statsDetailState === 'error') && !force) {
      return null;
    }

    const requestKey = `${nextTeamId}::${nextPlayerId}`;
    statsDetailRequestKeyRef.current = requestKey;
    setStatsDetailState('loading');
    setStatsDetailError(null);
    try {
      const statsDetail = await loadParentPlayerStatsDetail(auth.user, nextTeamId, nextPlayerId);
      if (statsDetailRequestKeyRef.current !== requestKey) {
        return null;
      }
      setData((current) => {
        if (!current || current.child.teamId !== nextTeamId || current.child.playerId !== nextPlayerId) {
          return current;
        }
        return {
          ...current,
          statsDetail,
          statRows: statsDetail.statRows.length ? statsDetail.statRows : current.statRows
        };
      });
      setStatsDetailState('loaded');
      return statsDetail;
    } catch (loadError: any) {
      if (statsDetailRequestKeyRef.current === requestKey) {
        setStatsDetailError(toAppServiceError(loadError, 'Unable to load full player stats.'));
        setStatsDetailState('error');
      }
      return null;
    }
  }, [auth.user, statsDetailState]);

  const loadVideoClips = async ({
    nextTeamId,
    nextPlayerId,
    force = false
  }: {
    nextTeamId: string;
    nextPlayerId: string;
    force?: boolean;
  }): Promise<PlayerVideoClip[] | null> => {
    if (!auth.user?.uid) {
      return null;
    }
    if ((videoClipsLoaded || videoClipsLoading || videoClipsError) && !force) {
      return null;
    }

    const requestKey = `${nextTeamId}::${nextPlayerId}`;
    videoClipsRequestKeyRef.current = requestKey;
    setVideoClipsLoading(true);
    setVideoClipsError(null);
    try {
      const clips = await loadParentPlayerVideoClips(auth.user, nextTeamId, nextPlayerId);
      if (videoClipsRequestKeyRef.current !== requestKey) {
        return null;
      }
      setData((current) => {
        if (!current || current.child.teamId !== nextTeamId || current.child.playerId !== nextPlayerId) {
          return current;
        }
        return {
          ...current,
          clips
        };
      });
      setVideoClipsLoaded(true);
      return clips;
    } catch (loadError: any) {
      if (videoClipsRequestKeyRef.current === requestKey) {
        setVideoClipsError(toAppServiceError(loadError, 'Unable to load video clips.'));
      }
      return null;
    } finally {
      if (videoClipsRequestKeyRef.current === requestKey) {
        setVideoClipsLoading(false);
      }
    }
  };

  const loadAthleteProfile = useCallback(async ({
    nextTeamId,
    nextPlayerId,
    force = false
  }: {
    nextTeamId: string;
    nextPlayerId: string;
    force?: boolean;
  }): Promise<ParentAthleteProfileData | null> => {
    if (!auth.user?.uid) {
      return null;
    }
    if (athleteProfileLoading && !force) {
      return null;
    }

    const requestKey = `${nextTeamId}::${nextPlayerId}`;
    athleteProfileRequestKeyRef.current = requestKey;
    setAthleteProfileLoading(true);
    setAthleteProfileError(null);
    try {
      const athleteProfile = await loadParentPlayerAthleteProfile(auth.user, nextTeamId, nextPlayerId);
      if (athleteProfileRequestKeyRef.current !== requestKey) {
        return null;
      }
      setData((current) => {
        if (!current || current.child.teamId !== nextTeamId || current.child.playerId !== nextPlayerId) {
          return current;
        }
        return {
          ...current,
          athleteProfile
        };
      });
      setAthleteProfileLoaded(true);
      return athleteProfile;
    } catch (loadError: any) {
      if (athleteProfileRequestKeyRef.current === requestKey) {
        setAthleteProfileError(toAppServiceError(loadError, 'Unable to load athlete profile.'));
      }
      return null;
    } finally {
      if (athleteProfileRequestKeyRef.current === requestKey) {
        setAthleteProfileLoading(false);
      }
    }
  }, [athleteProfileLoading, auth.user]);

  const refreshPlayer = async ({
    showLoading = data === null,
    reloadVideoClips = videoClipsLoaded
  }: {
    showLoading?: boolean;
    reloadVideoClips?: boolean;
  } = {}) => {
    const requestId = ++playerDetailRequestIdRef.current;
    const fullPageLoading = showLoading || data === null;
    if (fullPageLoading) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }
    setError(null);
    try {
      const nextData = await loadParentPlayerDetail(auth.user, teamId, playerId);
      if (playerDetailRequestIdRef.current !== requestId) {
        return;
      }
      const nextAthleteProfileLoaded = hasResolvedAthleteProfile(nextData.athleteProfile);
      const preserveAthleteProfile = athleteProfileLoaded && !nextAthleteProfileLoaded && !!data
        && data.child.teamId === nextData.child.teamId
        && data.child.playerId === nextData.child.playerId;
      const reloadStatsDetail = activeSection === 'performance' && (statsDetailState === 'loaded' || statsDetailState === 'error')
        && !!data
        && data.child.teamId === nextData.child.teamId
        && data.child.playerId === nextData.child.playerId;
      setData((current) => ({
        ...nextData,
        athleteProfile: preserveAthleteProfile && current
          ? current.athleteProfile
          : nextData.athleteProfile,
        statsDetail: reloadStatsDetail ? null : nextData.statsDetail
      }));
      setAthleteProfileLoaded(nextAthleteProfileLoaded || preserveAthleteProfile);
      setAthleteProfileError(null);
      setVideoClipsError(null);
      if (reloadStatsDetail) {
        statsDetailRequestKeyRef.current = '';
        setStatsDetailState('idle');
        setStatsDetailError(null);
      }
      if (reloadVideoClips) {
        await loadVideoClips({
          nextTeamId: nextData.child.teamId,
          nextPlayerId: nextData.child.playerId,
          force: true
        });
      }
      if (preserveAthleteProfile) {
        const nextAthleteProfile = await loadAthleteProfile({
          nextTeamId: nextData.child.teamId,
          nextPlayerId: nextData.child.playerId,
          force: true
        });
        if (nextAthleteProfile) {
          setData((current) => current ? { ...current, athleteProfile: nextAthleteProfile } : current);
        }
      }
    } catch (loadError: any) {
      if (playerDetailRequestIdRef.current !== requestId) {
        return;
      }
      if (fullPageLoading) {
        setData(null);
      }
      setError(toAppServiceError(loadError, 'Unable to load player.'));
    } finally {
      if (playerDetailRequestIdRef.current !== requestId) {
        return;
      }
      if (fullPageLoading) {
        setLoading(false);
      } else {
        setRefreshing(false);
      }
    }
  };

  useEffect(() => {
    athleteProfileRequestKeyRef.current = '';
    videoClipsRequestKeyRef.current = '';
    statsDetailRequestKeyRef.current = '';
    setRefreshing(false);
    setAthleteProfileLoaded(false);
    setAthleteProfileLoading(false);
    setAthleteProfileError(null);
    setVideoClipsLoaded(false);
    setVideoClipsLoading(false);
    setVideoClipsError(null);
    setStatsDetailState('idle');
    setStatsDetailError(null);
    refreshPlayer({ showLoading: true, reloadVideoClips: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.user?.uid, teamId, playerId]);

  useEffect(() => {
    if (activeSection !== 'profile' || !data || athleteProfileLoaded || athleteProfileLoading || hasResolvedAthleteProfile(data.athleteProfile)) return;
    void loadAthleteProfile({
      nextTeamId: data.child.teamId,
      nextPlayerId: data.child.playerId
    });
  }, [activeSection, athleteProfileLoaded, athleteProfileLoading, data, loadAthleteProfile]);

  useEffect(() => {
    if (activeSection !== 'performance' || !data || statsDetailState !== 'idle') return;
    void loadStatsDetail({
      nextTeamId: data.child.teamId,
      nextPlayerId: data.child.playerId
    });
  }, [activeSection, data, loadStatsDetail, statsDetailState]);

  useEffect(() => {
    if (loading || !data) return;
    completeParentCoreWorkflowTimer('player', {
      targetPage: 'player',
      teamId,
      playerId,
      playerName: data.player.name || data.child.playerName || 'Player',
      completedRoute: `/players/${teamId}/${playerId}`
    });
  }, [data, loading, playerId, teamId]);

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
      <DetailLoadErrorState
        icon={UserRound}
        title="Player unavailable"
        error={error}
        fallbackMessage="This player is not available for your account."
        backTo="/home"
        backLabel="Home"
        onRetry={() => refreshPlayer({ showLoading: true })}
        retrying={loading}
      />
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
            {data.player.photoUrl ? <AvatarImage src={data.player.photoUrl} alt={`${playerName} profile photo`} loading="lazy" decoding="async" className="h-full w-full object-cover" fallback={<span>{jersey || getInitials(playerName)}</span>} /> : <span>{jersey || getInitials(playerName)}</span>}
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

      {error ? <Status tone="error" message={error.message} /> : null}
      {data.scheduleLoadError ? <ScheduleLoadNotice message={data.scheduleLoadError} /> : null}
      {activeSection === 'overview' ? <OverviewSection data={data} /> : null}
      {activeSection === 'schedule' ? <PlayerScheduleSection events={data.events} /> : null}
      {activeSection === 'performance' ? (
        <ReportsSection
          data={data}
          statsDetailState={statsDetailState}
          statsDetailError={statsDetailError}
          onRetryStatsDetail={() => loadStatsDetail({
            nextTeamId: data.child.teamId,
            nextPlayerId: data.child.playerId,
            force: true
          })}
          videoClipsLoading={videoClipsLoading}
          videoClipsError={videoClipsError}
          onVideoClipsOpen={() => loadVideoClips({
            nextTeamId: data.child.teamId,
            nextPlayerId: data.child.playerId
          })}
          onRetryVideoClips={() => loadVideoClips({
            nextTeamId: data.child.teamId,
            nextPlayerId: data.child.playerId,
            force: true
          })}
        />
      ) : null}
      {activeSection === 'profile' ? (
        <PlayerProfileSection
          data={data}
          auth={auth}
          onChanged={refreshPlayer}
          athleteProfileLoaded={athleteProfileLoaded}
          athleteProfileLoading={athleteProfileLoading}
          athleteProfileError={athleteProfileError}
        />
      ) : null}
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

type ReportPanelId = 'overview' | 'games' | 'season' | 'events' | 'clips';

const reportPanels: Array<{ id: ReportPanelId; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'games', label: 'Game Stats' },
  { id: 'season', label: 'Season Averages' },
  { id: 'events', label: 'Game Events' },
  { id: 'clips', label: 'Video Clips' }
];

function ReportsSection({
  data,
  statsDetailState,
  statsDetailError,
  onRetryStatsDetail,
  videoClipsLoading,
  videoClipsError,
  onVideoClipsOpen,
  onRetryVideoClips
}: {
  data: ParentPlayerDetailData;
  statsDetailState: PlayerStatsDetailLoadState;
  statsDetailError: AppServiceError | null;
  onRetryStatsDetail: () => void;
  videoClipsLoading: boolean;
  videoClipsError: AppServiceError | null;
  onVideoClipsOpen: () => void;
  onRetryVideoClips: () => void;
}) {
  const [activePanel, setActivePanel] = useState<ReportPanelId>('overview');
  const trackingRows = Array.isArray(data.trackingSummary) ? data.trackingSummary[0]?.items || [] : [];
  const statsDetail = data.statsDetail;
  const reportRows = statsDetail?.statRows?.length ? statsDetail.statRows : data.statRows;

  useEffect(() => {
    if (activePanel === 'clips') {
      onVideoClipsOpen();
    }
  }, [activePanel, onVideoClipsOpen]);

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
          {statsDetailState === 'loading' && !statsDetail ? <StatsDetailLoadingNotice /> : null}
          {statsDetailError && !statsDetail ? <StatsDetailErrorNotice error={statsDetailError} onRetry={onRetryStatsDetail} /> : null}
          {activePanel === 'overview' ? <StatsOverviewPanel statsDetail={statsDetail} rows={reportRows} loading={statsDetailState === 'loading'} /> : null}
          {activePanel === 'games' ? <GameStatsPanel rows={reportRows} hasMore={statsDetail?.summary.hasMoreGames} gameLimit={statsDetail?.summary.gameLimit} /> : null}
          {activePanel === 'season' ? <SeasonAveragesPanel rows={reportRows} statsDetail={statsDetail} /> : null}
          {activePanel === 'events' ? <GameEventsPanel statsDetail={statsDetail} fallbackEvents={data.events} loading={statsDetailState === 'loading'} /> : null}
          {activePanel === 'clips' ? (
            <ClipsPanel
              clips={data.clips}
              loading={videoClipsLoading}
              error={videoClipsError}
              onRetry={onRetryVideoClips}
            />
          ) : null}
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

function StatsDetailLoadingNotice() {
  return (
    <div className="mb-3 rounded-xl border border-primary-100 bg-primary-50 p-3 text-sm font-semibold text-primary-800">
      <Loader2 className="mr-2 inline h-4 w-4 animate-spin" aria-hidden="true" />
      Loading full-season player stats...
    </div>
  );
}

function StatsDetailErrorNotice({ error, onRetry }: { error: AppServiceError; onRetry: () => void }) {
  return (
    <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 p-3">
      <div className="text-sm font-black text-rose-900">{error.message}</div>
      <button type="button" className="mt-2 text-xs font-black text-rose-700" onClick={onRetry}>Retry stats</button>
    </div>
  );
}

function StatsOverviewPanel({
  statsDetail,
  rows,
  loading
}: {
  statsDetail: ParentPlayerStatsDetailData | null;
  rows: ParentPlayerStatRow[];
  loading: boolean;
}) {
  const summary = statsDetail?.summary;
  const averages = summary?.averages || Object.fromEntries(getSeasonAverages(rows).map(([key, value]) => [key.toLowerCase(), Number(value) || 0]));
  const totals = summary?.totals || buildDisplayTotals(rows);
  const primaryAverage = Object.entries(averages)[0];
  const primaryTotal = Object.entries(totals)[0];
  const primaryStatKey = primaryAverage?.[0] || primaryTotal?.[0] || Object.keys(rows[0]?.stats || {})[0] || '';
  const avgMinutes = summary && summary.gamesWithTime > 0 ? summary.totalTimeMs / 60000 / summary.gamesWithTime : null;
  const cards = [
    { label: 'Games', value: String(summary?.gamesPlayed ?? rows.length), sub: summary?.hasMoreGames ? `Last ${summary.gameLimit}` : 'Tracked' },
    primaryAverage ? { label: `${primaryAverage[0].toUpperCase()}/G`, value: formatAverage(Number(primaryAverage[1])), sub: 'Average' } : null,
    primaryTotal ? { label: primaryTotal[0].toUpperCase(), value: formatAverage(Number(primaryTotal[1])), sub: 'Total' } : null,
    avgMinutes !== null ? { label: 'MIN/G', value: formatAverage(avgMinutes), sub: 'Playing time' } : null
  ].filter(Boolean) as Array<{ label: string; value: string; sub: string }>;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {cards.length ? cards.slice(0, 4).map((card) => (
          <div key={card.label} className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-center">
            <div className="text-xl font-black text-gray-950">{card.value}</div>
            <div className="mt-1 truncate text-[10px] font-black uppercase tracking-[0.04em] text-gray-500">{card.label}</div>
            <div className="mt-0.5 text-[10px] font-bold text-gray-400">{card.sub}</div>
          </div>
        )) : <div className="col-span-full rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm font-semibold text-gray-500">No season stats yet.</div>}
      </div>

      {summary?.topStats.length ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {summary.topStats.map((stat) => (
            <div key={stat.id} className="rounded-xl border border-primary-100 bg-primary-50 p-3">
              <div className="text-xs font-black uppercase tracking-[0.04em] text-primary-700">{stat.label}</div>
              <div className="mt-1 flex items-end justify-between gap-3">
                <div className="text-2xl font-black text-primary-900">#{stat.rank}</div>
                <div className="text-right">
                  <div className="text-lg font-black text-gray-950">{stat.formattedValue}</div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.04em] text-gray-500">of {stat.totalPlayers}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <PlayerChartsPanel rows={rows} totals={totals} primaryStatKey={primaryStatKey} />

      {summary?.trends.length ? (
        <div className="space-y-2">
          {summary.trends.map((trend) => (
            <div key={trend.key} className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-gray-50 p-3">
              <div>
                <div className="text-sm font-black text-gray-950">{trend.label}</div>
                <div className="text-xs font-semibold text-gray-500">Recent {formatAverage(trend.recentAverage)} vs earlier {formatAverage(trend.earlierAverage)}</div>
              </div>
              <div className={`flex items-center gap-1 text-sm font-black ${trend.direction === 'up' ? 'text-emerald-700' : trend.direction === 'down' ? 'text-rose-700' : 'text-gray-500'}`}>
                {trend.direction === 'up' && ArrowUp ? <ArrowUp className="h-4 w-4" aria-hidden="true" /> : trend.direction === 'down' && ArrowDown ? <ArrowDown className="h-4 w-4" aria-hidden="true" /> : null}
                {trend.direction === 'neutral' ? 'Even' : `${trend.percentChange}%`}
              </div>
            </div>
          ))}
        </div>
      ) : loading ? null : <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm font-semibold text-gray-500">Track more games to see trends.</div>}
    </div>
  );
}

function GameStatsPanel({ rows, hasMore = false, gameLimit = 0 }: { rows: ParentPlayerStatRow[]; hasMore?: boolean; gameLimit?: number }) {
  return (
    <div className="space-y-3">
      {hasMore ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-900">Showing the latest {gameLimit} tracked games for speed.</div> : null}
      <GameStatsTrendPanel rows={rows} />
      {rows.length ? rows.map((row) => (
        <StatRow key={row.event.eventKey} row={row} />
      )) : <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm font-semibold text-gray-500">No tracked game stats yet.</div>}
    </div>
  );
}

function PlayerChartsPanel({
  rows,
  totals,
  primaryStatKey
}: {
  rows: ParentPlayerStatRow[];
  totals: Record<string, number>;
  primaryStatKey: string;
}) {
  const statBars = Object.entries(totals)
    .filter(([, value]) => Number.isFinite(Number(value)) && Number(value) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, 5);
  const primarySeries = rows
    .slice(0, 6)
    .reverse()
    .map((row) => ({
      label: row.event.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      value: Number((row.stats || {})[primaryStatKey]) || 0,
      opponent: String(row.event.opponent || row.event.title || 'Game').replace(/^vs\.?\s*/i, '')
    }));
  const minuteSeries = rows
    .filter((row) => Number(row.timeMs || 0) > 0)
    .slice(0, 6)
    .reverse()
    .map((row) => ({
      label: row.event.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      value: Number(row.timeMs || 0) / 60000
    }));

  if (!statBars.length && !primarySeries.some((point) => point.value > 0) && !minuteSeries.length) {
    return null;
  }

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {primaryStatKey && primarySeries.some((point) => point.value > 0) ? (
        <RecentStatBarChart title={`Recent ${primaryStatKey.toUpperCase()}`} series={primarySeries} />
      ) : null}
      {statBars.length ? <StatMixChart stats={statBars} /> : null}
      {minuteSeries.length ? <RecentMinutesChart series={minuteSeries} /> : null}
    </div>
  );
}

function RecentStatBarChart({ title, series }: { title: string; series: Array<{ label: string; value: number; opponent: string }> }) {
  const maxValue = Math.max(...series.map((point) => point.value), 1);
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-black text-gray-950">{title}</div>
        <div className="text-[10px] font-black uppercase tracking-[0.04em] text-gray-500">Last {series.length}</div>
      </div>
      <div className="mt-3 flex h-40 items-end gap-2 rounded-lg bg-gray-50 px-2 pb-2 pt-4">
        {series.map((point) => {
          const height = Math.max(10, Math.round((point.value / maxValue) * 100));
          return (
            <div key={`${point.label}-${point.opponent}`} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
              <div className="text-xs font-black text-primary-800">{formatAverage(point.value)}</div>
              <div
                className="w-full rounded-t-md bg-primary-600"
                style={{ height: `${height}%` }}
                aria-label={`${point.value} ${title} on ${point.label}`}
              />
              <div className="w-full truncate text-center text-[10px] font-bold text-gray-500">{point.label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatMixChart({ stats }: { stats: Array<[string, number]> }) {
  const maxValue = Math.max(...stats.map(([, value]) => Number(value)), 1);
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <div className="text-sm font-black text-gray-950">Stat mix</div>
      <div className="mt-3 space-y-2">
        {stats.map(([key, value]) => {
          const width = Math.max(6, Math.round((Number(value) / maxValue) * 100));
          return (
            <div key={key}>
              <div className="mb-1 flex items-center justify-between gap-3">
                <div className="text-[10px] font-black uppercase tracking-[0.04em] text-gray-500">{key}</div>
                <div className="text-xs font-black text-gray-950">{formatAverage(Number(value))}</div>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-gray-100">
                <div className="h-full rounded-full bg-emerald-600" style={{ width: `${width}%` }} aria-label={`${key} total ${value}`} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RecentMinutesChart({ series }: { series: Array<{ label: string; value: number }> }) {
  const maxValue = Math.max(...series.map((point) => point.value), 1);
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3 lg:col-span-2">
      <div className="text-sm font-black text-gray-950">Playing time</div>
      <div className="mt-3 grid grid-cols-6 gap-1 rounded-lg bg-gray-50 p-2">
        {series.map((point) => {
          const intensity = Math.max(18, Math.round((point.value / maxValue) * 100));
          return (
            <div key={point.label} className="min-w-0 rounded-lg border border-gray-200 bg-white p-2 text-center">
              <div className="mx-auto flex h-14 w-full items-end overflow-hidden rounded-md bg-gray-100">
                <div className="w-full bg-amber-500" style={{ height: `${intensity}%` }} aria-label={`${formatAverage(point.value)} minutes on ${point.label}`} />
              </div>
              <div className="mt-1 text-xs font-black text-gray-950">{formatAverage(point.value)}</div>
              <div className="truncate text-[10px] font-bold text-gray-500">{point.label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GameStatsTrendPanel({ rows }: { rows: ParentPlayerStatRow[] }) {
  const statKeys = Object.keys(buildDisplayTotals(rows)).slice(0, 3);
  const recentRows = rows.slice(0, 6).reverse();
  if (!statKeys.length || !recentRows.length) {
    return null;
  }
  const maxValue = Math.max(...recentRows.flatMap((row) => statKeys.map((key) => Number((row.stats || {})[key]) || Number((row.stats || {})[key.toLowerCase()]) || 0)), 1);
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-black text-gray-950">Game-by-game trend</div>
        <div className="text-[10px] font-black uppercase tracking-[0.04em] text-gray-500">Last {recentRows.length}</div>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
        {statKeys.map((key, keyIndex) => (
          <div key={key} className="rounded-lg bg-gray-50 p-2">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-[10px] font-black uppercase tracking-[0.04em] text-gray-500">{key}</div>
              <div className="text-xs font-black text-gray-950">{formatAverage(Number(recentRows[recentRows.length - 1]?.stats?.[key] || recentRows[recentRows.length - 1]?.stats?.[key.toLowerCase()] || 0))}</div>
            </div>
            <div className="flex h-24 items-end gap-1">
              {recentRows.map((row) => {
                const value = Number((row.stats || {})[key]) || Number((row.stats || {})[key.toLowerCase()]) || 0;
                const height = Math.max(8, Math.round((value / maxValue) * 100));
                return (
                  <div key={`${row.event.eventKey}-${key}`} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1">
                    <div
                      className={`w-full rounded-t ${keyIndex === 0 ? 'bg-primary-600' : keyIndex === 1 ? 'bg-emerald-600' : 'bg-amber-500'}`}
                      style={{ height: `${height}%` }}
                      aria-label={`${key} ${formatAverage(value)} on ${row.event.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
                    />
                    <div className="w-full truncate text-center text-[9px] font-bold text-gray-500">{row.event.date.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })}</div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SeasonAveragesPanel({ rows, statsDetail }: { rows: ParentPlayerStatRow[]; statsDetail: ParentPlayerStatsDetailData | null }) {
  const averages = statsDetail
    ? Object.entries(statsDetail.summary.averages).map(([key, value]) => [key.toUpperCase(), formatAverage(value)] as [string, string])
    : getSeasonAverages(rows);
  const totals = statsDetail ? Object.entries(statsDetail.summary.totals) : Object.entries(buildDisplayTotals(rows));
  return (
    <div className="space-y-4">
      <SeasonComparisonChart averages={averages} totals={totals} />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {averages.length ? averages.slice(0, 12).map(([key, value]) => (
          <div key={key} className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-center">
            <div className="text-xl font-black text-gray-950">{value}</div>
            <div className="mt-1 truncate text-[10px] font-black uppercase tracking-[0.04em] text-gray-500">{key}/G</div>
          </div>
        )) : <div className="col-span-full rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm font-semibold text-gray-500">No season averages yet.</div>}
      </div>
      {totals.length ? (
        <div>
          <div className="mb-2 text-xs font-black uppercase tracking-[0.04em] text-gray-500">Totals</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {totals.slice(0, 12).map(([key, value]) => (
              <div key={key} className="rounded-xl border border-gray-200 bg-white p-3 text-center">
                <div className="text-lg font-black text-gray-950">{formatAverage(Number(value))}</div>
                <div className="mt-1 truncate text-[10px] font-black uppercase tracking-[0.04em] text-gray-500">{key}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SeasonComparisonChart({
  averages,
  totals
}: {
  averages: Array<[string, string]>;
  totals: Array<[string, unknown]>;
}) {
  const averageMap = new Map(averages.map(([key, value]) => [key.replace(/\/G$/i, '').toUpperCase(), Number(value)]));
  const rows = totals
    .map(([key, value]) => ({
      key: String(key).toUpperCase(),
      total: Number(value) || 0,
      average: averageMap.get(String(key).toUpperCase()) || 0
    }))
    .filter((row) => row.total > 0 || row.average > 0)
    .slice(0, 6);
  const maxTotal = Math.max(...rows.map((row) => row.total), 1);
  const maxAverage = Math.max(...rows.map((row) => row.average), 1);
  if (!rows.length) {
    return null;
  }
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-black text-gray-950">Season profile</div>
        <div className="flex items-center gap-3 text-[10px] font-black uppercase tracking-[0.04em] text-gray-500">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-primary-600" />Total</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-600" />Avg</span>
        </div>
      </div>
      <div className="mt-3 space-y-2">
        {rows.map((row) => {
          const totalWidth = Math.max(5, Math.round((row.total / maxTotal) * 100));
          const averageWidth = Math.max(5, Math.round((row.average / maxAverage) * 100));
          return (
            <div key={row.key} className="grid grid-cols-[3rem_1fr_3.5rem] items-center gap-2">
              <div className="truncate text-[10px] font-black uppercase tracking-[0.04em] text-gray-500">{row.key}</div>
              <div className="space-y-1">
                <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                  <div className="h-full rounded-full bg-primary-600" style={{ width: `${totalWidth}%` }} aria-label={`${row.key} total ${formatAverage(row.total)}`} />
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                  <div className="h-full rounded-full bg-emerald-600" style={{ width: `${averageWidth}%` }} aria-label={`${row.key} average ${formatAverage(row.average)}`} />
                </div>
              </div>
              <div className="text-right text-xs font-black text-gray-950">{formatAverage(row.total)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GameEventsPanel({ statsDetail, fallbackEvents, loading }: { statsDetail: ParentPlayerStatsDetailData | null; fallbackEvents: ParentScheduleEvent[]; loading: boolean }) {
  const gameEventRows = statsDetail?.gameEventRows || [];
  if (gameEventRows.length) {
    return (
      <div className="space-y-3">
        <GameEventTimelineChart rows={gameEventRows} />
        {gameEventRows.map((row) => (
          <div key={row.gameId} className="rounded-xl border border-gray-200 bg-gray-50 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-black text-gray-950">{row.gameLabel}</div>
              <div className="text-xs font-semibold text-gray-500">{row.gameDate}</div>
            </div>
            <div className="mt-2 space-y-2">
              {row.events.map((event) => (
                <div key={event.id} className="rounded-lg border border-gray-200 bg-white px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 truncate text-sm font-black text-gray-950">{event.description}</div>
                    <div className="flex-none text-xs font-black text-primary-700">{[event.period, event.clock].filter(Boolean).join(' ')}</div>
                  </div>
                  <div className="mt-0.5 text-xs font-semibold text-gray-500">{[event.statKey.toUpperCase(), event.value].filter((value) => String(value || '').trim()).join(' · ')}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (loading) {
    return <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm font-semibold text-gray-500">Loading player events...</div>;
  }
  const gameEvents = fallbackEvents.filter((event) => event.type === 'game').slice().sort((a, b) => b.date.getTime() - a.date.getTime());
  return (
    <div className="space-y-2">
      {gameEvents.length ? gameEvents.map((event) => (
        <PlayerEventCard key={event.eventKey} event={event} />
      )) : <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm font-semibold text-gray-500">No game events recorded yet.</div>}
    </div>
  );
}

function GameEventTimelineChart({ rows }: { rows: ParentPlayerStatsDetailData['gameEventRows'] }) {
  const series = rows
    .slice(0, 8)
    .reverse()
    .map((row) => ({
      label: row.gameDate,
      game: row.gameLabel,
      value: row.events.length
    }));
  const maxValue = Math.max(...series.map((point) => point.value), 1);
  if (!series.some((point) => point.value > 0)) {
    return null;
  }
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-black text-gray-950">Event volume</div>
        <div className="text-[10px] font-black uppercase tracking-[0.04em] text-gray-500">Recorded plays</div>
      </div>
      <div className="mt-3 flex h-32 items-end gap-2 rounded-lg bg-gray-50 px-2 pb-2 pt-4">
        {series.map((point) => {
          const height = Math.max(12, Math.round((point.value / maxValue) * 100));
          return (
            <div key={`${point.game}-${point.label}`} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1">
              <div className="text-xs font-black text-primary-800">{point.value}</div>
              <div
                className="w-full rounded-t-md bg-indigo-600"
                style={{ height: `${height}%` }}
                aria-label={`${point.value} player events in ${point.game}`}
              />
              <div className="w-full truncate text-center text-[10px] font-bold text-gray-500">{point.label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ClipsPanel({
  clips,
  loading,
  error,
  onRetry
}: {
  clips: Array<Record<string, any>>;
  loading: boolean;
  error: AppServiceError | null;
  onRetry: () => void;
}) {
  if (loading) {
    return (
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm font-semibold text-gray-500">
        <Loader2 className="mr-2 inline h-4 w-4 animate-spin text-primary-600" aria-hidden="true" />
        Loading video clips...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-3">
        <div className="text-sm font-black text-rose-900">{error.message}</div>
        <button type="button" className="mt-2 text-xs font-black text-rose-700" onClick={onRetry}>Retry clips</button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <ClipCoverageChart clips={clips} />
      <div className="grid gap-2 sm:grid-cols-2">
        {clips.length ? clips.map((clip) => (
          <a key={`${clip.url}-${clip.title}`} href={clip.url} target="_blank" rel="noreferrer" className="rounded-xl border border-gray-200 bg-gray-50 p-3 transition hover:border-primary-200 hover:bg-primary-50/40">
            <div className="flex items-center gap-2 text-sm font-black text-gray-950">
              {FileVideo ? <FileVideo className="h-4 w-4 flex-none text-primary-600" aria-hidden="true" /> : null}
              <span className="truncate">{clip.title || 'Game clip'}</span>
            </div>
            <div className="mt-0.5 truncate text-xs font-semibold text-gray-500">{clip.gameLabel || clip.game || 'Game'}{clip.gameDate ? ` · ${clip.gameDate}` : ''}</div>
          </a>
        )) : <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm font-semibold text-gray-500">No clips yet.</div>}
      </div>
    </div>
  );
}

function ClipCoverageChart({ clips }: { clips: Array<Record<string, any>> }) {
  if (!clips.length) {
    return null;
  }
  const counts = new Map<string, number>();
  clips.forEach((clip) => {
    const label = String(clip.gameLabel || clip.game || 'Unassigned').trim() || 'Unassigned';
    counts.set(label, (counts.get(label) || 0) + 1);
  });
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const maxValue = Math.max(...rows.map(([, value]) => value), 1);
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-black text-gray-950">Clip coverage</div>
        <div className="text-[10px] font-black uppercase tracking-[0.04em] text-gray-500">{clips.length} total</div>
      </div>
      <div className="mt-3 space-y-2">
        {rows.map(([label, count]) => {
          const width = Math.max(8, Math.round((count / maxValue) * 100));
          return (
            <div key={label}>
              <div className="mb-1 flex items-center justify-between gap-3">
                <div className="min-w-0 truncate text-xs font-bold text-gray-600">{label}</div>
                <div className="text-xs font-black text-gray-950">{count}</div>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-gray-100">
                <div className="h-full rounded-full bg-sky-600" style={{ width: `${width}%` }} aria-label={`${count} clips for ${label}`} />
              </div>
            </div>
          );
        })}
      </div>
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

function PlayerProfileSection({
  data,
  auth,
  onChanged,
  athleteProfileLoaded,
  athleteProfileLoading,
  athleteProfileError
}: {
  data: ParentPlayerDetailData;
  auth: AuthState;
  onChanged: () => Promise<void>;
  athleteProfileLoaded: boolean;
  athleteProfileLoading: boolean;
  athleteProfileError: AppServiceError | null;
}) {
  const [activePanel, setActivePanel] = useState<ProfilePanelId>('edit');
  const [athleteProfileShareState, setAthleteProfileShareState] = useState({ hasUnsavedPublishChanges: false, saving: false });
  const customRosterFields = Array.isArray(data.customRosterFields) ? data.customRosterFields : [];
  const persistedPublicProfileUrl = getPersistedPublicProfileUrl(data.athleteProfile.profile, data.athleteProfile.shareUrl);
  const persistedPublicProfileAvailable = isPersistedPublicProfileReady(data.athleteProfile.profile, data.athleteProfile.shareUrl, athleteProfileShareState);
  const fullBuilderAvailable = athleteProfileLoaded && !!String(data.athleteProfile.builderUrl || '').trim();

  useEffect(() => {
    setAthleteProfileShareState((current) => {
      if (!current.hasUnsavedPublishChanges && !current.saving) {
        return current;
      }
      return { hasUnsavedPublishChanges: false, saving: false };
    });
  }, [data.athleteProfile.profile, data.athleteProfile.shareUrl]);

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

      {activePanel === 'edit' ? (
        <>
          <StaffRosterDetailsCard data={data} auth={auth} onChanged={onChanged} />
          <EditablePlayerProfileCard data={data} auth={auth} onChanged={onChanged} />
          {customRosterFields.length ? <CustomRosterFieldsCard data={data} auth={auth} onChanged={onChanged} /> : null}
        </>
      ) : null}
      {athleteProfileLoading ? (
        <div className="rounded-xl border border-primary-100 bg-primary-50/60 p-3 text-sm font-semibold text-primary-800">
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Loading athlete profile tools...
          </div>
        </div>
      ) : null}
      {athleteProfileError ? <Status tone="error" message={athleteProfileError.message} /> : null}
      {activePanel === 'athlete' ? (
        athleteProfileLoaded ? (
          <AthleteProfileBuilderCard
            key={`${data.child.teamId}:${data.child.playerId}`}
            data={data}
            auth={auth}
            onChanged={onChanged}
            onShareStateChange={setAthleteProfileShareState}
          />
        ) : (
          <div className="app-card p-4 text-sm font-semibold text-gray-500">Athlete profile tools will appear here after the profile data finishes loading.</div>
        )
      ) : null}
      {activePanel === 'family' ? (
        <div className="space-y-3">
          <LinkedFamilyContactsCard data={data} />
          <CoParentInviteCard data={data} auth={auth} />
        </div>
      ) : null}
      {activePanel === 'incentives' ? <IncentivesCard data={data} auth={auth} onChanged={onChanged} /> : null}

      <section className="grid gap-3 sm:grid-cols-3">
        <a
          href={fullBuilderAvailable ? data.athleteProfile.builderUrl : '#'}
          target={fullBuilderAvailable ? '_blank' : undefined}
          rel={fullBuilderAvailable ? 'noreferrer' : undefined}
          aria-disabled={!fullBuilderAvailable}
          tabIndex={fullBuilderAvailable ? undefined : -1}
          onClick={fullBuilderAvailable ? undefined : (event) => event.preventDefault()}
          className={`app-card flex items-start gap-3 p-4 transition hover:border-primary-200 hover:shadow-app-lg ${fullBuilderAvailable ? '' : 'pointer-events-none opacity-60'}`}
        >
          <IconBox icon={Sparkles} />
          <CardText title="Full builder" detail={athleteProfileLoading ? 'Loading athlete profile builder...' : 'Open the legacy builder for headshot and highlight uploads.'} />
          <ExternalLink className="h-4 w-4 flex-none text-gray-400" aria-hidden="true" />
        </a>
        <a
          href={persistedPublicProfileAvailable ? persistedPublicProfileUrl : '#'}
          target={persistedPublicProfileAvailable ? '_blank' : undefined}
          rel={persistedPublicProfileAvailable ? 'noreferrer' : undefined}
          aria-disabled={!persistedPublicProfileAvailable}
          tabIndex={persistedPublicProfileAvailable ? undefined : -1}
          onClick={persistedPublicProfileAvailable ? undefined : (event) => event.preventDefault()}
          className={`app-card flex items-start gap-3 p-4 transition hover:border-primary-200 hover:shadow-app-lg ${persistedPublicProfileAvailable ? '' : 'pointer-events-none opacity-60'}`}
        >
          <IconBox icon={Share2} />
          <CardText title="Public athlete profile" detail={athleteProfileLoading ? 'Loading athlete profile share status...' : (persistedPublicProfileAvailable ? 'Open the shareable athlete profile.' : 'Publish and save this profile to enable sharing.')} />
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

function StaffRosterDetailsCard({ data, auth, onChanged }: { data: ParentPlayerDetailData; auth: AuthState; onChanged: () => Promise<void> }) {
  const canEditRosterDetails = data.access.canEditRosterDetails;
  const [name, setName] = useState(data.player.name || data.child.playerName || '');
  const [number, setNumber] = useState(String(data.player.number || ''));
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ tone: 'error' | 'success'; message: string } | null>(null);
  const previewUrl = useMemo(() => {
    if (photoFile) return URL.createObjectURL(photoFile);
    if (removePhoto) return '';
    return String(data.player.photoUrl || '');
  }, [data.player.photoUrl, photoFile, removePhoto]);

  useEffect(() => {
    setName(data.player.name || data.child.playerName || '');
    setNumber(String(data.player.number || ''));
    setPhotoFile(null);
    setRemovePhoto(false);
    setStatus(null);
  }, [data.child.playerName, data.player.name, data.player.number, data.player.photoUrl]);

  useEffect(() => {
    return () => {
      if (previewUrl.startsWith('blob:')) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  if (!canEditRosterDetails) {
    return null;
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setStatus(null);
    try {
      await saveStaffPlayerRosterDetails({
        user: auth.user,
        teamId: data.child.teamId,
        playerId: data.child.playerId,
        currentPlayer: data.player,
        name,
        number,
        photoFile,
        removePhoto
      });
      setPhotoFile(null);
      setRemovePhoto(false);
      setStatus({ tone: 'success', message: 'Roster details saved.' });
      await onChanged();
    } catch (error: any) {
      setStatus({ tone: 'error', message: error?.message || 'Unable to save roster details.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="app-card p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-14 w-14 flex-none items-center justify-center overflow-hidden rounded-2xl bg-primary-50 text-sm font-black text-primary-700">
          {previewUrl ? <AvatarImage src={previewUrl} alt={`${name || data.child.playerName || 'Player'} roster photo preview`} className="h-full w-full object-cover" fallback={getInitials(name || data.child.playerName || 'Player')} /> : getInitials(name || data.child.playerName || 'Player')}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-black text-gray-950">
            <Edit3 className="h-4 w-4 text-primary-600" aria-hidden="true" />
            Roster Details
          </div>
          <p className="mt-1 text-xs font-semibold leading-5 text-gray-500">Team staff can update the player name, jersey number, and roster photo here.</p>
        </div>
      </div>

      <form className="mt-4 space-y-3" onSubmit={submit}>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Player name" value={name} onChange={setName} placeholder="Player name" />
          <TextField label="Jersey number" value={number} onChange={setNumber} placeholder="Number" inputMode="numeric" />
        </div>
        <label className="block">
          <span className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">Roster photo</span>
          <input
            type="file"
            accept="image/*"
            className="mt-1 block w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-semibold text-gray-700"
            onChange={(event) => {
              setPhotoFile(event.currentTarget.files?.[0] || null);
              if (event.currentTarget.files?.[0]) {
                setRemovePhoto(false);
              }
            }}
          />
        </label>
        <button type="button" className="secondary-button w-full justify-center" onClick={() => {
          setPhotoFile(null);
          setRemovePhoto(true);
        }}>
          Remove roster photo
        </button>
        {status ? <Status tone={status.tone} message={status.message} /> : null}
        <button type="submit" className="primary-button w-full justify-center" disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
          {saving ? 'Saving' : 'Save Roster Details'}
        </button>
      </form>
    </section>
  );
}

function EditablePlayerProfileCard({ data, auth, onChanged }: { data: ParentPlayerDetailData; auth: AuthState; onChanged: () => Promise<void> }) {
  const canEditProfile = data.access.isLinkedParent || auth.isAdmin || auth.isPlatformAdmin;
  const canEditRosterDetails = data.access.canEditRosterDetails;
  const canEditPhoto = !canEditRosterDetails;
  const [emergencyName, setEmergencyName] = useState(data.privateProfile?.emergencyContact?.name || '');
  const [emergencyPhone, setEmergencyPhone] = useState(data.privateProfile?.emergencyContact?.phone || '');
  const [medicalInfo, setMedicalInfo] = useState(data.privateProfile?.medicalInfo || '');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ tone: 'error' | 'success'; message: string } | null>(null);
  const playerName = data.player.name || data.child.playerName || 'Player';
  const previewUrl = useMemo(() => canEditPhoto ? (photoFile ? URL.createObjectURL(photoFile) : (data.player.photoUrl || '')) : '', [canEditPhoto, photoFile, data.player.photoUrl]);

  useEffect(() => {
    return () => {
      if (previewUrl.startsWith('blob:')) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  useEffect(() => {
    if (!canEditPhoto) {
      setPhotoFile(null);
    }
  }, [canEditPhoto]);

  if (!canEditProfile) {
    return null;
  }

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
          {previewUrl ? <AvatarImage src={previewUrl} alt={`${playerName} profile photo preview`} className="h-full w-full object-cover" fallback={getInitials(playerName)} /> : getInitials(playerName)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-black text-gray-950">
            <Edit3 className="h-4 w-4 text-primary-600" aria-hidden="true" />
            Edit Profile
          </div>
          <p className="mt-1 text-xs font-semibold leading-5 text-gray-500">
            {canEditPhoto ? 'Parents can update the player photo and private emergency/medical details.' : 'Parents can update private emergency and medical details here. Use Roster Details for the team roster photo.'}
          </p>
        </div>
      </div>

      <form className="mt-4 space-y-3" onSubmit={submit}>
        {canEditPhoto ? (
          <label className="block">
            <span className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">Player photo</span>
            <input
              type="file"
              accept="image/*"
              className="mt-1 block w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-semibold text-gray-700"
              onChange={(event) => setPhotoFile(event.currentTarget.files?.[0] || null)}
            />
          </label>
        ) : null}
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

function CustomRosterFieldsCard({ data, auth, onChanged }: { data: ParentPlayerDetailData; auth: AuthState; onChanged: () => Promise<void> }) {
  const [values, setValues] = useState<Record<string, string | boolean>>(() => buildCustomRosterFieldState(data.customRosterFields));
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ tone: 'error' | 'success'; message: string } | null>(null);
  const canEdit = data.access.canEditCustomRosterFields;

  useEffect(() => {
    setValues(buildCustomRosterFieldState(data.customRosterFields));
    setStatus(null);
  }, [data.customRosterFields]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canEdit) return;
    setSaving(true);
    setStatus(null);
    try {
      await savePlayerCustomRosterFieldValues({
        user: auth.user,
        teamId: data.child.teamId,
        playerId: data.child.playerId,
        values
      });
      setStatus({ tone: 'success', message: 'Custom roster fields saved.' });
      await onChanged();
    } catch (error: any) {
      setStatus({ tone: 'error', message: error?.message || 'Unable to save custom roster fields.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="app-card p-4">
      <div className="flex items-start gap-3">
        <IconBox icon={Users} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-black text-gray-950">Custom roster fields</div>
          <p className="mt-1 text-xs font-semibold leading-5 text-gray-500">
            {canEdit ? 'Team staff can update player custom field values here.' : 'Visible roster fields from the team roster setup.'}
          </p>
        </div>
      </div>

      <form className="mt-4 space-y-3" onSubmit={submit}>
        {data.customRosterFields.map((field) => (
          <CustomRosterFieldInput
            key={field.key}
            field={field}
            value={values[field.key]}
            disabled={!canEdit || saving}
            onChange={(nextValue) => setValues((current) => ({ ...current, [field.key]: nextValue }))}
          />
        ))}
        {status ? <Status tone={status.tone} message={status.message} /> : null}
        {canEdit ? (
          <button type="submit" className="primary-button w-full justify-center" disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
            {saving ? 'Saving' : 'Save Custom Fields'}
          </button>
        ) : null}
      </form>
    </section>
  );
}

function CustomRosterFieldInput({
  field,
  value,
  disabled,
  onChange
}: {
  field: ParentPlayerDetailData['customRosterFields'][number];
  value: string | boolean | undefined;
  disabled: boolean;
  onChange: (value: string | boolean) => void;
}) {
  if (field.type === 'checkbox') {
    return (
      <label className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-3">
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-black text-gray-950">{field.label}</span>
          {field.description ? <span className="mt-0.5 block text-xs font-semibold text-gray-500">{field.description}</span> : null}
        </span>
        <input
          type="checkbox"
          aria-label={field.label}
          checked={value === true}
          disabled={disabled}
          onChange={(event) => onChange(event.currentTarget.checked)}
          className="h-5 w-5 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
        />
      </label>
    );
  }

  return (
    <label className="block">
      <span className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">{field.label}</span>
      {field.description ? <span className="mt-1 block text-xs font-semibold text-gray-500">{field.description}</span> : null}
      {field.type === 'menu' ? (
        <select
          aria-label={field.label}
          value={String(value ?? '')}
          disabled={disabled}
          onChange={(event) => onChange(event.currentTarget.value)}
          className="mt-1 block w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-semibold text-gray-800 outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-100"
        >
          <option value="">Select an option</option>
          {field.options.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      ) : (
        <input
          type={field.type === 'date' ? 'date' : 'text'}
          aria-label={field.label}
          value={String(value ?? '')}
          disabled={disabled}
          onChange={(event) => onChange(event.currentTarget.value)}
          className="mt-1 block w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-semibold text-gray-800 outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-100"
        />
      )}
    </label>
  );
}

function buildCustomRosterFieldState(fields: ParentPlayerDetailData['customRosterFields']) {
  return fields.reduce<Record<string, string | boolean>>((result, field) => {
    result[field.key] = field.type === 'checkbox' ? field.value === true : String(field.value ?? '');
    return result;
  }, {});
}

function AthleteProfileBuilderCard({ data, auth, onChanged, onShareStateChange }: { data: ParentPlayerDetailData; auth: AuthState; onChanged: () => Promise<void>; onShareStateChange: (state: { hasUnsavedPublishChanges: boolean; saving: boolean }) => void }) {
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
    const availableSeasonKeys = new Set(
      seasonOptions
        .map((option) => String(option?.seasonKey || '').trim())
        .filter(Boolean)
    );
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
        .filter((seasonKey: string) => !availableSeasonKeys.size || availableSeasonKeys.has(seasonKey))
      : [];
    if (existingKeys.length) {
      return [...new Set(existingKeys)];
    }
    if (seasonOptions.length === 1) {
      return [seasonOptions[0].seasonKey];
    }
    return currentSeasonKey ? [currentSeasonKey] : [];
  }, [currentSeasonKey, existing, seasonOptions]);
  const initialClipDrafts = useMemo(() => normalizeExistingAthleteClips(existing?.clips), [existing?.clips]);
  const [name, setName] = useState(existing?.athlete?.name || data.player.name || data.child.playerName || '');
  const [headline, setHeadline] = useState(existing?.athlete?.headline || '');
  const [position, setPosition] = useState(existing?.bio?.position || '');
  const [graduationYear, setGraduationYear] = useState(existing?.bio?.graduationYear || '');
  const [hometown, setHometown] = useState(existing?.bio?.hometown || '');
  const [dominantHand, setDominantHand] = useState(existing?.bio?.dominantHand || '');
  const [achievements, setAchievements] = useState(existing?.bio?.achievements || '');
  const [privacy, setPrivacy] = useState<AthleteProfilePrivacy>(existing?.privacy === 'public' ? 'public' : 'private');
  const [selectedSeasonKeys, setSelectedSeasonKeys] = useState<string[]>(initialSelectedSeasonKeys);
  const hasSingleSeasonOption = seasonOptions.length === 1;
  const singleSeasonOption = hasSingleSeasonOption ? seasonOptions[0] : null;
  const [saving, setSaving] = useState(false);
  const [awaitingPersistedPublish, setAwaitingPersistedPublish] = useState(false);
  const [status, setStatus] = useState<{ tone: 'error' | 'success'; message: string } | null>(null);
  const [headshotFile, setHeadshotFile] = useState<File | null>(null);
  const [headshotError, setHeadshotError] = useState('');
  const [headshotBusy, setHeadshotBusy] = useState(false);
  const [resetHeadshot, setResetHeadshot] = useState(false);
  const [clipDrafts, setClipDrafts] = useState<AthleteProfileClipDraftState[]>(initialClipDrafts);
  const [highlightClipError, setHighlightClipError] = useState('');
  const headshotInputRef = useRef<HTMLInputElement | null>(null);
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
      clipDrafts.length ? `${clipDrafts.length} highlight clip${clipDrafts.length === 1 ? '' : 's'}` : ''
    ].filter(Boolean);
    return items;
  }, [achievements, clipDrafts.length, data.child.playerName, dominantHand, graduationYear, headline, hometown, name, position, selectedSeasonKeys.length]);
  const normalizedExistingName = existing?.athlete?.name || data.player.name || data.child.playerName || '';
  const normalizedExistingHeadline = existing?.athlete?.headline || '';
  const normalizedExistingPosition = existing?.bio?.position || '';
  const normalizedExistingGraduationYear = existing?.bio?.graduationYear || '';
  const normalizedExistingHometown = existing?.bio?.hometown || '';
  const normalizedExistingDominantHand = existing?.bio?.dominantHand || '';
  const normalizedExistingAchievements = existing?.bio?.achievements || '';
  const normalizedInitialSelectedSeasonKeys = [...initialSelectedSeasonKeys].sort();
  const normalizedSelectedSeasonKeys = [...selectedSeasonKeys].sort();
  const normalizedInitialClipSignature = buildAthleteProfileClipSignature(initialClipDrafts);
  const normalizedClipSignature = buildAthleteProfileClipSignature(clipDrafts);
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
    normalizedInitialClipSignature !== normalizedClipSignature ||
    !!headshotFile ||
    resetHeadshot
  );
  const normalizedShareUrl = String(data.athleteProfile.shareUrl || '').trim();
  const persistedPublicProfileUrl = getPersistedPublicProfileUrl(existing, normalizedShareUrl);
  const hasPersistedPrivateShareUrl = hasPersistedPrivateProfileShareUrl(existing, normalizedShareUrl);
  const isPublishingNewPublicProfile = privacy === 'public' && persistedPrivacy !== 'public';
  const persistedPublicProfileReady = isPersistedPublicProfileReady(existing, normalizedShareUrl, {
    hasUnsavedPublishChanges,
    saving
  });
  const canPreviewPublishedPublicProfile = persistedPublicProfileReady;
  const canSharePublicProfile = persistedPublicProfileReady;
  const hasPendingPersistedPublicProfile = hasPendingPublicProfilePublish({
    hasUnsavedPublishChanges,
    saving: saving || awaitingPersistedPublish
  });
  const requiresPublishBeforeSharing = requiresSavedPublicProfileForSharing({
    draftPrivacy: privacy,
    persistedPrivacy,
    shareUrl: normalizedShareUrl,
    hasUnsavedPublishChanges,
    saving: saving || awaitingPersistedPublish
  });
  const shareRequiresSavedPublicProfile = privacy === 'public' && requiresPublishBeforeSharing;
  const latestPublicShareStateRef = useRef({
    canSharePublicProfile: false,
    persistedPublicProfileUrl: ''
  });
  latestPublicShareStateRef.current = {
    canSharePublicProfile,
    persistedPublicProfileUrl
  };
  const saveDisabled = saving || headshotBusy;
  const saveLabel = headshotBusy
    ? 'Preparing'
    : saving
      ? 'Saving'
      : privacy === 'public'
        ? 'Publish Athlete Profile'
        : 'Save Athlete Profile';

  useLayoutEffect(() => {
    onShareStateChange({
      hasUnsavedPublishChanges,
      saving: saving || awaitingPersistedPublish
    });
    return () => {
      onShareStateChange({ hasUnsavedPublishChanges: false, saving: false });
    };
  }, [awaitingPersistedPublish, hasUnsavedPublishChanges, onShareStateChange, saving]);

  useEffect(() => {
    return () => {
      if (headshotPreviewUrl.startsWith('blob:')) URL.revokeObjectURL(headshotPreviewUrl);
    };
  }, [headshotPreviewUrl]);

  useEffect(() => {
    setSelectedSeasonKeys(initialSelectedSeasonKeys);
  }, [initialSelectedSeasonKeys]);

  useEffect(() => {
    setClipDrafts(initialClipDrafts);
    setHighlightClipError('');
  }, [initialClipDrafts]);

  useEffect(() => {
    setPrivacy(existing?.privacy === 'public' ? 'public' : 'private');
  }, [existing?.privacy]);

  const toggleSeasonKey = (seasonKey: string) => {
    setSelectedSeasonKeys((current) => (
      current.includes(seasonKey)
        ? current.filter((key) => key !== seasonKey)
        : [...current, seasonKey]
    ));
  };

  const prepareHeadshotFile = async (file: File | null, options: { normalize?: boolean } = {}) => {
    if (!file) {
      setHeadshotFile(null);
      setHeadshotError('');
      return;
    }
    if (!String(file.type || '').startsWith('image/')) {
      setHeadshotFile(null);
      setHeadshotError('Choose an image file for the athlete headshot.');
      return;
    }

    setHeadshotBusy(true);
    setHeadshotError('');
    try {
      const nextFile = options.normalize === false
        ? file
        : await import('../lib/profilePhotoService').then((module) => module.normalizeProfilePhoto(file));
      setHeadshotFile(nextFile);
      setResetHeadshot(false);
    } catch (error: any) {
      setHeadshotFile(null);
      setHeadshotError(error?.message || 'Athlete headshot could not be prepared right now.');
    } finally {
      setHeadshotBusy(false);
    }
  };

  const chooseNativeHeadshot = async (source: ProfilePhotoSource) => {
    setHeadshotBusy(true);
    setHeadshotError('');
    try {
      const { acquireProfilePhoto } = await import('../lib/profilePhotoService');
      const file = await acquireProfilePhoto(source);
      await prepareHeadshotFile(file, { normalize: false });
    } catch (error: any) {
      if (error?.code === 'cancelled') {
        return;
      }
      if (error?.code === 'unavailable' && source === 'photos') {
        headshotInputRef.current?.click();
        return;
      }
      const message = error?.code === 'permission-denied'
        ? source === 'camera'
          ? 'Camera permission was denied. Allow camera access to take a headshot.'
          : 'Photo permission was denied. Allow photo library access to choose a headshot.'
        : error?.message || 'Athlete headshot could not be selected right now.';
      setHeadshotError(message);
    } finally {
      setHeadshotBusy(false);
    }
  };

  const addExternalClip = () => {
    setClipDrafts((current) => [...current, createExternalAthleteClip()]);
    setHighlightClipError('');
  };

  const addUploadClips = (files: File[]) => {
    if (!files.length) return;
    const nextClips: AthleteProfileClipDraftState[] = [];
    for (const file of files) {
      const type = String(file.type || '');
      if (!type.startsWith('image/') && !type.startsWith('video/')) {
        setHighlightClipError('Choose image or video files for highlight clips.');
        return;
      }
      if (file.size > 100 * 1024 * 1024) {
        setHighlightClipError('Choose highlight clips under 100 MB.');
        return;
      }
      nextClips.push(createPendingAthleteClip(file));
    }
    setClipDrafts((current) => [...current, ...nextClips]);
    setHighlightClipError('');
  };

  const updateClipDraft = (clipId: string, patch: Partial<AthleteProfileClipDraftState>) => {
    setClipDrafts((current) => current.map((clip) => (
      clip.id === clipId ? { ...clip, ...patch } : clip
    )));
    setHighlightClipError('');
  };

  const removeClipDraft = (clipId: string) => {
    setClipDrafts((current) => current.filter((clip) => clip.id !== clipId));
    setHighlightClipError('');
  };

  const moveClipDraft = (clipId: string, direction: -1 | 1) => {
    setClipDrafts((current) => {
      const index = current.findIndex((clip) => clip.id === clipId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) {
        return current;
      }
      const next = [...current];
      const [clip] = next.splice(index, 1);
      next.splice(nextIndex, 0, clip);
      return next;
    });
    setHighlightClipError('');
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (headshotError || highlightClipError) return;
    if (headshotBusy) {
      setStatus({ tone: 'error', message: 'Finish preparing the athlete headshot before saving.' });
      return;
    }
    if (!selectedSeasonKeys.length) {
      setStatus({ tone: 'error', message: 'Select at least one linked season to build an athlete profile.' });
      return;
    }
    let clipSaveState: ReturnType<typeof buildAthleteProfileClipSaveState>;
    try {
      clipSaveState = buildAthleteProfileClipSaveState(clipDrafts);
    } catch (error: any) {
      setHighlightClipError(error?.message || 'Check the highlight clips and try again.');
      return;
    }
    setSaving(true);
    setStatus(null);
    setAwaitingPersistedPublish(isPublishingNewPublicProfile);
    try {
      const savedProfile = await saveParentAthleteProfileDraft({
        user: auth.user,
        teamId: data.child.teamId,
        playerId: data.child.playerId,
        profileId: existing?.id || null,
        draft: {
          athlete: { name, headline },
          bio: { position, graduationYear, hometown, dominantHand, achievements },
          privacy,
          selectedSeasonKeys,
          clips: clipSaveState.draftClips,
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
        highlightClipUploads: clipSaveState.highlightClipUploads
      });
      setHeadshotFile(null);
      setResetHeadshot(false);
      if (Array.isArray(savedProfile.profile?.clips)) {
        setClipDrafts(normalizeExistingAthleteClips(savedProfile.profile.clips));
      }
      setHighlightClipError('');
      setStatus({ tone: 'success', message: 'Athlete profile saved.' });
      await onChanged();
    } catch (error: any) {
      setStatus({ tone: 'error', message: error?.message || 'Unable to save athlete profile.' });
    } finally {
      setSaving(false);
      setAwaitingPersistedPublish(false);
    }
  };

  const shareProfile = async () => {
    const { canSharePublicProfile: shareReady, persistedPublicProfileUrl: shareUrl } = latestPublicShareStateRef.current;
    const shareBlockedByUnsavedPublish = requiresSavedPublicProfileForSharing({
      draftPrivacy: privacy,
      persistedPrivacy,
      shareUrl: normalizedShareUrl,
      hasUnsavedPublishChanges,
      saving: saving || awaitingPersistedPublish
    });
    if (shareBlockedByUnsavedPublish || !shareReady || !shareUrl) return;
    try {
      const result = await sharePublicUrl({
        title: `${name || data.child.playerName || 'Athlete'} profile`,
        text: 'Take a look at this athlete profile on ALL PLAYS.',
        url: shareUrl
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
              {headshotPreviewUrl ? <AvatarImage src={headshotPreviewUrl} alt="Athlete profile headshot preview" className="h-full w-full object-cover" fallback={getInitials(name || data.child.playerName || 'Athlete')} /> : getInitials(name || data.child.playerName || 'Athlete')}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">Public headshot</div>
              <p className="mt-1 text-sm font-semibold text-gray-700">{headshotLabel}</p>
              {headshotFile ? <p className="mt-1 text-xs font-semibold text-primary-700">{headshotFile.name}</p> : null}
            </div>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              className="secondary-button justify-center"
              disabled={headshotBusy}
              onClick={() => void chooseNativeHeadshot('camera')}
            >
              {headshotBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Camera className="h-4 w-4" aria-hidden="true" />}
              Take photo
            </button>
            <button
              type="button"
              className="secondary-button justify-center"
              disabled={headshotBusy}
              onClick={() => void chooseNativeHeadshot('photos')}
            >
              <ImagePlus className="h-4 w-4" aria-hidden="true" />
              Photo library
            </button>
            <label className="secondary-button justify-center">
              <ImagePlus className="h-4 w-4" aria-hidden="true" />
              <span>Browse file</span>
              <input
                ref={headshotInputRef}
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0] || null;
                  void prepareHeadshotFile(file);
                  event.currentTarget.value = '';
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
              {FileVideo ? <FileVideo className="h-5 w-5" aria-hidden="true" /> : null}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">Highlight clips</div>
              <p className="mt-1 text-sm font-semibold text-gray-700">Add links or upload image/video highlights, then drag the order with move controls.</p>
            </div>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <button type="button" className="secondary-button justify-center" onClick={addExternalClip}>
              <Link2 className="h-4 w-4" aria-hidden="true" />
              Add link
            </button>
            <label className="secondary-button justify-center">
              {FileVideo ? <FileVideo className="h-4 w-4" aria-hidden="true" /> : null}
              <span>Upload clips</span>
              <input
                type="file"
                accept="video/*,image/*"
                multiple
                className="sr-only"
                onChange={(event) => {
                  addUploadClips(Array.from(event.currentTarget.files || []));
                  event.currentTarget.value = '';
                }}
              />
            </label>
          </div>
          <div className="mt-3 space-y-2">
            {clipDrafts.length ? clipDrafts.map((clip, index) => (
              <div key={clip.id} className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">
                      {clip.pendingUpload ? 'Pending upload' : clip.source === 'upload' ? 'Uploaded clip' : 'External link'}
                    </div>
                    <p className="mt-1 truncate text-sm font-bold text-gray-900">
                      {clip.title || (clip.pendingUpload ? clip.file?.name : '') || 'Untitled clip'}
                    </p>
                    <p className="mt-1 truncate text-xs font-semibold text-gray-500">
                      {clip.pendingUpload ? clip.file?.name || 'Selected clip' : clip.url || 'Add a URL before saving'}
                    </p>
                  </div>
                  <div className="flex flex-none items-center gap-1">
                    <button
                      type="button"
                      className="icon-button h-8 w-8"
                      aria-label="Move clip up"
                      disabled={index === 0}
                      onClick={() => moveClipDraft(clip.id, -1)}
                    >
                      {ArrowUp ? <ArrowUp className="h-4 w-4" aria-hidden="true" /> : null}
                    </button>
                    <button
                      type="button"
                      className="icon-button h-8 w-8"
                      aria-label="Move clip down"
                      disabled={index === clipDrafts.length - 1}
                      onClick={() => moveClipDraft(clip.id, 1)}
                    >
                      {ArrowDown ? <ArrowDown className="h-4 w-4" aria-hidden="true" /> : null}
                    </button>
                    <button
                      type="button"
                      className="icon-button h-8 w-8 text-rose-600"
                      aria-label="Remove clip"
                      onClick={() => removeClipDraft(clip.id)}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <TextField
                    label="Clip title"
                    value={clip.title}
                    onChange={(value) => updateClipDraft(clip.id, { title: value })}
                    placeholder="Fast break"
                  />
                  <TextField
                    label="Note"
                    value={clip.label}
                    onChange={(value) => updateClipDraft(clip.id, { label: value })}
                    placeholder="Optional context"
                  />
                </div>
                {clip.source === 'external' ? (
                  <label className="mt-2 block">
                    <span className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">Clip URL</span>
                    <input
                      type="url"
                      value={clip.url}
                      onChange={(event) => updateClipDraft(clip.id, { url: event.currentTarget.value })}
                      placeholder="https://www.youtube.com/watch?v=..."
                      className="mt-1 block w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-800 outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-100"
                    />
                  </label>
                ) : null}
              </div>
            )) : (
              <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-3 text-sm font-semibold text-gray-500">
                No highlight clips yet.
              </div>
            )}
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
          {hasSingleSeasonOption && singleSeasonOption ? (
            <>
              <p className="mt-1 text-sm font-semibold text-gray-700">Included linked season</p>
              <div className="mt-3 rounded-xl border border-primary-200 bg-primary-50 px-3 py-3">
                <div className="text-sm font-black text-gray-900">{singleSeasonOption.playerName}</div>
                <div className="text-xs font-semibold text-gray-500">{singleSeasonOption.teamName}</div>
              </div>
            </>
          ) : (
            <>
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
            </>
          )}
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
          <button type="submit" className="primary-button justify-center" disabled={saveDisabled}>
            {saveDisabled ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
            {saveLabel}
          </button>
          {canSharePublicProfile ? (
            <button type="button" className="secondary-button justify-center" onClick={shareProfile}>
              <Share2 className="h-4 w-4" aria-hidden="true" />
              Share Public Profile
            </button>
          ) : awaitingPersistedPublish ? (
            <button type="button" className="secondary-button justify-center" disabled>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Waiting for published profile...
            </button>
          ) : requiresPublishBeforeSharing ? (
            <button type="button" className="secondary-button justify-center" disabled>
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
              Publish changes before sharing
            </button>
          ) : (
            <a href={canPreviewPublishedPublicProfile ? persistedPublicProfileUrl : data.athleteProfile.builderUrl} target="_blank" rel="noreferrer" className="secondary-button justify-center">
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
              {canPreviewPublishedPublicProfile ? 'Preview Public Page' : 'Open Full Builder'}
            </a>
          )}
        </div>
        {privacy === 'public' && awaitingPersistedPublish ? (
          <p className="text-center text-xs font-semibold text-gray-500">Waiting for refresh to confirm the public share link.</p>
        ) : privacy === 'public' && hasUnsavedPublishChanges ? (
          <p className="text-center text-xs font-semibold text-gray-500">Publish and save this profile before the public share link becomes available.</p>
        ) : hasPersistedPrivateShareUrl ? (
          <p className="text-center text-xs font-semibold text-gray-500">This saved share link stays private until you publish and save the profile.</p>
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

function LinkedFamilyContactsCard({ data }: { data: ParentPlayerDetailData }) {
  const contacts = Array.isArray(data.familyContacts) ? data.familyContacts : [];
  const [copiedEmail, setCopiedEmail] = useState('');

  const copyEmail = async (email: string) => {
    const normalizedEmail = compactString(email);
    if (!normalizedEmail) return;
    await navigator.clipboard?.writeText(normalizedEmail);
    setCopiedEmail(normalizedEmail);
    window.setTimeout(() => setCopiedEmail((current) => current === normalizedEmail ? '' : current), 1400);
  };

  return (
    <section className="app-card p-4">
      <div className="flex items-start gap-3">
        <IconBox icon={Users} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-black text-gray-950">Linked Parents</div>
          <p className="mt-1 text-xs font-semibold leading-5 text-gray-500">Parents and family contacts connected to this player.</p>
        </div>
        <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-black text-gray-700">{contacts.length}</span>
      </div>
      {contacts.length ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {contacts.map((contact, index) => {
            const name = compactString(contact.name) || compactString(contact.email) || compactString(contact.phone) || 'Parent';
            const relation = compactString(contact.relation) || 'Parent';
            const email = compactString(contact.email);
            const phone = compactString(contact.phone);
            const showEmailMeta = Boolean(email && email !== name);
            const status = compactString(contact.status);
            return (
              <div key={`${contact.userId || contact.email || contact.phone || name}-${index}`} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="truncate text-sm font-black leading-5 text-gray-950">{name}</div>
                      {email ? (
                        <button type="button" className="ghost-button !h-7 !min-h-7 !w-7 !flex-none !p-0" onClick={() => copyEmail(email)} aria-label={`Copy ${email}`} title={copiedEmail === email ? 'Copied' : 'Copy email'}>
                          {copiedEmail === email ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
                        </button>
                      ) : null}
                    </div>
                    <div className="text-xs font-semibold leading-4 text-gray-500">{relation}</div>
                  </div>
                  {status ? <span className="flex-none rounded-full bg-white px-2 py-0.5 text-[11px] font-black capitalize leading-4 text-gray-600">{status}</span> : null}
                </div>
                {showEmailMeta || phone ? (
                  <div className="mt-1 flex min-w-0 flex-wrap gap-x-3 gap-y-0.5 text-xs font-semibold leading-4 text-gray-600">
                    {showEmailMeta ? <span className="truncate">{email}</span> : null}
                    {phone ? <span className="truncate">{phone}</span> : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="mt-4 rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4 text-sm font-semibold text-gray-500">No linked parents are listed for this player.</div>
      )}
    </section>
  );
}

type IncentivePanelId = 'overview' | 'rules' | 'history';
type PlayerIncentiveRule = ParentPlayerDetailData['incentives']['currentRules'][number];

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
  const [editingRule, setEditingRule] = useState<PlayerIncentiveRule | null>(null);
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

  const editRule = (rule: PlayerIncentiveRule) => {
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
                      <button type="button" className="ghost-button !h-8 !min-h-8 !px-2 text-xs" disabled={!rule.id || busy === `retire-${rule.id}`} onClick={() => {
                        const ruleId = rule.id;
                        return ruleId ? run(`retire-${ruleId}`, () => retireParentPlayerIncentiveRule(auth.user, data.child.teamId, data.child.playerId, ruleId), 'Rule stopped.') : undefined;
                      }}>
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

type TextFieldHints = Pick<InputHTMLAttributes<HTMLInputElement>, 'inputMode' | 'autoComplete' | 'enterKeyHint'>;

function TextField({ label, value, onChange, placeholder = '', type = 'text', inputMode, autoComplete, enterKeyHint }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: string } & TextFieldHints) {
  const hints = inferInputHints(type);
  return (
    <label className="block">
      <span className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">{label}</span>
      <input
        type={type}
        inputMode={inputMode || hints.inputMode}
        autoComplete={autoComplete || hints.autoComplete}
        enterKeyHint={enterKeyHint || hints.enterKeyHint}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        placeholder={placeholder}
        className="mt-1 block w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-semibold text-gray-800 outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-100"
      />
    </label>
  );
}

function inferInputHints(type: string): TextFieldHints {
  if (type === 'email') return { inputMode: 'email', autoComplete: 'email', enterKeyHint: 'next' };
  if (type === 'tel') return { inputMode: 'tel', autoComplete: 'tel', enterKeyHint: 'next' };
  if (type === 'number') return { inputMode: 'decimal', enterKeyHint: 'next' };
  return { enterKeyHint: 'next' };
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
  const timeMs = Number(row.timeMs || 0);
  return (
    <Link to={getEventDetailPath(row.event, 'game')} className="block rounded-xl border border-gray-200 bg-gray-50 p-3 transition hover:border-primary-200 hover:bg-primary-50/40">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-black text-gray-950">{getScheduleTitle(row.event)}</div>
          <div className="mt-0.5 truncate text-xs font-semibold text-gray-500">{formatEventDateLabel(row.event.date)}</div>
        </div>
        <ChevronRight className="h-4 w-4 flex-none text-gray-400" aria-hidden="true" />
      </div>
      {statEntries.length || timeMs > 0 ? (
        <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
          {timeMs > 0 ? (
            <div className="rounded-lg border border-gray-200 bg-white p-2 text-center">
              <div className="text-base font-black text-gray-950">{formatAverage(timeMs / 60000)}</div>
              <div className="mt-0.5 truncate text-[10px] font-black uppercase tracking-[0.04em] text-gray-500">MIN</div>
            </div>
          ) : null}
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
      {Icon ? <Icon className={`h-3.5 w-3.5 ${urgent ? 'text-amber-700' : 'text-primary-600'}`} aria-hidden="true" /> : null}
      <span>{label}</span>
      <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${urgent ? 'bg-amber-200/70 text-amber-950' : 'bg-white text-gray-950'}`}>{value}</span>
    </div>
  );
}

function InfoCard({ icon: Icon, title, detail }: { icon: LucideIcon; title: string; detail: string }) {
  return (
    <div className="app-card p-4">
      {Icon ? <Icon className="h-5 w-5 text-primary-600" aria-hidden="true" /> : null}
      <div className="mt-3 text-sm font-black text-gray-950">{title}</div>
      <div className="mt-1 text-xs font-semibold leading-5 text-gray-600">{detail}</div>
    </div>
  );
}

function EmptyCard({ icon: Icon, title, detail }: { icon: LucideIcon; title: string; detail: string }) {
  return (
    <section className="app-card p-5 text-center">
      {Icon ? <Icon className="mx-auto h-8 w-8 text-gray-300" aria-hidden="true" /> : null}
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
      {Icon ? <Icon className="h-5 w-5" aria-hidden="true" /> : null}
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
    <div
      className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-sm font-semibold ${isError ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
      aria-atomic="true"
    >
      {isError ? <AlertCircle className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />}
      {message}
    </div>
  );
}

function ScheduleLoadNotice({ message }: { message: string }) {
  return (
    <div
      className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />
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

function buildDisplayTotals(rows: ParentPlayerStatRow[]) {
  const totals = new Map<string, number>();
  rows.forEach((row) => {
    Object.entries(row.stats || {}).forEach(([key, value]) => {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return;
      totals.set(key.toUpperCase(), (totals.get(key.toUpperCase()) || 0) + numeric);
    });
  });
  return Object.fromEntries([...totals.entries()].slice(0, 12));
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

function formatIncentiveRule(rule: PlayerIncentiveRule, statOptions = defaultStatOptions) {
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
