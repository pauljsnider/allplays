import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link as LinkIcon } from 'lucide-react';
import { Modal } from '../../components/Modal';
import {
  addTeamCalendarUrl,
  createScheduledGameForApp,
  createScheduledPracticeForApp,
  createScheduledTournamentBlockForApp,
  loadScheduleStatTrackerConfigsForApp,
  removeTeamCalendarUrl,
  type PracticeRecurrenceFormInput,
  type ScheduleGameFormInput,
  type SchedulePracticeFormInput,
  type ScheduleStatTrackerConfigOption,
  type ScheduleTournamentCreateFormInput
} from '../../lib/scheduleService';
import { validateExternalCalendarUrl, type ParentScheduleTeamOption } from '../../lib/scheduleLogic';
import type { AuthState } from '../../lib/types';
import { WORKFLOW_TIMING, startWorkflowTimer } from '../../lib/workflowTiming';

type ScheduleTournamentGameFieldErrors = Partial<Record<'opponent' | 'startDate' | 'endDate' | 'arrivalTime', string>>;
type ScheduleTournamentCreateFieldErrors = Partial<Record<'divisionName' | 'bracketName' | 'roundName' | 'games', string>> & {
  gameRows?: ScheduleTournamentGameFieldErrors[];
};

export type ScheduleStaffToolsProps = {
  auth: AuthState;
  manageableTeamOptions: ParentScheduleTeamOption[];
  selectedTeamId: string;
  initialSection?: string;
  onRefresh: () => Promise<unknown>;
  onStatusMessage: (message: string | null) => void;
  onClearError: () => void;
};

export function ScheduleStaffTools({
  auth,
  manageableTeamOptions,
  selectedTeamId,
  initialSection = '',
  onRefresh,
  onStatusMessage,
  onClearError
}: ScheduleStaffToolsProps) {
  const [calendarUrl, setCalendarUrl] = useState('');
  const [calendarUrlError, setCalendarUrlError] = useState<string | null>(null);
  const [savingCalendarUrl, setSavingCalendarUrl] = useState(false);
  const [removingCalendarUrl, setRemovingCalendarUrl] = useState<string | null>(null);
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
  const [scheduleStaffToolMode, setScheduleStaffToolMode] = useState<'menu' | 'tournament'>('menu');
  const trackerConfigCacheRef = useRef<Record<string, ScheduleStatTrackerConfigOption[]>>({});
  const trackerConfigRequestPromiseRef = useRef<Partial<Record<string, Promise<ScheduleStatTrackerConfigOption[]>>>>({});
  const [selectedStaffManageTeamId, setSelectedStaffManageTeamId] = useState('');
  const selectedCalendarTeam = useMemo(() => {
    const explicitlySelectedManageableTeam = selectedStaffManageTeamId
      ? manageableTeamOptions.find((team) => team.teamId === selectedStaffManageTeamId) || null
      : null;
    if (explicitlySelectedManageableTeam) return explicitlySelectedManageableTeam;
    const pageSelectedManageableTeam = selectedTeamId
      ? manageableTeamOptions.find((team) => team.teamId === selectedTeamId) || null
      : null;
    if (pageSelectedManageableTeam) return pageSelectedManageableTeam;
    return manageableTeamOptions.length === 1 ? manageableTeamOptions[0] : null;
  }, [manageableTeamOptions, selectedStaffManageTeamId, selectedTeamId]);
  const activeTrackerConfigTeamIdRef = useRef<string | null>(null);
  activeTrackerConfigTeamIdRef.current = selectedCalendarTeam?.teamId || null;
  const shouldShowManageScheduleTeamPicker = manageableTeamOptions.length > 1;
  const previousSelectedTeamIdRef = useRef(selectedCalendarTeam?.teamId);
  const appliedPageSelectedTeamIdRef = useRef('');

  useEffect(() => {
    if (selectedStaffManageTeamId && !manageableTeamOptions.some((team) => team.teamId === selectedStaffManageTeamId)) {
      setSelectedStaffManageTeamId('');
    }
  }, [manageableTeamOptions, selectedStaffManageTeamId]);

  useEffect(() => {
    if (
      selectedTeamId
      && selectedTeamId !== appliedPageSelectedTeamIdRef.current
      && manageableTeamOptions.some((team) => team.teamId === selectedTeamId)
    ) {
      setSelectedStaffManageTeamId(selectedTeamId);
      appliedPageSelectedTeamIdRef.current = selectedTeamId;
    } else if (!selectedTeamId) {
      appliedPageSelectedTeamIdRef.current = '';
    }
  }, [manageableTeamOptions, selectedTeamId]);

  useEffect(() => {
    if (!selectedCalendarTeam || !['add', 'ai', 'imports'].includes(initialSection)) return;
    const frame = window.requestAnimationFrame(() => {
      const target = document.getElementById(`schedule-staff-${initialSection}`);
      if (target && typeof target.scrollIntoView === 'function') {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [initialSection, selectedCalendarTeam]);

  useEffect(() => {
    if (previousSelectedTeamIdRef.current && previousSelectedTeamIdRef.current !== selectedCalendarTeam?.teamId) {
      setScheduleStaffToolMode('menu');
    }
    previousSelectedTeamIdRef.current = selectedCalendarTeam?.teamId;
  }, [selectedCalendarTeam?.teamId]);

  const requestTrackerConfigLoad = useCallback(() => {
    if (!selectedCalendarTeam || !auth.user) return;
    const requestedTeamId = selectedCalendarTeam.teamId;
    const cachedConfigs = trackerConfigCacheRef.current[requestedTeamId];
    if (cachedConfigs) {
      setGameTrackerConfigs(cachedConfigs);
      setGameTrackerConfigsLoading(false);
      setGameTrackerConfigError(null);
      return;
    }
    if (trackerConfigRequestPromiseRef.current[requestedTeamId]) {
      setGameTrackerConfigsLoading(true);
      setGameTrackerConfigError(null);
      return;
    }

    setGameTrackerConfigs([]);
    setGameTrackerConfigsLoading(true);
    setGameTrackerConfigError(null);
    const request = loadScheduleStatTrackerConfigsForApp(requestedTeamId, auth.user);
    trackerConfigRequestPromiseRef.current[requestedTeamId] = request;
    request
      .then((configs) => {
        trackerConfigCacheRef.current[requestedTeamId] = configs;
        delete trackerConfigRequestPromiseRef.current[requestedTeamId];
        if (activeTrackerConfigTeamIdRef.current !== requestedTeamId) return;
        setGameTrackerConfigs(configs);
        setGameTrackerConfigsLoading(false);
        setGameTrackerConfigError(null);
      })
      .catch((configError: any) => {
        delete trackerConfigRequestPromiseRef.current[requestedTeamId];
        if (activeTrackerConfigTeamIdRef.current !== requestedTeamId) return;
        setGameTrackerConfigsLoading(false);
        setGameTrackerConfigError(configError?.message || 'Unable to load tracker configs.');
      });
  }, [auth.user, selectedCalendarTeam]);

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
    requestTrackerConfigLoad();
  }, [requestTrackerConfigLoad, selectedCalendarTeam]);

  const renderScheduleStaffToolsContent = () => {
    const teamPicker = shouldShowManageScheduleTeamPicker ? (
      <section className="app-card p-3 sm:p-4" aria-label="Choose team to manage">
        <div className="app-label">Manage team</div>
        <label className="mt-2 block text-xs font-bold uppercase tracking-wide text-gray-600">
          Team to manage
          <select
            aria-label="Team to manage"
            className="auth-input mt-1"
            value={selectedCalendarTeam?.teamId || ''}
            onChange={(event) => setSelectedStaffManageTeamId(event.target.value)}
          >
            <option value="">Select a team</option>
            {manageableTeamOptions.map((team) => (
              <option key={team.teamId} value={team.teamId}>{team.teamName}</option>
            ))}
          </select>
        </label>
      </section>
    ) : null;

    if (!selectedCalendarTeam) {
      return (
        <>
          {teamPicker}
          <section className="app-card p-3 sm:p-4" aria-label="Choose team to manage">
            <div className="app-label">Choose team</div>
            <h3 className="mt-1 text-base font-black text-gray-950">Choose the team to manage</h3>
            <p className="mt-1 text-sm font-semibold leading-6 text-gray-600">Pick a team here to unlock game, practice, tournament, and import tools.</p>
          </section>
        </>
      );
    }
    return (
      <>
        {teamPicker}
        <div id="schedule-staff-add" className="scroll-mt-24 space-y-3">
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
        </div>
        <div id="schedule-staff-imports" className="scroll-mt-24">
          <ScheduleImportTools
            teamName={selectedCalendarTeam.teamName}
            calendarUrl={calendarUrl}
            calendarUrls={selectedCalendarTeam.calendarUrls || []}
            calendarUrlError={calendarUrlError}
            savingCalendarUrl={savingCalendarUrl}
            removingCalendarUrl={removingCalendarUrl}
            onCalendarUrlChange={(value) => {
              setCalendarUrl(value);
              if (calendarUrlError) setCalendarUrlError(null);
            }}
            onAddCalendarUrl={handleAddCalendarUrl}
            onRemoveCalendarUrl={handleRemoveCalendarUrl}
          />
        </div>
      </>
    );
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
    onStatusMessage(null);
    onClearError();
    const timer = startWorkflowTimer(WORKFLOW_TIMING.scheduleCreateGame, {
      route: 'schedule',
      hasStatTrackerConfig: Boolean(gameForm.statTrackerConfigId)
    });
    try {
      await createScheduledGameForApp(selectedCalendarTeam.teamId, gameForm, auth.user);
      setGameForm(getDefaultScheduleGameForm());
      await onRefresh();
      onStatusMessage('Game created and schedule refreshed.');
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
      onStatusMessage(null);
      return;
    }
    setSavingTournament(true);
    setTournamentFormError(null);
    setTournamentFormFieldErrors({});
    onStatusMessage(null);
    onClearError();
    const timer = startWorkflowTimer(WORKFLOW_TIMING.scheduleCreateTournament, {
      route: 'schedule',
      gameCount: tournamentForm.games.length
    });
    try {
      await createScheduledTournamentBlockForApp(selectedCalendarTeam.teamId, tournamentForm, auth.user);
      setTournamentForm(getDefaultScheduleTournamentForm());
      setTournamentFormFieldErrors({});
      setScheduleStaffToolMode('menu');
      await onRefresh();
      onStatusMessage('Tournament created and schedule refreshed.');
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
    onStatusMessage(null);
    onClearError();
    const timer = startWorkflowTimer(WORKFLOW_TIMING.scheduleCreatePractice, {
      route: 'schedule',
      recurring: Boolean(practiceForm.recurrence?.isRecurring)
    });
    try {
      await createScheduledPracticeForApp(selectedCalendarTeam.teamId, practiceForm, auth.user);
      setPracticeForm(getDefaultSchedulePracticeForm());
      await onRefresh();
      onStatusMessage(practiceForm.recurrence?.isRecurring ? 'Recurring practice series created and schedule refreshed.' : 'Practice created and schedule refreshed.');
      timer.end({ refreshed: true });
    } catch (practiceError: any) {
      setPracticeFormError(practiceError?.message || 'Unable to create practice.');
      timer.end({ error: practiceError });
    } finally {
      setSavingPractice(false);
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
    onStatusMessage(null);
    onClearError();
    try {
      const result = await addTeamCalendarUrl(selectedCalendarTeam.teamId, validation.url, auth.user);
      setCalendarUrl('');
      onStatusMessage(result.added ? 'Calendar link saved. Refreshing schedule…' : 'Calendar link already exists. Refreshing schedule…');
      await onRefresh();
      onStatusMessage(result.added ? 'Calendar link saved and schedule refreshed.' : 'Calendar link already exists. Schedule refreshed.');
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
    onStatusMessage(null);
    onClearError();
    try {
      const result = await removeTeamCalendarUrl(selectedCalendarTeam.teamId, url, auth.user);
      onStatusMessage(result.removed ? 'Calendar link removed. Refreshing schedule…' : 'Calendar link was already removed. Refreshing schedule…');
      await onRefresh();
      onStatusMessage(result.removed ? 'Calendar link removed and schedule refreshed.' : 'Calendar link was already removed. Schedule refreshed.');
    } catch (removeError: any) {
      setCalendarUrlError(removeError?.message || 'Unable to remove calendar link.');
    } finally {
      setRemovingCalendarUrl(null);
    }
  };

  return renderScheduleStaffToolsContent();
}

export default ScheduleStaffTools;

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

function ScheduleImportTools({
  teamName,
  calendarUrl,
  calendarUrls,
  calendarUrlError,
  savingCalendarUrl,
  removingCalendarUrl,
  onCalendarUrlChange,
  onAddCalendarUrl,
  onRemoveCalendarUrl
}: {
  teamName: string;
  calendarUrl: string;
  calendarUrls: string[];
  calendarUrlError: string | null;
  savingCalendarUrl: boolean;
  removingCalendarUrl: string | null;
  onCalendarUrlChange: (value: string) => void;
  onAddCalendarUrl: (event: FormEvent<HTMLFormElement>) => void;
  onRemoveCalendarUrl: (url: string) => void;
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
    </>
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
