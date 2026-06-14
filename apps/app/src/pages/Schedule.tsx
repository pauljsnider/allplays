import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { AlertCircle, CalendarDays, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, ClipboardCheck, Copy, Download, Filter, Link as LinkIcon, ListChecks, MapPin, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { SchedulePageSkeleton } from '../components/PageSkeletons';
import { addTeamCalendarUrl, createScheduleImportGame, createScheduleImportPractice, loadParentSchedule, removeTeamCalendarUrl, type ParentScheduleChild } from '../lib/scheduleService';
import { getCachedAppData, getParentScheduleSummaryCacheKey, loadCachedAppData } from '../lib/appDataCache';
import { startUxTimer } from '../lib/uxTiming';
import { useAsyncOperation } from '../lib/useAsyncOperation';
import { useShellLayout } from '../lib/useShellLayout';
import {
  buildScheduleIcs,
  buildScheduleAgendaText,
  filterParentScheduleEvents,
  formatEventDateLabel,
  formatEventTimeLabel,
  getCalendarScheduleEntries,
  getScheduleEventDetailPath,
  getParentScheduleTeamOptions,
  getPracticePacketRows,
  getScheduleTitle,
  getScheduleMapHref,
  getScheduleForecastHref,
  getScheduleTaskDetailSection,
  normalizeRsvpResponse,
  validateExternalCalendarUrl,
  type CalendarScheduleEntry,
  type ParentScheduleEvent,
  type ParentScheduleFilter,
  type ParentScheduleTeamOption,
  type PracticePacketScheduleRow,
  type RsvpResponse,
  type ScheduleTimeRange,
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

const upcomingListPageSize = 20;
const pastListPageSize = 10;

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

export function Schedule({ auth }: { auth: AuthState }) {
  const { isDesktopWeb } = useShellLayout();
  const [filter, setFilter] = useState<ParentScheduleFilter>('upcoming-all');
  const [view, setView] = useState<ScheduleViewMode>('list');
  const [selectedPlayerId, setSelectedPlayerId] = useState('');
  const [selectedTeamId, setSelectedTeamId] = useState('');
  const [timeRange, setTimeRange] = useState<ScheduleTimeRange>('all');
  const [children, setChildren] = useState<ParentScheduleChild[]>([]);
  const [events, setEvents] = useState<ParentScheduleEvent[]>([]);
  const { loading, error, clearError, run: runAsyncOperation } = useAsyncOperation();
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [visibleListCount, setVisibleListCount] = useState(upcomingListPageSize);
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1);
  });
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [desktopAdvancedControlsOpen, setDesktopAdvancedControlsOpen] = useState(false);
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
  const [aiScheduleText, setAiScheduleText] = useState('');
  const [aiScheduleImage, setAiScheduleImage] = useState<File | null>(null);
  const [aiScheduleImageName, setAiScheduleImageName] = useState('');
  const [aiImportErrors, setAiImportErrors] = useState<string[]>([]);
  const [processingAiImport, setProcessingAiImport] = useState(false);
  const [importingCsv, setImportingCsv] = useState(false);
  const [removingCalendarUrl, setRemovingCalendarUrl] = useState<string | null>(null);
  const [mobileStaffToolsOpen, setMobileStaffToolsOpen] = useState(false);
  const eventsRef = useRef<ParentScheduleEvent[]>([]);

  const applyScheduleResult = (data: { children: ParentScheduleChild[]; events: ParentScheduleEvent[]; }) => {
    eventsRef.current = data.events;
    setChildren(data.children);
    setEvents(data.events);
  };

  const clearAiPreview = () => {
    if (scheduleImportPreviewSource === 'ai') {
      setCsvPreviewRows([]);
      setScheduleImportPreviewSource(null);
    }
  };

  const refreshSchedule = async (force = false) => {
    if (!auth.user) return null;
    clearError();
    setStatusMessage(null);
    const timer = startUxTimer('schedule summary load');
    const hasExistingSchedule = eventsRef.current.length > 0;
    const cacheKey = getParentScheduleSummaryCacheKey(auth.user.uid);
    const scheduleCacheTtlMs = 60 * 1000 * 5;
    const cached = getCachedAppData(cacheKey);

    return runAsyncOperation(
      () => loadCachedAppData(
        cacheKey,
        () => loadParentSchedule(auth.user, { hydrateDetails: false, expandStaffPlayers: false }),
        { ttlMs: scheduleCacheTtlMs, force }
      ),
      {
        getErrorMessage: (loadError) => {
          if (loadError && typeof loadError === 'object' && 'message' in loadError && typeof loadError.message === 'string' && loadError.message.trim()) {
            return loadError.message;
          }
          return hasExistingSchedule
            ? 'Unable to refresh schedule. Showing the last loaded schedule. Try again.'
            : 'Unable to load schedule. Try again.';
        },
        rethrow: false,
        onSuccess: (result) => {
          applyScheduleResult(result);

          if (selectedPlayerId && !result.children.some((child) => child.playerId === selectedPlayerId)) {
            setSelectedPlayerId('');
          }
          if (selectedTeamId && !result.children.some((child) => child.teamId === selectedTeamId)) {
            setSelectedTeamId('');
          }
          const firstUpcoming = filterParentScheduleEvents(result.events, { filter: 'upcoming-all' })[0];
          if (firstUpcoming) {
            setCalendarMonth(new Date(firstUpcoming.date.getFullYear(), firstUpcoming.date.getMonth(), 1));
          }

          timer.end({
            cacheHit: Boolean(cached) && !force,
            force,
            children: result.children.length,
            eventRows: result.events.length,
            groupedEvents: getCalendarScheduleEntries(result.events).length
          });
        },
        onError: (loadError) => {
          if (!hasExistingSchedule) {
            applyScheduleResult({ children: [], events: [] });
          }
          timer.end({
            force,
            error: loadError && typeof loadError === 'object' && 'message' in loadError && typeof loadError.message === 'string'
              ? loadError.message
              : 'Unable to load schedule.'
          });
        }
      }
    );
  };

  useEffect(() => {
    void refreshSchedule();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.user?.uid]);

  const visibleEvents = useMemo(() => (
    filterParentScheduleEvents(events, { filter, playerId: selectedPlayerId, teamId: selectedTeamId, timeRange })
  ), [events, filter, selectedPlayerId, selectedTeamId, timeRange]);

  const listPageSize = filter === 'past-all' ? pastListPageSize : upcomingListPageSize;

  useEffect(() => {
    setVisibleListCount(filter === 'past-all' ? pastListPageSize : upcomingListPageSize);
  }, [filter, selectedPlayerId, selectedTeamId, timeRange, view]);

  const calendarEntries = useMemo(() => getCalendarScheduleEntries(visibleEvents), [visibleEvents]);
  const listEntries = calendarEntries;
  const parentLinkedPlayerIds = useMemo(() => new Set(children.map((child) => child.playerId)), [children]);
  const teamOptions = useMemo(() => getParentScheduleTeamOptions(events, children), [children, events]);
  const packetRows = useMemo(() => getPracticePacketRows(visibleEvents), [visibleEvents]);
  const selectedDayEntries = useMemo(() => {
    if (!selectedDay) return [];
    return calendarEntries.filter((event) =>
      event.date.getFullYear() === selectedDay.getFullYear() &&
      event.date.getMonth() === selectedDay.getMonth() &&
      event.date.getDate() === selectedDay.getDate()
    );
  }, [calendarEntries, selectedDay]);

  const counts = useMemo(() => ({
    total: listEntries.length,
    games: listEntries.filter((event) => event.type === 'game').length,
    practices: listEntries.filter((event) => event.type === 'practice').length,
    rsvpNeeded: visibleEvents.filter((event) => parentLinkedPlayerIds.has(event.childId) && event.isDbGame && !event.isCancelled && normalizeRsvpResponse(event.myRsvp) === 'not_responded').length,
    packetsReady: packetRows.filter((row) => row.needsAction).length
  }), [listEntries, packetRows, parentLinkedPlayerIds, visibleEvents]);
  const webInsights = useMemo(() => buildScheduleWebInsights(listEntries), [listEntries]);
  const manageableTeamOptions = useMemo(() => (
    teamOptions.filter((team) => events.some((event) => event.teamId === team.teamId && event.isTeamStaff === true))
  ), [events, teamOptions]);
  const selectedCalendarTeam = useMemo(() => {
    if (selectedTeamId) {
      return manageableTeamOptions.find((team) => team.teamId === selectedTeamId) || null;
    }
    return manageableTeamOptions.length === 1 ? manageableTeamOptions[0] : null;
  }, [manageableTeamOptions, selectedTeamId]);

  useEffect(() => {
    if (isDesktopWeb || !selectedCalendarTeam) {
      setMobileStaffToolsOpen(false);
    }
  }, [isDesktopWeb, selectedCalendarTeam]);

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
    clearError();
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
    clearError();
    const failedRows: ScheduleCsvImportPreviewRow[] = [];
    let importedCount = 0;
    for (const row of csvPreviewRows) {
      try {
        if (row.normalized.eventType === 'game') {
          await createScheduleImportGame(selectedCalendarTeam.teamId, row.normalized, auth.user);
        } else {
          await createScheduleImportPractice(selectedCalendarTeam.teamId, row.normalized, auth.user);
        }
        importedCount += 1;
      } catch (importError: any) {
        failedRows.push({
          ...row,
          errors: [importError?.message || 'Import failed for this row.']
        });
      }
    }

    setCsvPreviewRows(failedRows);
    await refreshSchedule(true);
    setStatusMessage(failedRows.length
      ? `Imported ${importedCount} row(s); ${failedRows.length} row(s) failed and remain below for retry.`
      : `Imported ${importedCount} schedule row(s) and refreshed the schedule.`);
    setImportingCsv(false);
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
    clearError();
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
    clearError();
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
            <button type="button" className="ghost-button !h-9 !min-h-9 !w-9 !p-0" onClick={() => refreshSchedule(true)} disabled={loading} aria-label="Refresh schedule">
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
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
              <button type="button" className="ghost-button !min-h-9 !px-3 !py-2 !text-xs sm:!min-h-10 sm:!text-sm" onClick={() => refreshSchedule(true)} disabled={loading}>
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
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

          <ScheduleNextUpCard event={webInsights.nextEvent} />
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
              loading={loading}
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
            <ScheduleActionQueue events={listEntries} />
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

          {isDesktopWeb && selectedCalendarTeam ? (
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
          ) : null}

          {statusMessage ? <Status tone="success" message={statusMessage} /> : null}
          {error ? <Status tone="error" message={error} /> : null}

          {loading ? (
            <LoadingSchedule />
          ) : view === 'calendar' ? (
            <CalendarSchedule
              month={calendarMonth}
              entries={calendarEntries}
              selectedDay={selectedDay}
              selectedDayEntries={selectedDayEntries}
              onMonthChange={setCalendarMonth}
              onDaySelect={setSelectedDay}
              onDayClose={() => setSelectedDay(null)}
            />
          ) : view === 'packets' ? (
            <PracticePacketsPanel rows={packetRows} />
          ) : view === 'compact' ? (
            <CompactScheduleList
              events={listEntries}
              visibleCount={visibleListCount}
              pageSize={listPageSize}
              onShowMore={() => setVisibleListCount((current) => Math.min(current + listPageSize, listEntries.length))}
            />
          ) : (
            <ScheduleList
              events={listEntries}
              visibleCount={visibleListCount}
              pageSize={listPageSize}
              onShowMore={() => setVisibleListCount((current) => Math.min(current + listPageSize, listEntries.length))}
            />
          )}

          {!isDesktopWeb && selectedCalendarTeam ? (
            <MobileScheduleStaffToolsSection
              open={mobileStaffToolsOpen}
              teamName={selectedCalendarTeam.teamName}
              onToggle={() => setMobileStaffToolsOpen((current) => !current)}
            >
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
            </MobileScheduleStaffToolsSection>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function MobileScheduleStaffToolsSection({ open, teamName, onToggle, children }: { open: boolean; teamName: string; onToggle: () => void; children: ReactNode }) {
  return (
    <section className="app-card p-3" aria-label="Manage schedule tools">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 text-left"
        aria-expanded={open}
        aria-controls="mobile-schedule-staff-tools"
        onClick={onToggle}
      >
        <div className="min-w-0">
          <div className="app-label">Staff schedule tools</div>
          <h2 className="mt-1 text-base font-black text-gray-950">Manage schedule</h2>
          <p className="mt-1 text-xs font-semibold leading-5 text-gray-500">Calendar feeds and imports for {teamName} stay tucked away until you need them.</p>
        </div>
        <ChevronDown className={`h-5 w-5 flex-none text-gray-500 transition ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {open ? (
        <div id="mobile-schedule-staff-tools" className="mt-3 space-y-3">
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

function ScheduleCsvImportPanel({ teamName, headers, mapping, previewRows, errors, fileName, importing, onFileChange, onMappingChange, onPreview, onImport, onClear }: {
  teamName: string;
  headers: string[];
  mapping: ScheduleCsvImportMapping;
  previewRows: ScheduleCsvImportPreviewRow[];
  errors: string[];
  fileName: string;
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
          <button type="button" className="secondary-button" onClick={onPreview} disabled={!fileName || importing}>Preview rows</button>
          <button type="button" className="primary-button" onClick={onImport} disabled={!previewRows.length || invalidCount > 0 || importing}>{importing ? 'Importing…' : 'Import rows'}</button>
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

type ScheduleWebInsights = {
  nextEvent: ParentScheduleEvent | null;
  rsvpNeeded: number;
  packetsReady: number;
  openAssignments: number;
  rideRequests: number;
};

function buildScheduleWebInsights(events: ParentScheduleEvent[]): ScheduleWebInsights {
  return events.reduce<ScheduleWebInsights>((insights, event) => {
    if (!insights.nextEvent && !event.isCancelled) insights.nextEvent = event;
    if (event.isDbGame && !event.isCancelled && normalizeRsvpResponse(event.myRsvp) === 'not_responded') insights.rsvpNeeded += 1;
    if (event.type === 'practice' && event.practiceHomePacketSummary) insights.packetsReady += 1;
    insights.openAssignments += event.assignments.filter((assignment) => assignment.claimable && !assignment.claim && !assignment.value).length;
    insights.rideRequests += event.rideshareSummary?.requests || 0;
    return insights;
  }, {
    nextEvent: null,
    rsvpNeeded: 0,
    packetsReady: 0,
    openAssignments: 0,
    rideRequests: 0
  });
}

function ScheduleNextUpCard({ event }: { event: ParentScheduleEvent | null }) {
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
  const actionText = getEventPrimaryActionText(event, rsvp);

  return (
    <Link to={getEventDetailPath(event)} className="schedule-next-card block rounded-xl border border-primary-100 bg-primary-50 p-4 transition hover:border-primary-200 hover:bg-primary-100">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="app-label text-primary-700">Next up</div>
          <div className="mt-1 truncate text-lg font-black text-gray-950">{getScheduleTitle(event)}</div>
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

function ScheduleActionQueue({ events }: { events: ParentScheduleEvent[] }) {
  const actionEvents = events
    .map((event) => ({ event, action: getEventActionSummary(event) }))
    .filter((item) => item.action)
    .slice(0, 5);

  return (
    <section className="app-card schedule-action-queue p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="app-label">Needs attention</div>
          <h2 className="mt-1 text-base font-black text-gray-950">Parent queue</h2>
        </div>
        <ClipboardCheck className="h-5 w-5 text-primary-600" aria-hidden="true" />
      </div>
      <div className="mt-3 space-y-2">
        {actionEvents.length ? actionEvents.map(({ event, action }) => (
          <Link key={event.eventKey} to={getEventDetailPath(event)} className="block rounded-xl border border-gray-200 bg-white p-3 transition hover:border-primary-200 hover:bg-primary-50">
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

function ScheduleList({ events, visibleCount, pageSize, onShowMore }: {
  events: CalendarScheduleEntry[];
  visibleCount: number;
  pageSize: number;
  onShowMore: () => void;
}) {
  if (!events.length) {
    return (
      <div className="app-card p-8 text-center">
        <CalendarDays className="mx-auto h-10 w-10 text-gray-300" aria-hidden="true" />
        <div className="mt-3 text-sm font-black text-gray-900">No events in this filter</div>
        <div className="mt-1 text-xs font-semibold text-gray-500">Try another player or switch between upcoming and past events.</div>
      </div>
    );
  }

  const renderedEvents = events.slice(0, visibleCount);
  const remainingCount = Math.max(events.length - renderedEvents.length, 0);

  return (
    <div className="space-y-3">
      <div className="schedule-list overflow-hidden rounded-xl border border-gray-200 bg-white shadow-app sm:space-y-3 sm:overflow-visible sm:border-0 sm:bg-transparent sm:shadow-none">
        {renderedEvents.map((event) => (
          <ScheduleEventCard key={event.eventKey} event={event} />
        ))}
      </div>
      {remainingCount > 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-3 text-center shadow-sm">
          <div className="text-xs font-bold text-gray-500">
            Showing {renderedEvents.length} of {events.length} events
          </div>
          <button type="button" className="secondary-button mt-2 min-h-9 px-3 py-2 text-xs" onClick={onShowMore}>
            Show {Math.min(pageSize, remainingCount)} more
          </button>
        </div>
      ) : null}
    </div>
  );
}

function CompactScheduleList({ events, visibleCount, pageSize, onShowMore }: {
  events: CalendarScheduleEntry[];
  visibleCount: number;
  pageSize: number;
  onShowMore: () => void;
}) {
  if (!events.length) {
    return (
      <div className="app-card p-8 text-center">
        <CalendarDays className="mx-auto h-10 w-10 text-gray-300" aria-hidden="true" />
        <div className="mt-3 text-sm font-black text-gray-900">No events in this filter</div>
        <div className="mt-1 text-xs font-semibold text-gray-500">Try another team, player, range, or schedule type.</div>
      </div>
    );
  }

  const renderedEvents = events.slice(0, visibleCount);
  const remainingCount = Math.max(events.length - renderedEvents.length, 0);

  return (
    <section className="space-y-3">
      <div className="app-card overflow-hidden">
        <div className="border-b border-gray-100 bg-gray-50 px-3 py-2">
          <div className="text-xs font-black uppercase tracking-[0.04em] text-gray-500">Compact schedule</div>
        </div>
        <div className="divide-y divide-gray-100">
          {renderedEvents.map((event) => {
            const rsvp = normalizeRsvpResponse(event.myRsvp);
            return (
              <Link key={event.eventKey} to={getEventDetailPath(event)} className="compact-schedule-row grid grid-cols-[82px_minmax(0,1fr)_auto] gap-3 px-3 py-2.5 transition hover:bg-primary-50">
                <div className="text-xs font-black text-gray-700">
                  <div>{formatEventDateLabel(event.date)}</div>
                  <div className="mt-0.5 text-gray-500">{formatEventTimeLabel(event.date)}</div>
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-black text-gray-950">{getScheduleTitle(event)}</div>
                  <div className="mt-0.5 truncate text-xs font-semibold text-gray-500">{getScheduleChildLabel(event)} · {event.teamName} · {event.location || 'TBD'}</div>
                </div>
                <span className={`self-center rounded-full border px-2 py-1 text-[10px] font-extrabold uppercase tracking-[0.04em] ${rsvpBadgeClasses[rsvp]}`}>
                  {rsvpLabels[rsvp]}
                </span>
              </Link>
            );
          })}
        </div>
      </div>
      {remainingCount > 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-3 text-center shadow-sm">
          <div className="text-xs font-bold text-gray-500">
            Showing {renderedEvents.length} of {events.length} events
          </div>
          <button type="button" className="secondary-button mt-2 min-h-9 px-3 py-2 text-xs" onClick={onShowMore}>
            Show {Math.min(pageSize, remainingCount)} more
          </button>
        </div>
      ) : null}
    </section>
  );
}

function PracticePacketsPanel({ rows }: { rows: PracticePacketScheduleRow[] }) {
  if (!rows.length) {
    return (
      <div className="app-card p-8 text-center">
        <ClipboardCheck className="mx-auto h-10 w-10 text-gray-300" aria-hidden="true" />
        <div className="mt-3 text-sm font-black text-gray-900">No practice packets in this filter</div>
        <div className="mt-1 text-xs font-semibold text-gray-500">Packets appear when a practice has home drills or follow-up work.</div>
      </div>
    );
  }

  const readyCount = rows.filter((row) => row.needsAction).length;

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
        {rows.map((row) => (
          <Link key={`${row.event.eventKey}-packet`} to={getEventDetailPath(row.event)} className="block border-b border-gray-100 px-3 py-3 transition last:border-b-0 hover:bg-gray-50 sm:rounded-xl sm:border sm:border-blue-100 sm:bg-white sm:shadow-sm sm:hover:border-blue-200 sm:hover:bg-blue-50">
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
    </section>
  );
}

function ScheduleEventCard({ event }: {
  event: ParentScheduleEvent | CalendarScheduleEntry;
}) {
  const rsvp = normalizeRsvpResponse(event.myRsvp);
  const eventTitle = getScheduleTitle(event);
  const detailPath = getEventDetailPath(event);
  const isRsvpNeeded = rsvp === 'not_responded' && event.isDbGame && !event.isCancelled;
  const hasPracticePacket = event.type === 'practice' && Boolean(event.practiceHomePacketSummary);
  const actionPills = getEventCardActionPills(event, rsvp);
  const metadataPills = getEventMetadataPills(event);
  const mapHref = getScheduleMapHref(event.location);
  const forecastHref = getScheduleForecastHref(event.location, event.date);
  const childLabel = getScheduleChildLabel(event);

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

function getEventDetailPath(event: ParentScheduleEvent | CalendarScheduleEntry) {
  return getScheduleEventDetailPath(event, getScheduleTaskDetailSection(event));
}

function getScheduleChildLabel(event: ParentScheduleEvent | CalendarScheduleEntry) {
  const names = 'childNames' in event && event.childNames.length ? event.childNames : [];
  if (names.length > 2) return `${names.slice(0, 2).join(', ')} +${names.length - 2}`;
  if (names.length) return names.join(', ');
  return event.childName || 'Player';
}

function getEventPrimaryActionText(event: ParentScheduleEvent, rsvp: RsvpResponse) {
  if (rsvp === 'not_responded' && event.isDbGame && !event.isCancelled) return 'Set availability';
  if (event.type === 'practice' && event.practiceHomePacketSummary) return 'Review packet';
  if (getOpenAssignmentCount(event) > 0) return 'Review assignments';
  if ((event.rideshareSummary?.requests || 0) > 0) return 'Check ride requests';
  return event.type === 'practice' ? 'Open practice' : 'Open game';
}

function getEventActionSummary(event: ParentScheduleEvent) {
  const rsvp = normalizeRsvpResponse(event.myRsvp);
  if (rsvp === 'not_responded' && event.isDbGame && !event.isCancelled) return `RSVP needed for ${event.childName}`;
  if (event.type === 'practice' && event.practiceHomePacketSummary) return `Packet ready: ${event.practiceHomePacketSummary}`;
  const openAssignments = getOpenAssignmentCount(event);
  if (openAssignments > 0) return `${openAssignments} open ${openAssignments === 1 ? 'assignment' : 'assignments'}`;
  const rideRequests = event.rideshareSummary?.requests || 0;
  if (rideRequests > 0) return `${rideRequests} ride ${rideRequests === 1 ? 'request' : 'requests'}`;
  return '';
}

function getEventCardActionPills(event: ParentScheduleEvent | CalendarScheduleEntry, rsvp: RsvpResponse) {
  const pills: string[] = [];
  if (rsvp === 'not_responded' && event.isDbGame && !event.isCancelled) pills.push('Availability needed');
  if (event.type === 'practice' && event.practiceHomePacketSummary) pills.push(`Packet: ${event.practiceHomePacketSummary}`);
  const openAssignments = getOpenAssignmentCount(event);
  if (openAssignments > 0) pills.push(`${openAssignments} task${openAssignments === 1 ? '' : 's'} open`);
  const seatsLeft = event.rideshareSummary?.seatsLeft || 0;
  const rideRequests = event.rideshareSummary?.requests || 0;
  if (seatsLeft > 0) pills.push(`${seatsLeft} seats open`);
  if (rideRequests > 0) pills.push(`${rideRequests} ride ${rideRequests === 1 ? 'request' : 'requests'}`);
  return pills.slice(0, 4);
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
  return `${event.homeScore}-${event.awayScore}`;
}

function getOpenAssignmentCount(event: ParentScheduleEvent | CalendarScheduleEntry) {
  return event.assignments.filter((assignment) => assignment.claimable && !assignment.claim && !assignment.value).length;
}

function CalendarSchedule({ month, entries, selectedDay, selectedDayEntries, onMonthChange, onDaySelect, onDayClose }: {
  month: Date;
  entries: CalendarScheduleEntry[];
  selectedDay: Date | null;
  selectedDayEntries: CalendarScheduleEntry[];
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
        onClose={onDayClose}
      />
    </div>
  );
}

function CalendarEventPicker({ day, entries, onClose }: {
  day: Date | null;
  entries: CalendarScheduleEntry[];
  onClose: () => void;
}) {
  useEffect(() => {
    if (!day) return;
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  }, [day, onClose]);

  if (!day) return null;

  const dayLabel = day.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const eventCountLabel = `${entries.length} ${entries.length === 1 ? 'event' : 'events'}`;

  return (
    <div className="fixed inset-0 z-[70] flex items-end bg-gray-950/40 p-0 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="calendar-event-picker-title">
      <button type="button" className="absolute inset-0 h-full w-full cursor-default" onClick={onClose} aria-label="Close calendar events" />
      <section className="relative w-full overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:mx-auto sm:max-w-2xl sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-4 py-3">
          <div className="min-w-0">
            <div className="app-label">Calendar</div>
            <h2 id="calendar-event-picker-title" className="mt-1 truncate text-lg font-black text-gray-950">{dayLabel}</h2>
            <div className="mt-0.5 text-xs font-semibold text-gray-500">{eventCountLabel}</div>
          </div>
          <button type="button" className="ghost-button !min-h-9 !px-3 !py-2 !text-xs" onClick={onClose}>
            Close
          </button>
        </div>

        {entries.length ? (
          <div className="max-h-[65vh] overflow-y-auto p-3 sm:max-h-[70vh]">
            <div className="space-y-2">
              {entries.map((entry) => (
                <CalendarEventPickerRow key={entry.eventKey} entry={entry} />
              ))}
            </div>
          </div>
        ) : (
          <div className="p-5 text-sm font-semibold text-gray-500">No events on this day.</div>
        )}
      </section>
    </div>
  );
}

function CalendarEventPickerRow({ entry }: { entry: CalendarScheduleEntry }) {
  const rsvp = normalizeRsvpResponse(entry.myRsvp);
  const needsRsvp = entry.childRsvps.some((child) => normalizeRsvpResponse(child.myRsvp) === 'not_responded') || rsvp === 'not_responded';
  const childLabel = entry.childNames.length ? entry.childNames.join(', ') : entry.childName;
  const actionLabel = entry.type === 'practice' ? 'Open practice' : 'Open game';

  return (
    <Link to={getEventDetailPath(entry)} className="block rounded-2xl border border-gray-200 bg-white p-3 shadow-sm transition hover:border-primary-200 hover:bg-primary-50" onClick={(event) => event.stopPropagation()}>
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
