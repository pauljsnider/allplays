import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import {
  Award,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Code2,
  Copy,
  DollarSign,
  Dumbbell,
  ExternalLink,
  ImageIcon,
  LinkIcon,
  Loader2,
  Radio,
  Save,
  Shield,
  Ticket,
  Trophy
} from 'lucide-react';
import { copyPublicText, openPublicUrl, sharePublicUrl } from '../../lib/publicActions';
import { getAppleCalendarFeedUrl, getGoogleCalendarFeedUrl, getPrivateTeamCalendarFeedUrl } from '../../lib/parentToolsService';
import {
  buildPublicTeamGamesIcsUrl,
  canExposePublicFanFeed,
  createStatTrackerConfigForApp,
  grantScorekeeperAccessForApp,
  grantTeamMediaManagerAccessForApp,
  grantVideographerAccessForApp,
  inviteTeamAdminForApp,
  revokeScorekeeperAccessForApp,
  revokeTeamAdminAccessForApp,
  revokeTeamMediaManagerAccessForApp,
  revokeVideographerAccessForApp,
  saveTeamScheduleNotificationsForApp,
  updateStatTrackerConfigForApp,
  type InviteTeamAdminForAppResult,
  type TeamDetailModel,
  type TeamScorekeeperGrantTarget
} from '../../lib/teamDetailService';
import {
  buildStatTrackerConfigPayload,
  createBlankStatTrackerConfigColumnDraft,
  createEmptyStatTrackerConfigDraft,
  createStatTrackerConfigDraft,
  createStatTrackerConfigDraftFromPreset,
  getStatTrackerConfigPresetCatalog,
  validateStatTrackerConfigDraft,
  type StatTrackerConfigDraft
} from '../../lib/statTrackerConfigEditor';
import type { AuthState } from '../../lib/types';
import { InviteResultCard } from '../parent-tools/shared';

export function MoreTab({ model, auth, staffPermissionsLoading, staffPermissionsError, sponsorsLoading, sponsorsError, onTeamDetailRefresh }: { model: TeamDetailModel; auth: AuthState; staffPermissionsLoading: boolean; staffPermissionsError: string; sponsorsLoading: boolean; sponsorsError: string; onTeamDetailRefresh: () => Promise<void> }) {
  const statTrackerConfigs = model.statTrackerConfigs || [];
  const orphanedConfigAssignments = model.canManageTeam
    ? model.upcomingEvents.filter((event) => event.type === 'game' && event.statTrackerConfigId && !event.statTrackerConfigExists)
    : [];

  return (
    <div className="space-y-4">
      {model.canManageTeam ? <StatTrackerConfigsCard teamId={model.team.id} auth={auth} configs={statTrackerConfigs} orphanedAssignments={orphanedConfigAssignments} onSaved={onTeamDetailRefresh} /> : null}
      {model.canManageTeam && !model.staffPermissions && staffPermissionsLoading ? (
        <section className="app-card p-4">
          <div className="flex items-center gap-3 text-sm font-semibold text-gray-600">
            <Loader2 className="h-4 w-4 animate-spin text-primary-600" aria-hidden="true" />
            Loading team staff permissions…
          </div>
        </section>
      ) : null}
      {model.canManageTeam && !model.staffPermissions && staffPermissionsError ? (
        <section className="app-card p-4">
          <div className="text-sm font-black text-gray-950">Team staff permissions unavailable</div>
          <div className="mt-1 text-xs font-semibold text-rose-700">{staffPermissionsError}</div>
        </section>
      ) : null}
      {model.staffPermissions ? <StaffPermissionsCard model={model} auth={auth} onInviteSuccess={onTeamDetailRefresh} /> : null}
      {model.canManageTeam ? <ReminderTimingDefaultsCard model={model} onSaved={onTeamDetailRefresh} /> : null}
      {auth.user ? <PrivateCalendarSyncCard model={model} /> : null}
      {canExposePublicFanFeed(model.team, [...model.upcomingEvents, ...model.recentResults]) ? <FanFeedCard model={model} /> : null}
      {model.canManageTeam ? <ScoreboardWidgetCard model={model} /> : null}

      <section className="app-card p-4">
        <div className="text-sm font-black text-gray-950">Team links</div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <ExternalAction icon={ExternalLink} label="Website team page" detail="Open the current full team.html page." href={model.team.websiteUrl} />
          {model.canManageTeam ? <InternalAction icon={Shield} label="Edit team" detail="Update name, sport, photo, ZIP, and visibility in the app." to={`/teams/${encodeURIComponent(model.team.id)}/edit`} /> : null}
          {model.canManageTeam ? <InternalAction icon={Award} label="Awards studio" detail="Create drafts, review AI narratives, publish, and export." to={`/teams/${encodeURIComponent(model.team.id)}/certificates`} /> : null}
          {model.canManageTeam ? <InternalAction icon={Dumbbell} label="Drill library" detail="Browse community drills and manage favorites." to={`/teams/${encodeURIComponent(model.team.id)}/drills`} /> : null}
          {model.canManageTeam ? <InternalAction icon={Ticket} label="Registration forms" detail="Create, edit, publish, or close registration forms." to={`/teams/${encodeURIComponent(model.team.id)}/registration-forms`} /> : null}
          <InternalAction icon={ImageIcon} label="Media albums" detail="Photos, video links, albums, and files." to={`/teams/${encodeURIComponent(model.team.id)}/media`} />
          <InternalAction icon={DollarSign} label="My fees" detail="Balances, checkout links, installments, and history." to="/parent-tools/fees" />
          <InternalAction icon={Ticket} label="Registrations" detail="Open published team registration forms." to="/parent-tools/registrations" />
          {model.team.streamUrl ? <ExternalAction icon={Radio} label="Watch stream" detail="Open the configured team stream." href={model.team.streamUrl} /> : null}
          {model.team.bracketUrl ? <ExternalAction icon={Trophy} label="Tournament bracket" detail="Open official bracket." href={model.team.bracketUrl} /> : null}
          {model.team.leagueUrl ? <ExternalAction icon={Trophy} label="League page" detail="Open standings or league registration source." href={model.team.leagueUrl} /> : null}
        </div>
      </section>

      {model.team.registrationProvider.length ? <RegistrationProviderCard rows={model.team.registrationProvider} /> : null}

      {sponsorsLoading ? <MoreTabInlineLoading copy="Loading local attractions and sponsors…" /> : null}
      {!sponsorsLoading && sponsorsError ? <MoreTabInlineError title="Sponsors unavailable" message={sponsorsError} /> : null}

      {model.sponsors.length ? (
        <section className="app-card p-4">
          <div className="text-sm font-black text-gray-950">Local attractions and sponsors</div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {model.sponsors.map((sponsor) => (
              <a
                key={sponsor.id}
                href={sponsor.websiteUrl || '#'}
                className="flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 p-3"
                onClick={(event) => {
                  if (!sponsor.websiteUrl) return;
                  event.preventDefault();
                  void openPublicUrl(sponsor.websiteUrl);
                }}
              >
                <SponsorImage sponsor={sponsor} />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-black text-gray-950">{sponsor.name}</span>
                  {sponsor.description ? <span className="line-clamp-1 text-xs font-semibold text-gray-500">{sponsor.description}</span> : null}
                </span>
              </a>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function StatTrackerConfigsCard({
  teamId,
  auth,
  configs,
  orphanedAssignments,
  onSaved
}: {
  teamId: string;
  auth: AuthState;
  configs: TeamDetailModel['statTrackerConfigs'];
  orphanedAssignments: TeamDetailModel['upcomingEvents'];
  onSaved: () => Promise<void>;
}) {
  const safeConfigs = configs || [];
  const presetCatalog = getStatTrackerConfigPresetCatalog();
  const [editingConfigId, setEditingConfigId] = useState('');
  const [selectedPresetId, setSelectedPresetId] = useState('blank');
  const [draft, setDraft] = useState<StatTrackerConfigDraft | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<{ success: boolean; message: string } | null>(null);

  function openCreateForm() {
    setEditingConfigId('');
    setSelectedPresetId('blank');
    setDraft(createEmptyStatTrackerConfigDraft());
    setStatus(null);
  }

  function openEditForm(config: TeamDetailModel['statTrackerConfigs'][number]) {
    const nextDraft = createStatTrackerConfigDraft({
      id: config.id,
      name: config.name,
      baseType: config.baseType,
      columns: config.columns,
      statDefinitions: config.statDefinitions
    });
    setEditingConfigId(config.id);
    setSelectedPresetId('blank');
    setDraft(nextDraft);
    setStatus(null);
  }

  function closeEditor(options: { keepStatus?: boolean } = {}) {
    setEditingConfigId('');
    setSelectedPresetId('blank');
    setDraft(null);
    if (!options.keepStatus) {
      setStatus(null);
    }
  }

  function updateColumn(columnUiId: string, patch: { key?: string; label?: string }) {
    setDraft((currentDraft) => currentDraft ? {
      ...currentDraft,
      columns: currentDraft.columns.map((column) => column.uiId === columnUiId ? { ...column, ...patch } : column)
    } : currentDraft);
  }

  function moveColumn(columnUiId: string, direction: -1 | 1) {
    setDraft((currentDraft) => {
      if (!currentDraft) return currentDraft;
      const index = currentDraft.columns.findIndex((column) => column.uiId === columnUiId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= currentDraft.columns.length) return currentDraft;
      const columns = currentDraft.columns.slice();
      const [column] = columns.splice(index, 1);
      columns.splice(nextIndex, 0, column);
      return { ...currentDraft, columns };
    });
  }

  async function saveDraft() {
    if (!draft || submitting) return;

    const validation = validateStatTrackerConfigDraft(draft);
    if (!validation.valid) {
      setStatus({ success: false, message: validation.errors.join(' ') });
      return;
    }

    const payload = buildStatTrackerConfigPayload(draft);
    setSubmitting(true);
    setStatus(null);
    try {
      if (editingConfigId) {
        await updateStatTrackerConfigForApp(teamId, editingConfigId, auth.user || null, payload);
      } else {
        await createStatTrackerConfigForApp(teamId, auth.user || null, payload);
      }
      await onSaved();
      setStatus({ success: true, message: editingConfigId ? 'Stat config saved.' : 'Stat config created.' });
      closeEditor({ keepStatus: true });
    } catch (error: any) {
      setStatus({ success: false, message: error?.message || 'Unable to save this stat config.' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="app-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-black text-gray-950">Stat tracker configs</div>
          <div className="mt-1 text-xs font-semibold leading-5 text-gray-500">Create a config from a sport preset or blank slate, then rename, reorder, add, or remove tracked columns without leaving the app.</div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-black text-gray-700">{safeConfigs.length} config{safeConfigs.length === 1 ? '' : 's'}</span>
          {!draft ? <button type="button" className="primary-button !min-h-9 px-3 text-xs" onClick={openCreateForm}>Create config</button> : null}
        </div>
      </div>

      {status ? <div className={`mt-3 rounded-xl border p-3 text-xs font-black ${status.success ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-rose-200 bg-rose-50 text-rose-700'}`} role="status">{status.message}</div> : null}

      {draft ? (
        <div className="mt-3 rounded-xl border border-primary-100 bg-primary-50 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm font-black text-gray-950">{editingConfigId ? 'Edit stat config' : 'Create stat config'}</div>
              <div className="mt-1 text-xs font-semibold text-gray-600">Column labels can change without changing stored stat keys. Basketball base type keeps the website tracker chooser working.</div>
            </div>
            <button type="button" className="secondary-button !min-h-9 px-3 text-xs" onClick={() => closeEditor()} disabled={submitting}>Cancel</button>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-[11px] font-black uppercase tracking-[0.04em] text-primary-700">Config name</span>
              <input
                type="text"
                value={draft.name}
                onChange={(event) => setDraft((currentDraft) => currentDraft ? { ...currentDraft, name: event.target.value } : currentDraft)}
                className="mt-2 min-h-10 w-full rounded-xl border border-primary-200 bg-white px-3 text-sm font-semibold text-gray-950 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
                placeholder="Basketball Standard"
                disabled={submitting}
              />
            </label>
            <label className="block">
              <span className="text-[11px] font-black uppercase tracking-[0.04em] text-primary-700">Base sport</span>
              <select
                value={draft.baseType}
                onChange={(event) => setDraft((currentDraft) => currentDraft ? { ...currentDraft, baseType: event.target.value } : currentDraft)}
                className="mt-2 min-h-10 w-full rounded-xl border border-primary-200 bg-white px-3 text-sm font-semibold text-gray-950 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
                disabled={submitting}
              >
                {['Basketball', 'Soccer', 'Baseball', 'Football', 'Volleyball', 'Custom'].map((baseType) => <option key={baseType} value={baseType}>{baseType}</option>)}
              </select>
            </label>
          </div>

          {!editingConfigId ? (
            <div className="mt-3 rounded-xl border border-white/80 bg-white p-3">
              <div className="text-[11px] font-black uppercase tracking-[0.04em] text-primary-700">Preset library</div>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <select
                  aria-label="Preset library"
                  value={selectedPresetId}
                  onChange={(event) => setSelectedPresetId(event.target.value)}
                  className="min-h-10 flex-1 rounded-xl border border-primary-200 bg-white px-3 text-sm font-semibold text-gray-950 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
                  disabled={submitting}
                >
                  {presetCatalog.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
                </select>
                <button type="button" className="secondary-button !min-h-10 px-3 text-xs" onClick={() => {
                  const presetDraft = createStatTrackerConfigDraftFromPreset(selectedPresetId);
                  setDraft({ ...presetDraft, name: draft.name || presetDraft.name, baseType: presetDraft.baseType });
                }} disabled={submitting}>Apply preset</button>
              </div>
            </div>
          ) : null}

          <div className="mt-3 rounded-xl border border-white/80 bg-white p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-black uppercase tracking-[0.04em] text-primary-700">Columns</div>
                <div className="mt-1 text-xs font-semibold text-gray-500">Keys power saved events. Labels control what coaches see in the tracker and reports.</div>
              </div>
              <button type="button" className="secondary-button !min-h-8 px-3 text-xs" onClick={() => setDraft((currentDraft) => currentDraft ? { ...currentDraft, columns: currentDraft.columns.concat(createBlankStatTrackerConfigColumnDraft()) } : currentDraft)} disabled={submitting}>Add column</button>
            </div>
            <div className="mt-3 space-y-2">
              {draft.columns.length ? draft.columns.map((column, index) => (
                <div key={column.uiId} className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
                    <label className="block">
                      <span className="text-[11px] font-black uppercase tracking-[0.04em] text-gray-500">Label</span>
                      <input
                        type="text"
                        value={column.label}
                        onChange={(event) => updateColumn(column.uiId, { label: event.target.value })}
                        className="mt-1 min-h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-950 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
                        placeholder="PTS"
                        disabled={submitting}
                      />
                    </label>
                    <label className="block">
                      <span className="text-[11px] font-black uppercase tracking-[0.04em] text-gray-500">Key</span>
                      <input
                        type="text"
                        value={column.key}
                        onChange={(event) => updateColumn(column.uiId, { key: event.target.value })}
                        className="mt-1 min-h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-950 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
                        placeholder="PTS"
                        disabled={submitting}
                      />
                    </label>
                    <div className="flex gap-2">
                      <button type="button" className="secondary-button !min-h-10 px-3 text-xs" onClick={() => moveColumn(column.uiId, -1)} disabled={submitting || index === 0}>Up</button>
                      <button type="button" className="secondary-button !min-h-10 px-3 text-xs" onClick={() => moveColumn(column.uiId, 1)} disabled={submitting || index === draft.columns.length - 1}>Down</button>
                      <button type="button" className="secondary-button !min-h-10 px-3 text-xs !border-rose-200 !bg-rose-50 !text-rose-700" onClick={() => setDraft((currentDraft) => currentDraft ? { ...currentDraft, columns: currentDraft.columns.filter((entry) => entry.uiId !== column.uiId) } : currentDraft)} disabled={submitting}>Remove</button>
                    </div>
                  </div>
                </div>
              )) : <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-3 text-xs font-semibold text-gray-500">No columns yet. Add one manually or apply a preset.</div>}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="primary-button !min-h-10 px-3 text-xs" disabled={submitting} onClick={saveDraft}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
              {editingConfigId ? 'Save config' : 'Create config'}
            </button>
          </div>
        </div>
      ) : null}

      <div className="mt-3 space-y-3">
        {safeConfigs.length ? safeConfigs.map((config) => (
          <div key={config.id} className="rounded-xl border border-gray-200 bg-gray-50 p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="text-sm font-black text-gray-950">{config.name}</div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.04em] text-gray-700">{config.baseType || 'Custom'}</span>
                  {config.isBasketball ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.04em] text-amber-800">Basketball tracker routing</span> : null}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-primary-50 px-2.5 py-1 text-xs font-black text-primary-700">{formatConfigColumnSummary(config.columnCount, config.columnNames)}</span>
                <button type="button" className="secondary-button !min-h-8 px-3 text-xs" onClick={() => openEditForm(config)} disabled={submitting}>Edit</button>
              </div>
            </div>
            <div className="mt-3 text-xs font-semibold text-gray-600">Columns: <span className="font-black text-gray-900">{config.columnNames.length ? config.columnNames.join(', ') : 'None configured'}</span></div>
            <div className="mt-3">
              <div className="text-[11px] font-black uppercase tracking-[0.04em] text-gray-500">Assigned upcoming games</div>
              {config.assignedUpcomingGames.length ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {config.assignedUpcomingGames.map((game) => (
                    <span key={`${config.id}-${game.gameId}`} className="rounded-full bg-white px-2.5 py-1 text-xs font-black text-gray-700">
                      {game.title} · {formatEventDate(game.date)}
                    </span>
                  ))}
                </div>
              ) : (
                <div className="mt-2 text-xs font-semibold text-gray-500">No upcoming games assigned.</div>
              )}
            </div>
          </div>
        )) : (
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm font-semibold text-gray-500">No stat tracker configs found for this team.</div>
        )}

        {orphanedAssignments.length ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-3">
            <div className="text-[11px] font-black uppercase tracking-[0.04em] text-rose-700">Missing config assignments</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {orphanedAssignments.map((event) => (
                <span key={event.id} className="rounded-full bg-white px-2.5 py-1 text-xs font-black text-rose-700">{event.title} · {event.statTrackerConfigId}</span>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function formatConfigColumnSummary(columnCount: number, columnNames: string[]) {
  if (!columnCount) return 'No columns';
  const preview = columnNames.slice(0, 3).join(', ');
  const remainder = columnCount - Math.min(columnNames.length, 3);
  return `${columnCount} column${columnCount === 1 ? '' : 's'}${preview ? ` · ${preview}${remainder > 0 ? ` +${remainder}` : ''}` : ''}`;
}


function MoreTabInlineLoading({ copy }: { copy: string }) {
  return (
    <div className="rounded-xl border border-primary-200 bg-primary-50 p-4">
      <div className="flex items-center gap-3 text-sm font-semibold text-gray-600">
        <Loader2 className="h-4 w-4 animate-spin text-primary-600" aria-hidden="true" />
        {copy}
      </div>
    </div>
  );
}

function MoreTabInlineError({ title, message }: { title: string; message: string }) {
  return (
    <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
      <div className="text-sm font-black text-gray-950">{title}</div>
      <div className="mt-1 text-xs font-semibold text-rose-700">{message}</div>
    </div>
  );
}

function ReminderTimingDefaultsCard({ model, onSaved }: { model: TeamDetailModel; onSaved: () => Promise<void> }) {
  const [enabled, setEnabled] = useState(model.team.scheduleNotifications.enabled);
  const [reminderHours, setReminderHours] = useState(model.team.scheduleNotifications.reminderHours);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    setEnabled(model.team.scheduleNotifications.enabled);
    setReminderHours(model.team.scheduleNotifications.reminderHours);
  }, [model.team.scheduleNotifications.enabled, model.team.scheduleNotifications.reminderHours]);

  const hasChanges = enabled !== model.team.scheduleNotifications.enabled
    || reminderHours !== model.team.scheduleNotifications.reminderHours;

  async function saveSettings() {
    if (submitting || !hasChanges) return;
    setSubmitting(true);
    setStatus(null);
    try {
      await saveTeamScheduleNotificationsForApp(model.team.id, { enabled, reminderHours, delivery: 'team_chat' });
      await onSaved();
      setStatus({ success: true, message: 'Reminder timing defaults saved.' });
    } catch (saveError: any) {
      setStatus({ success: false, message: saveError?.message || 'Unable to save reminder timing defaults.' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="app-card p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-primary-50 text-primary-700">
          <CalendarDays className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-black text-gray-950">Reminder timing defaults</div>
          <div className="mt-1 text-xs font-semibold leading-5 text-gray-500">Save the inherited team RSVP reminder timing for future schedule events in web and mobile.</div>

          <div className="mt-4 space-y-3 rounded-xl border border-primary-100 bg-primary-50 p-3">
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                checked={enabled}
                onChange={(event) => {
                  setEnabled(event.target.checked);
                  setStatus(null);
                }}
                disabled={submitting}
              />
              <span>
                <span className="block text-sm font-black text-gray-950">Enable team-wide pre-event reminders</span>
                <span className="mt-1 block text-xs font-semibold leading-5 text-gray-600">When enabled, new schedule flows can inherit this team reminder window.</span>
              </span>
            </label>

            <label className="block">
              <span className="text-[11px] font-black uppercase tracking-[0.04em] text-primary-700">Reminder window</span>
              <select
                aria-label="Reminder window"
                className="mt-2 min-h-10 w-full rounded-xl border border-primary-200 bg-white px-3 text-sm font-semibold text-gray-950 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
                value={String(reminderHours)}
                onChange={(event) => {
                  setReminderHours(Number.parseInt(event.target.value, 10) as 24 | 48 | 72);
                  setStatus(null);
                }}
                disabled={submitting}
              >
                <option value="24">24 hours before event start</option>
                <option value="48">48 hours before event start</option>
                <option value="72">72 hours before event start</option>
              </select>
            </label>

            <div className="rounded-lg border border-white/80 bg-white p-3 text-xs font-semibold leading-5 text-gray-600">{model.team.scheduleNotifications.summary}</div>

            <button type="button" className="primary-button !min-h-10 text-xs" disabled={submitting || !hasChanges} onClick={saveSettings}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
              Save Timing Defaults
            </button>
            {status ? <div className={`text-xs font-black ${status.success ? 'text-emerald-700' : 'text-rose-700'}`} role="status">{status.message}</div> : null}
          </div>
        </div>
      </div>
    </section>
  );
}

function PrivateCalendarSyncCard({ model }: { model: TeamDetailModel }) {
  const [busyTarget, setBusyTarget] = useState<'apple' | 'google' | 'copy' | ''>('');
  const [status, setStatus] = useState<{ success: boolean; message: string } | null>(null);

  async function openFeed(target: 'apple' | 'google' | 'copy') {
    if (busyTarget) return;
    setBusyTarget(target);
    setStatus(null);
    try {
      const feedUrl = await getPrivateTeamCalendarFeedUrl(model.team.id);
      if (!feedUrl) throw new Error('Unable to create private calendar feed. Sign in again and retry.');
      if (target === 'copy') {
        const result = await copyPublicText(feedUrl);
        setStatus(result === 'copied'
          ? { success: true, message: 'Private calendar link copied.' }
          : { success: false, message: 'Unable to copy the private calendar link. Sign in again and retry.' });
        return;
      }
      await openPublicUrl(target === 'apple' ? getAppleCalendarFeedUrl(feedUrl) : getGoogleCalendarFeedUrl(feedUrl));
    } catch (feedError: any) {
      setStatus({ success: false, message: feedError?.message || 'Unable to open private calendar sync. Sign in again and retry.' });
    } finally {
      setBusyTarget('');
    }
  }

  return (
    <section className="app-card p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-primary-50 text-primary-700">
          <CalendarDays className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-black text-gray-950">Private calendar sync</div>
          <div className="mt-1 text-xs font-semibold leading-5 text-gray-500">Subscribe to the live private team feed for games and practices. For a one-time .ics file instead, use the team schedule export.</div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <button type="button" className="secondary-button !min-h-9 justify-center text-xs" onClick={() => openFeed('apple')} disabled={Boolean(busyTarget)}>
              {busyTarget === 'apple' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              Apple Calendar
            </button>
            <button type="button" className="secondary-button !min-h-9 justify-center text-xs" onClick={() => openFeed('google')} disabled={Boolean(busyTarget)}>
              {busyTarget === 'google' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              Google Calendar
            </button>
            <button type="button" className="secondary-button !min-h-9 justify-center text-xs" onClick={() => openFeed('copy')} disabled={Boolean(busyTarget)}>
              {busyTarget === 'copy' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
              Copy Link
            </button>
          </div>
          <Link to={`/schedule?teamId=${encodeURIComponent(model.team.id)}`} className="ghost-button mt-3 !min-h-9 px-0 text-xs text-primary-700">
            Open team schedule for one-time .ics export
          </Link>
          {status ? <div className={`mt-2 text-xs font-black ${status.success ? 'text-emerald-700' : 'text-rose-700'}`} role="status">{status.message}</div> : null}
        </div>
      </div>
    </section>
  );
}

function FanFeedCard({ model }: { model: TeamDetailModel }) {
  const feedUrl = buildPublicTeamGamesIcsUrl(model.team.id);
  const [status, setStatus] = useState<{ success: boolean; message: string } | null>(null);

  async function shareFanFeed() {
    const result = await sharePublicUrl({
      title: `${model.team.name} fan feed`,
      text: `${model.team.name} public games calendar feed`,
      url: feedUrl,
      clipboardText: feedUrl
    });
    if (result === 'shared') {
      setStatus({ success: true, message: 'Fan feed share sheet opened.' });
    } else if (result === 'copied') {
      setStatus({ success: true, message: 'Fan feed link copied.' });
    } else {
      setStatus({ success: false, message: 'Unable to share the fan feed from this device.' });
    }
  }

  return (
    <section className="app-card p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-primary-50 text-primary-700">
          <CalendarDays className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-black text-gray-950">Fan Feed</div>
          <div className="mt-1 text-xs font-semibold leading-5 text-gray-500">Share a public games-only calendar link for fans. Practices, private notes, RSVPs, and assignments stay out of this feed.</div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="primary-button !min-h-9 text-xs" onClick={shareFanFeed}>
              <LinkIcon className="h-4 w-4" aria-hidden="true" />
              Copy or Share Fan Feed
            </button>
          </div>
          {status ? <div className={`mt-2 text-xs font-black ${status.success ? 'text-emerald-700' : 'text-rose-700'}`} role="status">{status.message}</div> : null}
        </div>
      </div>
    </section>
  );
}

function RegistrationProviderCard({ rows }: { rows: TeamDetailModel['team']['registrationProvider'] }) {
  const [copyStatus, setCopyStatus] = useState<{ label: string; success: boolean } | null>(null);

  async function copyValue(label: string, value: string) {
    const result = await copyPublicText(value);
    setCopyStatus({ label, success: result === 'copied' });
  }

  return (
    <section className="app-card p-4">
      <div className="text-sm font-black text-gray-950">Registration provider</div>
      <div className="mt-1 text-xs font-semibold leading-5 text-gray-500">This team syncs registrations from an external provider.</div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {rows.map((row) => (
          <div key={row.label} className="rounded-xl border border-blue-100 bg-blue-50 p-3">
            <div className="text-[11px] font-black uppercase tracking-[0.04em] text-blue-700">{row.label}</div>
            <div className="mt-1 flex items-center justify-between gap-2">
              <div className="min-w-0 break-all text-sm font-black text-gray-950">{row.value}</div>
              {row.copyable ? (
                <button
                  type="button"
                  className="flex-none rounded-lg border border-blue-200 bg-white px-2 py-1 text-[11px] font-black text-blue-700 hover:bg-blue-100"
                  aria-label={`Copy ${row.label}`}
                  onClick={() => void copyValue(row.label, row.value)}
                >
                  Copy
                </button>
              ) : null}
            </div>
          </div>
        ))}
      </div>
      {copyStatus ? (
        <div className={`mt-2 text-xs font-bold ${copyStatus.success ? 'text-emerald-700' : 'text-rose-700'}`}>
          {copyStatus.success ? `${copyStatus.label} copied.` : `Unable to copy ${copyStatus.label}.`}
        </div>
      ) : null}
    </section>
  );
}

function ScoreboardWidgetCard({ model }: { model: TeamDetailModel }) {
  const widgetUrl = buildScoreboardWidgetUrl(model.team.id);
  const embedCode = buildScoreboardWidgetEmbedCode(model.team);
  const [copyStatus, setCopyStatus] = useState<{ kind: 'embed' | 'link'; success: boolean } | null>(null);

  if (model.team.isExplicitlyPublic !== true) {
    return (
      <section className="app-card p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-gray-100 text-gray-600">
            <Code2 className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <div className="text-sm font-black text-gray-950">Scoreboard widget unavailable</div>
            <div className="mt-1 text-xs font-semibold leading-5 text-gray-500">This team is private. Make the team public before sharing a scoreboard link or embed.</div>
          </div>
        </div>
      </section>
    );
  }

  async function copyValue(kind: 'embed' | 'link', value: string) {
    const result = await copyPublicText(value);
    setCopyStatus({ kind, success: result === 'copied' });
  }

  return (
    <section className="app-card p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-primary-50 text-primary-700">
          <Code2 className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-black text-gray-950">Scoreboard widget</div>
          <div className="mt-1 text-xs font-semibold leading-5 text-gray-500">Copy a read-only public link or iframe embed for this team&apos;s live scoreboard.</div>
          <label className="mt-3 block text-[11px] font-black uppercase tracking-[0.04em] text-gray-500" htmlFor="scoreboard-widget-embed">Embed code</label>
          <textarea
            id="scoreboard-widget-embed"
            className="mt-1 h-24 w-full resize-none rounded-xl border border-gray-200 bg-gray-50 p-3 font-mono text-xs font-semibold text-gray-700"
            readOnly
            value={embedCode}
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="primary-button !min-h-9 text-xs" onClick={() => copyValue('embed', embedCode)}>
              <Copy className="h-4 w-4" aria-hidden="true" />
              Copy Embed Code
            </button>
            <button type="button" className="secondary-button !min-h-9 text-xs" onClick={() => copyValue('link', widgetUrl)}>
              <LinkIcon className="h-4 w-4" aria-hidden="true" />
              Copy Link
            </button>
          </div>
          {copyStatus ? (
            <div className={`mt-2 flex items-center gap-2 text-xs font-black ${copyStatus.success ? 'text-emerald-700' : 'text-rose-700'}`} role="status">
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              {copyStatus.success
                ? `${copyStatus.kind === 'embed' ? 'Embed code' : 'Widget link'} copied.`
                : `Unable to copy ${copyStatus.kind === 'embed' ? 'embed code' : 'widget link'}. Select the field and copy manually.`}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

export function buildScoreboardWidgetUrl(teamId: string, baseUrl = getPublicBaseUrl()) {
  const url = new URL('/widget-scoreboard.html', baseUrl);
  url.searchParams.set('teamId', teamId);
  return url.toString();
}

export function buildScoreboardWidgetEmbedCode(team: { id: string; name: string }, baseUrl?: string) {
  const widgetUrl = buildScoreboardWidgetUrl(team.id, baseUrl);
  const title = escapeHtmlAttribute(`${team.name || 'Team'} live scoreboard`);
  return `<iframe src="${escapeHtmlAttribute(widgetUrl)}" title="${title}" style="width: 100%; max-width: 720px; height: 480px; border: 0;" loading="lazy"></iframe>`;
}

function getPublicBaseUrl() {
  if (typeof window !== 'undefined' && /^https?:$/i.test(window.location.protocol)) {
    return window.location.origin;
  }
  return 'https://allplays.ai';
}

function escapeHtmlAttribute(value: string) {
  return String(value || '').replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char] || char));
}

function StaffPermissionsCard({ model, auth, onInviteSuccess }: { model: TeamDetailModel; auth: AuthState; onInviteSuccess: () => Promise<void> }) {
  const summary = model.staffPermissions;
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<InviteTeamAdminForAppResult | null>(null);
  const [grantingUserId, setGrantingUserId] = useState<string | null>(null);
  const [removingAdminEmail, setRemovingAdminEmail] = useState<string | null>(null);
  const [grantStatus, setGrantStatus] = useState<{ success: boolean; message: string } | null>(null);
  if (!summary) return null;
  const scorekeeperGrantTargets = summary.scorekeeperGrantTargets || [];
  const teamMediaManagerGrantTargets = summary.teamMediaManagerGrantTargets || [];
  const videographerGrantTargets = summary.videographerGrantTargets || [];
  const isAllConfirmedScorekeeping = summary.scorekeepingMode === 'all_confirmed';
  const existingEmails = getStaffPermissionEmails(summary);

  async function submitInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    setResult(null);
    if (!normalizedEmail) {
      setError('Enter an admin email.');
      return;
    }
    if (!isValidEmail(normalizedEmail)) {
      setError('Enter a valid email address.');
      return;
    }
    if (existingEmails.has(normalizedEmail)) {
      setError('That email is already listed as staff or pending.');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      const inviteResult = await inviteTeamAdminForApp(model.team.id, normalizedEmail, auth.user || null);
      if (inviteResult.status === 'fallback_code' && !inviteResult.code && !inviteResult.acceptInviteUrl) {
        setError('Unable to create an admin invite code. Try again.');
        return;
      }
      setResult(inviteResult);
      setEmail('');
      await onInviteSuccess();
    } catch (submitError: any) {
      setError(submitError?.message || 'Unable to send admin invite.');
    } finally {
      setSubmitting(false);
    }
  }

  async function removeAdmin(emailToRemove: string) {
    if (!emailToRemove || removingAdminEmail) return;
    const confirmed = window.confirm(`Remove ${emailToRemove} as a team admin?`);
    if (!confirmed) return;
    setRemovingAdminEmail(emailToRemove);
    setGrantStatus(null);
    setResult(null);
    try {
      await revokeTeamAdminAccessForApp(model.team.id, emailToRemove, auth.user || null);
      setGrantStatus({ success: true, message: `${emailToRemove} removed from team admins.` });
      await onInviteSuccess();
    } catch (removeError: any) {
      setGrantStatus({ success: false, message: removeError?.message || 'Unable to remove this team admin.' });
    } finally {
      setRemovingAdminEmail(null);
    }
  }

  async function toggleScorekeeperGrant(memberUserId: string, isGranted: boolean) {
    if (!memberUserId || grantingUserId) return;
    setGrantingUserId(memberUserId);
    setGrantStatus(null);
    setResult(null);
    try {
      if (isGranted) {
        await revokeScorekeeperAccessForApp(model.team.id, memberUserId);
      } else {
        await grantScorekeeperAccessForApp(model.team.id, memberUserId);
      }
      setGrantStatus({ success: true, message: isGranted ? 'Scorekeeper access revoked.' : 'Scorekeeper access granted.' });
      await onInviteSuccess();
    } catch (grantError: any) {
      setGrantStatus({ success: false, message: grantError?.message || 'Unable to update scorekeeper access.' });
    } finally {
      setGrantingUserId(null);
    }
  }

  async function toggleVideographerGrant(memberUserId: string, isGranted: boolean) {
    if (!memberUserId || grantingUserId) return;
    setGrantingUserId(memberUserId);
    setGrantStatus(null);
    setResult(null);
    try {
      if (isGranted) {
        await revokeVideographerAccessForApp(model.team.id, memberUserId);
      } else {
        await grantVideographerAccessForApp(model.team.id, memberUserId);
      }
      setGrantStatus({ success: true, message: isGranted ? 'Videographer access revoked.' : 'Videographer access granted.' });
      await onInviteSuccess();
    } catch (grantError: any) {
      setGrantStatus({ success: false, message: grantError?.message || 'Unable to update videographer access.' });
    } finally {
      setGrantingUserId(null);
    }
  }

  async function toggleTeamMediaManagerGrant(memberUserId: string, isGranted: boolean) {
    if (!memberUserId || grantingUserId) return;
    setGrantingUserId(memberUserId);
    setGrantStatus(null);
    setResult(null);
    try {
      if (isGranted) {
        await revokeTeamMediaManagerAccessForApp(model.team.id, memberUserId);
      } else {
        await grantTeamMediaManagerAccessForApp(model.team.id, memberUserId);
      }
      setGrantStatus({ success: true, message: isGranted ? 'Team Media manager access revoked.' : 'Team Media manager access granted.' });
      await onInviteSuccess();
    } catch (grantError: any) {
      setGrantStatus({ success: false, message: grantError?.message || 'Unable to update Team Media manager access.' });
    } finally {
      setGrantingUserId(null);
    }
  }

  return (
    <section className="app-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-black text-gray-950">Team Staff &amp; Permissions</div>
          <div className="mt-1 text-xs font-semibold leading-5 text-gray-500">Owners and platform admins can manage team admins here in the app. Scoped helpers cover scorekeeping, Stream &amp; Score, Team Media, video, and volunteer tasks.</div>
        </div>
      </div>

      {model.canManageAdmins ? (
        <form className="mt-4 rounded-xl border border-primary-100 bg-primary-50 p-3" onSubmit={submitInvite} noValidate>
          <div className="text-[11px] font-black uppercase tracking-[0.04em] text-primary-700">Invite admin</div>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <label className="sr-only" htmlFor="team-admin-invite-email">Admin email</label>
            <input
              id="team-admin-invite-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              enterKeyHint="send"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                setError('');
              }}
              className="min-h-10 flex-1 rounded-xl border border-primary-200 bg-white px-3 text-sm font-semibold text-gray-950 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
              placeholder="coach@example.com"
              disabled={submitting}
              aria-invalid={Boolean(error)}
            />
            <button type="submit" className="primary-button !min-h-10 text-xs" disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              Send invite
            </button>
          </div>
          {error ? <div className="mt-2 text-xs font-black text-rose-700" role="alert">{error}</div> : null}
          {result ? (
            result.code || result.acceptInviteUrl ? (
              <InviteResultCard
                code={result.code}
                inviteUrl={result.acceptInviteUrl}
                recipientEmail={result.email}
                emailSent={result.status === 'sent'}
                title="Invite code"
                shareTitle={`${model.team.name} staff invite`}
                shareText={`Join ${model.team.name} staff on ALL PLAYS.`}
                onStatus={(message) => setGrantStatus({ success: !message.startsWith('Unable'), message })}
              />
            ) : (
              <div className="mt-3 rounded-lg border border-white/80 bg-white p-3 text-xs font-black text-gray-950" role="status">
                {result.email} already has an account and was added as an admin.
              </div>
            )
          ) : null}
        </form>
      ) : (
        <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs font-semibold text-gray-600">Only the team owner or a platform admin can add or remove team admins.</div>
      )}

      {isAllConfirmedScorekeeping ? (
        <div className="mt-4 rounded-xl border border-primary-100 bg-white p-3">
          <div className="text-[11px] font-black uppercase tracking-[0.04em] text-primary-700">Scorekeeper helper access</div>
          <p className="mt-2 text-xs font-semibold leading-5 text-gray-600">All confirmed team members can score games, so individual scorekeeper grants are disabled to preserve that team-wide access.</p>
        </div>
      ) : scorekeeperGrantTargets.length ? (
        <PermissionGrantPanel
          title="Scorekeeper helper access"
          description="Grant an existing linked team member scorekeeping duty without making them a full admin or giving roster, schedule, settings, or broader team access."
          targets={scorekeeperGrantTargets}
          grantingUserId={grantingUserId}
          onToggle={toggleScorekeeperGrant}
          grantedText="Can score games."
          emptyText="No scorekeeper helper grant."
          grantLabel="Grant scorekeeper"
          revokeLabel="Revoke scorekeeper"
        />
      ) : null}

      {videographerGrantTargets.length ? (
        <PermissionGrantPanel
          title="Videographer access"
          description="Grant an existing linked team member live-game camera and media capture access only. This does not grant roster, schedule, RSVP, or full team admin rights."
          targets={videographerGrantTargets}
          grantingUserId={grantingUserId}
          onToggle={toggleVideographerGrant}
          grantedText="Can capture live-game camera and media."
          emptyText="No videographer helper grant."
          grantLabel="Grant videographer"
          revokeLabel="Revoke videographer"
        />
      ) : null}

      {teamMediaManagerGrantTargets.length ? (
        <PermissionGrantPanel
          title="Team Media manager access"
          description="Grant an existing linked team member album, visibility, upload, video-link, and media moderation access without full roster, schedule, or settings admin rights."
          targets={teamMediaManagerGrantTargets}
          grantingUserId={grantingUserId}
          onToggle={toggleTeamMediaManagerGrant}
          grantedText="Can manage albums, visibility, uploads, and video links."
          emptyText="No Team Media manager grant."
          grantLabel="Grant media manager"
          revokeLabel="Revoke media manager"
        />
      ) : null}

      {grantStatus ? <div className={`mt-2 text-xs font-black ${grantStatus.success ? 'text-emerald-700' : 'text-rose-700'}`} role="status">{grantStatus.message}</div> : null}

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-3">
          <div className="text-[11px] font-black uppercase tracking-[0.04em] text-indigo-700">Owner, admins, and invites</div>
          <div className="mt-2 space-y-2">
            {summary.staff.length ? summary.staff.map((member) => {
              const canRemove = model.canManageAdmins && member.role === 'Admin';
              const busy = removingAdminEmail === member.label;
              return (
                <div key={`${member.role}:${member.label}`} className="flex items-center justify-between gap-3 rounded-lg border border-indigo-200 bg-white px-3 py-2">
                  <span className="min-w-0 truncate text-xs font-black text-indigo-800">{member.label} · {member.role}</span>
                  {canRemove ? (
                    <button type="button" className="secondary-button !min-h-8 flex-none text-xs !border-rose-200 !bg-rose-50 !text-rose-700" disabled={Boolean(removingAdminEmail)} onClick={() => removeAdmin(member.label)}>
                      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
                      Remove
                    </button>
                  ) : null}
                </div>
              );
            }) : null}
            {summary.pendingInvites.length ? summary.pendingInvites.map((inviteEmail) => (
              <div key={`pending:${inviteEmail}`} className="rounded-lg border border-indigo-200 bg-white px-3 py-2 text-xs font-black text-indigo-800">{inviteEmail} · Pending admin invite</div>
            )) : null}
            {!summary.staff.length && !summary.pendingInvites.length ? <PillList items={[]} emptyText="No owner, admin staff, or pending admin invites found." tone="border-indigo-200 bg-white text-indigo-800" /> : null}
          </div>
        </div>
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-3">
          <div className="text-[11px] font-black uppercase tracking-[0.04em] text-emerald-700">Admin vs game-day helpers</div>
          <p className="mt-2 text-xs font-semibold leading-5 text-emerald-800">Stream &amp; Score means scorekeeping plus streaming capability. It does not grant roster, schedule, RSVP, scoring setup, or full team settings access.</p>
        </div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {summary.helperPermissions.map((permission) => (
          <div key={permission.key} className="rounded-xl border border-gray-200 bg-gray-50 p-3">
            <div className="text-[11px] font-black uppercase tracking-[0.04em] text-gray-700">{permission.title}</div>
            <PillList items={permission.grants} emptyText={permission.emptyText} />
          </div>
        ))}
      </div>
    </section>
  );
}

function PermissionGrantPanel({
  title,
  description,
  targets,
  grantingUserId,
  onToggle,
  grantedText,
  emptyText,
  grantLabel,
  revokeLabel
}: {
  title: string;
  description: string;
  targets: TeamScorekeeperGrantTarget[];
  grantingUserId: string | null;
  onToggle: (memberUserId: string, isGranted: boolean) => Promise<void>;
  grantedText: string;
  emptyText: string;
  grantLabel: string;
  revokeLabel: string;
}) {
  return (
    <div className="mt-4 rounded-xl border border-primary-100 bg-white p-3">
      <div className="text-[11px] font-black uppercase tracking-[0.04em] text-primary-700">{title}</div>
      <p className="mt-2 text-xs font-semibold leading-5 text-gray-600">{description}</p>
      <div className="mt-3 divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-100">
        {targets.map((target) => {
          const busy = grantingUserId === target.userId;
          const detail = target.playerNames.length ? `Linked to ${target.playerNames.join(', ')}.` : 'Linked team member account.';
          return (
            <div key={target.userId} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="truncate text-sm font-black text-gray-950">{target.name || target.email || 'Team member'}</div>
                <div className="text-xs font-semibold leading-5 text-gray-500">{target.isGranted ? `${grantedText} ${detail}` : `${emptyText} ${detail}`}</div>
              </div>
              <button type="button" className={`secondary-button !min-h-9 flex-none text-xs ${target.isGranted ? '!border-rose-200 !bg-rose-50 !text-rose-700' : ''}`} disabled={Boolean(grantingUserId)} onClick={() => onToggle(target.userId, target.isGranted)}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                {target.isGranted ? revokeLabel : grantLabel}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}


function getStaffPermissionEmails(summary: NonNullable<TeamDetailModel['staffPermissions']>) {
  const emails = new Set<string>();
  summary.staff.forEach((member) => {
    const value = member.label.trim().toLowerCase();
    if (value.includes('@')) emails.add(value);
  });
  summary.pendingInvites.forEach((inviteEmail) => {
    const value = inviteEmail.trim().toLowerCase();
    if (value) emails.add(value);
  });
  return emails;
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function PillList({ items, emptyText, tone = 'border-gray-200 bg-white text-gray-700' }: { items: string[]; emptyText: string; tone?: string }) {
  if (!items.length) {
    return <div className="mt-2 rounded-lg border border-dashed border-gray-300 bg-white/70 p-3 text-xs font-semibold italic text-gray-500">{emptyText}</div>;
  }

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {items.map((item) => <span key={item} className={`rounded-full border px-2.5 py-1 text-xs font-black ${tone}`}>{item}</span>)}
    </div>
  );
}


function ExternalAction({ icon: Icon, label, detail, href }: { icon: LucideIcon; label: string; detail: string; href: string }) {
  return (
    <a
      href={href}
      className="flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 p-3 transition hover:border-primary-200 hover:bg-primary-50/40"
      onClick={(event) => {
        event.preventDefault();
        void openPublicUrl(href);
      }}
    >
      <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-white text-primary-700">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-black text-gray-950">{label}</span>
        <span className="line-clamp-1 text-xs font-semibold text-gray-500">{detail}</span>
      </span>
      <ExternalLink className="h-4 w-4 flex-none text-gray-400" aria-hidden="true" />
    </a>
  );
}

function InternalAction({ icon: Icon, label, detail, to }: { icon: LucideIcon; label: string; detail: string; to: string }) {
  return (
    <Link to={to} className="flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 p-3 transition hover:border-primary-200 hover:bg-primary-50/40">
      <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-white text-primary-700">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-black text-gray-950">{label}</span>
        <span className="line-clamp-1 text-xs font-semibold text-gray-500">{detail}</span>
      </span>
      <ChevronRight className="h-4 w-4 flex-none text-gray-400" aria-hidden="true" />
    </Link>
  );
}

function SponsorImage({ sponsor }: { sponsor: { name: string; imageUrl: string | null } }) {
  if (sponsor.imageUrl) return <img src={sponsor.imageUrl} alt={`${sponsor.name} sponsor logo`} className="h-12 w-12 flex-none rounded-xl object-cover" loading="lazy" />;
  return (
    <span className="flex h-12 w-12 flex-none items-center justify-center rounded-xl bg-white text-gray-500">
      <LinkIcon className="h-5 w-5" aria-hidden="true" />
    </span>
  );
}


function formatEventDate(date: Date) {
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
