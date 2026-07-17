import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { AlertCircle, CalendarDays, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, ClipboardCheck, Copy, Download, Filter, Link as LinkIcon, ListChecks, MapPin, RefreshCw } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { Modal } from '../components/Modal';
import { SchedulePageSkeleton } from '../components/PageSkeletons';
import { PullToRefresh } from '../components/PullToRefresh';
import { addTeamCalendarUrl, createScheduledGameForApp, createScheduledPracticeForApp, createScheduledTournamentBlockForApp, createScheduleImportGame, createScheduleImportPractice, finalizeScheduleImportBatch, loadParentSchedule, loadScheduleStatTrackerConfigsForApp, removeTeamCalendarUrl, type ParentScheduleChild, type ParentScheduleStaffTeam, type ScheduleGameFormInput, type SchedulePracticeFormInput, type PracticeRecurrenceFormInput, type ScheduleStatTrackerConfigOption, type ScheduleTournamentCreateFormInput } from '../lib/scheduleService';
import { getCachedAppData, getParentScheduleSummaryCacheKey, loadCachedAppData } from '../lib/appDataCache';
import { toAppServiceError, type AppServiceError } from '../lib/appErrors';
import { startAppInitialLoadTimer } from '../lib/telemetry';
import { recordFirstMeaningfulRender, startScreenMountTimer } from '../lib/uxTiming';
import { WORKFLOW_TIMING, startWorkflowTimer } from '../lib/workflowTiming';
import { completeParentCoreWorkflowTimer } from '../lib/parentWorkflowTiming';
import { useViewLoadTimer } from '../lib/viewLoadTiming';
import { useAsyncOperation } from '../lib/useAsyncOperation';
import { useRefreshOnResume } from '../lib/useRefreshOnResume';
import { useShellLayout } from '../lib/useShellLayout';
import {
  buildScheduleIcs,
  buildScheduleAgendaText,
  canSubmitScheduleEventRsvp,
  filterParentScheduleEvents,
  formatEventDateLabel,
  formatEventTimeLabel,
  getCalendarScheduleEntries,
  getEventOpenAssignmentCount,
  getGenericEventDetailPath,
  getManageableScheduleTeamOptions,
  getParentScheduleTeamOptions,
  getScheduleEventDetailPath,
  getWindowedCalendarScheduleEntries,
  getWindowedPracticePacketRows,
  getScheduleTitle,
  getScheduleTournamentInfo,
  getScheduleMapHref,
  getScheduleForecastHref,
  normalizeRsvpResponse,
  validateExternalCalendarUrl,
  type CalendarScheduleEntry,
  type ParentScheduleEvent,
  type ParentScheduleFilter,
  type ParentScheduleTeamOption,
  type PracticePacketScheduleRow,
  type RsvpResponse,
  type ScheduleTimeRange,
  type ScheduleTournamentInfo,
  type ScheduleTournamentStandingRow,
  type ScheduleViewMode
} from '../lib/scheduleLogic';
import type { AuthState } from '../lib/types';

const filterOptions: Array<{ value: ParentScheduleFilter; label: string }> = [
  { value: 'upcoming-all', label: 'All Upcoming' },
  { value: 'upcoming-games', label: 'Upcoming Games' },
  { value: 'upcoming-practices', label: 'Upcoming Practices' },
  { value: 'availability', label: 'Availability' },
  { value: 'recent-results', label: 'Recent Results' },
  { value: 'past-all', label: 'Past Events' }
];

const timeRangeOptions: Array<{ value: ScheduleTimeRange; label: string }> = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'quarter', label: 'Quarter' },
  { value: 'all', label: 'All' }
];
const scheduleViewModes: ScheduleViewMode[] = ['list', 'compact', 'calendar', 'packets'];
const scheduleFilterValues = filterOptions.map((option) => option.value);
const scheduleTimeRangeValues = timeRangeOptions.map((option) => option.value);

const upcomingListPageSize = 20;
const pastListPageSize = 10;
const pastScheduleCutoffMs = 3 * 60 * 60 * 1000;
const pastScheduleHistoryPageWindowMs = 365 * 24 * 60 * 60 * 1000;
const pastScheduleInitialHistoryWindowMs = 400 * 24 * 60 * 60 * 1000;

const rsvpLabels: Record<RsvpResponse, string> = {
  going: 'Going',
  maybe: 'Maybe',
  not_going: "Can't go",
  not_responded: 'RSVP needed'
};

const rsvpBadgeClasses: Record<RsvpResponse, string> = {
  going: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  maybe: 'border-amber-200 bg-amber-50 text-amber-700',
  not_going: 'border-rose-200 bg-rose-50 text-rose-700',
  not_responded: 'border-primary-200 bg-primary-50 text-primary-700'
};

type ScheduleCsvImportFieldKey = 'startDateTime' | 'date' | 'startTime' | 'endTime' | 'eventType' | 'opponent' | 'title' | 'location' | 'arrivalTime' | 'isHome' | 'notes';
type ScheduleCsvImportMapping = Partial<Record<ScheduleCsvImportFieldKey, string>>;
type ScheduleCsvImportNormalizedRow = {
  rowNumber: number;
  eventType: 'game' | 'practice';
  startsAt: string;
  endsAt: string | null;
  opponent: string | null;
  title: string | null;
  location: string | null;
  arrivalTime: string | null;
  isHome: boolean | null;
  notes: string | null;
};
type ScheduleCsvImportPreviewRow = {
  rowNumber: number;
  draft: Record<string, string>;
  normalized: ScheduleCsvImportNormalizedRow;
  errors: string[];
};
type ScheduleTournamentGameFieldErrors = Partial<Record<'opponent' | 'startDate' | 'endDate' | 'arrivalTime', string>>;
type ScheduleTournamentCreateFieldErrors = Partial<Record<'divisionName' | 'bracketName' | 'roundName' | 'games', string>> & {
  gameRows?: ScheduleTournamentGameFieldErrors[];
};

const SCHEDULE_CSV_IMPORT_FIELDS: Array<{ key: ScheduleCsvImportFieldKey; label: string }> = [
  { key: 'startDateTime', label: 'Start Date & Time' },
  { key: 'date', label: 'Date' },
  { key: 'startTime', label: 'Start Time' },
  { key: 'endTime', label: 'End Time' },
  { key: 'eventType', label: 'Event Type' },
  { key: 'opponent', label: 'Opponent' },
  { key: 'title', label: 'Title' },
  { key: 'location', label: 'Location' },
  { key: 'arrivalTime', label: 'Arrival Time' },
  { key: 'isHome', label: 'Home / Away' },
  { key: 'notes', label: 'Notes' }
];

type ScheduleCsvImportModule = typeof import('../lib/scheduleCsvImport');
type ScheduleAiImportModule = typeof import('../lib/scheduleAiImport');

let scheduleCsvImportModulePromise: Promise<ScheduleCsvImportModule> | null = null;
let scheduleAiImportModulePromise: Promise<ScheduleAiImportModule> | null = null;

function loadScheduleCsvImportModule() {
  if (!scheduleCsvImportModulePromise) {
    scheduleCsvImportModulePromise = import('../lib/scheduleCsvImport');
  }
  return scheduleCsvImportModulePromise;
}

function loadScheduleAiImportModule() {
  if (!scheduleAiImportModulePromise) {
    scheduleAiImportModulePromise = import('../lib/scheduleAiImport');
  }
  return scheduleAiImportModulePromise;
}

function getScheduleViewFromQuery(value: string | null): ScheduleViewMode | null {
  const normalized = String(value || '').trim().toLowerCase();
  return scheduleViewModes.includes(normalized as ScheduleViewMode) ? normalized as ScheduleViewMode : null;
}

function getScheduleFilterFromQuery(value: string | null): ParentScheduleFilter | null {
  const normalized = String(value || '').trim().toLowerCase();
  return scheduleFilterValues.includes(normalized as ParentScheduleFilter) ? normalized as ParentScheduleFilter : null;
}

function getScheduleTimeRangeFromQuery(value: string | null): ScheduleTimeRange | null {
  const normalized = String(value || '').trim().toLowerCase();
  return scheduleTimeRangeValues.includes(normalized as ScheduleTimeRange) ? normalized as ScheduleTimeRange : null;
}

export function Schedule({ auth }: { auth: AuthState }) {
  const [searchParams] = useSearchParams();
  const { isDesktopWeb } = useShellLayout();
  const [filter, setFilter] = useState<ParentScheduleFilter>(() => getScheduleFilterFromQuery(searchParams.get('filter')) || 'upcoming-all');
  const [view, setView] = useState<ScheduleViewMode>(() => getScheduleViewFromQuery(searchParams.get('view')) || 'list');
  const [selectedPlayerId, setSelectedPlayerId] = useState(() => String(searchParams.get('playerId') || '').trim());
  const [selectedTeamId, setSelectedTeamId] = useState(() => String(searchParams.get('teamId') || '').trim());
  const [timeRange, setTimeRange] = useState<ScheduleTimeRange>(() => getScheduleTimeRangeFromQuery(searchParams.get('range')) || 'all');
  const [children, setChildren] = useState<ParentScheduleChild[]>([]);
  const [events, setEvents] = useState<ParentScheduleEvent[]>([]);
  const [staffTeams, setStaffTeams] = useState<ParentScheduleStaffTeam[]>([]);
  const [scheduleLoadError, setScheduleLoadError] = useState<AppServiceError | null>(null);
  const {
    loading: scheduleReadLoading,
    error: scheduleReadError,
    clearError: clearScheduleReadError,
    run: runScheduleRead
  } = useAsyncOperation();
  const {
    loading: loadingPastHistory,
    run: runPastHistoryRead
  } = useAsyncOperation();
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [visibleListCount, setVisibleListCount] = useState(upcomingListPageSize);
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1);
  });
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [desktopAdvancedControlsOpen, setDesktopAdvancedControlsOpen] = useState(false);
  const [desktopStaffToolsOpen, setDesktopStaffToolsOpen] = useState(false);
  const [calendarUrl, setCalendarUrl] = useState('');
  const [calendarUrlError, setCalendarUrlError] = useState<string | null>(null);
  const [savingCalendarUrl, setSavingCalendarUrl] = useState(false);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<Array<Record<string, string>>>([]);
  const [csvMapping, setCsvMapping] = useState<ScheduleCsvImportMapping>({});
  const csvHeadersRef = useRef<string[]>([]);
  const csvRowsRef = useRef<Array<Record<string, string>>>([]);
  const csvMappingRef = useRef<ScheduleCsvImportMapping>({});
  const csvLoadPromiseRef = useRef<Promise<void> | null>(null);
  const [csvPreviewRows, setCsvPreviewRows] = useState<ScheduleCsvImportPreviewRow[]>([]);
  const [scheduleImportPreviewSource, setScheduleImportPreviewSource] = useState<'csv' | 'ai' | null>(null);
  const [csvImportErrors, setCsvImportErrors] = useState<string[]>([]);
  const [csvFileName, setCsvFileName] = useState('');
  const [loadingCsvFile, setLoadingCsvFile] = useState(false);
  const [aiScheduleText, setAiScheduleText] = useState('');
  const [aiScheduleImage, setAiScheduleImage] = useState<File | null>(null);
  const [aiScheduleImageName, setAiScheduleImageName] = useState('');
  const [aiImportErrors, setAiImportErrors] = useState<string[]>([]);
  const [processingAiImport, setProcessingAiImport] = useState(false);
  const [importingCsv, setImportingCsv] = useState(false);
  const [removingCalendarUrl, setRemovingCalendarUrl] = useState<string | null>(null);
  const [mobileStaffToolsOpen, setMobileStaffToolsOpen] = useState(false);
  const [scheduleStaffToolMode, setScheduleStaffToolMode] = useState<'menu' | 'tournament'>('menu');
  const [gameForm, setGameForm] = useState<ScheduleGameFormInput>(() => getDefaultScheduleGameForm());
  const [savingGame, setSavingGame] = useState(false);
  const [gameFormError, setGameFormError] = useState<string | null>(null);
  const [gameTrackerConfigs, setGameTrackerConfigs] = useState<ScheduleStatTrackerConfigOption[]>([]);
  const [gameTrackerConfigsLoading, setGameTrackerConfigsLoading] = useState(false);
  const [gameTrackerConfigError, setGameTrackerConfigError] = useState<string | null>(null);
  const [tournamentForm, setTournamentForm] = useState<ScheduleTournamentCreateFormInput>(() => getDefaultScheduleTournamentForm());
  const [savingTournament, setSavingTournament] = useState(false);
  const [tournamentFormError, setTournamentFormError] = useState<string | null>(null);
  const [tournamentFormFieldErrors, setTournamentFormFieldErrors] = useState<ScheduleTournamentCreateFieldErrors>({});
  const [practiceForm, setPracticeForm] = useState<SchedulePracticeFormInput>(() => getDefaultSchedulePracticeForm());
  const [savingPractice, setSavingPractice] = useState(false);
  const [practiceFormError, setPracticeFormError] = useState<string | null>(null);
  const [loadedScheduleUserId, setLoadedScheduleUserId] = useState<string | null>(null);
  const [pastHistoryHasMore, setPastHistoryHasMore] = useState(false);
  const hasLoadedScheduleRef = useRef(false);
  const hasStartedInitialScheduleLoadRef = useRef(false);
  const pastHistoryLoadedRef = useRef(false);
  const childrenRef = useRef<ParentScheduleChild[]>([]);
  const eventsRef = useRef<ParentScheduleEvent[]>([]);
  const trackerConfigCacheRef = useRef<Record<string, ScheduleStatTrackerConfigOption[]>>({});
  const trackerConfigRequestPromiseRef = useRef<Record<string, Promise<ScheduleStatTrackerConfigOption[]>>>({});
  const [trackerConfigRequestedTeamIds, setTrackerConfigRequestedTeamIds] = useState<Record<string, true>>({});

  const applyScheduleResult = (data: { children: ParentScheduleChild[]; events: ParentScheduleEvent[]; staffTeams?: ParentScheduleStaffTeam[]; }) => {
    childrenRef.current = data.children;
    eventsRef.current = data.events;
    setChildren(data.children);
    setEvents(data.events);
    setStaffTeams(data.staffTeams ?? []);
  };

  const mergeScheduleResult = (data: { children: ParentScheduleChild[]; events: ParentScheduleEvent[]; }) => {
    const mergedChildren = [...childrenRef.current];
    const childKeys = new Set(mergedChildren.map((child) => `${child.teamId}::${child.playerId}`));
    data.children.forEach((child) => {
      const key = `${child.teamId}::${child.playerId}`;
      if (!childKeys.has(key)) {
        childKeys.add(key);
        mergedChildren.push(child);
      }
    });

    const mergedEvents = [...eventsRef.current];
    const eventKeys = new Set(mergedEvents.map((event) => event.eventKey));
    data.events.forEach((event) => {
      if (!eventKeys.has(event.eventKey)) {
        eventKeys.add(event.eventKey);
        mergedEvents.push(event);
      }
    });
    mergedEvents.sort((a, b) => a.date.getTime() - b.date.getTime());
    childrenRef.current = mergedChildren;
    eventsRef.current = mergedEvents;
    setChildren(mergedChildren);
    setEvents(mergedEvents);
  };

  const buildPastScheduleRangeByTeam = () => {
    const cutoff = new Date(Date.now() - pastScheduleCutoffMs);
    const defaultHistoryBoundary = new Date(Date.now() - pastScheduleInitialHistoryWindowMs);
    const oldestPastEventByTeam = new Map<string, Date>();
    eventsRef.current.forEach((event) => {
      if (event.date >= cutoff) return;
      const currentOldest = oldestPastEventByTeam.get(event.teamId);
      if (!currentOldest || event.date < currentOldest) {
        oldestPastEventByTeam.set(event.teamId, event.date);
      }
    });

    const teamIds = Array.from(new Set(childrenRef.current.map((child) => child.teamId).filter(Boolean)));
    if (!teamIds.length) {
      return null;
    }

    return Object.fromEntries(
      teamIds.map((teamId) => {
        const boundaryDate = oldestPastEventByTeam.get(teamId) || defaultHistoryBoundary;
        const endDate = new Date(boundaryDate.getTime() - 1);
        return [teamId, {
          startDate: new Date(endDate.getTime() - pastScheduleHistoryPageWindowMs),
          endDate
        }];
      })
    );
  };

  const loadPastSchedulePage = async () => {
    const user = auth.user;
    if (!user || loadingPastHistory) return false;
    const scheduleRangeByTeam = buildPastScheduleRangeByTeam();
    if (!scheduleRangeByTeam) {
      setPastHistoryHasMore(false);
      return false;
    }

    const loaded = await runPastHistoryRead(
      async () => {
        const beforeKeys = new Set(eventsRef.current.map((event) => event.eventKey));
        const result = await loadParentSchedule(user, {
          hydrateDetails: false,
          expandStaffPlayers: false,
          scheduleRangeByTeam
        });
        return {
          children: result.children,
          events: result.events.filter((event) => !beforeKeys.has(event.eventKey))
        };
      },
      {
        clearError: false,
        rethrow: false,
        onSuccess: (result) => {
          if (!result.events.length) {
            setPastHistoryHasMore(false);
            return;
          }
          mergeScheduleResult({ children: result.children, events: result.events });
          setPastHistoryHasMore(true);
        }
      }
    );

    return Boolean(loaded?.events.length);
  };

  const ensurePastSchedulePageLoaded = async (force = false) => {
    if (pastHistoryLoadedRef.current && !force) return;
    pastHistoryLoadedRef.current = true;
    setPastHistoryHasMore(true);
    const loaded = await loadPastSchedulePage();
    if (!loaded) {
      setPastHistoryHasMore(false);
    }
  };

  const hasLoadedSchedule = Boolean(auth.user?.uid) && loadedScheduleUserId === auth.user?.uid && hasLoadedScheduleRef.current;
  const isInitialScheduleLoad = Boolean(auth.user?.uid) && loadedScheduleUserId !== auth.user?.uid;

  const clearAiPreview = () => {
    if (scheduleImportPreviewSource === 'ai') {
      setCsvPreviewRows([]);
      setScheduleImportPreviewSource(null);
    }
  };

  useEffect(() => {
    const nextFilter = getScheduleFilterFromQuery(searchParams.get('filter'));
    if (nextFilter) setFilter(nextFilter);

    const nextView = getScheduleViewFromQuery(searchParams.get('view'));
    if (nextView) setView(nextView);

    const nextRange = getScheduleTimeRangeFromQuery(searchParams.get('range'));
    if (nextRange) setTimeRange(nextRange);

    setSelectedTeamId(String(searchParams.get('teamId') || '').trim());
    setSelectedPlayerId(String(searchParams.get('playerId') || '').trim());
  }, [searchParams]);

  const refreshSchedule = async (force = false) => {
    if (!auth.user) return null;
    clearScheduleReadError();
    setScheduleLoadError(null);
    setStatusMessage(null);
    const hasExistingSchedule = hasLoadedScheduleRef.current;
    const initialLoadTimer = !hasExistingSchedule
      ? startAppInitialLoadTimer('schedule', { route: 'schedule' })
      : null;
    const timer = startScreenMountTimer('schedule', {
      force,
      hasExistingSchedule
    });
    const cacheKey = getParentScheduleSummaryCacheKey(auth.user.uid);
    const scheduleCacheTtlMs = 60 * 1000 * 5;
    const scheduleCacheOptions = { ttlMs: scheduleCacheTtlMs, force };
    const cached = getCachedAppData(cacheKey);

    return runScheduleRead(
      () => loadCachedAppData(
        cacheKey,
        () => loadParentSchedule(auth.user, { hydrateDetails: false, expandStaffPlayers: false }),
        {
          ...scheduleCacheOptions,
          shouldCache: (result) => result?.isPartial !== true
        }
      ),
      {
        getErrorMessage: (loadError) => {
          return getScheduleLoadErrorMessage(toAppServiceError(loadError, 'Unable to load schedule.'), hasExistingSchedule);
        },
        rethrow: false,
        onSuccess: (result) => {
          hasLoadedScheduleRef.current = true;
          setLoadedScheduleUserId(auth.user?.uid || null);
          setScheduleLoadError(null);
          applyScheduleResult(result);
          completeParentCoreWorkflowTimer('schedule', {
            targetPage: 'schedule',
            teamId: selectedTeamId || '',
            playerId: selectedPlayerId || '',
            filter,
            view,
            eventCount: result.events.length,
            completedRoute: '/schedule'
          });

          if (filter === 'past-all') {
            pastHistoryLoadedRef.current = false;
            setPastHistoryHasMore(true);
            void ensurePastSchedulePageLoaded(true);
          }

          if (selectedPlayerId && !result.children.some((child) => child.playerId === selectedPlayerId)) {
            setSelectedPlayerId('');
          }
          if (selectedTeamId && !result.children.some((child) => child.teamId === selectedTeamId) && !result.events.some((event) => event.teamId === selectedTeamId)) {
            setSelectedTeamId('');
          }
          const firstUpcoming = filterParentScheduleEvents(result.events, { filter: 'upcoming-all' })[0];
          if (firstUpcoming) {
            setCalendarMonth(new Date(firstUpcoming.date.getFullYear(), firstUpcoming.date.getMonth(), 1));
          }

          timer.end({
            cacheHit: Boolean(cached) && !force,
            force,
            childCount: result.children.length,
            eventRowCount: result.events.length,
            groupedEventCount: getCalendarScheduleEntries(result.events).length
          });
          initialLoadTimer?.end({
            cacheHit: Boolean(cached) && !force,
            force,
            children: result.children.length,
            eventRows: result.events.length,
            groupedEvents: getCalendarScheduleEntries(result.events).length
          });
        },
        onError: (loadError) => {
          const mappedError = toAppServiceError(loadError, 'Unable to load schedule.');
          setScheduleLoadError(mappedError);
          if (!hasExistingSchedule) {
            applyScheduleResult({ children: [], events: [] });
          }
          setLoadedScheduleUserId(auth.user?.uid || null);
          timer.end({
            force,
            error: mappedError.message
          });
          initialLoadTimer?.end({
            force,
            error: mappedError
          });
        }
      }
    );
  };

  useEffect(() => {
    hasLoadedScheduleRef.current = false;
    hasStartedInitialScheduleLoadRef.current = false;
    pastHistoryLoadedRef.current = false;
    setPastHistoryHasMore(false);
    if (!auth.user?.uid) {
      setLoadedScheduleUserId(null);
      applyScheduleResult({ children: [], events: [] });
      return;
    }
    hasStartedInitialScheduleLoadRef.current = true;
    void refreshSchedule();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.user?.uid]);

  useEffect(() => {
    if (filter === 'past-all' && hasLoadedSchedule) {
      void ensurePastSchedulePageLoaded();
      return;
    }
    setPastHistoryHasMore(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, hasLoadedSchedule]);

  useRefreshOnResume(() => { void refreshSchedule(true); }, { enabled: Boolean(auth.user?.uid) });

  useEffect(() => {
    if (!hasStartedInitialScheduleLoadRef.current || scheduleReadLoading || isInitialScheduleLoad) {
      return;
    }
    recordFirstMeaningfulRender('schedule');
  }, [isInitialScheduleLoad, scheduleReadLoading]);

  const visibleEvents = useMemo(() => (
    filterParentScheduleEvents(events, { filter, playerId: selectedPlayerId, teamId: selectedTeamId, timeRange })
  ), [events, filter, selectedPlayerId, selectedTeamId, timeRange]);
  const scheduleRoute = `/schedule${searchParams.toString() ? `?${searchParams.toString()}` : ''}`;

  useViewLoadTimer({
    viewName: 'schedule',
    route: scheduleRoute,
    ready: hasLoadedSchedule && !scheduleReadLoading && !isInitialScheduleLoad,
    resetKey: `${auth.user?.uid || 'anonymous'}:${scheduleRoute}`,
    disabled: !auth.user,
    getBaseMeta: () => ({
      page: 'schedule',
      filter,
      view,
      selectedTeamId,
      selectedPlayerId,
      timeRange
    }),
    getCompleteMeta: () => ({
      eventCount: events.length,
      visibleEventCount: visibleEvents.length,
      childCount: children.length,
      filter,
      view,
      selectedTeamId,
      selectedPlayerId,
      timeRange
    })
  });

  const listPageSize = filter === 'past-all' ? pastListPageSize : upcomingListPageSize;

  useEffect(() => {
    setVisibleListCount(filter === 'past-all' ? pastListPageSize : upcomingListPageSize);
  }, [filter, selectedPlayerId, selectedTeamId, timeRange, view]);

  const listWindowLimit = visibleListCount + 1;
  const calendarEntries = useMemo(() => (
    view === 'calendar' ? getCalendarScheduleEntries(visibleEvents) : []
  ), [visibleEvents, view]);
  const packetWindow = useMemo(() => (
    getWindowedPracticePacketRows(visibleEvents, view === 'packets' ? listWindowLimit : 0)
  ), [listWindowLimit, visibleEvents, view]);
  const windowedListEntries = useMemo(() => (
    view === 'calendar'
      ? {
          entries: calendarEntries,
          totalCount: calendarEntries.length,
          gameCount: calendarEntries.filter((event) => event.type === 'game').length,
          practiceCount: calendarEntries.filter((event) => event.type === 'practice').length,
          hasMore: false,
          nextEvent: calendarEntries.find((event) => !event.isCancelled) || null,
          packetsReady: packetWindow.readyCount,
          openAssignments: calendarEntries.reduce((total, event) => total + getEventOpenAssignmentCount(event), 0),
          rideRequests: calendarEntries.reduce((total, event) => total + (event.rideshareSummary?.requests || 0), 0)
        }
      : getWindowedCalendarScheduleEntries(visibleEvents, listWindowLimit)
  ), [calendarEntries, listWindowLimit, packetWindow.readyCount, visibleEvents, view]);
  const listEntries = windowedListEntries.entries;
  const packetRows = packetWindow.rows;
  const canLoadMorePastHistory = filter === 'past-all' && (pastHistoryHasMore || visibleListCount < windowedListEntries.totalCount);
  const canLoadMorePacketRows = (filter === 'past-all' && pastHistoryHasMore) || visibleListCount < packetWindow.totalCount;

  const handleShowMore = async () => {
    if (visibleListCount < windowedListEntries.totalCount) {
      setVisibleListCount((current) => Math.min(current + listPageSize, windowedListEntries.totalCount));
      return;
    }
    if (filter !== 'past-all' || !pastHistoryHasMore || loadingPastHistory) {
      return;
    }
    const loaded = await loadPastSchedulePage();
    if (loaded) {
      setVisibleListCount((current) => current + listPageSize);
    }
  };
  const handleShowMorePackets = async () => {
    if (visibleListCount < packetWindow.totalCount) {
      setVisibleListCount((current) => Math.min(current + listPageSize, packetWindow.totalCount));
      return;
    }
    if (filter !== 'past-all' || !pastHistoryHasMore || loadingPastHistory) {
      return;
    }
    const loaded = await loadPastSchedulePage();
    if (loaded) {
      setVisibleListCount((current) => current + listPageSize);
    }
  };
  const teamOptions = useMemo(() => getParentScheduleTeamOptions(events, children), [children, events]);
  const selectedDayEntries = useMemo(() => {
    if (!selectedDay) return [];
    return calendarEntries.filter((event) =>
      event.date.getFullYear() === selectedDay.getFullYear() &&
      event.date.getMonth() === selectedDay.getMonth() &&
      event.date.getDate() === selectedDay.getDate()
    );
  }, [calendarEntries, selectedDay]);

  const counts = useMemo(() => ({
    total: windowedListEntries.totalCount,
    games: windowedListEntries.gameCount,
    practices: windowedListEntries.practiceCount,
    rsvpNeeded: visibleEvents.filter(isScheduleAvailabilityNeeded).length,
    packetsReady: packetWindow.readyCount
  }), [packetWindow.readyCount, visibleEvents, windowedListEntries.gameCount, windowedListEntries.practiceCount, windowedListEntries.totalCount]);
  const webInsights = useMemo(() => ({
    nextEvent: windowedListEntries.nextEvent,
    rsvpNeeded: counts.rsvpNeeded,
    packetsReady: counts.packetsReady,
    openAssignments: windowedListEntries.openAssignments,
    rideRequests: windowedListEntries.rideRequests
  }), [counts.packetsReady, counts.rsvpNeeded, windowedListEntries.nextEvent, windowedListEntries.openAssignments, windowedListEntries.rideRequests]);
  const manageableTeamOptions = useMemo(() => (
    getManageableScheduleTeamOptions(teamOptions, events, staffTeams)
  ), [events, staffTeams, teamOptions]);
  const [selectedStaffManageTeamId, setSelectedStaffManageTeamId] = useState('');
  const hasManageableScheduleTeams = manageableTeamOptions.length > 0;
  const selectedCalendarTeam = useMemo(() => {
    const pageSelectedManageableTeam = selectedTeamId
      ? manageableTeamOptions.find((team) => team.teamId === selectedTeamId) || null
      : null;
    if (pageSelectedManageableTeam) {
      return pageSelectedManageableTeam;
    }
    if (selectedStaffManageTeamId) {
      return manageableTeamOptions.find((team) => team.teamId === selectedStaffManageTeamId) || null;
    }
    return manageableTeamOptions.length === 1 ? manageableTeamOptions[0] : null;
  }, [manageableTeamOptions, selectedStaffManageTeamId, selectedTeamId]);
  const shouldShowManageScheduleTeamPicker = !selectedCalendarTeam && manageableTeamOptions.length > 1;

  useEffect(() => {
    if (!selectedStaffManageTeamId) {
      return;
    }
    const stillManageable = manageableTeamOptions.some((team) => team.teamId === selectedStaffManageTeamId);
    if (!stillManageable) {
      setSelectedStaffManageTeamId('');
    }
  }, [manageableTeamOptions, selectedStaffManageTeamId]);

  useEffect(() => {
    if (isDesktopWeb || !hasManageableScheduleTeams) {
      setMobileStaffToolsOpen(false);
      setScheduleStaffToolMode('menu');
    }
  }, [hasManageableScheduleTeams, isDesktopWeb]);

  useEffect(() => {
    if (!isDesktopWeb || !hasManageableScheduleTeams) {
      setDesktopStaffToolsOpen(false);
      setScheduleStaffToolMode('menu');
    }
  }, [hasManageableScheduleTeams, isDesktopWeb]);

  useEffect(() => {
    setScheduleStaffToolMode('menu');
  }, [selectedCalendarTeam?.teamId]);

  const requestTrackerConfigLoad = () => {
    if (!selectedCalendarTeam) return;
    setTrackerConfigRequestedTeamIds((current) => {
      if (current[selectedCalendarTeam.teamId]) return current;
      return {
        ...current,
        [selectedCalendarTeam.teamId]: true
      };
    });
  };

  useEffect(() => {
    if (!selectedCalendarTeam) {
      setGameTrackerConfigs([]);
      setGameTrackerConfigsLoading(false);
      setGameTrackerConfigError(null);
      return;
    }
    const cachedConfigs = trackerConfigCacheRef.current[selectedCalendarTeam.teamId];
    setGameTrackerConfigs(cachedConfigs || []);
    setGameTrackerConfigsLoading(false);
    setGameTrackerConfigError(null);
  }, [selectedCalendarTeam]);


  useEffect(() => {
    let cancelled = false;
    if (!selectedCalendarTeam || !auth.user) return;
    const shouldLoadTrackerConfigs = desktopStaffToolsOpen
      || mobileStaffToolsOpen
      || trackerConfigRequestedTeamIds[selectedCalendarTeam.teamId];
    if (!shouldLoadTrackerConfigs) return;

    const cachedConfigs = trackerConfigCacheRef.current[selectedCalendarTeam.teamId];
    if (cachedConfigs) {
      setGameTrackerConfigs(cachedConfigs);
      setGameTrackerConfigsLoading(false);
      setGameTrackerConfigError(null);
      return;
    }

    setGameTrackerConfigs([]);
    setGameTrackerConfigsLoading(true);
    setGameTrackerConfigError(null);

    const cachedPromise = trackerConfigRequestPromiseRef.current[selectedCalendarTeam.teamId]
      || loadScheduleStatTrackerConfigsForApp(selectedCalendarTeam.teamId, auth.user);
    trackerConfigRequestPromiseRef.current[selectedCalendarTeam.teamId] = cachedPromise;

    cachedPromise
      .then((configs) => {
        trackerConfigCacheRef.current[selectedCalendarTeam.teamId] = configs;
        delete trackerConfigRequestPromiseRef.current[selectedCalendarTeam.teamId];
        if (!cancelled) {
          setGameTrackerConfigs(configs);
          setGameTrackerConfigsLoading(false);
          setGameTrackerConfigError(null);
        }
      })
      .catch((configError: any) => {
        delete trackerConfigRequestPromiseRef.current[selectedCalendarTeam.teamId];
        if (!cancelled) {
          setGameTrackerConfigsLoading(false);
          setGameTrackerConfigError(configError?.message || 'Unable to load tracker configs.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [auth.user, desktopStaffToolsOpen, mobileStaffToolsOpen, selectedCalendarTeam, trackerConfigRequestedTeamIds]);

  const renderScheduleStaffToolsContent = () => {
    if (shouldShowManageScheduleTeamPicker) {
      return (
        <section className="app-card p-3 sm:p-4" aria-label="Choose team to manage">
          <div className="app-label">Choose team</div>
          <h3 className="mt-1 text-base font-black text-gray-950">Choose the team to manage</h3>
          <p className="mt-1 text-sm font-semibold leading-6 text-gray-600">Pick a team here to unlock game, practice, tournament, and import tools.</p>
          <label className="mt-3 block text-xs font-bold uppercase tracking-wide text-gray-600">
            Team to manage
            <select
              aria-label="Team to manage"
              className="auth-input mt-1"
              value={selectedStaffManageTeamId}
              onChange={(event) => setSelectedStaffManageTeamId(event.target.value)}
            >
              <option value="">Select a team</option>
              {manageableTeamOptions.map((team) => (
                <option key={team.teamId} value={team.teamId}>{team.teamName}</option>
              ))}
            </select>
          </label>
        </section>
      );
    }
    return selectedCalendarTeam ? (
      <>
        <ScheduleGameCreatePanel
          teamName={selectedCalendarTeam.teamName}
          form={gameForm}
          configs={gameTrackerConfigs}
          configsLoading={gameTrackerConfigsLoading}
          saving={savingGame}
          error={gameFormError}
          configError={gameTrackerConfigError}
          onStartUsing={requestTrackerConfigLoad}
          onChange={(nextForm) => {
            setGameForm(nextForm);
            if (gameFormError) setGameFormError(null);
          }}
          onSubmit={handleCreateGame}
        />
        <ScheduleTournamentEntryCard
          teamName={selectedCalendarTeam.teamName}
          onOpen={() => {
            requestTrackerConfigLoad();
            setTournamentFormError(null);
            setTournamentFormFieldErrors({});
            setScheduleStaffToolMode('tournament');
          }}
        />
        {scheduleStaffToolMode === 'tournament' ? (
          <ScheduleTournamentCreateModal
            saving={savingTournament}
            onClose={() => {
              if (savingTournament) return;
              setTournamentForm(getDefaultScheduleTournamentForm());
              setTournamentFormError(null);
              setTournamentFormFieldErrors({});
              setScheduleStaffToolMode('menu');
            }}
          >
            <ScheduleTournamentCreatePanel
              teamName={selectedCalendarTeam.teamName}
              form={tournamentForm}
              configs={gameTrackerConfigs}
              saving={savingTournament}
              error={tournamentFormError}
              fieldErrors={tournamentFormFieldErrors}
              configError={gameTrackerConfigError}
              onStartUsing={requestTrackerConfigLoad}
              onChange={(nextForm) => {
                setTournamentForm(nextForm);
                if (tournamentFormError || hasScheduleTournamentFieldErrors(tournamentFormFieldErrors)) {
                  const validation = getScheduleTournamentCreateFormValidation(nextForm);
                  setTournamentFormError(validation.formError);
                  setTournamentFormFieldErrors(validation.fieldErrors);
                }
              }}
              onCancel={() => {
                setTournamentForm(getDefaultScheduleTournamentForm());
                setTournamentFormError(null);
                setTournamentFormFieldErrors({});
                setScheduleStaffToolMode('menu');
              }}
              onSubmit={handleCreateTournament}
            />
          </ScheduleTournamentCreateModal>
        ) : null}
        <SchedulePracticeCreatePanel
          teamName={selectedCalendarTeam.teamName}
          form={practiceForm}
          saving={savingPractice}
          error={practiceFormError}
          onChange={(nextForm) => {
            setPracticeForm(nextForm);
            if (practiceFormError) setPracticeFormError(null);
          }}
          onSubmit={handleCreatePractice}
        />
        <ScheduleStaffTools
          teamName={selectedCalendarTeam.teamName}
          calendarUrl={calendarUrl}
          calendarUrls={selectedCalendarTeam.calendarUrls || []}
          calendarUrlError={calendarUrlError}
          savingCalendarUrl={savingCalendarUrl}
          removingCalendarUrl={removingCalendarUrl}
          aiScheduleText={aiScheduleText}
          aiScheduleImageName={aiScheduleImageName}
          aiPreviewRows={scheduleImportPreviewSource === 'ai' ? csvPreviewRows : []}
          aiImportErrors={aiImportErrors}
          processingAiImport={processingAiImport}
          csvHeaders={csvHeaders}
          csvMapping={csvMapping}
          csvPreviewRows={scheduleImportPreviewSource === 'csv' ? csvPreviewRows : []}
          csvImportErrors={csvImportErrors}
          csvFileName={csvFileName}
          loadingCsvFile={loadingCsvFile}
          importingCsv={importingCsv}
          onCalendarUrlChange={(value) => {
            setCalendarUrl(value);
            if (calendarUrlError) setCalendarUrlError(null);
          }}
          onAddCalendarUrl={handleAddCalendarUrl}
          onRemoveCalendarUrl={handleRemoveCalendarUrl}
          onAiTextChange={(value) => {
            setAiScheduleText(value);
            clearAiPreview();
            if (aiImportErrors.length) setAiImportErrors([]);
          }}
          onAiImageChange={handleAiImageChange}
          onAiGeneratePreview={handleAiGeneratePreview}
          onImportCsv={handleCsvImport}
          onClearAi={handleAiClear}
          onCsvFileChange={handleCsvFileChange}
          onCsvMappingChange={handleCsvMappingChange}
          onCsvPreview={handleCsvPreview}
          onClearCsv={handleCsvClear}
        />
      </>
    ) : null;
  };

  useEffect(() => {
    setGameForm((current) => {
      if (!current.statTrackerConfigId) return current;
      const hasMatchingConfig = gameTrackerConfigs.some((config) => config.id === current.statTrackerConfigId);
      if (hasMatchingConfig) return current;
      return {
        ...current,
        statTrackerConfigId: ''
      };
    });
  }, [gameTrackerConfigs]);

  useEffect(() => {
    setTournamentForm((current) => ({
      ...current,
      games: current.games.map((game) => {
        if (!game.statTrackerConfigId) return game;
        const hasMatchingConfig = gameTrackerConfigs.some((config) => config.id === game.statTrackerConfigId);
        return hasMatchingConfig ? game : { ...game, statTrackerConfigId: '' };
      })
    }));
  }, [gameTrackerConfigs]);

  const handleCreateGame = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedCalendarTeam || !auth.user || savingGame) return;
    setSavingGame(true);
    setGameFormError(null);
    setStatusMessage(null);
    clearScheduleReadError();
    const timer = startWorkflowTimer(WORKFLOW_TIMING.scheduleCreateGame, {
      route: 'schedule',
      hasStatTrackerConfig: Boolean(gameForm.statTrackerConfigId)
    });
    try {
      await createScheduledGameForApp(selectedCalendarTeam.teamId, gameForm, auth.user);
      setGameForm(getDefaultScheduleGameForm());
      await refreshSchedule(true);
      setStatusMessage('Game created and schedule refreshed.');
      timer.end({ refreshed: true });
    } catch (gameError: any) {
      setGameFormError(gameError?.message || 'Unable to create game.');
      timer.end({ error: gameError });
    } finally {
      setSavingGame(false);
    }
  };

  const handleCreateTournament = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedCalendarTeam || !auth.user || savingTournament) return;
    const validation = getScheduleTournamentCreateFormValidation(tournamentForm);
    if (validation.formError) {
      setTournamentFormError(validation.formError);
      setTournamentFormFieldErrors(validation.fieldErrors);
      setStatusMessage(null);
      return;
    }
    setSavingTournament(true);
    setTournamentFormError(null);
    setTournamentFormFieldErrors({});
    setStatusMessage(null);
    clearScheduleReadError();
    const timer = startWorkflowTimer(WORKFLOW_TIMING.scheduleCreateTournament, {
      route: 'schedule',
      gameCount: tournamentForm.games.length
    });
    try {
      await createScheduledTournamentBlockForApp(selectedCalendarTeam.teamId, tournamentForm, auth.user);
      setTournamentForm(getDefaultScheduleTournamentForm());
      setTournamentFormFieldErrors({});
      setScheduleStaffToolMode('menu');
      await refreshSchedule(true);
      setStatusMessage('Tournament created and schedule refreshed.');
      timer.end({ refreshed: true });
    } catch (tournamentError: any) {
      setTournamentFormError(tournamentError?.message || 'Unable to create tournament.');
      timer.end({ error: tournamentError });
    } finally {
      setSavingTournament(false);
    }
  };

  const handleCreatePractice = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedCalendarTeam || !auth.user || savingPractice) return;
    setSavingPractice(true);
    setPracticeFormError(null);
    setStatusMessage(null);
    clearScheduleReadError();
    const timer = startWorkflowTimer(WORKFLOW_TIMING.scheduleCreatePractice, {
      route: 'schedule',
      recurring: Boolean(practiceForm.recurrence?.isRecurring)
    });
    try {
      await createScheduledPracticeForApp(selectedCalendarTeam.teamId, practiceForm, auth.user);
      setPracticeForm(getDefaultSchedulePracticeForm());
      await refreshSchedule(true);
      setStatusMessage(practiceForm.recurrence?.isRecurring ? 'Recurring practice series created and schedule refreshed.' : 'Practice created and schedule refreshed.');
      timer.end({ refreshed: true });
    } catch (practiceError: any) {
      setPracticeFormError(practiceError?.message || 'Unable to create practice.');
      timer.end({ error: practiceError });
    } finally {
      setSavingPractice(false);
    }
  };

  const handleCsvFileChange = async (file: File | null) => {
    setCsvImportErrors([]);
    setCsvPreviewRows([]);
    setScheduleImportPreviewSource(null);
    setCsvHeaders([]);
    setCsvRows([]);
    setCsvMapping({});
    csvHeadersRef.current = [];
    csvRowsRef.current = [];
    csvMappingRef.current = {};
    setCsvFileName(file?.name || '');
    setLoadingCsvFile(Boolean(file));
    if (!file) {
      csvLoadPromiseRef.current = null;
      return;
    }
    const loadPromise = (async () => {
      const [{ parseCsvText, inferScheduleCsvMapping }, csvText] = await Promise.all([
        loadScheduleCsvImportModule(),
        file.text()
      ]);
      const parsed = parseCsvText(csvText);
      const inferredMapping = inferScheduleCsvMapping(parsed.headers);
      csvHeadersRef.current = parsed.headers;
      csvRowsRef.current = parsed.rows;
      csvMappingRef.current = inferredMapping;
      setCsvHeaders(parsed.headers);
      setCsvRows(parsed.rows);
      setCsvMapping(inferredMapping);
    })();
    csvLoadPromiseRef.current = loadPromise;
    try {
      await loadPromise;
    } catch (csvError: any) {
      setCsvImportErrors([csvError?.message || 'Could not read the CSV file.']);
    } finally {
      if (csvLoadPromiseRef.current === loadPromise) {
        csvLoadPromiseRef.current = null;
      }
      setLoadingCsvFile(false);
    }
  };

  const handleCsvPreview = async () => {
    if (csvLoadPromiseRef.current) {
      await csvLoadPromiseRef.current;
    }
    const { buildScheduleImportPreview } = await loadScheduleCsvImportModule();
    const preview = buildScheduleImportPreview({
      rows: csvRowsRef.current,
      mapping: csvMappingRef.current,
      teamName: selectedCalendarTeam?.teamName || ''
    });
    setCsvImportErrors(preview.errors);
    setCsvPreviewRows(preview.rows);
    setScheduleImportPreviewSource(preview.rows.length ? 'csv' : null);
  };

  const handleCsvClear = () => {
    setCsvHeaders([]);
    setCsvRows([]);
    setCsvMapping({});
    csvHeadersRef.current = [];
    csvRowsRef.current = [];
    csvMappingRef.current = {};
    csvLoadPromiseRef.current = null;
    setCsvPreviewRows([]);
    setCsvImportErrors([]);
    setCsvFileName('');
    setLoadingCsvFile(false);
    setScheduleImportPreviewSource(null);
  };

  const handleCsvMappingChange = (field: keyof ScheduleCsvImportMapping, value: string) => {
    setCsvMapping((current) => {
      const next = { ...current, [field]: value || undefined };
      csvMappingRef.current = next;
      return next;
    });
  };

  const handleAiImageChange = (file: File | null) => {
    setAiImportErrors([]);
    clearAiPreview();
    setAiScheduleImage(file);
    setAiScheduleImageName(file?.name || '');
  };

  const handleAiClear = () => {
    setAiScheduleText('');
    setAiScheduleImage(null);
    setAiScheduleImageName('');
    setAiImportErrors([]);
    clearAiPreview();
  };

  const handleAiGeneratePreview = async () => {
    if (!selectedCalendarTeam || processingAiImport) return;
    setAiImportErrors([]);
    setCsvImportErrors([]);
    setCsvPreviewRows([]);
    setScheduleImportPreviewSource(null);
    setStatusMessage(null);
    clearScheduleReadError();
    const currentGames = events
      .filter((event) => event.teamId === selectedCalendarTeam.teamId && event.type === 'game' && event.isDbGame)
      .map((event) => ({
        id: event.id,
        date: event.date,
        opponent: event.opponent,
        location: event.location,
        status: event.isCancelled ? 'cancelled' : 'scheduled'
      }));

    setProcessingAiImport(true);
    const timer = startWorkflowTimer(WORKFLOW_TIMING.scheduleAiPreview, {
      route: 'schedule',
      imageAttached: Boolean(aiScheduleImage),
      textLengthBucket: aiScheduleText ? Math.min(5000, Math.ceil(aiScheduleText.length / 250) * 250) : 0,
      currentGameCount: currentGames.length
    });
    try {
      const { generateScheduleAiImportRows } = await loadScheduleAiImportModule();
      const result = await generateScheduleAiImportRows({
        teamName: selectedCalendarTeam.teamName,
        text: aiScheduleText,
        imageFile: aiScheduleImage,
        currentGames
      });
      setAiImportErrors(result.errors);
      setCsvPreviewRows(result.rows);
      setScheduleImportPreviewSource(result.rows.length ? 'ai' : null);
      if (result.rows.length) {
        setStatusMessage(`AI generated ${result.rows.length} draft game row(s). Review them below before importing.`);
      }
      timer.end({
        rowCount: result.rows.length,
        errorCount: result.errors.length
      });
    } catch (aiError: any) {
      setAiImportErrors([aiError?.message || 'Unable to generate schedule preview.']);
      timer.end({ error: aiError });
    } finally {
      setProcessingAiImport(false);
    }
  };

  const handleCsvImport = async () => {
    if (!selectedCalendarTeam || !auth.user || importingCsv) return;
    const invalidRows = csvPreviewRows.filter((row) => row.errors.length > 0);
    if (!csvPreviewRows.length) {
      setCsvImportErrors(['Preview rows before importing.']);
      return;
    }
    if (invalidRows.length > 0) {
      setCsvImportErrors(['Fix invalid rows before importing.']);
      return;
    }

    setImportingCsv(true);
    setCsvImportErrors([]);
    setStatusMessage(null);
    clearScheduleReadError();
    const failedRows: ScheduleCsvImportPreviewRow[] = [];
    const importBatchId = `app-schedule-import-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const importBatchTimestamp = new Date().toISOString();
    const totalCount = csvPreviewRows.length;
    let importedCount = 0;
    const successfulImportIds: string[] = [];
    const timer = startWorkflowTimer(WORKFLOW_TIMING.scheduleImport, {
      route: 'schedule',
      source: scheduleImportPreviewSource || 'csv',
      rowCount: totalCount
    });
    try {
      for (const [index, row] of csvPreviewRows.entries()) {
        const normalizedRow = {
          ...row.normalized,
          importBatch: {
            batchId: importBatchId,
            totalCount,
            rowNumber: row.normalized.rowNumber || row.rowNumber || index + 1,
            importedAt: importBatchTimestamp,
            importedBy: auth.user.uid
          }
        };
        try {
          const createdId = row.normalized.eventType === 'game'
            ? await createScheduleImportGame(selectedCalendarTeam.teamId, normalizedRow, auth.user)
            : await createScheduleImportPractice(selectedCalendarTeam.teamId, normalizedRow, auth.user);
          if (createdId) {
            successfulImportIds.push(createdId);
          }
          importedCount += 1;
        } catch (importError: any) {
          failedRows.push({
            ...row,
            errors: [importError?.message || 'Import failed for this row.']
          });
        }
      }

      if (totalCount > 3 && importedCount > 0) {
        try {
          await finalizeScheduleImportBatch(selectedCalendarTeam.teamId, importBatchId, successfulImportIds.length || importedCount, auth.user);
        } catch {
          // Ignore notification finalization errors so successful imports still complete.
        }
      }

      setCsvPreviewRows(failedRows);
      await refreshSchedule(true);
      setStatusMessage(failedRows.length
        ? `Imported ${importedCount} row(s); ${failedRows.length} row(s) failed and remain below for retry.`
        : `Imported ${importedCount} schedule row(s) and refreshed the schedule.`);
      timer.end({
        importedCount,
        failedRowCount: failedRows.length,
        refreshed: true
      });
    } catch (importError: any) {
      setCsvImportErrors([importError?.message || 'Unable to import schedule rows.']);
      timer.end({
        importedCount,
        failedRowCount: failedRows.length,
        error: importError
      });
    } finally {
      setImportingCsv(false);
    }
  };

  const handleAddCalendarUrl = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedCalendarTeam || !auth.user) return;
    const validation = validateExternalCalendarUrl(calendarUrl);
    if (!validation.valid) {
      setCalendarUrlError(validation.error || 'Enter a valid .ics calendar URL.');
      return;
    }

    setSavingCalendarUrl(true);
    setCalendarUrlError(null);
    setStatusMessage(null);
    clearScheduleReadError();
    try {
      const result = await addTeamCalendarUrl(selectedCalendarTeam.teamId, validation.url, auth.user);
      setCalendarUrl('');
      setStatusMessage(result.added ? 'Calendar link saved. Refreshing schedule…' : 'Calendar link already exists. Refreshing schedule…');
      await refreshSchedule(true);
      setStatusMessage(result.added ? 'Calendar link saved and schedule refreshed.' : 'Calendar link already exists. Schedule refreshed.');
    } catch (saveError: any) {
      setCalendarUrlError(saveError?.message || 'Unable to save calendar link.');
    } finally {
      setSavingCalendarUrl(false);
    }
  };

  const handleRemoveCalendarUrl = async (url: string) => {
    if (!selectedCalendarTeam || !auth.user) return;
    const confirmed = window.confirm('Remove this external calendar link? Imported events from this feed will disappear after the schedule refreshes.');
    if (!confirmed) return;

    setRemovingCalendarUrl(url);
    setCalendarUrlError(null);
    setStatusMessage(null);
    clearScheduleReadError();
    try {
      const result = await removeTeamCalendarUrl(selectedCalendarTeam.teamId, url, auth.user);
      setStatusMessage(result.removed ? 'Calendar link removed. Refreshing schedule…' : 'Calendar link was already removed. Refreshing schedule…');
      await refreshSchedule(true);
      setStatusMessage(result.removed ? 'Calendar link removed and schedule refreshed.' : 'Calendar link was already removed. Schedule refreshed.');
    } catch (removeError: any) {
      setCalendarUrlError(removeError?.message || 'Unable to remove calendar link.');
    } finally {
      setRemovingCalendarUrl(null);
    }
  };

  const handleExport = () => {
    const exportEvents = filterParentScheduleEvents(events, {
      filter: 'upcoming-all',
      playerId: selectedPlayerId,
      teamId: selectedTeamId,
      timeRange: 'all'
    });
    if (!exportEvents.length) {
      setStatusMessage('No schedule events to export yet.');
      return;
    }

    const ics = buildScheduleIcs(exportEvents);
    const blob = new Blob([ics], { type: 'text/calendar' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const selectedChild = children.find((child) => child.playerId === selectedPlayerId);
    link.download = selectedChild
      ? `${selectedChild.playerName || 'player'}-schedule.ics`.replace(/[^a-z0-9]+/gi, '-').toLowerCase()
      : 'family-schedule.ics';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setStatusMessage('Calendar export started.');
  };

  const handleCopyAgenda = async () => {
    const agendaEvents = visibleEvents.length ? visibleEvents : filterParentScheduleEvents(events, {
      filter: 'upcoming-all',
      playerId: selectedPlayerId,
      teamId: selectedTeamId,
      timeRange
    });
    const text = buildScheduleAgendaText(agendaEvents);
    if (!text) {
      setStatusMessage('No schedule details to copy yet.');
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setStatusMessage('Schedule details copied.');
    } catch {
      setStatusMessage('Copy is not available in this browser.');
    }
  };

  return (
    <PullToRefresh onRefresh={() => refreshSchedule(true)} disabled={!auth.user?.uid}>
    <div className="schedule-page space-y-4">
      <section className="schedule-header app-card p-3 sm:hidden">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-lg font-black leading-tight text-gray-950">Schedule</h1>
            <div className="mt-0.5 text-xs font-bold text-gray-500">
              {formatCount(counts.total, 'event')} · {counts.rsvpNeeded} RSVP · {counts.packetsReady} packets
            </div>
          </div>
          <div className="flex flex-none gap-1.5">
            <button type="button" className="ghost-button !h-9 !min-h-9 !w-9 !p-0" onClick={() => refreshSchedule(true)} disabled={scheduleReadLoading} aria-label="Refresh schedule">
              <RefreshCw className={`h-4 w-4 ${scheduleReadLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
            </button>
            <button type="button" className="secondary-button !h-9 !min-h-9 !w-9 !p-0" onClick={handleExport} aria-label="Export calendar">
              <Download className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2">
          <Segment active={view === 'list'} onClick={() => setView('list')} icon={ListChecks} label="List" />
          <Segment active={view === 'calendar'} onClick={() => setView('calendar')} icon={CalendarDays} label="Calendar" />
          <Segment active={view === 'packets'} onClick={() => setView('packets')} icon={ClipboardCheck} label="Packets" />
        </div>

        <div className="mt-2 grid grid-cols-2 gap-2">
          <label>
            <span className="sr-only">Schedule filter</span>
            <select
              aria-label="Schedule filter"
              className="auth-input min-h-9 truncate !px-3 !py-2 text-xs font-black"
              value={filter}
              onChange={(event) => setFilter(event.target.value as ParentScheduleFilter)}
            >
              {filterOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">Schedule range</span>
            <select
              aria-label="Schedule range"
              className="auth-input min-h-9 truncate !px-3 !py-2 text-xs font-black"
              value={timeRange}
              onChange={(event) => setTimeRange(event.target.value as ScheduleTimeRange)}
            >
              {timeRangeOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-2 grid grid-cols-2 gap-2">
          <label>
            <span className="sr-only">Team filter</span>
            <select aria-label="Team filter" className="auth-input min-h-9 truncate !px-3 !py-2 text-xs font-black" value={selectedTeamId} onChange={(event) => setSelectedTeamId(event.target.value)}>
              <option value="">All Teams</option>
              {teamOptions.map((team) => (
                <option key={team.teamId} value={team.teamId}>{team.teamName}</option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">Player filter</span>
            <select aria-label="Player filter" className="auth-input min-h-9 truncate !px-3 !py-2 text-xs font-black" value={selectedPlayerId} onChange={(event) => setSelectedPlayerId(event.target.value)}>
              <option value="">All Players</option>
              {children.map((child) => (
                <option key={`${child.teamId}-${child.playerId}`} value={child.playerId}>{child.playerName}</option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="schedule-header app-card hidden p-3 sm:block sm:p-4">
        <div className="schedule-web-hero-layout">
          <div className="min-w-0 flex-1">
            <div className="app-label">Schedule</div>
            <h1 className="mt-1 text-xl font-black text-gray-950 sm:text-2xl">Games, practices, RSVP</h1>
            <p className="mt-2 hidden text-sm font-semibold leading-6 text-gray-600 sm:block">
              A family command center for what is next, what needs a parent decision, and what can wait.
            </p>

            <div className="mt-3 grid grid-cols-5 gap-1.5 sm:mt-4 sm:gap-2">
              <Metric label="Events" value={String(counts.total)} />
              <Metric label="Games" value={String(counts.games)} />
              <Metric label="Practices" value={String(counts.practices)} />
              <Metric label="RSVP Needed" mobileLabel="RSVP" value={String(counts.rsvpNeeded)} />
              <Metric label="Packets" value={String(counts.packetsReady)} />
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className="ghost-button !min-h-9 !px-3 !py-2 !text-xs sm:!min-h-10 sm:!text-sm" onClick={() => refreshSchedule(true)} disabled={scheduleReadLoading}>
                <RefreshCw className={`h-4 w-4 ${scheduleReadLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
                Refresh
              </button>
              {!isDesktopWeb ? (
                <>
                  <button type="button" className="secondary-button !min-h-9 !px-3 !py-2 !text-xs sm:!min-h-10 sm:!text-sm" onClick={handleExport}>
                    <Download className="h-4 w-4" aria-hidden="true" />
                    .ics
                  </button>
                  <button type="button" className="secondary-button !min-h-9 !px-3 !py-2 !text-xs sm:!min-h-10 sm:!text-sm" onClick={handleCopyAgenda}>
                    <Copy className="h-4 w-4" aria-hidden="true" />
                    Copy agenda
                  </button>
                </>
              ) : null}
            </div>
          </div>

          <ScheduleNextUpCard event={webInsights.nextEvent} preferGameHubForStaff={!isDesktopWeb} />
        </div>

        {!isDesktopWeb ? (
          <div className="mt-3 grid grid-cols-3 gap-2 sm:mt-4 sm:flex sm:flex-wrap">
            <Segment active={view === 'list'} onClick={() => setView('list')} icon={ListChecks} label="List" />
            <Segment active={view === 'calendar'} onClick={() => setView('calendar')} icon={CalendarDays} label="Calendar" />
            <Segment active={view === 'packets'} onClick={() => setView('packets')} icon={ClipboardCheck} label="Packets" />
            <label className="sm:hidden">
              <span className="sr-only">Schedule filter</span>
              <select
                aria-label="Schedule filter"
                className="auth-input min-h-9 truncate !px-3 !py-2 text-xs font-black"
                value={filter}
                onChange={(event) => setFilter(event.target.value as ParentScheduleFilter)}
              >
                {filterOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="min-w-0 flex-1 sm:min-w-32 sm:max-w-40">
              <span className="sr-only">Range</span>
              <select aria-label="Range" className="auth-input min-h-9 truncate !px-3 !py-2 text-xs font-black sm:min-h-10 sm:text-sm" value={timeRange} onChange={(event) => setTimeRange(event.target.value as ScheduleTimeRange)}>
                {timeRangeOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="min-w-0 flex-1 sm:min-w-48 sm:max-w-64">
              <span className="sr-only">Team</span>
              <select aria-label="Team" className="auth-input min-h-9 truncate !px-3 !py-2 text-xs font-black sm:min-h-10 sm:text-sm" value={selectedTeamId} onChange={(event) => setSelectedTeamId(event.target.value)}>
                <option value="">All Teams</option>
                {teamOptions.map((team) => (
                  <option key={team.teamId} value={team.teamId}>{team.teamName}</option>
                ))}
              </select>
            </label>
            <label className="min-w-0 flex-1 sm:min-w-48 sm:max-w-64">
              <span className="sr-only">Player</span>
              <select aria-label="Player" className="auth-input min-h-9 truncate !px-3 !py-2 text-xs font-black sm:min-h-10 sm:text-sm" value={selectedPlayerId} onChange={(event) => setSelectedPlayerId(event.target.value)}>
                <option value="">All Players</option>
                {children.map((child) => (
                  <option key={`${child.teamId}-${child.playerId}`} value={child.playerId}>{child.playerName}</option>
                ))}
              </select>
            </label>
          </div>
        ) : null}
      </section>

      <div className="schedule-workbench">
        {isDesktopWeb ? (
          <aside className="schedule-web-sidebar space-y-3">
            <ScheduleWebControls
              filter={filter}
              view={view}
              selectedPlayerId={selectedPlayerId}
              selectedTeamId={selectedTeamId}
              timeRange={timeRange}
              children={children}
              teamOptions={teamOptions}
              loading={scheduleReadLoading}
              insights={webInsights}
              onFilterChange={setFilter}
              onViewChange={setView}
              onPlayerChange={setSelectedPlayerId}
              onTeamChange={setSelectedTeamId}
              onTimeRangeChange={setTimeRange}
              onRefresh={() => refreshSchedule(true)}
              onExport={handleExport}
              advancedControlsOpen={desktopAdvancedControlsOpen}
              onAdvancedControlsOpenChange={setDesktopAdvancedControlsOpen}
              onCopyAgenda={handleCopyAgenda}
              onResetFilters={() => {
                setFilter('upcoming-all');
                setView('list');
                setSelectedPlayerId('');
                setSelectedTeamId('');
                setTimeRange('all');
              }}
            />
            <ScheduleActionQueue events={visibleEvents} />
          </aside>
        ) : null}

        <div className="schedule-content-pane space-y-3">
          {!isDesktopWeb ? (
            <div className="schedule-filters hidden gap-2 overflow-x-auto pb-1 sm:flex">
              {filterOptions.map((option) => (
                <ScheduleFilterButton
                  key={option.value}
                  option={option}
                  active={filter === option.value}
                  onClick={() => setFilter(option.value)}
                />
              ))}
            </div>
          ) : null}
          {statusMessage ? <Status tone="success" message={statusMessage} /> : null}
          {scheduleReadError ? <Status tone="error" message={scheduleLoadError ? getScheduleLoadErrorMessage(scheduleLoadError, hasLoadedSchedule) : scheduleReadError} /> : null}
          {!isDesktopWeb && !scheduleReadLoading && !isInitialScheduleLoad ? (
            <ScheduleActionQueue events={visibleEvents} compact hideWhenEmpty preferGameHubForStaff />
          ) : null}

          {scheduleReadLoading || isInitialScheduleLoad ? (
            <LoadingSchedule />
          ) : view === 'calendar' ? (
            <CalendarSchedule
              month={calendarMonth}
              entries={calendarEntries}
              selectedDay={selectedDay}
              selectedDayEntries={selectedDayEntries}
              preferGameHubForStaff={!isDesktopWeb}
              onMonthChange={setCalendarMonth}
              onDaySelect={setSelectedDay}
              onDayClose={() => setSelectedDay(null)}
            />
          ) : view === 'packets' ? (
            <PracticePacketsPanel
              rows={packetRows}
              totalCount={packetWindow.totalCount}
              readyCount={packetWindow.readyCount}
              visibleCount={visibleListCount}
              pageSize={listPageSize}
              canShowMore={canLoadMorePacketRows}
              loadingMore={filter === 'past-all' && loadingPastHistory}
              onShowMore={handleShowMorePackets}
            />
          ) : view === 'compact' ? (
            <CompactScheduleList
              events={listEntries}
              totalCount={windowedListEntries.totalCount}
              visibleCount={visibleListCount}
              pageSize={listPageSize}
              canShowMore={canLoadMorePastHistory || visibleListCount < windowedListEntries.totalCount}
              loadingMore={filter === 'past-all' && loadingPastHistory}
              preferGameHubForStaff={!isDesktopWeb}
              onShowMore={handleShowMore}
            />
          ) : (
            <ScheduleList
              events={listEntries}
              totalCount={windowedListEntries.totalCount}
              visibleCount={visibleListCount}
              pageSize={listPageSize}
              canShowMore={canLoadMorePastHistory || visibleListCount < windowedListEntries.totalCount}
              loadingMore={filter === 'past-all' && loadingPastHistory}
              preferGameHubForStaff={!isDesktopWeb}
              onShowMore={handleShowMore}
            />
          )}

          {isDesktopWeb && hasManageableScheduleTeams ? (
            <ScheduleStaffToolsSection
              open={desktopStaffToolsOpen}
              teamName={selectedCalendarTeam?.teamName || null}
              contentId="desktop-schedule-staff-tools"
              onToggle={() => setDesktopStaffToolsOpen((current) => {
                const nextOpen = !current;
                if (!nextOpen) {
                  setScheduleStaffToolMode('menu');
                }
                return nextOpen;
              })}
            >
              {renderScheduleStaffToolsContent()}
            </ScheduleStaffToolsSection>
          ) : null}

          {!isDesktopWeb && hasManageableScheduleTeams ? (
            <ScheduleStaffToolsSection
              open={mobileStaffToolsOpen}
              teamName={selectedCalendarTeam?.teamName || null}
              contentId="mobile-schedule-staff-tools"
              onToggle={() => setMobileStaffToolsOpen((current) => {
                const nextOpen = !current;
                if (nextOpen) {
                  requestTrackerConfigLoad();
                } else {
                  setScheduleStaffToolMode('menu');
                }
                return nextOpen;
              })}
            >
              {renderScheduleStaffToolsContent()}
            </ScheduleStaffToolsSection>
          ) : null}
        </div>
      </div>
    </div>
    </PullToRefresh>
  );
}


function padDatePart(value: number) {
  return String(value).padStart(2, '0');
}

function toDatetimeLocalInputValue(value: Date | string | number | null | undefined) {
  if (value === null || value === undefined || value === '') return '';
  const date = value instanceof Date ? value : new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}T${padDatePart(date.getHours())}:${padDatePart(date.getMinutes())}`;
}

function getDefaultScheduleGameForm(): ScheduleGameFormInput {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() + 1);
  startDate.setHours(18, 30, 0, 0);
  return {
    opponent: '',
    startDate,
    endDate: new Date(startDate.getTime() + 90 * 60000),
    location: '',
    arrivalTime: new Date(startDate.getTime() - 30 * 60000),
    isHome: true,
    notes: '',
    statTrackerConfigId: '',
    competitionType: 'league',
    countsTowardSeasonRecord: true
  };
}

function getDefaultScheduleTournamentGameForm(): ScheduleGameFormInput {
  return {
    ...getDefaultScheduleGameForm(),
    competitionType: 'tournament'
  };
}

function getDefaultScheduleTournamentForm(): ScheduleTournamentCreateFormInput {
  return {
    divisionName: '',
    bracketName: '',
    roundName: '',
    poolName: '',
    games: [getDefaultScheduleTournamentGameForm()]
  };
}

function isValidScheduleDate(value: Date | string | number | null | undefined) {
  const date = value instanceof Date ? value : new Date(value || '');
  return !Number.isNaN(date.getTime());
}

function getScheduleTournamentCreateFormValidation(form: ScheduleTournamentCreateFormInput): { formError: string | null; fieldErrors: ScheduleTournamentCreateFieldErrors } {
  const fieldErrors: ScheduleTournamentCreateFieldErrors = {};
  if (!form.divisionName.trim()) fieldErrors.divisionName = 'Tournament division is required.';
  if (!form.bracketName.trim()) fieldErrors.bracketName = 'Tournament bracket is required.';
  if (!form.roundName.trim()) fieldErrors.roundName = 'Tournament round is required.';
  if (!Array.isArray(form.games) || form.games.length === 0) fieldErrors.games = 'Tournament blocks require at least one game.';

  const gameRows = Array.isArray(form.games) ? form.games.map((game) => {
    const gameErrors: ScheduleTournamentGameFieldErrors = {};
    if (!String(game.opponent || '').trim()) gameErrors.opponent = 'Game opponent is required.';
    if (!isValidScheduleDate(game.startDate)) gameErrors.startDate = 'Game start time is required.';
    if (!isValidScheduleDate(game.endDate)) gameErrors.endDate = 'Game end time is required.';
    if (!gameErrors.startDate && !gameErrors.endDate) {
      const startDate = game.startDate instanceof Date ? game.startDate : new Date(game.startDate);
      const endDate = game.endDate instanceof Date ? game.endDate : new Date(game.endDate || '');
      if (endDate.getTime() <= startDate.getTime()) gameErrors.endDate = 'Game end time must be after the start time.';
    }
    if (game.arrivalTime && !isValidScheduleDate(game.arrivalTime)) gameErrors.arrivalTime = 'Arrival time is invalid.';
    return gameErrors;
  }) : [];
  if (gameRows.some((gameErrors) => Object.values(gameErrors).some(Boolean))) fieldErrors.gameRows = gameRows;

  const firstGameError = gameRows.flatMap((gameErrors) => Object.values(gameErrors)).find(Boolean) || null;

  const formError = fieldErrors.divisionName
    || fieldErrors.bracketName
    || fieldErrors.roundName
    || fieldErrors.games
    || firstGameError
    || null;
  return { formError, fieldErrors };
}

function hasScheduleTournamentFieldErrors(fieldErrors: ScheduleTournamentCreateFieldErrors) {
  return Boolean(
    fieldErrors.divisionName
    || fieldErrors.bracketName
    || fieldErrors.roundName
    || fieldErrors.games
    || fieldErrors.gameRows?.some((gameErrors) => Object.values(gameErrors).some(Boolean))
  );
}

function ScheduleFieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-1 text-xs font-bold text-rose-700">{message}</p>;
}

function getScheduleInputClassName(hasError?: boolean) {
  return `auth-input mt-1${hasError ? ' border-rose-300 bg-rose-50 focus:border-rose-500 focus:ring-rose-200' : ''}`;
}

function ScheduleRequiredHint() {
  return <span className="ml-1 text-rose-600" aria-hidden="true">*</span>;
}

function getDefaultSchedulePracticeForm(): SchedulePracticeFormInput {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() + 1);
  startDate.setHours(18, 0, 0, 0);
  const endDate = new Date(startDate.getTime() + 90 * 60000);
  const dayCodes = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
  return {
    title: 'Practice',
    startDate,
    endDate,
    location: '',
    notes: '',
    recurrence: { isRecurring: false, freq: 'weekly', interval: 1, byDays: [dayCodes[startDate.getDay()]], endType: 'never', countValue: 10 }
  };
}

function ScheduleGameCreatePanel({ teamName, form, configs, configsLoading, saving, error, configError, onStartUsing, onChange, onSubmit }: { teamName: string; form: ScheduleGameFormInput; configs: ScheduleStatTrackerConfigOption[]; configsLoading: boolean; saving: boolean; error: string | null; configError: string | null; onStartUsing?: () => void; onChange: (form: ScheduleGameFormInput) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const updateField = (field: keyof ScheduleGameFormInput, value: string | Date | boolean | null) => onChange({ ...form, [field]: value });
  return (
    <section className="app-card p-3 sm:p-4" aria-label="Create game" onFocusCapture={onStartUsing}>
      <div className="app-label">Game scheduling</div>
      <h2 className="mt-1 text-base font-black text-gray-950">Add game for {teamName}</h2>
      <form className="mt-3 space-y-3" onSubmit={onSubmit}>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-bold uppercase tracking-wide text-gray-600">Opponent<input className="auth-input mt-1" value={form.opponent} onChange={(event) => updateField('opponent', event.target.value)} /></label>
          <label className="text-xs font-bold uppercase tracking-wide text-gray-600">Location<input className="auth-input mt-1" value={form.location || ''} onChange={(event) => updateField('location', event.target.value)} /></label>
          <label className="text-xs font-bold uppercase tracking-wide text-gray-600">Starts<input type="datetime-local" className="auth-input mt-1" value={toDatetimeLocalInputValue(form.startDate)} onChange={(event) => updateField('startDate', new Date(event.target.value))} /></label>
          <label className="text-xs font-bold uppercase tracking-wide text-gray-600">Ends<input type="datetime-local" className="auth-input mt-1" value={toDatetimeLocalInputValue(form.endDate)} onChange={(event) => updateField('endDate', event.target.value ? new Date(event.target.value) : null)} /></label>
          <label className="text-xs font-bold uppercase tracking-wide text-gray-600">Arrival<input type="datetime-local" className="auth-input mt-1" value={toDatetimeLocalInputValue(form.arrivalTime)} onChange={(event) => updateField('arrivalTime', event.target.value ? new Date(event.target.value) : null)} /></label>
          <label className="text-xs font-bold uppercase tracking-wide text-gray-600">Home / away<select className="auth-input mt-1" value={form.isHome === false ? 'away' : form.isHome === true ? 'home' : 'neutral'} onChange={(event) => updateField('isHome', event.target.value === 'neutral' ? null : event.target.value === 'home')}><option value="home">Home</option><option value="away">Away</option><option value="neutral">Neutral</option></select></label>
          <label className="text-xs font-bold uppercase tracking-wide text-gray-600">Tracker config<select className="auth-input mt-1" value={form.statTrackerConfigId || ''} disabled={configsLoading} onChange={(event) => updateField('statTrackerConfigId', event.target.value)}><option value="">{configsLoading ? 'Loading tracker configs' : 'No tracker config'}</option>{configs.map((config) => <option key={config.id} value={config.id}>{config.name}</option>)}</select></label>
          <label className="text-xs font-bold uppercase tracking-wide text-gray-600">Competition<select className="auth-input mt-1" value={form.competitionType || 'league'} onChange={(event) => updateField('competitionType', event.target.value)}><option value="league">League</option><option value="tournament">Tournament</option><option value="scrimmage">Scrimmage</option><option value="friendly">Friendly</option></select></label>
        </div>
        <label className="flex items-center gap-2 text-sm font-black text-gray-800"><input type="checkbox" checked={form.countsTowardSeasonRecord !== false} onChange={(event) => updateField('countsTowardSeasonRecord', event.target.checked)} /> Counts toward season record</label>
        <label className="text-xs font-bold uppercase tracking-wide text-gray-600">Notes<textarea className="auth-input mt-1 min-h-20" value={form.notes || ''} onChange={(event) => updateField('notes', event.target.value)} /></label>
        <button type="submit" className="primary-button" disabled={saving}>{saving ? 'Creating game' : 'Create game'}</button>
        {configError ? <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-700">{configError}</div> : null}
        {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700">{error}</div> : null}
      </form>
    </section>
  );
}

function ScheduleTournamentEntryCard({ teamName, onOpen }: { teamName: string; onOpen: () => void }) {
  return (
    <section className="app-card p-3 sm:p-4" aria-label="Tournament entry point">
      <div className="app-label">Tournament scheduling</div>
      <h2 className="mt-1 text-base font-black text-gray-950">Start a new tournament block</h2>
      <p className="mt-1 text-sm font-semibold leading-6 text-gray-600">Open a tournament shell for {teamName} without creating any schedule data yet.</p>
      <button type="button" className="primary-button mt-3" onClick={onOpen}>New tournament block</button>
    </section>
  );
}

function ScheduleTournamentCreateModal({ children, saving, onClose }: { children: ReactNode; saving: boolean; onClose: () => void }) {
  return (
    <Modal overlayClassName="z-[70] flex items-end justify-center bg-gray-950/40 p-0 sm:items-center sm:p-6" ariaLabel="Create tournament block" onClose={onClose}>
      <section className="relative w-full overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:mx-auto sm:max-w-4xl sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-4 py-3">
          <div className="min-w-0">
            <div className="app-label">Staff schedule tools</div>
            <h2 className="mt-1 text-lg font-black text-gray-950">Create tournament block</h2>
            <p className="mt-1 text-xs font-semibold text-gray-500">Review the tournament shell, then cancel back to Schedule or create the block when you are ready.</p>
          </div>
          <button
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-white text-lg font-black leading-none text-gray-500 transition hover:border-gray-300 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
            aria-label="Close tournament shell"
            disabled={saving}
            onClick={onClose}
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
        <div className="max-h-[85vh] overflow-y-auto p-3 sm:p-4">
          {children}
        </div>
      </section>
    </Modal>
  );
}

function ScheduleTournamentCreatePanel({ teamName, form, configs, saving, error, fieldErrors, configError, onStartUsing, onChange, onCancel, onSubmit }: { teamName: string; form: ScheduleTournamentCreateFormInput; configs: ScheduleStatTrackerConfigOption[]; saving: boolean; error: string | null; fieldErrors: ScheduleTournamentCreateFieldErrors; configError: string | null; onStartUsing?: () => void; onChange: (form: ScheduleTournamentCreateFormInput) => void; onCancel: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const updateField = (field: keyof Omit<ScheduleTournamentCreateFormInput, 'games'>, value: string) => onChange({ ...form, [field]: value });
  const updateGame = (gameIndex: number, field: keyof ScheduleGameFormInput, value: string | Date | boolean | null) => onChange({
    ...form,
    games: form.games.map((game, index) => index === gameIndex ? { ...game, [field]: value } : game)
  });
  const addGame = () => onChange({ ...form, games: [...form.games, getDefaultScheduleTournamentGameForm()] });
  const removeGame = (gameIndex: number) => {
    if (form.games.length <= 1) return;
    onChange({ ...form, games: form.games.filter((_, index) => index !== gameIndex) });
  };

  return (
    <section className="app-card border-0 p-0 shadow-none sm:p-0" aria-label="Create tournament" onFocusCapture={onStartUsing}>
      <div className="app-label">Tournament scheduling</div>
      <h2 className="mt-1 text-base font-black text-gray-950">Add tournament for {teamName}</h2>
      <form className="mt-3 space-y-3" noValidate onSubmit={onSubmit}>
        <p className="text-xs font-bold text-gray-500">Required fields are marked with <span className="text-rose-600">*</span>.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-bold uppercase tracking-wide text-gray-600">Tournament division<ScheduleRequiredHint /><input aria-label="Tournament division" className={getScheduleInputClassName(Boolean(fieldErrors.divisionName))} aria-invalid={Boolean(fieldErrors.divisionName)} required value={form.divisionName} onChange={(event) => updateField('divisionName', event.target.value)} /><ScheduleFieldError message={fieldErrors.divisionName} /></label>
          <label className="text-xs font-bold uppercase tracking-wide text-gray-600">Bracket<ScheduleRequiredHint /><input aria-label="Tournament bracket" className={getScheduleInputClassName(Boolean(fieldErrors.bracketName))} aria-invalid={Boolean(fieldErrors.bracketName)} required value={form.bracketName} onChange={(event) => updateField('bracketName', event.target.value)} /><ScheduleFieldError message={fieldErrors.bracketName} /></label>
          <label className="text-xs font-bold uppercase tracking-wide text-gray-600">Round<ScheduleRequiredHint /><input aria-label="Tournament round" className={getScheduleInputClassName(Boolean(fieldErrors.roundName))} aria-invalid={Boolean(fieldErrors.roundName)} required value={form.roundName} onChange={(event) => updateField('roundName', event.target.value)} /><ScheduleFieldError message={fieldErrors.roundName} /></label>
          <label className="text-xs font-bold uppercase tracking-wide text-gray-600">Pool<input aria-label="Tournament pool" className="auth-input mt-1" value={form.poolName || ''} onChange={(event) => updateField('poolName', event.target.value)} /></label>
        </div>

        <div className="space-y-3">
          <ScheduleFieldError message={fieldErrors.games} />
          {form.games.map((game, gameIndex) => {
            const gameNumber = gameIndex + 1;
            const gameErrors = fieldErrors.gameRows?.[gameIndex] || {};
            return (
              <div key={gameIndex} className="rounded-2xl border border-gray-200 bg-gray-50 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-black text-gray-900">Game {gameNumber}</div>
                  {form.games.length > 1 ? (
                    <button type="button" className="text-xs font-black text-rose-700 hover:text-rose-800 disabled:cursor-not-allowed disabled:opacity-60" aria-label={`Remove game ${gameNumber}`} disabled={saving} onClick={() => removeGame(gameIndex)}>Remove</button>
                  ) : null}
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="text-xs font-bold uppercase tracking-wide text-gray-600">Opponent<ScheduleRequiredHint /><input aria-label={`Game ${gameNumber} opponent`} className={getScheduleInputClassName(Boolean(gameErrors.opponent))} aria-invalid={Boolean(gameErrors.opponent)} required value={game.opponent} onChange={(event) => updateGame(gameIndex, 'opponent', event.target.value)} /><ScheduleFieldError message={gameErrors.opponent} /></label>
                  <label className="text-xs font-bold uppercase tracking-wide text-gray-600">Location<input aria-label={`Game ${gameNumber} location`} className="auth-input mt-1" value={game.location || ''} onChange={(event) => updateGame(gameIndex, 'location', event.target.value)} /></label>
                  <label className="text-xs font-bold uppercase tracking-wide text-gray-600">Starts<ScheduleRequiredHint /><input aria-label={`Game ${gameNumber} starts`} type="datetime-local" className={getScheduleInputClassName(Boolean(gameErrors.startDate))} aria-invalid={Boolean(gameErrors.startDate)} required value={toDatetimeLocalInputValue(game.startDate)} onChange={(event) => updateGame(gameIndex, 'startDate', new Date(event.target.value))} /><ScheduleFieldError message={gameErrors.startDate} /></label>
                  <label className="text-xs font-bold uppercase tracking-wide text-gray-600">Ends<ScheduleRequiredHint /><input aria-label={`Game ${gameNumber} ends`} type="datetime-local" className={getScheduleInputClassName(Boolean(gameErrors.endDate))} aria-invalid={Boolean(gameErrors.endDate)} required value={toDatetimeLocalInputValue(game.endDate)} onChange={(event) => updateGame(gameIndex, 'endDate', event.target.value ? new Date(event.target.value) : null)} /><ScheduleFieldError message={gameErrors.endDate} /></label>
                  <label className="text-xs font-bold uppercase tracking-wide text-gray-600">Arrival<input aria-label={`Game ${gameNumber} arrival`} type="datetime-local" className={getScheduleInputClassName(Boolean(gameErrors.arrivalTime))} aria-invalid={Boolean(gameErrors.arrivalTime)} value={toDatetimeLocalInputValue(game.arrivalTime)} onChange={(event) => updateGame(gameIndex, 'arrivalTime', event.target.value ? new Date(event.target.value) : null)} /><ScheduleFieldError message={gameErrors.arrivalTime} /></label>
                  <label className="text-xs font-bold uppercase tracking-wide text-gray-600">Home / away<select aria-label={`Game ${gameNumber} home away`} className="auth-input mt-1" value={game.isHome === false ? 'away' : game.isHome === true ? 'home' : 'neutral'} onChange={(event) => updateGame(gameIndex, 'isHome', event.target.value === 'neutral' ? null : event.target.value === 'home')}><option value="home">Home</option><option value="away">Away</option><option value="neutral">Neutral</option></select></label>
                  <label className="text-xs font-bold uppercase tracking-wide text-gray-600">Tracker config<select aria-label={`Game ${gameNumber} tracker config`} className="auth-input mt-1" value={game.statTrackerConfigId || ''} onChange={(event) => updateGame(gameIndex, 'statTrackerConfigId', event.target.value)}><option value="">No tracker config</option>{configs.map((config) => <option key={config.id} value={config.id}>{config.name}</option>)}</select></label>
                </div>
                <label className="mt-3 block text-xs font-bold uppercase tracking-wide text-gray-600">Notes<textarea aria-label={`Game ${gameNumber} notes`} className="auth-input mt-1 min-h-20" value={game.notes || ''} onChange={(event) => updateGame(gameIndex, 'notes', event.target.value)} /></label>
              </div>
            );
          })}
          <button type="button" className="secondary-button" disabled={saving} onClick={addGame}>Add another game</button>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="submit" className="primary-button" disabled={saving}>{saving ? 'Creating tournament' : 'Create tournament'}</button>
          <button type="button" className="secondary-button" onClick={onCancel} disabled={saving}>Cancel</button>
        </div>
        {configError ? <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-700">{configError}</div> : null}
        {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700">{error}</div> : null}
      </form>
    </section>
  );
}

function SchedulePracticeCreatePanel({ teamName, form, saving, error, onChange, onSubmit }: { teamName: string; form: SchedulePracticeFormInput; saving: boolean; error: string | null; onChange: (form: SchedulePracticeFormInput) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const updateField = (field: keyof SchedulePracticeFormInput, value: string | Date | PracticeRecurrenceFormInput) => onChange({ ...form, [field]: value });
  return (
    <section className="app-card p-3 sm:p-4" aria-label="Create practice">
      <div className="app-label">Practice scheduling</div>
      <h2 className="mt-1 text-base font-black text-gray-950">Add practice for {teamName}</h2>
      <form className="mt-3 space-y-3" onSubmit={onSubmit}>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-bold uppercase tracking-wide text-gray-600">Title<input className="auth-input mt-1" value={form.title} onChange={(event) => updateField('title', event.target.value)} /></label>
          <label className="text-xs font-bold uppercase tracking-wide text-gray-600">Location<input className="auth-input mt-1" value={form.location || ''} onChange={(event) => updateField('location', event.target.value)} /></label>
          <label className="text-xs font-bold uppercase tracking-wide text-gray-600">Starts<input type="datetime-local" className="auth-input mt-1" value={toDatetimeLocalInputValue(form.startDate)} onChange={(event) => updateField('startDate', new Date(event.target.value))} /></label>
          <label className="text-xs font-bold uppercase tracking-wide text-gray-600">Ends<input type="datetime-local" className="auth-input mt-1" value={toDatetimeLocalInputValue(form.endDate)} onChange={(event) => updateField('endDate', new Date(event.target.value))} /></label>
        </div>
        <label className="text-xs font-bold uppercase tracking-wide text-gray-600">Notes<textarea className="auth-input mt-1 min-h-20" value={form.notes || ''} onChange={(event) => updateField('notes', event.target.value)} /></label>
        <PracticeRecurrenceFields form={form} onChange={onChange} />
        <button type="submit" className="primary-button" disabled={saving}>{saving ? 'Creating practice' : 'Create practice'}</button>
        {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700">{error}</div> : null}
      </form>
    </section>
  );
}

function PracticeRecurrenceFields({ form, onChange }: { form: SchedulePracticeFormInput; onChange: (form: SchedulePracticeFormInput) => void }) {
  const recurrence = form.recurrence || { isRecurring: false, freq: 'weekly', interval: 1, byDays: [], endType: 'never', countValue: 10 };
  const setRecurrence = (next: Partial<PracticeRecurrenceFormInput>) => onChange({ ...form, recurrence: { ...recurrence, ...next } });
  const byDays = new Set(recurrence.byDays || []);
  const days = [['MO', 'Mon'], ['TU', 'Tue'], ['WE', 'Wed'], ['TH', 'Thu'], ['FR', 'Fri'], ['SA', 'Sat'], ['SU', 'Sun']];
  return (
    <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3">
      <label className="flex items-center gap-2 text-sm font-black text-gray-800"><input type="checkbox" checked={recurrence.isRecurring === true} onChange={(event) => setRecurrence({ isRecurring: event.target.checked })} /> Repeat weekly</label>
      {recurrence.isRecurring ? (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap gap-2">
            {days.map(([value, label]) => (
              <label key={value} className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-black text-gray-700"><input className="mr-1" type="checkbox" checked={byDays.has(value)} onChange={(event) => { const next = new Set(byDays); if (event.target.checked) next.add(value); else next.delete(value); setRecurrence({ byDays: Array.from(next) }); }} />{label}</label>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-xs font-bold uppercase tracking-wide text-gray-600">Every<input type="number" min="1" className="auth-input mt-1" value={recurrence.interval || 1} onChange={(event) => setRecurrence({ interval: Number(event.target.value) || 1 })} /></label>
            <label className="text-xs font-bold uppercase tracking-wide text-gray-600">Ends<select className="auth-input mt-1" value={recurrence.endType || 'never'} onChange={(event) => setRecurrence({ endType: event.target.value as PracticeRecurrenceFormInput['endType'] })}><option value="never">Never</option><option value="until">On date</option><option value="count">After count</option></select></label>
            {recurrence.endType === 'until' ? <label className="text-xs font-bold uppercase tracking-wide text-gray-600">Until<input type="date" className="auth-input mt-1" value={recurrence.untilValue || ''} onChange={(event) => setRecurrence({ untilValue: event.target.value })} /></label> : null}
            {recurrence.endType === 'count' ? <label className="text-xs font-bold uppercase tracking-wide text-gray-600">Count<input type="number" min="1" className="auth-input mt-1" value={recurrence.countValue || 10} onChange={(event) => setRecurrence({ countValue: Number(event.target.value) || 10 })} /></label> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ScheduleStaffToolsSection({ open, teamName, contentId, onToggle, children }: { open: boolean; teamName: string | null; contentId: string; onToggle: () => void; children: ReactNode }) {
  return (
    <section className="app-card p-3" aria-label="Manage schedule tools">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 text-left"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={onToggle}
      >
        <div className="min-w-0">
          <div className="app-label">Staff schedule tools</div>
          <h2 className="mt-1 text-base font-black text-gray-950">Manage schedule</h2>
          <p className="mt-1 text-xs font-semibold leading-5 text-gray-500">{teamName ? `Calendar feeds and imports for ${teamName} stay tucked away until you need them.` : 'Choose a team here to unlock schedule tools without relying on the page-level team filter.'}</p>
        </div>
        <ChevronDown className={`h-5 w-5 flex-none text-gray-500 transition ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {open ? (
        <div id={contentId} className="mt-3 space-y-3">
          {children}
        </div>
      ) : null}
    </section>
  );
}

function ScheduleStaffTools({
  teamName,
  calendarUrl,
  calendarUrls,
  calendarUrlError,
  savingCalendarUrl,
  removingCalendarUrl,
  aiScheduleText,
  aiScheduleImageName,
  aiPreviewRows,
  aiImportErrors,
  processingAiImport,
  csvHeaders,
  csvMapping,
  csvPreviewRows,
  csvImportErrors,
  csvFileName,
  loadingCsvFile,
  importingCsv,
  onCalendarUrlChange,
  onAddCalendarUrl,
  onRemoveCalendarUrl,
  onAiTextChange,
  onAiImageChange,
  onAiGeneratePreview,
  onImportCsv,
  onClearAi,
  onCsvFileChange,
  onCsvMappingChange,
  onCsvPreview,
  onClearCsv
}: {
  teamName: string;
  calendarUrl: string;
  calendarUrls: string[];
  calendarUrlError: string | null;
  savingCalendarUrl: boolean;
  removingCalendarUrl: string | null;
  aiScheduleText: string;
  aiScheduleImageName: string;
  aiPreviewRows: ScheduleCsvImportPreviewRow[];
  aiImportErrors: string[];
  processingAiImport: boolean;
  csvHeaders: string[];
  csvMapping: ScheduleCsvImportMapping;
  csvPreviewRows: ScheduleCsvImportPreviewRow[];
  csvImportErrors: string[];
  csvFileName: string;
  loadingCsvFile: boolean;
  importingCsv: boolean;
  onCalendarUrlChange: (value: string) => void;
  onAddCalendarUrl: (event: FormEvent<HTMLFormElement>) => void;
  onRemoveCalendarUrl: (url: string) => void;
  onAiTextChange: (value: string) => void;
  onAiImageChange: (file: File | null) => void;
  onAiGeneratePreview: () => void;
  onImportCsv: () => void;
  onClearAi: () => void;
  onCsvFileChange: (file: File | null) => void;
  onCsvMappingChange: (field: keyof ScheduleCsvImportMapping, value: string) => void;
  onCsvPreview: () => void;
  onClearCsv: () => void;
}) {
  return (
    <>
      <CalendarSourcePanel
        teamName={teamName}
        calendarUrl={calendarUrl}
        calendarUrls={calendarUrls}
        error={calendarUrlError}
        saving={savingCalendarUrl}
        removingUrl={removingCalendarUrl}
        onCalendarUrlChange={onCalendarUrlChange}
        onSubmit={onAddCalendarUrl}
        onRemove={onRemoveCalendarUrl}
      />
      <ScheduleAiImportPanel
        teamName={teamName}
        text={aiScheduleText}
        imageName={aiScheduleImageName}
        previewRows={aiPreviewRows}
        errors={aiImportErrors}
        processing={processingAiImport}
        importing={importingCsv}
        onTextChange={onAiTextChange}
        onImageChange={onAiImageChange}
        onGeneratePreview={onAiGeneratePreview}
        onImport={onImportCsv}
        onClear={onClearAi}
      />
      <ScheduleCsvImportPanel
        teamName={teamName}
        headers={csvHeaders}
        mapping={csvMapping}
        previewRows={csvPreviewRows}
        errors={csvImportErrors}
        fileName={csvFileName}
        loadingCsvFile={loadingCsvFile}
        importing={importingCsv}
        onFileChange={onCsvFileChange}
        onMappingChange={onCsvMappingChange}
        onPreview={onCsvPreview}
        onImport={onImportCsv}
        onClear={onClearCsv}
      />
    </>
  );
}

function ScheduleAiImportPanel({ teamName, text, imageName, previewRows, errors, processing, importing, onTextChange, onImageChange, onGeneratePreview, onImport, onClear }: {
  teamName: string;
  text: string;
  imageName: string;
  previewRows: ScheduleCsvImportPreviewRow[];
  errors: string[];
  processing: boolean;
  importing: boolean;
  onTextChange: (value: string) => void;
  onImageChange: (file: File | null) => void;
  onGeneratePreview: () => void;
  onImport: () => void;
  onClear: () => void;
}) {
  const invalidCount = previewRows.filter((row) => row.errors.length > 0).length;
  return (
    <section className="app-card p-4" aria-label="AI schedule import">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-violet-50 text-violet-700">
          <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="app-label">Staff schedule tools</div>
          <h2 className="mt-1 text-base font-black text-gray-950">Draft schedule with AI</h2>
          <p className="mt-1 text-xs font-semibold leading-5 text-gray-500">Paste schedule text or upload one image for {teamName}. AI drafts game rows only; nothing is saved until you review and import.</p>
        </div>
      </div>

      <div className="mt-3 space-y-3">
        <label className="block">
          <span className="text-xs font-black uppercase tracking-[0.08em] text-gray-500">Schedule text or instructions</span>
          <textarea
            className="auth-input mt-1 min-h-28 !px-3 !py-2 text-sm font-semibold"
            placeholder="Paste schedule lines, or add instructions like 'only home games' when uploading an image."
            value={text}
            onChange={(event) => onTextChange(event.target.value)}
            aria-label="Schedule text or AI instructions"
          />
        </label>

        <label className="block">
          <span className="text-xs font-black uppercase tracking-[0.08em] text-gray-500">Schedule image</span>
          <input
            className="auth-input mt-1 min-h-10 !px-3 !py-2 text-sm font-semibold"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/heic,image/heif"
            aria-label="Schedule image"
            onChange={(event) => onImageChange(event.target.files?.[0] || null)}
          />
        </label>
        {imageName ? <div className="text-xs font-bold text-gray-500">Loaded {imageName}</div> : null}

        {errors.length ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-bold text-rose-700" role="alert">
            {errors.map((item) => <div key={item}>{item}</div>)}
          </div>
        ) : null}

        {previewRows.length ? (
          <div className="space-y-2">
            <div className="text-xs font-black uppercase tracking-[0.08em] text-gray-500">AI draft preview {previewRows.length} row(s){invalidCount ? `, ${invalidCount} needs review` : ''}</div>
            {previewRows.map((row) => (
              <div key={row.rowNumber} className={`rounded-xl border p-3 text-sm ${row.errors.length ? 'border-rose-200 bg-rose-50' : 'border-violet-200 bg-violet-50'}`}>
                <div className="font-black text-gray-900">Draft {row.rowNumber}: Game vs {row.normalized.opponent || 'opponent TBD'}</div>
                <div className="mt-1 text-xs font-semibold text-gray-600">{row.normalized.startsAt || 'Start TBD'} · {row.normalized.location || 'Location TBD'}</div>
                {row.normalized.notes ? <div className="mt-1 text-xs font-semibold text-gray-600 whitespace-pre-line">{row.normalized.notes}</div> : null}
                {row.errors.length ? <ul className="mt-2 list-disc pl-4 text-xs font-bold text-rose-700">{row.errors.map((item) => <li key={item}>{item}</li>)}</ul> : null}
              </div>
            ))}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <button type="button" className="secondary-button" onClick={onGeneratePreview} disabled={processing || importing}>{processing ? 'Processing…' : 'Generate draft rows'}</button>
          <button type="button" className="primary-button" onClick={onImport} disabled={!previewRows.length || invalidCount > 0 || processing || importing}>{importing ? 'Importing…' : 'Import reviewed rows'}</button>
          <button type="button" className="secondary-button" onClick={onClear} disabled={processing || importing}>Clear AI input</button>
        </div>
      </div>
    </section>
  );
}

function ScheduleCsvImportPanel({ teamName, headers, mapping, previewRows, errors, fileName, loadingCsvFile, importing, onFileChange, onMappingChange, onPreview, onImport, onClear }: {
  teamName: string;
  headers: string[];
  mapping: ScheduleCsvImportMapping;
  previewRows: ScheduleCsvImportPreviewRow[];
  errors: string[];
  fileName: string;
  loadingCsvFile: boolean;
  importing: boolean;
  onFileChange: (file: File | null) => void;
  onMappingChange: (field: keyof ScheduleCsvImportMapping, value: string) => void;
  onPreview: () => void;
  onImport: () => void;
  onClear: () => void;
}) {
  const invalidCount = previewRows.filter((row) => row.errors.length > 0).length;
  return (
    <section className="app-card p-4" aria-label="CSV schedule import">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
          <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="app-label">Staff schedule tools</div>
          <h2 className="mt-1 text-base font-black text-gray-950">Import schedule CSV</h2>
          <p className="mt-1 text-xs font-semibold leading-5 text-gray-500">Upload a UTF-8 CSV for {teamName}, confirm column mapping, preview rows, then import games and practices.</p>
        </div>
      </div>

      <div className="mt-3 space-y-3">
        <label className="block">
          <span className="text-xs font-black uppercase tracking-[0.08em] text-gray-500">CSV file</span>
          <input
            className="auth-input mt-1 min-h-10 !px-3 !py-2 text-sm font-semibold"
            type="file"
            accept=".csv,text/csv"
            aria-label="Schedule CSV file"
            onChange={(event) => onFileChange(event.target.files?.[0] || null)}
          />
        </label>
        {fileName ? <div className="text-xs font-bold text-gray-500">Loaded {fileName}</div> : null}

        {headers.length ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {SCHEDULE_CSV_IMPORT_FIELDS.map((field: { key: string; label: string }) => (
              <label key={field.key} className="block">
                <span className="text-xs font-bold text-gray-600">{field.label}</span>
                <select
                  className="auth-input mt-1 min-h-10 !px-3 !py-2 text-sm font-semibold"
                  aria-label={`CSV mapping ${field.label}`}
                  value={mapping[field.key as keyof ScheduleCsvImportMapping] || ''}
                  onChange={(event) => onMappingChange(field.key as keyof ScheduleCsvImportMapping, event.target.value)}
                >
                  <option value="">Not mapped</option>
                  {headers.map((header) => <option key={header} value={header}>{header}</option>)}
                </select>
              </label>
            ))}
          </div>
        ) : null}

        {errors.length ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-bold text-rose-700" role="alert">
            {errors.map((item) => <div key={item}>{item}</div>)}
          </div>
        ) : null}

        {previewRows.length ? (
          <div className="space-y-2">
            <div className="text-xs font-black uppercase tracking-[0.08em] text-gray-500">Preview {previewRows.length} row(s){invalidCount ? `, ${invalidCount} invalid` : ''}</div>
            {previewRows.map((row) => (
              <div key={row.rowNumber} className={`rounded-xl border p-3 text-sm ${row.errors.length ? 'border-rose-200 bg-rose-50' : 'border-emerald-200 bg-emerald-50'}`}>
                <div className="font-black text-gray-900">Row {row.rowNumber}: {row.normalized.eventType === 'game' ? `Game vs ${row.normalized.opponent || 'opponent TBD'}` : row.normalized.title || 'Practice'}</div>
                <div className="mt-1 text-xs font-semibold text-gray-600">{row.normalized.startsAt || 'Start TBD'} · {row.normalized.location || 'Location TBD'}</div>
                {row.errors.length ? <ul className="mt-2 list-disc pl-4 text-xs font-bold text-rose-700">{row.errors.map((item) => <li key={item}>{item}</li>)}</ul> : null}
              </div>
            ))}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <button type="button" className="secondary-button" onClick={onPreview} disabled={!fileName || importing || loadingCsvFile}>{loadingCsvFile ? 'Reading CSV…' : 'Preview rows'}</button>
          <button type="button" className="primary-button" onClick={onImport} disabled={!previewRows.length || invalidCount > 0 || importing || loadingCsvFile}>{importing ? 'Importing…' : 'Import rows'}</button>
          <button type="button" className="secondary-button" onClick={onClear} disabled={importing}>Clear</button>
        </div>
      </div>
    </section>
  );
}

function CalendarSourcePanel({ teamName, calendarUrl, calendarUrls, error, saving, removingUrl, onCalendarUrlChange, onSubmit, onRemove }: {
  teamName: string;
  calendarUrl: string;
  calendarUrls: string[];
  error: string | null;
  saving: boolean;
  removingUrl: string | null;
  onCalendarUrlChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onRemove: (url: string) => void;
}) {
  const savedCalendarUrls = calendarUrls.map((url) => String(url || '').trim()).filter(Boolean);

  return (
    <section className="app-card p-4" aria-label="Calendar source">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-primary-50 text-primary-700">
          <LinkIcon className="h-4 w-4" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="app-label">Staff schedule tools</div>
          <h2 className="mt-1 text-base font-black text-gray-950">Add external calendar</h2>
          <p className="mt-1 text-xs font-semibold leading-5 text-gray-500">Paste one .ics link for {teamName}. Imported events appear after the schedule refreshes.</p>
        </div>
      </div>
      <form className="mt-3 space-y-2 sm:flex sm:items-start sm:gap-2 sm:space-y-0" onSubmit={onSubmit}>
        <label className="block min-w-0 flex-1">
          <span className="sr-only">External .ics calendar URL</span>
          <input
            className="auth-input min-h-10 !px-3 !py-2 text-sm font-semibold"
            type="url"
            inputMode="url"
            placeholder="https://example.com/team.ics"
            value={calendarUrl}
            onChange={(event) => onCalendarUrlChange(event.target.value)}
            aria-label="External .ics calendar URL"
            aria-invalid={error ? 'true' : 'false'}
          />
        </label>
        <button type="submit" className="primary-button w-full sm:w-auto" disabled={saving}>
          {saving ? 'Saving…' : 'Save calendar'}
        </button>
      </form>
      {savedCalendarUrls.length > 0 ? (
        <div className="mt-4 space-y-2">
          <div className="text-xs font-black uppercase tracking-wide text-gray-500">Saved calendar links</div>
          {savedCalendarUrls.map((url) => (
            <div key={url} className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-gray-50 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 break-all text-xs font-semibold text-gray-700">{url}</div>
              <button
                type="button"
                className="secondary-button min-h-9 w-full border-rose-200 text-rose-700 hover:bg-rose-50 sm:w-auto"
                disabled={saving || removingUrl === url}
                onClick={() => onRemove(url)}
              >
                {removingUrl === url ? 'Removing…' : 'Remove'}
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {error ? <div className="mt-2 text-xs font-bold text-rose-600" role="alert">{error}</div> : null}
    </section>
  );
}

function Segment({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: typeof CalendarDays; label: string }) {
  return (
    <button
      type="button"
      className={`inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-black transition sm:min-h-10 sm:rounded-xl sm:px-4 sm:text-sm ${
        active ? 'border-primary-200 bg-primary-50 text-primary-700' : 'border-gray-200 bg-white text-gray-600'
      }`}
      onClick={onClick}
      aria-pressed={active}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      {label}
    </button>
  );
}

function formatCount(value: number, label: string) {
  return `${value} ${label}${value === 1 ? '' : 's'}`;
}

function Metric({ label, mobileLabel, value }: { label: string; mobileLabel?: string; value: string }) {
  return (
    <div className="schedule-metric rounded-lg border border-gray-200 bg-gray-50 px-2 py-2 text-center sm:rounded-xl sm:p-3 sm:text-left">
      <div className="text-base font-black leading-none text-gray-950 sm:text-xl sm:leading-normal">{value}</div>
      <div className="mt-1 text-[10px] font-extrabold uppercase leading-tight text-gray-500 sm:text-xs sm:tracking-[0.04em]">
        {mobileLabel ? (
          <>
            <span className="sm:hidden">{mobileLabel}</span>
            <span className="hidden sm:inline">{label}</span>
          </>
        ) : label}
      </div>
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

function getScheduleLoadErrorMessage(error: AppServiceError, hasExistingSchedule: boolean) {
  if (hasExistingSchedule) {
    if (error.type === 'network') return 'Unable to refresh schedule while offline. Showing the last loaded schedule.';
    if (error.type === 'permission') return 'Unable to refresh schedule because access was denied. Showing the last loaded schedule.';
    if (error.type === 'not_found') return 'Unable to refresh schedule because the requested data was not found. Showing the last loaded schedule.';
    if (error.type === 'validation') return error.message;
    return 'Unable to refresh schedule. Showing the last loaded schedule. Try again.';
  }
  if (error.type === 'network') return 'Unable to load schedule while offline. Check your connection and try again.';
  if (error.type === 'permission') return 'You do not have permission to load this schedule.';
  if (error.type === 'not_found') return 'Schedule data was not found. Try again after refreshing your team access.';
  if (error.type === 'validation') return error.message;
  return error.message || 'Unable to load schedule. Try again.';
}

type ScheduleWebInsights = {
  nextEvent: ParentScheduleEvent | null;
  rsvpNeeded: number;
  packetsReady: number;
  openAssignments: number;
  rideRequests: number;
};

function ScheduleNextUpCard({ event, preferGameHubForStaff }: { event: ParentScheduleEvent | null; preferGameHubForStaff: boolean }) {
  if (!event) {
    return (
      <div className="schedule-next-card rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4">
        <div className="app-label">Next up</div>
        <div className="mt-2 text-lg font-black text-gray-950">Nothing scheduled</div>
        <div className="mt-1 text-sm font-semibold leading-6 text-gray-500">Try another filter or player.</div>
      </div>
    );
  }

  const rsvp = normalizeRsvpResponse(event.myRsvp);
  const actionText = getEventPrimaryActionText(event);
  const tournamentInfo = getScheduleTournamentInfo(event);

  return (
    <Link to={getGenericEventDetailPath(event, preferGameHubForStaff)} className="schedule-next-card block rounded-xl border border-primary-100 bg-primary-50 p-4 transition hover:border-primary-200 hover:bg-primary-100">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="app-label text-primary-700">Next up</div>
          <div className="mt-1 truncate text-lg font-black text-gray-950">{getScheduleTitle(event)}</div>
          {tournamentInfo.isTournament ? (
            <div className="mt-0.5 truncate text-xs font-black text-indigo-700">{tournamentInfo.label}</div>
          ) : null}
          <div className="mt-1 text-sm font-bold text-gray-700">{formatEventDateLabel(event.date)} · {formatEventTimeLabel(event.date)}</div>
          <div className="mt-0.5 truncate text-xs font-semibold text-gray-600">{event.childName} · {event.location || 'Location TBD'}</div>
        </div>
        <span className={`inline-flex min-h-6 flex-none items-center rounded-full border px-2 text-[11px] font-extrabold uppercase tracking-[0.04em] ${rsvpBadgeClasses[rsvp]}`}>
          {rsvpLabels[rsvp]}
        </span>
      </div>
      <div className="mt-3 inline-flex min-h-8 items-center gap-2 rounded-full bg-white px-3 text-xs font-black text-primary-700 shadow-sm">
        {actionText}
        <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
      </div>
    </Link>
  );
}

function ScheduleWebControls({ filter, view, selectedPlayerId, selectedTeamId, timeRange, children, teamOptions, loading, insights, advancedControlsOpen, onFilterChange, onViewChange, onPlayerChange, onTeamChange, onTimeRangeChange, onRefresh, onExport, onCopyAgenda, onAdvancedControlsOpenChange, onResetFilters }: {
  filter: ParentScheduleFilter;
  view: ScheduleViewMode;
  selectedPlayerId: string;
  selectedTeamId: string;
  timeRange: ScheduleTimeRange;
  children: ParentScheduleChild[];
  teamOptions: ParentScheduleTeamOption[];
  loading: boolean;
  insights: ScheduleWebInsights;
  advancedControlsOpen: boolean;
  onFilterChange: (filter: ParentScheduleFilter) => void;
  onViewChange: (view: ScheduleViewMode) => void;
  onPlayerChange: (playerId: string) => void;
  onTeamChange: (teamId: string) => void;
  onTimeRangeChange: (range: ScheduleTimeRange) => void;
  onRefresh: () => void;
  onExport: () => void;
  onCopyAgenda: () => void;
  onAdvancedControlsOpenChange: (open: boolean) => void;
  onResetFilters: () => void;
}) {
  const filterLabel = filterOptions.find((option) => option.value === filter)?.label || 'Schedule';
  const rangeLabel = timeRangeOptions.find((option) => option.value === timeRange)?.label || 'All';
  const teamLabel = teamOptions.find((team) => team.teamId === selectedTeamId)?.teamName || 'All teams';
  const playerLabel = children.find((child) => child.playerId === selectedPlayerId)?.playerName || 'All players';

  return (
    <section className="app-card schedule-control-panel p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="app-label">Plan view</div>
          <h2 className="mt-1 text-base font-black text-gray-950">Family agenda</h2>
        </div>
        <button type="button" className="ghost-button !h-9 !min-h-9 !w-9 !p-0" onClick={onRefresh} disabled={loading} aria-label="Refresh schedule">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
        </button>
      </div>

      <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-3">
        <div className="app-label">Active filters</div>
        <div className="mt-1 text-sm font-black text-gray-950">{filterLabel} · {rangeLabel} · {teamLabel} · {playerLabel}</div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            className="secondary-button w-full"
            onClick={() => onAdvancedControlsOpenChange(!advancedControlsOpen)}
            aria-expanded={advancedControlsOpen}
          >
            Filters and views
          </button>
          <button type="button" className="ghost-button w-full" onClick={onResetFilters}>
            Reset
          </button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <Segment active={view === 'list'} onClick={() => onViewChange('list')} icon={ListChecks} label="List" />
        <Segment active={view === 'calendar'} onClick={() => onViewChange('calendar')} icon={CalendarDays} label="Calendar" />
        <Segment active={view === 'packets'} onClick={() => onViewChange('packets')} icon={ClipboardCheck} label="Packets" />
      </div>

      <div className="mt-4 space-y-2" aria-label="Primary schedule filters">
        {filterOptions.map((option) => (
          <ScheduleFilterButton
            key={option.value}
            option={option}
            active={filter === option.value}
            onClick={() => onFilterChange(option.value)}
            fullWidth
          />
        ))}
      </div>

      <label className="mt-4 block">
        <span className="app-label">Player</span>
        <select aria-label="Player" className="auth-input mt-1 min-h-10 truncate !px-3 !py-2 text-sm font-black" value={selectedPlayerId} onChange={(event) => onPlayerChange(event.target.value)}>
          <option value="">All Players</option>
          {children.map((child) => (
            <option key={`${child.teamId}-${child.playerId}`} value={child.playerId}>{child.playerName}</option>
          ))}
        </select>
      </label>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button type="button" className="secondary-button w-full" onClick={onExport}>
          <Download className="h-4 w-4" aria-hidden="true" />
          .ics
        </button>
        <button type="button" className="secondary-button w-full" onClick={onCopyAgenda}>
          <Copy className="h-4 w-4" aria-hidden="true" />
          Copy agenda
        </button>
      </div>

      {advancedControlsOpen ? (
        <>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Segment active={view === 'list'} onClick={() => onViewChange('list')} icon={ListChecks} label="List" />
        <Segment active={view === 'compact'} onClick={() => onViewChange('compact')} icon={ListChecks} label="Compact" />
        <Segment active={view === 'calendar'} onClick={() => onViewChange('calendar')} icon={CalendarDays} label="Calendar" />
        <Segment active={view === 'packets'} onClick={() => onViewChange('packets')} icon={ClipboardCheck} label="Packets" />
      </div>

      <label className="mt-4 block">
        <span className="app-label">Range</span>
        <select aria-label="Time range" className="auth-input mt-1 min-h-10 truncate !px-3 !py-2 text-sm font-black" value={timeRange} onChange={(event) => onTimeRangeChange(event.target.value as ScheduleTimeRange)}>
          {timeRangeOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>

      <label className="mt-4 block">
        <span className="app-label">Team</span>
        <select aria-label="Team" className="auth-input mt-1 min-h-10 truncate !px-3 !py-2 text-sm font-black" value={selectedTeamId} onChange={(event) => onTeamChange(event.target.value)}>
          <option value="">All Teams</option>
          {teamOptions.map((team) => (
            <option key={team.teamId} value={team.teamId}>{team.teamName}</option>
          ))}
        </select>
      </label>

      <label className="mt-4 block">
        <span className="app-label">Player</span>
        <select aria-label="Player" className="auth-input mt-1 min-h-10 truncate !px-3 !py-2 text-sm font-black" value={selectedPlayerId} onChange={(event) => onPlayerChange(event.target.value)}>
          <option value="">All Players</option>
          {children.map((child) => (
            <option key={`${child.teamId}-${child.playerId}`} value={child.playerId}>{child.playerName}</option>
          ))}
        </select>
      </label>

      <div className="mt-4 space-y-2" aria-label="Schedule filters">
        {filterOptions.map((option) => (
          <ScheduleFilterButton
            key={option.value}
            option={option}
            active={filter === option.value}
            onClick={() => onFilterChange(option.value)}
            fullWidth
          />
        ))}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button type="button" className="secondary-button w-full" onClick={onExport}>
          <Download className="h-4 w-4" aria-hidden="true" />
          Download
        </button>
        <button type="button" className="secondary-button w-full" onClick={onCopyAgenda}>
          <Copy className="h-4 w-4" aria-hidden="true" />
          Copy
        </button>
      </div>
      <div className="mt-2 rounded-xl border border-gray-200 bg-gray-50 p-2 text-[11px] font-semibold leading-4 text-gray-500">
        Use the calendar file for Apple or Google Calendar import. Copy agenda sends plain event details.
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <ScheduleInsightMini label="RSVP" value={insights.rsvpNeeded} />
        <ScheduleInsightMini label="Packets" value={insights.packetsReady} />
        <ScheduleInsightMini label="Tasks" value={insights.openAssignments} />
        <ScheduleInsightMini label="Ride asks" value={insights.rideRequests} />
      </div>
        </>
      ) : null}
    </section>
  );
}

function ScheduleFilterButton({ option, active, onClick, fullWidth = false }: {
  option: { value: ParentScheduleFilter; label: string };
  active: boolean;
  onClick: () => void;
  fullWidth?: boolean;
}) {
  return (
    <button
      type="button"
      className={`inline-flex min-h-10 flex-none items-center gap-2 rounded-full border px-3 text-sm font-black transition ${
        active ? 'border-primary-200 bg-primary-50 text-primary-700' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50'
      } ${fullWidth ? 'w-full justify-start rounded-xl' : ''}`}
      onClick={onClick}
      aria-pressed={active}
    >
      <Filter className="h-4 w-4" aria-hidden="true" />
      {option.label}
    </button>
  );
}

function ScheduleInsightMini({ label, value }: { label: string; value: number }) {
  const active = value > 0;
  return (
    <div className={`rounded-xl border p-3 ${active ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-gray-50'}`}>
      <div className={`text-lg font-black leading-none ${active ? 'text-amber-900' : 'text-gray-950'}`}>{value}</div>
      <div className={`mt-1 text-[10px] font-extrabold uppercase tracking-[0.04em] ${active ? 'text-amber-700' : 'text-gray-500'}`}>{label}</div>
    </div>
  );
}

function ScheduleActionQueue({ events, compact = false, hideWhenEmpty = false, preferGameHubForStaff = false }: {
  events: ParentScheduleEvent[];
  compact?: boolean;
  hideWhenEmpty?: boolean;
  preferGameHubForStaff?: boolean;
}) {
  const actionEvents = events
    .map((event) => ({ event, action: getEventActionSummary(event) }))
    .filter((item) => item.action)
    .slice(0, 5);

  if (hideWhenEmpty && !actionEvents.length) return null;

  return (
    <section className={`app-card schedule-action-queue ${compact ? 'schedule-action-queue-mobile min-w-0 overflow-hidden p-3' : 'p-4'}`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          {compact ? (
            <h2 className="text-sm font-black text-gray-950">Needs attention</h2>
          ) : (
            <>
              <div className="app-label">Needs attention</div>
              <h2 className="mt-1 text-base font-black text-gray-950">Parent queue</h2>
            </>
          )}
        </div>
        <ClipboardCheck className="h-5 w-5 text-primary-600" aria-hidden="true" />
      </div>
      <div className={`${compact ? 'mt-2 max-h-56 overflow-y-auto overscroll-contain' : 'mt-3'} space-y-2`}>
        {actionEvents.length ? actionEvents.map(({ event, action }) => (
          <Link key={event.eventKey} to={getGenericEventDetailPath(event, preferGameHubForStaff)} className={`block rounded-xl border border-gray-200 bg-white transition hover:border-primary-200 hover:bg-primary-50 ${compact ? 'min-h-11 p-2.5' : 'p-3'}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-black text-gray-950">{action}</div>
                <div className="mt-0.5 truncate text-xs font-semibold text-gray-500">{event.childName} · {getScheduleTitle(event)}</div>
              </div>
              <ChevronRight className="mt-0.5 h-4 w-4 flex-none text-gray-400" aria-hidden="true" />
            </div>
          </Link>
        )) : (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">
            Nothing needs action for this filter.
          </div>
        )}
      </div>
    </section>
  );
}

function LoadingSchedule() {
  return <SchedulePageSkeleton />;
}

function ScheduleList({ events, totalCount, visibleCount, pageSize, canShowMore, loadingMore, preferGameHubForStaff, onShowMore }: {
  events: CalendarScheduleEntry[];
  totalCount: number;
  visibleCount: number;
  pageSize: number;
  canShowMore: boolean;
  loadingMore: boolean;
  preferGameHubForStaff: boolean;
  onShowMore: () => void;
}) {
  if (!totalCount) {
    return (
      <div className="app-card p-8 text-center">
        <CalendarDays className="mx-auto h-10 w-10 text-gray-300" aria-hidden="true" />
        <div className="mt-3 text-sm font-black text-gray-900">No events in this filter</div>
        <div className="mt-1 text-xs font-semibold text-gray-500">Try another player or switch between upcoming and past events.</div>
      </div>
    );
  }

  const renderedEvents = events.slice(0, visibleCount);
  const remainingCount = Math.max(totalCount - renderedEvents.length, 0);

  return (
    <div className="space-y-3">
      <div className="schedule-list overflow-hidden rounded-xl border border-gray-200 bg-white shadow-app sm:space-y-3 sm:overflow-visible sm:border-0 sm:bg-transparent sm:shadow-none">
        {renderedEvents.map((event) => (
          <ScheduleEventCard key={event.eventKey} event={event} preferGameHubForStaff={preferGameHubForStaff} />
        ))}
      </div>
      {canShowMore ? (
        <div className="rounded-xl border border-gray-200 bg-white p-3 text-center shadow-sm">
          <div className="text-xs font-bold text-gray-500">
            Showing {renderedEvents.length} of {totalCount} events
          </div>
          <button type="button" className="secondary-button mt-2 min-h-9 px-3 py-2 text-xs" onClick={onShowMore} disabled={loadingMore}>
            {loadingMore ? 'Loading more…' : `Show ${Math.min(pageSize, remainingCount || pageSize)} more`}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function CompactScheduleList({ events, totalCount, visibleCount, pageSize, canShowMore, loadingMore, preferGameHubForStaff, onShowMore }: {
  events: CalendarScheduleEntry[];
  totalCount: number;
  visibleCount: number;
  pageSize: number;
  canShowMore: boolean;
  loadingMore: boolean;
  preferGameHubForStaff: boolean;
  onShowMore: () => void;
}) {
  if (!totalCount) {
    return (
      <div className="app-card p-8 text-center">
        <CalendarDays className="mx-auto h-10 w-10 text-gray-300" aria-hidden="true" />
        <div className="mt-3 text-sm font-black text-gray-900">No events in this filter</div>
        <div className="mt-1 text-xs font-semibold text-gray-500">Try another team, player, range, or schedule type.</div>
      </div>
    );
  }

  const renderedEvents = events.slice(0, visibleCount);
  const remainingCount = Math.max(totalCount - renderedEvents.length, 0);

  return (
    <section className="space-y-3">
      <div className="app-card overflow-hidden">
        <div className="border-b border-gray-100 bg-gray-50 px-3 py-2">
          <div className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">Compact schedule</div>
        </div>
        <div className="divide-y divide-gray-100">
          {renderedEvents.map((event) => {
            const rsvp = normalizeRsvpResponse(event.myRsvp);
            const tournamentInfo = getScheduleTournamentInfo(event);
            return (
              <Link key={event.eventKey} to={getGenericEventDetailPath(event, preferGameHubForStaff)} className="compact-schedule-row grid grid-cols-[82px_minmax(0,1fr)_auto] gap-3 px-3 py-2.5 transition hover:bg-primary-50">
                <div className="text-xs font-black text-gray-700">
                  <div>{formatEventDateLabel(event.date)}</div>
                  <div className="mt-0.5 text-gray-500">{formatEventTimeLabel(event.date)}</div>
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-black text-gray-950">{getScheduleTitle(event)}</div>
                  <div className="mt-0.5 truncate text-xs font-semibold text-gray-500">{getScheduleChildLabel(event)} · {event.teamName} · {event.location || 'TBD'}</div>
                  {tournamentInfo.isTournament ? (
                    <div className="mt-0.5 truncate text-xs font-bold text-indigo-700">{tournamentInfo.label}</div>
                  ) : null}
                </div>
                <span className={`self-center rounded-full border px-2 py-1 text-[10px] font-extrabold uppercase tracking-[0.04em] ${rsvpBadgeClasses[rsvp]}`}>
                  {rsvpLabels[rsvp]}
                </span>
              </Link>
            );
          })}
        </div>
      </div>
      {canShowMore ? (
        <div className="rounded-xl border border-gray-200 bg-white p-3 text-center shadow-sm">
          <div className="text-xs font-bold text-gray-500">
            Showing {renderedEvents.length} of {totalCount} events
          </div>
          <button type="button" className="secondary-button mt-2 min-h-9 px-3 py-2 text-xs" onClick={onShowMore} disabled={loadingMore}>
            {loadingMore ? 'Loading more…' : `Show ${Math.min(pageSize, remainingCount || pageSize)} more`}
          </button>
        </div>
      ) : null}
    </section>
  );
}

function PracticePacketsPanel({ rows, totalCount, readyCount, visibleCount, pageSize, canShowMore, loadingMore, onShowMore }: {
  rows: PracticePacketScheduleRow[];
  totalCount: number;
  readyCount: number;
  visibleCount: number;
  pageSize: number;
  canShowMore: boolean;
  loadingMore: boolean;
  onShowMore: () => void;
}) {
  if (!totalCount) {
    return (
      <div className="app-card p-8 text-center">
        <ClipboardCheck className="mx-auto h-10 w-10 text-gray-300" aria-hidden="true" />
        <div className="mt-3 text-sm font-black text-gray-900">No practice packets in this filter</div>
        <div className="mt-1 text-xs font-semibold text-gray-500">Packets appear when a practice has home drills or follow-up work.</div>
      </div>
    );
  }

  const renderedRows = rows.slice(0, visibleCount);
  const remainingCount = Math.max(totalCount - renderedRows.length, 0);

  return (
    <section className="space-y-3">
      <div className={`rounded-xl border p-3 ${readyCount ? 'border-blue-200 bg-blue-50' : 'border-emerald-200 bg-emerald-50'}`}>
        <div className={`text-sm font-black ${readyCount ? 'text-blue-950' : 'text-emerald-900'}`}>
          {readyCount ? `${readyCount} practice ${readyCount === 1 ? 'packet needs' : 'packets need'} review` : 'All visible packets are handled'}
        </div>
        <div className={`mt-0.5 text-xs font-semibold ${readyCount ? 'text-blue-800' : 'text-emerald-700'}`}>
          Open a packet to review drills and mark the right player complete.
        </div>
      </div>
      <div className="schedule-list overflow-hidden rounded-xl border border-gray-200 bg-white shadow-app sm:space-y-3 sm:overflow-visible sm:border-0 sm:bg-transparent sm:shadow-none">
        {renderedRows.map((row) => (
          <Link key={`${row.event.eventKey}-packet`} to={getGenericEventDetailPath(row.event)} className="block border-b border-gray-100 px-3 py-3 transition last:border-b-0 hover:bg-gray-50 sm:rounded-xl sm:border sm:border-blue-100 sm:bg-white sm:shadow-sm sm:hover:border-blue-200 sm:hover:bg-blue-50">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 flex-none rounded-full ${row.needsAction ? 'bg-blue-600' : row.status === 'completed' ? 'bg-emerald-500' : 'bg-gray-400'}`} aria-hidden="true" />
                  <h2 className="truncate text-sm font-black text-gray-950">{getScheduleTitle(row.event)}</h2>
                </div>
                <div className="mt-1 truncate text-xs font-semibold text-gray-500">
                  {row.event.childName} · {formatEventDateLabel(row.event.date)} {formatEventTimeLabel(row.event.date)} · {row.event.location || 'TBD'}
                </div>
                <div className="mt-1 truncate text-xs font-bold text-blue-800">
                  {row.event.practiceHomePacketSummary}
                </div>
              </div>
              <span className={`flex-none rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[0.04em] ${row.needsAction ? 'bg-blue-100 text-blue-800' : row.status === 'completed' ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-600'}`}>
                {row.needsAction ? 'Open' : row.status}
              </span>
            </div>
          </Link>
        ))}
      </div>
      {canShowMore ? (
        <div className="rounded-xl border border-gray-200 bg-white p-3 text-center shadow-sm">
          <div className="text-xs font-bold text-gray-500">
            Showing {renderedRows.length} of {totalCount} packets
          </div>
          <button type="button" className="secondary-button mt-2 min-h-9 px-3 py-2 text-xs" onClick={onShowMore} disabled={loadingMore}>
            {loadingMore ? 'Loading more…' : `Show ${Math.min(pageSize, remainingCount || pageSize)} more`}
          </button>
        </div>
      ) : null}
    </section>
  );
}

function ScheduleEventCard({ event, preferGameHubForStaff }: {
  event: ParentScheduleEvent | CalendarScheduleEntry;
  preferGameHubForStaff: boolean;
}) {
  const rsvp = normalizeRsvpResponse(event.myRsvp);
  const eventTitle = getScheduleTitle(event);
  const defaultDetailPath = getScheduleEventDetailPath(event);
  const detailPath = getGenericEventDetailPath(event, preferGameHubForStaff) || defaultDetailPath;
  const isRsvpNeeded = isScheduleAvailabilityNeeded(event);
  const hasPracticePacket = event.type === 'practice' && Boolean(event.practiceHomePacketSummary);
  const actionPills = getEventCardActionPills(event);
  const mobileActionPills = actionPills
    .filter((pill) => pill !== 'Availability needed' && !pill.startsWith('Packet:'))
    .slice(0, 2);
  const metadataPills = getEventMetadataPills(event);
  const mapHref = getScheduleMapHref(event.location);
  const forecastHref = getScheduleForecastHref(event.location, event.date);
  const childLabel = getScheduleChildLabel(event);
  const tournamentInfo = getScheduleTournamentInfo(event);

  return (
    <>
      <Link to={detailPath} className={`block border-b border-gray-100 px-3 py-2 transition last:border-b-0 hover:bg-gray-50 sm:hidden ${event.isCancelled ? 'opacity-65' : ''}`}>
        <div className="flex items-center gap-2.5">
          <div className="flex h-12 w-11 flex-none flex-col items-center justify-center rounded-lg bg-gray-50 ring-1 ring-gray-100">
            <div className="text-[10px] font-black uppercase leading-none tracking-[0.04em] text-gray-500">{event.date.toLocaleDateString('en-US', { month: 'short' })}</div>
            <div className="mt-0.5 text-lg font-black leading-none text-gray-950">{event.date.getDate()}</div>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className={`h-2.5 w-2.5 flex-none rounded-full ${event.type === 'practice' ? 'bg-amber-500' : 'bg-primary-600'}`} aria-hidden="true" />
              <h2 className={`truncate text-[15px] font-black leading-tight text-gray-950 ${event.isCancelled ? 'line-through' : ''}`}>{eventTitle}</h2>
            </div>
            <div className="mt-0.5 truncate text-xs font-bold leading-5 text-gray-600">
              {childLabel} · {event.teamName}
            </div>
            <div className="truncate text-xs font-semibold leading-5 text-gray-500">
              {event.location || 'TBD'}
            </div>
            {tournamentInfo.isTournament ? (
              <div className="truncate text-xs font-bold leading-5 text-indigo-700">
                {tournamentInfo.label}{tournamentInfo.details ? ` - ${tournamentInfo.details}` : ''}
              </div>
            ) : null}
            {mobileActionPills.length ? (
              <div className="mt-1 flex max-h-5 flex-wrap gap-1 overflow-hidden">
                {mobileActionPills.map((pill) => (
                  <span key={pill} className="inline-flex min-h-5 items-center rounded-full border border-gray-200 bg-white px-1.5 text-[10px] font-black leading-none text-gray-700">
                    {pill}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
          <div className="flex w-[72px] flex-none flex-col items-end gap-1 text-right">
            <span className="text-xs font-black text-gray-700">{formatEventTimeLabel(event.date)}</span>
            {isRsvpNeeded ? <span className="rounded-full bg-primary-50 px-2 py-0.5 text-[10px] font-black uppercase text-primary-700">RSVP</span> : null}
            {hasPracticePacket ? <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-black uppercase text-blue-700">Packet</span> : null}
            {event.type === 'game' && getScoreLabel(event) ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-black uppercase text-emerald-700">{getScoreLabel(event)}</span> : null}
          </div>
        </div>
      </Link>

      <article className={`app-card schedule-event-card hidden p-4 transition sm:block ${event.isCancelled ? 'opacity-65' : ''}`}>
        <div className="flex items-start gap-3">
          <div className="schedule-card-date flex h-16 w-16 flex-none flex-col items-center justify-center rounded-2xl bg-gray-50 shadow-inner ring-1 ring-gray-200">
            <div className="text-2xl font-black leading-none text-gray-950">{event.date.getDate()}</div>
            <div className="mt-1 text-[10px] font-black uppercase tracking-[0.08em] text-gray-500">{event.date.toLocaleDateString('en-US', { weekday: 'short' })}</div>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex min-h-6 items-center rounded-full px-2 text-[11px] font-extrabold uppercase tracking-[0.04em] ${event.type === 'practice' ? 'bg-amber-100 text-amber-800' : 'bg-primary-100 text-primary-800'}`}>
              {event.type}
            </span>
            {event.isCancelled ? <span className="inline-flex min-h-6 items-center rounded-full bg-rose-100 px-2 text-[11px] font-extrabold uppercase tracking-[0.04em] text-rose-800">Cancelled</span> : null}
            {hasPracticePacket ? <span className="inline-flex min-h-6 items-center rounded-full bg-blue-50 px-2 text-[11px] font-extrabold uppercase tracking-[0.04em] text-blue-700">Packet ready</span> : null}
            <span className={`inline-flex min-h-6 items-center rounded-full border px-2 text-[11px] font-extrabold uppercase tracking-[0.04em] ${rsvpBadgeClasses[rsvp]}`}>
              {rsvpLabels[rsvp]}
            </span>
            {metadataPills.map((pill) => (
              <span key={pill} className="inline-flex min-h-6 items-center rounded-full bg-gray-100 px-2 text-[11px] font-extrabold uppercase tracking-[0.04em] text-gray-600">
                {pill}
              </span>
            ))}
          </div>

            <h2 className={`mt-2 text-lg font-black leading-tight text-gray-950 ${event.isCancelled ? 'line-through' : ''}`}>{eventTitle}</h2>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm font-semibold text-gray-600">
              <span>{formatEventTimeLabel(event.date)}</span>
              <span className="inline-flex min-w-0 items-center gap-1">
                <MapPin className="h-3.5 w-3.5 flex-none" aria-hidden="true" />
                <span className="truncate">{event.location || 'TBD'}</span>
                {mapHref ? (
                  <a href={mapHref} target="_blank" rel="noreferrer" className="ml-1 flex-none text-xs font-black text-primary-700 hover:underline" onClick={(clickEvent) => clickEvent.stopPropagation()}>
                    Map
                  </a>
                ) : null}
                {forecastHref ? (
                  <a href={forecastHref} target="_blank" rel="noreferrer" className="ml-1 flex-none text-xs font-black text-primary-700 hover:underline" onClick={(clickEvent) => clickEvent.stopPropagation()}>
                    Forecast
                  </a>
                ) : null}
              </span>
            </div>
            <div className="mt-1 text-xs font-semibold text-gray-500">For {childLabel} · {event.teamName}</div>

            <TournamentScheduleSummary info={tournamentInfo} />

            {actionPills.length ? (
              <div className="schedule-card-pills mt-3 flex flex-wrap gap-1.5">
                {actionPills.map((pill) => (
                  <span key={pill} className="inline-flex min-h-7 items-center rounded-full border border-gray-200 bg-white px-2.5 text-xs font-black text-gray-700">
                    {pill}
                  </span>
                ))}
              </div>
            ) : null}

            <div className="schedule-card-actions mt-3 flex items-center justify-between gap-3">
              <Link to={detailPath} className="secondary-button min-h-9 px-3 py-2 text-xs">
                {event.type === 'practice' ? 'Event details' : 'Game details'}
                <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
              <div className="hidden text-xs font-bold text-gray-400 xl:block">
                {formatEventDateLabel(event.date)}
              </div>
            </div>
          </div>
        </div>
      </article>
    </>
  );
}

function TournamentScheduleSummary({ info }: { info: ScheduleTournamentInfo }) {
  if (!info.isTournament) return null;

  const standingsRows = info.standings?.rows.slice(0, 4) || [];
  const hiddenStandingCount = Math.max((info.standings?.rows.length || 0) - standingsRows.length, 0);
  const showMatchup = Boolean(info.matchupLabel && !info.details.includes(info.matchupLabel));

  return (
    <div className="mt-3 rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2" aria-label="Tournament information">
      <div className="text-xs font-black text-indigo-950">{info.label}</div>
      {info.details ? <div className="mt-0.5 text-xs font-semibold text-indigo-800">{info.details}</div> : null}
      {showMatchup ? <div className="mt-0.5 text-xs font-semibold text-indigo-800">{info.matchupLabel}</div> : null}
      {info.standings ? (
        <div className="mt-2 border-t border-indigo-100 pt-2">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-black uppercase tracking-[0.04em] text-indigo-900">
            <span>{info.standings.groupName} standings</span>
            {info.standings.note ? <span className="rounded-full bg-white px-2 py-0.5 text-indigo-700">{info.standings.note}</span> : null}
          </div>
          <div className="mt-1 grid gap-1 sm:grid-cols-2">
            {standingsRows.map((row) => (
              <div key={`${row.rank}-${row.teamName}`} className="truncate text-xs font-semibold text-indigo-900">
                #{row.rank} {row.teamName}{formatTournamentStandingMeta(row)}
              </div>
            ))}
            {hiddenStandingCount ? (
              <div className="text-xs font-semibold text-indigo-700">+{hiddenStandingCount} more</div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function formatTournamentStandingMeta(row: ScheduleTournamentStandingRow) {
  const parts = [
    row.record,
    row.points !== null ? `${row.points} pts` : ''
  ].filter(Boolean);
  return parts.length ? ` (${parts.join(', ')})` : '';
}

export { getGenericEventDetailPath } from '../lib/scheduleLogic';

function getScheduleChildLabel(event: ParentScheduleEvent | CalendarScheduleEntry) {
  const names = 'childNames' in event && event.childNames.length ? event.childNames : [];
  if (names.length > 2) return `${names.slice(0, 2).join(', ')} +${names.length - 2}`;
  if (names.length) return names.join(', ');
  return event.childName || 'Player';
}

function getEventPrimaryActionText(event: ParentScheduleEvent) {
  if (isScheduleAvailabilityNeeded(event)) return 'Set availability';
  if (event.type === 'practice' && event.practiceHomePacketSummary) return 'Review packet';
  if (getEventOpenAssignmentCount(event) > 0) return 'Review assignments';
  if ((event.rideshareSummary?.requests || 0) > 0) return 'Check ride requests';
  return event.type === 'practice' ? 'Open practice' : 'Open game';
}

function getEventActionSummary(event: ParentScheduleEvent) {
  if (isScheduleAvailabilityNeeded(event)) return `RSVP needed for ${event.childName}`;
  if (event.type === 'practice' && event.practiceHomePacketSummary) return `Packet ready: ${event.practiceHomePacketSummary}`;
  const openAssignments = getEventOpenAssignmentCount(event);
  if (openAssignments > 0) return `${openAssignments} open ${openAssignments === 1 ? 'assignment' : 'assignments'}`;
  const rideRequests = event.rideshareSummary?.requests || 0;
  if (rideRequests > 0) return `${rideRequests} ride ${rideRequests === 1 ? 'request' : 'requests'}`;
  return '';
}

function getEventCardActionPills(event: ParentScheduleEvent | CalendarScheduleEntry) {
  const pills: string[] = [];
  if (isScheduleAvailabilityNeeded(event)) pills.push('Availability needed');
  if (event.type === 'practice' && event.practiceHomePacketSummary) pills.push(`Packet: ${event.practiceHomePacketSummary}`);
  const openAssignments = getEventOpenAssignmentCount(event);
  if (openAssignments > 0) pills.push(`${openAssignments} task${openAssignments === 1 ? '' : 's'} open`);
  const seatsLeft = event.rideshareSummary?.seatsLeft || 0;
  const rideRequests = event.rideshareSummary?.requests || 0;
  if (seatsLeft > 0) pills.push(`${seatsLeft} seats open`);
  if (rideRequests > 0) pills.push(`${rideRequests} ride ${rideRequests === 1 ? 'request' : 'requests'}`);
  return pills.slice(0, 4);
}

function isScheduleAvailabilityNeeded(event: ParentScheduleEvent | CalendarScheduleEntry) {
  return normalizeRsvpResponse(event.myRsvp) === 'not_responded' && canSubmitScheduleEventRsvp(event);
}

function getEventMetadataPills(event: ParentScheduleEvent | CalendarScheduleEntry) {
  return [
    event.type === 'game' && getScoreLabel(event) ? `Final ${getScoreLabel(event)}` : '',
    event.isHome === true ? 'Home' : event.isHome === false ? 'Away' : '',
    event.seasonLabel ? event.seasonLabel : '',
    event.competitionType ? event.competitionType : '',
    event.isImported ? 'Imported' : ''
  ].filter(Boolean).slice(0, 3);
}

function getScoreLabel(event: ParentScheduleEvent | CalendarScheduleEntry) {
  if (event.type !== 'game') return '';
  if (event.homeScore === null || event.homeScore === undefined || event.awayScore === null || event.awayScore === undefined) return '';
  const status = String(event.status || '').trim().toLowerCase();
  const liveStatus = String(event.liveStatus || '').trim().toLowerCase();
  const isCompleted = status === 'completed' || status === 'final' || liveStatus === 'completed' || liveStatus === 'final';
  const isPastScheduledResult = event.date.getTime() < Date.now() - pastScheduleCutoffMs;
  if (!isCompleted && !isPastScheduledResult) return '';
  return `${event.homeScore}-${event.awayScore}`;
}

function CalendarSchedule({ month, entries, selectedDay, selectedDayEntries, preferGameHubForStaff, onMonthChange, onDaySelect, onDayClose }: {
  month: Date;
  entries: CalendarScheduleEntry[];
  selectedDay: Date | null;
  selectedDayEntries: CalendarScheduleEntry[];
  preferGameHubForStaff: boolean;
  onMonthChange: (month: Date) => void;
  onDaySelect: (day: Date) => void;
  onDayClose: () => void;
}) {
  const monthLabel = month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const monthStart = new Date(month.getFullYear(), month.getMonth(), 1);
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const startDow = monthStart.getDay();
  const totalCells = Math.ceil((startDow + daysInMonth) / 7) * 7;
  const entriesByDay = new Map<number, CalendarScheduleEntry[]>();
  entries.forEach((entry) => {
    if (entry.date.getFullYear() !== month.getFullYear() || entry.date.getMonth() !== month.getMonth()) return;
    const day = entry.date.getDate();
    entriesByDay.set(day, [...(entriesByDay.get(day) || []), entry]);
  });

  return (
    <div className="space-y-3">
      <section className="app-card overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-gray-100 bg-white p-3">
          <button type="button" className="ghost-button min-h-9 px-3" onClick={() => onMonthChange(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            Prev
          </button>
          <div className="text-sm font-black text-gray-950">{monthLabel}</div>
          <button type="button" className="ghost-button min-h-9 px-3" onClick={() => onMonthChange(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>
            Next
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="grid grid-cols-7 border-b border-gray-200 bg-gray-50">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
            <div key={day} className="py-2 text-center text-[11px] font-black uppercase text-gray-500">{day}</div>
          ))}
        </div>
        <div className="calendar-schedule-grid grid grid-cols-7">
          {Array.from({ length: totalCells }, (_, index) => {
            const dayNumber = index - startDow + 1;
            const inMonth = dayNumber >= 1 && dayNumber <= daysInMonth;
            const dayEntries = inMonth ? entriesByDay.get(dayNumber) || [] : [];
            const isSelected = selectedDay && selectedDay.getFullYear() === month.getFullYear() && selectedDay.getMonth() === month.getMonth() && selectedDay.getDate() === dayNumber;
            const daySummary = dayEntries.length
              ? `${dayEntries.length} ${dayEntries.length === 1 ? 'event' : 'events'}`
              : '';
            return (
              <button
                key={index}
                type="button"
                className={`min-h-24 border border-gray-100 p-1.5 text-left align-top ${inMonth ? 'bg-white hover:bg-gray-50' : 'bg-gray-50 text-gray-300'} ${isSelected ? 'ring-2 ring-primary-300' : ''}`}
                disabled={!inMonth || dayEntries.length === 0}
                onClick={() => onDaySelect(new Date(month.getFullYear(), month.getMonth(), dayNumber))}
                aria-label={inMonth ? `${monthLabel} ${dayNumber}${daySummary ? `, ${daySummary}` : ''}` : undefined}
              >
                {inMonth ? <div className="text-xs font-black text-gray-700">{dayNumber}</div> : null}
                <div className="mt-1 space-y-1">
                  {dayEntries.slice(0, 2).map((entry) => (
                    <div key={entry.eventKey} className={`truncate rounded px-1 py-0.5 text-[10px] font-bold ${entry.type === 'practice' ? 'bg-amber-100 text-amber-800' : 'bg-primary-100 text-primary-800'}`}>
                      {getScheduleTitle(entry)}
                    </div>
                  ))}
                  {dayEntries.length > 2 ? <div className="text-[10px] font-semibold text-gray-400">+{dayEntries.length - 2} more</div> : null}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <CalendarEventPicker
        day={selectedDay}
        entries={selectedDayEntries}
        preferGameHubForStaff={preferGameHubForStaff}
        onClose={onDayClose}
      />
    </div>
  );
}

function CalendarEventPicker({ day, entries, preferGameHubForStaff, onClose }: {
  day: Date | null;
  entries: CalendarScheduleEntry[];
  preferGameHubForStaff: boolean;
  onClose: () => void;
}) {
  if (!day) return null;

  const dayLabel = day.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const eventCountLabel = `${entries.length} ${entries.length === 1 ? 'event' : 'events'}`;

  return (
    <Modal overlayClassName="z-[70] flex items-end bg-gray-950/40 p-0 sm:items-center sm:p-6" ariaLabelledBy="calendar-event-picker-title" onClose={onClose}>
      <section className="relative w-full overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:mx-auto sm:max-w-2xl sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-4 py-3">
          <div className="min-w-0">
            <div className="app-label">Calendar</div>
            <h2 id="calendar-event-picker-title" className="mt-1 truncate text-lg font-black text-gray-950">{dayLabel}</h2>
            <div className="mt-0.5 text-xs font-semibold text-gray-500">{eventCountLabel}</div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-white text-lg font-black leading-none text-gray-500 transition hover:border-gray-300 hover:text-gray-700"
              aria-label="Close calendar events"
              onClick={onClose}
            >
              <span aria-hidden="true">×</span>
            </button>
            <button type="button" className="ghost-button !min-h-9 !px-3 !py-2 !text-xs" onClick={onClose}>
              Close
            </button>
          </div>
        </div>

        {entries.length ? (
          <div className="max-h-[65vh] overflow-y-auto p-3 sm:max-h-[70vh]">
            <div className="space-y-2">
              {entries.map((entry) => (
                <CalendarEventPickerRow key={entry.eventKey} entry={entry} preferGameHubForStaff={preferGameHubForStaff} />
              ))}
            </div>
          </div>
        ) : (
          <div className="p-5 text-sm font-semibold text-gray-500">No events on this day.</div>
        )}
      </section>
    </Modal>
  );
}

function CalendarEventPickerRow({ entry, preferGameHubForStaff }: { entry: CalendarScheduleEntry; preferGameHubForStaff: boolean }) {
  const rsvp = normalizeRsvpResponse(entry.myRsvp);
  const needsRsvp = entry.childRsvps.some((child) => normalizeRsvpResponse(child.myRsvp) === 'not_responded') || rsvp === 'not_responded';
  const childLabel = entry.childNames.length ? entry.childNames.join(', ') : entry.childName;
  const actionLabel = entry.type === 'practice' ? 'Open practice' : 'Open game';
  const tournamentInfo = getScheduleTournamentInfo(entry);

  return (
    <Link to={getGenericEventDetailPath(entry, preferGameHubForStaff)} className="block rounded-2xl border border-gray-200 bg-white p-3 shadow-sm transition hover:border-primary-200 hover:bg-primary-50" onClick={(event) => event.stopPropagation()}>
      <div className="flex items-start gap-3">
        <div className="flex h-12 w-16 flex-none flex-col items-center justify-center rounded-xl bg-gray-50 ring-1 ring-gray-100">
          <div className="text-sm font-black leading-none text-gray-950">{formatEventTimeLabel(entry.date)}</div>
          <div className="mt-1 text-[10px] font-black uppercase tracking-[0.04em] text-gray-500">{entry.type}</div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className={`h-2.5 w-2.5 flex-none rounded-full ${entry.type === 'practice' ? 'bg-amber-500' : 'bg-primary-600'}`} aria-hidden="true" />
            <h3 className="truncate text-sm font-black text-gray-950">{getScheduleTitle(entry)}</h3>
          </div>
          <div className="mt-1 truncate text-xs font-bold text-gray-600">{childLabel} · {entry.teamName}</div>
          <div className="mt-0.5 truncate text-xs font-semibold text-gray-500">{entry.location || 'Location TBD'}</div>
          {tournamentInfo.isTournament ? (
            <div className="mt-0.5 truncate text-xs font-bold text-indigo-700">{tournamentInfo.label}</div>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {needsRsvp ? <span className="rounded-full bg-primary-50 px-2 py-0.5 text-[10px] font-black uppercase text-primary-700">RSVP needed</span> : null}
            {entry.practiceHomePacketSummary ? <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-black uppercase text-blue-700">Packet</span> : null}
            {entry.childNames.length > 1 ? <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-black uppercase text-gray-600">Average {entry.childNames.length} players</span> : null}
          </div>
        </div>
        <span className="mt-1 flex-none rounded-full bg-gray-950 px-3 py-1.5 text-[11px] font-black text-white">{actionLabel}</span>
      </div>
    </Link>
  );
}
