import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { AlertCircle, CalendarDays, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, ClipboardCheck, Copy, Download, Filter, ListChecks, MapPin, RefreshCw } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { Modal } from '../components/Modal';
import { SchedulePageSkeleton } from '../components/PageSkeletons';
import { PullToRefresh } from '../components/PullToRefresh';
import {
  hydrateParentScheduleRsvps,
  loadParentSchedule,
  submitParentScheduleRsvp,
  submitParentScheduleRsvpForChildren,
  type ParentScheduleChild,
  type ParentScheduleStaffTeam
} from '../lib/scheduleService';
import { getCachedAppData, getParentScheduleSummaryCacheKey, loadCachedAppData } from '../lib/appDataCache';
import { toAppServiceError, type AppServiceError } from '../lib/appErrors';
import { startAppInitialLoadTimer } from '../lib/telemetry';
import { recordFirstMeaningfulRender, startScreenMountTimer } from '../lib/uxTiming';
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
import { loadScheduleStaffTools } from '../components/schedule/loadScheduleStaffTools';
import {
  applyBulkRsvpResponse,
  getBulkRsvpCandidates,
  getBulkRsvpResultMessage,
  getNeededBulkRsvpEventKeys,
  groupBulkRsvpEvents
} from '../lib/bulkRsvp';

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
  const [mobileStaffToolsOpen, setMobileStaffToolsOpen] = useState(false);
  const [staffToolsRequested, setStaffToolsRequested] = useState(false);
  const [bulkRsvpOpen, setBulkRsvpOpen] = useState(false);
  const [bulkRsvpResult, setBulkRsvpResult] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const [loadedScheduleUserId, setLoadedScheduleUserId] = useState<string | null>(null);
  const [pastHistoryHasMore, setPastHistoryHasMore] = useState(false);
  const hasLoadedScheduleRef = useRef(false);
  const hasStartedInitialScheduleLoadRef = useRef(false);
  const pastHistoryLoadedRef = useRef(false);
  const childrenRef = useRef<ParentScheduleChild[]>([]);
  const eventsRef = useRef<ParentScheduleEvent[]>([]);
  const rsvpHydrationVersionRef = useRef(0);
  const pendingRsvpEventKeysRef = useRef(new Set<string>());
  const updateScheduleEvents = (updater: (current: ParentScheduleEvent[]) => ParentScheduleEvent[]) => {
    const nextEvents = updater(eventsRef.current);
    eventsRef.current = nextEvents;
    setEvents(nextEvents);
  };
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

  const hydrateScheduleRsvpsInBackground = (result: { children: ParentScheduleChild[]; events: ParentScheduleEvent[] }) => {
    const user = auth.user;
    if (!user) return;
    const hydrationVersion = ++rsvpHydrationVersionRef.current;
    const rsvpEvents = getBulkRsvpCandidates(result.events);
    if (!rsvpEvents.length) return;

    const mergeHydratedEvents = (hydratedEvents: ParentScheduleEvent[]) => {
      if (hydrationVersion !== rsvpHydrationVersionRef.current || auth.user?.uid !== user.uid) return;
      const hydratedByKey = new Map(hydratedEvents.map((event) => [event.eventKey, event]));
      updateScheduleEvents((current) => current.map((event) => {
        if (pendingRsvpEventKeysRef.current.has(event.eventKey)) return event;
        const hydrated = hydratedByKey.get(event.eventKey);
        return hydrated
          ? { ...event, myRsvp: hydrated.myRsvp, myRsvpNote: hydrated.myRsvpNote }
          : event;
      }));
    };

    void hydrateParentScheduleRsvps(
      { children: result.children, events: rsvpEvents },
      user,
      { onProgress: mergeHydratedEvents }
    ).then((hydrated) => mergeHydratedEvents(hydrated.events));
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
          hydrateScheduleRsvpsInBackground(result);
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
  const bulkRsvpCandidates = useMemo(() => getBulkRsvpCandidates(filterParentScheduleEvents(events, {
    filter: 'upcoming-all',
    playerId: selectedPlayerId,
    teamId: selectedTeamId,
    timeRange: 'all'
  })), [events, selectedPlayerId, selectedTeamId]);
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
  const hasManageableScheduleTeams = manageableTeamOptions.length > 0;
  const staffToolsTeamName = useMemo(() => {
    const selectedManageableTeam = selectedTeamId
      ? manageableTeamOptions.find((team) => team.teamId === selectedTeamId)
      : null;
    return selectedManageableTeam?.teamName
      || (manageableTeamOptions.length === 1 ? manageableTeamOptions[0].teamName : null);
  }, [manageableTeamOptions, selectedTeamId]);

  useEffect(() => {
    if (isDesktopWeb || !hasManageableScheduleTeams) setMobileStaffToolsOpen(false);
  }, [hasManageableScheduleTeams, isDesktopWeb]);

  useEffect(() => {
    if (!isDesktopWeb || !hasManageableScheduleTeams) setDesktopStaffToolsOpen(false);
  }, [hasManageableScheduleTeams, isDesktopWeb]);

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

  const handleBulkRsvp = async (
    selectedEventKeys: string[],
    response: Exclude<RsvpResponse, 'not_responded'>
  ) => {
    const user = auth.user;
    if (!user || !selectedEventKeys.length) return { failedEventKeys: selectedEventKeys };

    const selectedKeySet = new Set(selectedEventKeys);
    const targetEvents = bulkRsvpCandidates.filter((event) => selectedKeySet.has(event.eventKey));
    const previousByKey = new Map(targetEvents.map((event) => [event.eventKey, {
      response: normalizeRsvpResponse(event.myRsvp),
      note: event.myRsvpNote || null
    }]));
    selectedEventKeys.forEach((eventKey) => pendingRsvpEventKeysRef.current.add(eventKey));
    updateScheduleEvents((current) => applyBulkRsvpResponse(current, selectedKeySet, response));

    const settledGroups = await Promise.all(groupBulkRsvpEvents(targetEvents).map(async (group) => {
      try {
        if (group.length > 1) {
          await submitParentScheduleRsvpForChildren(group, user, response);
        } else if (group[0]) {
          await submitParentScheduleRsvp(group[0], user, response);
        }
        return { ok: true as const, eventKeys: group.map((event) => event.eventKey) };
      } catch {
        return { ok: false as const, eventKeys: group.map((event) => event.eventKey) };
      }
    }));
    const failedEventKeys = settledGroups.filter((result) => !result.ok).flatMap((result) => result.eventKeys);
    const failedKeySet = new Set(failedEventKeys);
    updateScheduleEvents((current) => current.map((event) => {
      if (!selectedKeySet.has(event.eventKey)) return event;
      if (failedKeySet.has(event.eventKey)) {
        const previous = previousByKey.get(event.eventKey);
        return previous ? { ...event, myRsvp: previous.response, myRsvpNote: previous.note } : event;
      }
      return { ...event, myRsvp: response };
    }));
    selectedEventKeys.forEach((eventKey) => pendingRsvpEventKeysRef.current.delete(eventKey));

    const savedCount = targetEvents.length - failedEventKeys.length;
    setBulkRsvpResult({
      tone: failedEventKeys.length ? 'error' : 'success',
      message: getBulkRsvpResultMessage(savedCount, failedEventKeys.length, response)
    });
    return { failedEventKeys };
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
          {bulkRsvpResult ? <Status tone={bulkRsvpResult.tone} message={bulkRsvpResult.message} /> : null}
          {scheduleReadError ? <Status tone="error" message={scheduleLoadError ? getScheduleLoadErrorMessage(scheduleLoadError, hasLoadedSchedule) : scheduleReadError} /> : null}
          {bulkRsvpCandidates.length > 1 ? (
            <BulkRsvpLauncher
              eventCount={bulkRsvpCandidates.length}
              neededCount={getNeededBulkRsvpEventKeys(bulkRsvpCandidates).length}
              onOpen={() => {
                setBulkRsvpResult(null);
                setBulkRsvpOpen(true);
              }}
            />
          ) : null}
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
              teamName={staffToolsTeamName}
              contentId="desktop-schedule-staff-tools"
              onToggle={() => setDesktopStaffToolsOpen((current) => {
                const nextOpen = !current;
                if (nextOpen) setStaffToolsRequested(true);
                return nextOpen;
              })}
            >
              {staffToolsRequested ? (
                <DeferredScheduleStaffTools
                  auth={auth}
                  events={events}
                  manageableTeamOptions={manageableTeamOptions}
                  selectedTeamId={selectedTeamId}
                  onRefresh={() => refreshSchedule(true)}
                  onStatusMessage={setStatusMessage}
                  onClearError={clearScheduleReadError}
                />
              ) : null}
            </ScheduleStaffToolsSection>
          ) : null}

          {!isDesktopWeb && hasManageableScheduleTeams ? (
            <ScheduleStaffToolsSection
              open={mobileStaffToolsOpen}
              teamName={staffToolsTeamName}
              contentId="mobile-schedule-staff-tools"
              onToggle={() => setMobileStaffToolsOpen((current) => {
                const nextOpen = !current;
                if (nextOpen) setStaffToolsRequested(true);
                return nextOpen;
              })}
            >
              {staffToolsRequested ? (
                <DeferredScheduleStaffTools
                  auth={auth}
                  events={events}
                  manageableTeamOptions={manageableTeamOptions}
                  selectedTeamId={selectedTeamId}
                  onRefresh={() => refreshSchedule(true)}
                  onStatusMessage={setStatusMessage}
                  onClearError={clearScheduleReadError}
                />
              ) : null}
            </ScheduleStaffToolsSection>
          ) : null}
        </div>
      </div>
      {bulkRsvpOpen ? (
        <BulkRsvpModal
          events={bulkRsvpCandidates}
          onClose={() => setBulkRsvpOpen(false)}
          onSubmit={handleBulkRsvp}
        />
      ) : null}
    </div>
    </PullToRefresh>
  );
}

type DeferredScheduleStaffToolsProps = {
  auth: AuthState;
  events: ParentScheduleEvent[];
  manageableTeamOptions: ParentScheduleTeamOption[];
  selectedTeamId: string;
  onRefresh: () => Promise<unknown>;
  onStatusMessage: (message: string | null) => void;
  onClearError: () => void;
};

function DeferredScheduleStaffTools(props: DeferredScheduleStaffToolsProps) {
  const [StaffTools, setStaffTools] = useState<ComponentType<DeferredScheduleStaffToolsProps> | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadScheduleStaffTools()
      .then((module) => {
        if (!cancelled) setStaffTools(() => module.default);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loadError) {
    return <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-700">Unable to load schedule tools. Check your connection and refresh to try again.</div>;
  }
  if (!StaffTools) {
    return <div role="status" className="rounded-2xl border border-gray-200 bg-gray-50 p-3 text-sm font-bold text-gray-500">Loading schedule tools…</div>;
  }
  return <StaffTools {...props} />;
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
      {children ? (
        <div id={contentId} className="mt-3 space-y-3" hidden={!open}>
          {children}
        </div>
      ) : null}
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

function BulkRsvpLauncher({ eventCount, neededCount, onOpen }: {
  eventCount: number;
  neededCount: number;
  onOpen: () => void;
}) {
  return (
    <section className="app-card flex items-center justify-between gap-3 border-primary-100 bg-primary-50 p-3 sm:p-4" aria-label="Family RSVP">
      <div className="min-w-0">
        <div className="app-label text-primary-700">Family RSVP</div>
        <h2 className="mt-1 text-sm font-black text-gray-950 sm:text-base">Respond to multiple events</h2>
        <p className="mt-0.5 text-xs font-semibold leading-5 text-gray-600">
          {neededCount
            ? `${neededCount} ${neededCount === 1 ? 'event needs' : 'events need'} a response. Review up to ${eventCount} upcoming games and practices together.`
            : `Review or update ${eventCount} upcoming games and practices together.`}
        </p>
      </div>
      <button type="button" className="primary-button min-h-10 flex-none px-3 py-2 text-xs sm:text-sm" onClick={onOpen}>
        Review RSVPs
      </button>
    </section>
  );
}

function BulkRsvpModal({ events, onClose, onSubmit }: {
  events: ParentScheduleEvent[];
  onClose: () => void;
  onSubmit: (
    eventKeys: string[],
    response: Exclude<RsvpResponse, 'not_responded'>
  ) => Promise<{ failedEventKeys: string[] }>;
}) {
  const neededEventKeys = getNeededBulkRsvpEventKeys(events);
  const [selectedEventKeys, setSelectedEventKeys] = useState(() => new Set(neededEventKeys));
  const [submitting, setSubmitting] = useState<Exclude<RsvpResponse, 'not_responded'> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const setSelected = (eventKey: string, selected: boolean) => {
    setSelectedEventKeys((current) => {
      const next = new Set(current);
      if (selected) next.add(eventKey);
      else next.delete(eventKey);
      return next;
    });
  };

  const submit = async (response: Exclude<RsvpResponse, 'not_responded'>) => {
    if (!selectedEventKeys.size || submitting) return;
    setSubmitting(response);
    setError(null);
    try {
      const result = await onSubmit([...selectedEventKeys], response);
      if (!result.failedEventKeys.length) {
        onClose();
        return;
      }
      setSelectedEventKeys(new Set(result.failedEventKeys));
      setError(`${result.failedEventKeys.length} ${result.failedEventKeys.length === 1 ? 'RSVP was' : 'RSVPs were'} not saved. The failed ${result.failedEventKeys.length === 1 ? 'event remains' : 'events remain'} selected so you can try again.`);
    } finally {
      setSubmitting(null);
    }
  };

  return (
    <Modal
      ariaLabel="Respond to multiple events"
      overlayClassName="z-[70] flex items-end justify-center bg-gray-950/45 p-0 sm:items-center sm:p-6"
      onClose={() => { if (!submitting) onClose(); }}
    >
      <section className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:max-h-[86vh] sm:rounded-3xl">
        <header className="border-b border-gray-100 px-4 py-4 sm:px-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="app-label text-primary-700">Family RSVP</div>
              <h2 className="mt-1 text-xl font-black text-gray-950">Respond to multiple events</h2>
              <p className="mt-1 text-sm font-semibold text-gray-600">Choose events, then apply one response. Existing responses can be updated.</p>
            </div>
            <button type="button" className="ghost-button min-h-9 px-3 py-2 text-xs" onClick={onClose} disabled={Boolean(submitting)}>Close</button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" className="secondary-button min-h-9 px-3 py-2 text-xs" onClick={() => setSelectedEventKeys(new Set(events.map((event) => event.eventKey)))} disabled={Boolean(submitting)}>Select all</button>
            <button type="button" className="secondary-button min-h-9 px-3 py-2 text-xs" onClick={() => setSelectedEventKeys(new Set(neededEventKeys))} disabled={Boolean(submitting) || !neededEventKeys.length}>Select needed</button>
            <button type="button" className="ghost-button min-h-9 px-3 py-2 text-xs" onClick={() => setSelectedEventKeys(new Set())} disabled={Boolean(submitting) || !selectedEventKeys.size}>Clear</button>
            <span className="ml-auto text-xs font-black text-gray-600">{selectedEventKeys.size} selected</span>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2 sm:px-5">
          {events.map((event) => {
            const currentRsvp = normalizeRsvpResponse(event.myRsvp);
            return (
              <label key={event.eventKey} className="flex cursor-pointer items-start gap-3 border-b border-gray-100 py-3 last:border-b-0">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 rounded border-gray-300 text-primary-600"
                  checked={selectedEventKeys.has(event.eventKey)}
                  onChange={(changeEvent) => setSelected(event.eventKey, changeEvent.target.checked)}
                  disabled={Boolean(submitting)}
                  aria-label={`Select ${event.childName} ${getScheduleTitle(event)} on ${formatEventDateLabel(event.date)}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-black text-gray-950">{getScheduleTitle(event)}</span>
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase ${rsvpBadgeClasses[currentRsvp]}`}>{rsvpLabels[currentRsvp]}</span>
                  </span>
                  <span className="mt-0.5 block text-xs font-bold text-gray-600">{formatEventDateLabel(event.date)} · {formatEventTimeLabel(event.date)} · {event.childName}</span>
                  <span className="mt-0.5 block truncate text-xs font-semibold text-gray-500">{event.teamName} · {event.location || 'Location TBD'}</span>
                </span>
              </label>
            );
          })}
        </div>

        <footer className="border-t border-gray-100 bg-gray-50 px-4 py-4 sm:px-5">
          {error ? <div role="alert" className="mb-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-bold text-rose-800">{error}</div> : null}
          <div className="grid grid-cols-3 gap-2">
            {(['going', 'maybe', 'not_going'] as const).map((response) => (
              <button
                key={response}
                type="button"
                className={response === 'going' ? 'primary-button min-h-11 px-2 py-2 text-xs sm:text-sm' : 'secondary-button min-h-11 px-2 py-2 text-xs sm:text-sm'}
                onClick={() => submit(response)}
                disabled={!selectedEventKeys.size || Boolean(submitting)}
              >
                {submitting === response ? 'Saving…' : response === 'not_going' ? "Can't go" : response === 'going' ? 'Going' : 'Maybe'}
              </button>
            ))}
          </div>
        </footer>
      </section>
    </Modal>
  );
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
