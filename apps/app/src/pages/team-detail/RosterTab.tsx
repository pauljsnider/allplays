import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight, LinkIcon, Loader2, MessageCircle, Save, Sparkles, UserPlus } from 'lucide-react';
import { AvatarImage } from '../../components/AvatarImage';
import { buildPrivateAiLaunchPath } from '../../lib/privateAiLaunch';
import { addRosterPlayerForApp, archiveTeamTrackingItemForApp, createRosterParentInviteForApp, deactivateRosterPlayerForApp, loadRosterFieldDefinitionsForApp, reactivateRosterPlayerForApp, saveTeamTrackingItemForApp, setPlayerTrackingStatusForApp, type CreateRosterParentInviteForAppResult, type TeamDetailModel, type TeamDetailPlayer, type TeamRosterFieldDefinition, type TeamRosterParentInviteSummary, type TeamTrackingAdminItem } from '../../lib/teamDetailService';
import type { AuthState } from '../../lib/types';
import { InviteResultCard } from '../parent-tools/shared';

export const rosterRenderLimits = {
  activePlayers: 32,
  inactivePlayers: 8,
  trackingStatuses: 24
} as const;

export function calculateRosterRenderWindow(totalCount: number, requestedLimit: number, pageSize: number) {
  const safeTotal = Math.max(0, totalCount);
  const safePageSize = Math.max(0, pageSize);
  const safeRequestedLimit = Math.max(0, requestedLimit);
  const visibleCount = Math.min(safeTotal, safeRequestedLimit);
  return {
    visibleCount,
    hiddenCount: Math.max(0, safeTotal - visibleCount),
    hasMore: safeTotal > visibleCount,
    nextLimit: Math.min(safeTotal, visibleCount + safePageSize)
  };
}

export function RosterTab({
  model,
  authUser,
  onRefresh,
  rosterInviteLoading,
  rosterInviteError,
  rosterInviteSummaries,
  onInviteCreated,
  trackingLoading,
  trackingError,
  trackingItems,
  onTrackingChanged
}: {
  model: TeamDetailModel;
  authUser: AuthState['user'];
  onRefresh: () => Promise<void>;
  rosterInviteLoading: boolean;
  rosterInviteError: string;
  rosterInviteSummaries: Record<string, TeamRosterParentInviteSummary>;
  onInviteCreated: () => Promise<void>;
  trackingLoading: boolean;
  trackingError: string;
  trackingItems: TeamTrackingAdminItem[];
  onTrackingChanged: () => Promise<void>;
}) {
  const [pendingPlayerId, setPendingPlayerId] = useState('');
  const [expandedInvite, setExpandedInvite] = useState<{ teamId: string; playerId: string } | null>(null);
  const [status, setStatus] = useState<{ success: boolean; message: string } | null>(null);
  const [activePlayerLimit, setActivePlayerLimit] = useState<number>(rosterRenderLimits.activePlayers);
  const [inactivePlayerLimit, setInactivePlayerLimit] = useState<number>(rosterRenderLimits.inactivePlayers);
  const activePlayers = Array.isArray(model.players) ? model.players : [];
  const inactivePlayers = Array.isArray(model.inactivePlayers) ? model.inactivePlayers : [];
  const activePlayerWindow = calculateRosterRenderWindow(activePlayers.length, activePlayerLimit, rosterRenderLimits.activePlayers);
  const inactivePlayerWindow = calculateRosterRenderWindow(inactivePlayers.length, inactivePlayerLimit, rosterRenderLimits.inactivePlayers);
  const visibleActivePlayers = activePlayers.slice(0, activePlayerWindow.visibleCount);
  const visibleInactivePlayers = inactivePlayers.slice(0, inactivePlayerWindow.visibleCount);

  async function togglePlayerActiveState(player: TeamDetailPlayer) {
    const action = player.active ? 'deactivate' : 'reactivate';
    const confirmationMessage = player.active
      ? `Deactivate ${player.name}?\n\nLinked parents may lose access to this team, including history, until the player is reactivated or parent scope is repaired.`
      : `Reactivate ${player.name}?`;
    const confirmed = window.confirm(confirmationMessage);
    if (!confirmed) return;
    setPendingPlayerId(player.id);
    setStatus(null);
    try {
      if (player.active) {
        await deactivateRosterPlayerForApp(model.team.id, player.id);
      } else {
        await reactivateRosterPlayerForApp(model.team.id, player.id);
      }
      await onRefresh();
      setStatus({ success: true, message: `${player.name} ${player.active ? 'deactivated' : 'reactivated'}.` });
    } catch (saveError: any) {
      setStatus({ success: false, message: saveError?.message || `Unable to ${action} ${player.name}.` });
    } finally {
      setPendingPlayerId('');
    }
  }

  function toggleInviteEditor(playerId: string) {
    setExpandedInvite((current) => current?.teamId === model.team.id && current.playerId === playerId
      ? null
      : { teamId: model.team.id, playerId });
  }

  return (
    <section className="app-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-black text-gray-950">Roster</div>
          <div className="mt-0.5 text-xs font-semibold text-gray-500">Player photos, numbers, linked-player shortcuts, and profile drill-in.</div>
        </div>
        <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-black text-gray-700">{activePlayers.length} active</span>
      </div>
      {status ? (
        <div className={`mt-3 rounded-xl border p-3 text-xs font-semibold ${status.success ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-rose-200 bg-rose-50 text-rose-700'}`}>
          {status.message}
        </div>
      ) : null}
      {model.canManageTeam && rosterInviteLoading ? <div className="mt-3 text-xs font-semibold text-gray-500">Loading parent invite status…</div> : null}
      {model.canManageTeam && rosterInviteError ? <div className="mt-3 text-xs font-black text-rose-700">{rosterInviteError}</div> : null}
      {model.canManageTeam ? <AddPlayerCard teamId={model.team.id} authUser={authUser} onCreated={onRefresh} /> : null}
      {model.canManageTeam ? <RosterAiChatLauncher teamId={model.team.id} teamName={model.team.name} /> : null}
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {activePlayers.length ? visibleActivePlayers.map((player) => <PlayerRow key={player.id} teamId={model.team.id} teamName={model.team.name} authUser={authUser} player={player} canManageTeam={model.canManageTeam} pending={pendingPlayerId === player.id} onToggleActive={togglePlayerActiveState} inviteSummary={rosterInviteSummaries[player.id]} inviteExpanded={expandedInvite?.teamId === model.team.id && expandedInvite.playerId === player.id} onToggleInvite={() => toggleInviteEditor(player.id)} onInviteCreated={onInviteCreated} />) : (
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm font-semibold text-gray-500">No players have been added yet.</div>
        )}
      </div>
      {activePlayerWindow.hasMore ? (
        <button type="button" className="secondary-button mt-3 !min-h-9 text-xs" onClick={() => setActivePlayerLimit(activePlayerWindow.nextLimit)}>
          Show {Math.min(rosterRenderLimits.activePlayers, activePlayerWindow.hiddenCount)} more active players
        </button>
      ) : null}
      {model.canManageTeam ? <TrackingAdminCard teamId={model.team.id} authUser={authUser} players={activePlayers} trackingLoading={trackingLoading} trackingError={trackingError} trackingItems={trackingItems} onTrackingChanged={onTrackingChanged} /> : null}
      {model.canManageTeam && inactivePlayers.length ? (
        <div className="mt-4 border-t border-gray-200 pt-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-black text-gray-950">Inactive roster</div>
              <div className="mt-0.5 text-xs font-semibold text-gray-500">Inactive players stay attached to history and can be restored anytime.</div>
            </div>
            <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-black text-gray-700">{inactivePlayers.length} inactive</span>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {visibleInactivePlayers.map((player) => <PlayerRow key={player.id} teamId={model.team.id} teamName={model.team.name} authUser={authUser} player={player} canManageTeam pending={pendingPlayerId === player.id} onToggleActive={togglePlayerActiveState} inviteSummary={rosterInviteSummaries[player.id]} inviteExpanded={expandedInvite?.teamId === model.team.id && expandedInvite.playerId === player.id} onToggleInvite={() => toggleInviteEditor(player.id)} onInviteCreated={onInviteCreated} />)}
          </div>
          {inactivePlayerWindow.hasMore ? (
            <button type="button" className="secondary-button mt-3 !min-h-9 text-xs" onClick={() => setInactivePlayerLimit(inactivePlayerWindow.nextLimit)}>
              Show {Math.min(rosterRenderLimits.inactivePlayers, inactivePlayerWindow.hiddenCount)} more inactive players
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function RosterAiChatLauncher({ teamId, teamName }: { teamId: string; teamName: string }) {
  const launchPath = buildPrivateAiLaunchPath({
    intent: 'roster-import',
    teamId,
    teamName
  });
  return (
    <div className="mt-3 overflow-hidden rounded-2xl border border-violet-100 bg-gradient-to-br from-violet-50 via-white to-primary-50 p-3 sm:p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-violet-100 text-violet-700">
            <Sparkles className="h-4 w-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-black text-gray-950">Bulk roster import</div>
            <div className="mt-1 text-xs font-semibold leading-5 text-gray-600">
              Start a private AI chat for {teamName}. Attach a CSV, image, or PDF, or paste player and family-contact details.
            </div>
            <div className="mt-2 text-[11px] font-bold text-violet-700">Editable review first · invitations send only after you reply yes</div>
          </div>
        </div>
        <Link className="primary-button !min-h-10 flex-none text-xs" to={launchPath}>
          <MessageCircle className="h-4 w-4" aria-hidden="true" />
          Start roster import
        </Link>
      </div>
    </div>
  );
}

function AddPlayerCard({ teamId, authUser, onCreated }: {
  teamId: string;
  authUser: AuthState['user'];
  onCreated: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [loadingFields, setLoadingFields] = useState(false);
  const [fieldsError, setFieldsError] = useState('');
  const [fields, setFields] = useState<TeamRosterFieldDefinition[]>([]);
  const [name, setName] = useState('');
  const [number, setNumber] = useState('');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [rosterFieldValues, setRosterFieldValues] = useState<Record<string, unknown>>({});
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<{ success: boolean; message: string } | null>(null);

  async function openForm() {
    setOpen(true);
    if (fields.length || loadingFields) return;
    setLoadingFields(true);
    setFieldsError('');
    try {
      setFields(await loadRosterFieldDefinitionsForApp(teamId, authUser || null));
    } catch (error: any) {
      setFieldsError(error?.message || 'Unable to load roster fields.');
    } finally {
      setLoadingFields(false);
    }
  }

  function resetForm() {
    setName('');
    setNumber('');
    setPhotoFile(null);
    setRosterFieldValues({});
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setStatus(null);
    try {
      const result = await addRosterPlayerForApp(teamId, authUser || null, {
        name,
        number,
        photoFile,
        rosterFieldValues
      });
      await onCreated();
      setStatus(result.photoWarning
        ? { success: false, message: result.photoWarning }
        : { success: true, message: `${name.trim() || 'Player'} added to roster.` });
      resetForm();
      setOpen(false);
    } catch (error: any) {
      setStatus({ success: false, message: error?.message || 'Unable to add player.' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-primary-100 bg-primary-50 p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-sm font-black text-gray-950">Add player</div>
          <div className="mt-1 text-xs font-semibold text-gray-600">Add a player to this team&apos;s roster.</div>
        </div>
        {!open ? (
          <button type="button" className="primary-button !min-h-10 text-xs" onClick={openForm}>
            <UserPlus className="h-4 w-4" aria-hidden="true" />
            Add player
          </button>
        ) : (
          <button type="button" className="secondary-button !min-h-10 text-xs" onClick={() => setOpen(false)} disabled={submitting}>
            Cancel
          </button>
        )}
      </div>
      {status ? <div className={`mt-3 text-xs font-black ${status.success ? 'text-emerald-700' : 'text-rose-700'}`} role="status" aria-live="polite" aria-atomic="true">{status.message}</div> : null}
      {open ? (
        <form className="mt-3 space-y-3" onSubmit={submit}>
          <label className="block">
            <span className="text-[11px] font-black uppercase tracking-[0.04em] text-primary-700">Name</span>
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="mt-2 min-h-10 w-full rounded-xl border border-primary-200 bg-white px-3 text-sm font-semibold text-gray-950 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
              placeholder="Player name"
              required
              disabled={submitting}
            />
          </label>
          <label className="block">
            <span className="text-[11px] font-black uppercase tracking-[0.04em] text-primary-700">Jersey number</span>
            <input
              type="text"
              inputMode="numeric"
              enterKeyHint="next"
              value={number}
              onChange={(event) => setNumber(event.target.value)}
              className="mt-2 min-h-10 w-full rounded-xl border border-primary-200 bg-white px-3 text-sm font-semibold text-gray-950 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
              placeholder="Optional"
              disabled={submitting}
            />
          </label>
          <label className="block">
            <span className="text-[11px] font-black uppercase tracking-[0.04em] text-primary-700">Photo</span>
            <input
              type="file"
              accept="image/*"
              className="mt-2 block w-full text-sm font-semibold text-gray-600 file:mr-4 file:rounded-xl file:border-0 file:bg-white file:px-3 file:py-2 file:text-sm file:font-black file:text-primary-700"
              onChange={(event) => setPhotoFile(event.target.files?.[0] || null)}
              disabled={submitting}
            />
            <div className="mt-1 text-[11px] font-semibold text-gray-500">Optional. Matches the legacy 5 MB image limit.</div>
          </label>
          {loadingFields ? <div className="text-xs font-semibold text-gray-500">Loading roster fields…</div> : null}
          {fieldsError ? <div className="text-xs font-black text-rose-700">{fieldsError}</div> : null}
          {fields.map((field) => <RosterFieldInput key={field.key} field={field} value={rosterFieldValues[field.key]} disabled={submitting} onChange={(value) => setRosterFieldValues((current) => ({ ...current, [field.key]: value }))} />)}
          <button type="submit" className="primary-button !min-h-10 text-xs" disabled={submitting}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
            Save player
          </button>
        </form>
      ) : null}
    </div>
  );
}

function RosterFieldInput({
  field,
  value,
  disabled,
  onChange
}: {
  field: TeamRosterFieldDefinition;
  value: unknown;
  disabled: boolean;
  onChange: (value: unknown) => void;
}) {
  if (field.type === 'checkbox') {
    return (
      <label className="flex items-start gap-3 rounded-xl border border-primary-100 bg-white px-3 py-2">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
          checked={value === true}
          onChange={(event) => onChange(event.target.checked)}
          disabled={disabled}
        />
        <span>
          <span className="block text-sm font-black text-gray-950">{field.label}</span>
          {field.description ? <span className="mt-1 block text-xs font-semibold text-gray-500">{field.description}</span> : null}
        </span>
      </label>
    );
  }

  return (
    <label className="block">
      <span className="text-[11px] font-black uppercase tracking-[0.04em] text-primary-700">{field.label}{field.required ? ' *' : ''}</span>
      {field.type === 'menu' ? (
        <select
          value={String(value ?? '')}
          onChange={(event) => onChange(event.target.value)}
          className="mt-2 min-h-10 w-full rounded-xl border border-primary-200 bg-white px-3 text-sm font-semibold text-gray-950 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
          disabled={disabled}
        >
          <option value="">Select…</option>
          {field.options.map((option) => <option key={`${field.key}-${option.value}`} value={option.value}>{option.label}</option>)}
        </select>
      ) : (
        <input
          type={field.type === 'date' ? 'date' : 'text'}
          value={String(value ?? '')}
          onChange={(event) => onChange(event.target.value)}
          className="mt-2 min-h-10 w-full rounded-xl border border-primary-200 bg-white px-3 text-sm font-semibold text-gray-950 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
          disabled={disabled}
        />
      )}
      {field.description ? <span className="mt-1 block text-[11px] font-semibold text-gray-500">{field.description}</span> : null}
    </label>
  );
}

function TrackingAdminCard({
  teamId,
  authUser,
  players,
  trackingLoading,
  trackingError,
  trackingItems,
  onTrackingChanged
}: {
  teamId: string;
  authUser: AuthState['user'];
  players: TeamDetailPlayer[];
  trackingLoading: boolean;
  trackingError: string;
  trackingItems: TeamTrackingAdminItem[];
  onTrackingChanged: () => Promise<void>;
}) {
  const [showArchived, setShowArchived] = useState(false);
  const [editingItemId, setEditingItemId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<'private' | 'public'>('private');
  const [status, setStatus] = useState<'active' | 'archived'>('active');
  const [submitting, setSubmitting] = useState(false);
  const [busyKey, setBusyKey] = useState('');
  const [statusMessage, setStatusMessage] = useState<{ success: boolean; message: string } | null>(null);
  const [expandedStatusItemIds, setExpandedStatusItemIds] = useState<Set<string>>(() => new Set());
  const [statusLimits, setStatusLimits] = useState<Record<string, number>>({});

  const visibleItems = trackingItems.filter((item) => showArchived || item.status !== 'archived');

  function resetForm() {
    setEditingItemId('');
    setName('');
    setDescription('');
    setVisibility('private');
    setStatus('active');
  }

  function beginEdit(item: TeamTrackingAdminItem) {
    setEditingItemId(item.id);
    setName(item.name);
    setDescription(item.description);
    setVisibility(item.visibility);
    setStatus(item.status);
    setStatusMessage(null);
  }

  async function submitItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setStatusMessage(null);
    try {
      await saveTeamTrackingItemForApp(teamId, authUser || null, { name, description, visibility, status }, editingItemId ? { itemId: editingItemId } : undefined);
      await onTrackingChanged();
      setStatusMessage({ success: true, message: editingItemId ? 'Tracking item updated.' : 'Tracking item created.' });
      resetForm();
    } catch (error: any) {
      setStatusMessage({ success: false, message: error?.message || 'Unable to save tracking item.' });
    } finally {
      setSubmitting(false);
    }
  }

  async function archiveItem(item: TeamTrackingAdminItem) {
    if (busyKey || !window.confirm(`Archive ${item.name || 'this item'}?`)) return;
    setBusyKey(`archive:${item.id}`);
    setStatusMessage(null);
    try {
      await archiveTeamTrackingItemForApp(teamId, authUser || null, item.id);
      await onTrackingChanged();
      setStatusMessage({ success: true, message: 'Tracking item archived.' });
      if (editingItemId === item.id) resetForm();
    } catch (error: any) {
      setStatusMessage({ success: false, message: error?.message || 'Unable to archive tracking item.' });
    } finally {
      setBusyKey('');
    }
  }

  async function togglePlayerStatus(item: TeamTrackingAdminItem, playerId: string, complete: boolean) {
    if (busyKey) return;
    const player = players.find((candidate) => candidate.id === playerId);
    if (!player) return;
    setBusyKey(`status:${item.id}:${playerId}`);
    setStatusMessage(null);
    try {
      await setPlayerTrackingStatusForApp(teamId, authUser || null, item.id, player, !complete);
      await onTrackingChanged();
      setStatusMessage({ success: true, message: `${player.name} marked ${complete ? 'open' : 'done'} for ${item.name}.` });
    } catch (error: any) {
      setStatusMessage({ success: false, message: error?.message || 'Unable to update player tracking status.' });
    } finally {
      setBusyKey('');
    }
  }

  function toggleStatusRows(itemId: string) {
    setExpandedStatusItemIds((current) => {
      const next = new Set(current);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
    setStatusLimits((current) => current[itemId] ? current : { ...current, [itemId]: rosterRenderLimits.trackingStatuses });
  }

  return (
    <div className="mt-4 rounded-xl border border-primary-100 bg-primary-50 p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-sm font-black text-gray-950">Tracking items</div>
          <div className="mt-1 text-xs font-semibold text-gray-600">Manage legacy-compatible checklist items and each active player&apos;s completion status without leaving the app.</div>
        </div>
        <label className="flex items-center gap-2 text-xs font-semibold text-gray-600">
          <input type="checkbox" className="rounded border-gray-300 text-primary-600 focus:ring-primary-500" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />
          Show archived
        </label>
      </div>
      {statusMessage ? <div className={`mt-3 text-xs font-black ${statusMessage.success ? 'text-emerald-700' : 'text-rose-700'}`} role="status" aria-live="polite" aria-atomic="true">{statusMessage.message}</div> : null}
      <form className="mt-3 space-y-3 rounded-xl border border-white/80 bg-white p-3" onSubmit={submitItem}>
        <div className="text-sm font-black text-gray-950">{editingItemId ? 'Edit tracking item' : 'Add tracking item'}</div>
        <label className="block">
          <span className="text-[11px] font-black uppercase tracking-[0.04em] text-primary-700">Name</span>
          <input type="text" value={name} onChange={(event) => setName(event.target.value)} className="mt-2 min-h-10 w-full rounded-xl border border-primary-200 bg-white px-3 text-sm font-semibold text-gray-950 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100" placeholder="Medical release form" disabled={submitting} required />
        </label>
        <label className="block">
          <span className="text-[11px] font-black uppercase tracking-[0.04em] text-primary-700">Description</span>
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} className="mt-2 min-h-24 w-full rounded-xl border border-primary-200 bg-white px-3 py-2 text-sm font-semibold text-gray-950 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100" placeholder="Optional instructions" disabled={submitting} />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-[11px] font-black uppercase tracking-[0.04em] text-primary-700">Visibility</span>
            <select value={visibility} onChange={(event) => setVisibility(event.target.value === 'public' ? 'public' : 'private')} className="mt-2 min-h-10 w-full rounded-xl border border-primary-200 bg-white px-3 text-sm font-semibold text-gray-950 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100" disabled={submitting}>
              <option value="private">Private admin-only</option>
              <option value="public">Public to team members</option>
            </select>
          </label>
          <label className="block">
            <span className="text-[11px] font-black uppercase tracking-[0.04em] text-primary-700">Status</span>
            <select value={status} onChange={(event) => setStatus(event.target.value === 'archived' ? 'archived' : 'active')} className="mt-2 min-h-10 w-full rounded-xl border border-primary-200 bg-white px-3 text-sm font-semibold text-gray-950 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100" disabled={submitting}>
              <option value="active">Active</option>
              <option value="archived">Archived</option>
            </select>
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="submit" className="primary-button !min-h-10 text-xs" disabled={submitting}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
            {editingItemId ? 'Save item' : 'Create item'}
          </button>
          {editingItemId ? <button type="button" className="secondary-button !min-h-10 text-xs" onClick={resetForm} disabled={submitting}>Reset</button> : null}
        </div>
      </form>
      {trackingLoading ? <div className="mt-3 text-xs font-semibold text-gray-500">Loading tracking items…</div> : null}
      {trackingError ? <div className="mt-3 text-xs font-black text-rose-700">{trackingError}</div> : null}
      <div className="mt-3 space-y-3">
        {visibleItems.length ? visibleItems.map((item) => {
          const itemName = item.name || 'Untitled item';
          const statusRowsExpanded = expandedStatusItemIds.has(item.id);
          const statusWindow = calculateRosterRenderWindow(item.playerStatuses.length, statusRowsExpanded ? (statusLimits[item.id] ?? rosterRenderLimits.trackingStatuses) : 0, rosterRenderLimits.trackingStatuses);
          const visibleStatuses = item.playerStatuses.slice(0, statusWindow.visibleCount);
          return (
          <div key={item.id} className="rounded-xl border border-white/80 bg-white p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="text-sm font-black text-gray-950">{itemName}</div>
                {item.description ? <div className="mt-1 text-xs font-semibold text-gray-500">{item.description}</div> : null}
                <div className="mt-2 flex flex-wrap gap-2">
                  <span className="rounded-full bg-primary-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.04em] text-primary-700">{item.visibility}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.04em] ${item.status === 'archived' ? 'bg-gray-100 text-gray-700' : 'bg-emerald-50 text-emerald-700'}`}>{item.status}</span>
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-black text-gray-700">{item.completionSummary.complete}/{item.completionSummary.total} done</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="secondary-button !min-h-8 text-xs" onClick={() => toggleStatusRows(item.id)} aria-expanded={statusRowsExpanded} aria-controls={`tracking-statuses-${item.id}`} aria-label={`${statusRowsExpanded ? 'Hide players' : `Show players (${item.playerStatuses.length})`} for ${itemName}`}>
                  {statusRowsExpanded ? 'Hide players' : `Show players (${item.playerStatuses.length})`}
                </button>
                <button type="button" className="secondary-button !min-h-8 text-xs" onClick={() => beginEdit(item)} disabled={submitting || Boolean(busyKey)}>Edit</button>
                {item.status === 'active' ? <button type="button" className="secondary-button !min-h-8 text-xs !border-rose-200 !bg-rose-50 !text-rose-700" onClick={() => void archiveItem(item)} disabled={submitting || Boolean(busyKey)}>{busyKey === `archive:${item.id}` ? 'Archiving…' : 'Archive'}</button> : null}
              </div>
            </div>
            {statusRowsExpanded ? (
              <div id={`tracking-statuses-${item.id}`} className="mt-3 grid gap-2 sm:grid-cols-2">
              {item.playerStatuses.length ? visibleStatuses.map((playerStatus) => (
                <div key={`${item.id}:${playerStatus.playerId}`} data-testid="tracking-status-row" className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                  <div className="min-w-0 flex items-center gap-3">
                    <PlayerPhoto name={playerStatus.playerName} photoUrl={playerStatus.photoUrl} small />
                    <div className="min-w-0">
                      <div className="truncate text-xs font-black text-gray-950">{playerStatus.playerNumber ? `#${playerStatus.playerNumber} ` : ''}{playerStatus.playerName}</div>
                    </div>
                  </div>
                  <button type="button" className={`secondary-button !min-h-8 text-xs ${playerStatus.complete ? '!border-emerald-200 !bg-emerald-50 !text-emerald-700' : '!border-amber-200 !bg-amber-50 !text-amber-700'}`} onClick={() => void togglePlayerStatus(item, playerStatus.playerId, playerStatus.complete)} disabled={Boolean(busyKey)}>
                    {busyKey === `status:${item.id}:${playerStatus.playerId}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
                    {playerStatus.complete ? 'Done' : 'Open'}
                  </button>
                </div>
              )) : <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-3 text-xs font-semibold text-gray-500">Add active roster players to manage statuses here.</div>}
              {statusWindow.hasMore ? (
                <button type="button" className="secondary-button !min-h-9 text-xs sm:col-span-2" onClick={() => setStatusLimits((current) => ({ ...current, [item.id]: statusWindow.nextLimit }))} aria-label={`Show ${Math.min(rosterRenderLimits.trackingStatuses, statusWindow.hiddenCount)} more statuses for ${itemName}`}>
                  Show {Math.min(rosterRenderLimits.trackingStatuses, statusWindow.hiddenCount)} more statuses
                </button>
              ) : null}
            </div>
            ) : null}
          </div>
        );
        }) : !trackingLoading ? <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm font-semibold text-gray-500">No tracking items found.</div> : null}
      </div>
    </div>
  );
}


function PlayerRow({
  teamId,
  teamName,
  authUser,
  player,
  canManageTeam = false,
  pending = false,
  onToggleActive,
  inviteSummary,
  inviteExpanded = false,
  onToggleInvite,
  onInviteCreated
}: {
  teamId: string;
  teamName: string;
  authUser: AuthState['user'];
  player: TeamDetailPlayer;
  canManageTeam?: boolean;
  pending?: boolean;
  onToggleActive?: (player: TeamDetailPlayer) => Promise<void>;
  inviteSummary?: TeamRosterParentInviteSummary;
  inviteExpanded?: boolean;
  onToggleInvite?: () => void;
  onInviteCreated: () => Promise<void>;
}) {
  const navigate = useNavigate();
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [inviteResult, setInviteResult] = useState<CreateRosterParentInviteForAppResult | null>(null);
  const [inviteStatus, setInviteStatus] = useState<{ success: boolean; message: string } | null>(null);
  const [parentEmail, setParentEmail] = useState('');
  const [parentRelation, setParentRelation] = useState('Parent');

  const effectiveStatus = inviteResult?.status || inviteSummary?.status || 'none';
  const statusLabel = effectiveStatus === 'accepted' ? 'Accepted' : effectiveStatus === 'pending' ? 'Pending invite' : 'No parent linked';
  const parentContacts = Array.isArray(player.parentContacts) ? player.parentContacts : [];
  const statusClassName = effectiveStatus === 'accepted'
    ? 'bg-emerald-50 text-emerald-700'
    : effectiveStatus === 'pending'
      ? 'bg-amber-50 text-amber-700'
      : 'bg-gray-100 text-gray-700';

  async function createInvite() {
    if (creatingInvite) return;
    setCreatingInvite(true);
    setInviteStatus(null);
    try {
      const normalizedEmail = parentEmail.trim();
      const result = normalizedEmail
        ? await createRosterParentInviteForApp(teamId, authUser || null, player, { email: normalizedEmail, relation: parentRelation })
        : await createRosterParentInviteForApp(teamId, authUser || null, player);
      setInviteResult(result);
      setInviteStatus({
        success: true,
        message: result.autoLinked
          ? `Existing parent linked automatically${result.emailSent && result.email ? ` and notified at ${result.email}` : ''}.`
          : 'Invite created.'
      });
      await onInviteCreated();
    } catch (error: any) {
      setInviteStatus({ success: false, message: error?.message || 'Unable to create a parent invite.' });
    } finally {
      setCreatingInvite(false);
    }
  }

  const playerPath = `/players/${encodeURIComponent(teamId)}/${encodeURIComponent(player.id)}`;
  const openPlayerFromRow = (target: EventTarget | null) => {
    const element = target instanceof Element ? target : null;
    if (element?.closest('a, button, input, select, textarea, label')) return;
    navigate(playerPath);
  };

  return (
    <div
      data-testid={player.active === false ? 'inactive-roster-player-row' : 'roster-player-row'}
      className="min-w-0 cursor-pointer overflow-hidden rounded-xl border border-gray-200 bg-gray-50 p-3 transition hover:border-primary-200 hover:bg-primary-50/40"
      onClick={(event) => openPlayerFromRow(event.target)}
    >
      <div className="flex min-w-0 items-center gap-3">
        <Link to={playerPath} className="flex min-w-0 flex-1 items-center gap-3 transition hover:text-primary-700">
          <PlayerPhoto name={player.name} photoUrl={player.photoUrl} />
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate text-sm font-black text-gray-950">{player.number ? `#${player.number} ` : ''}{player.name}</span>
              {player.isLinked ? <span className="rounded-full bg-primary-600 px-2 py-0.5 text-[10px] font-black text-white">Yours</span> : null}
              {!player.active ? <span className="rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-black text-gray-700">Inactive</span> : null}
            </span>
            <span className="mt-0.5 block truncate text-xs font-semibold text-gray-500">
              {canManageTeam && player.ageClassification ? `${player.ageClassification} · ` : ''}{player.position || 'Player profile'}
            </span>
          </span>
          <ChevronRight className="h-4 w-4 flex-none text-gray-300" aria-hidden="true" />
        </Link>
        {canManageTeam && onToggleActive ? (
          <button
            type="button"
            className={`inline-flex min-h-10 flex-none items-center justify-center rounded-lg px-3 text-xs font-black ${player.active ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'} disabled:cursor-not-allowed disabled:opacity-60`}
            onClick={() => void onToggleActive(player)}
            disabled={pending}
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : player.active ? 'Deactivate' : 'Reactivate'}
          </button>
        ) : null}
      </div>
      {canManageTeam && parentContacts.length > 0 ? (
        <div className="mt-3 space-y-1 rounded-lg border border-white/80 bg-white px-3 py-2">
          {parentContacts.map((contact, index) => {
            const label = contact.name || contact.email || contact.phone || 'Family contact';
            const relation = contact.relation || 'Parent';
            const key = contact.userId || contact.email || contact.phone || `${player.id}-contact-${index}`;
            return (
              <div key={key} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                <span className="font-black text-gray-900">{label}</span>
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.04em] text-gray-600">{relation}</span>
                {contact.email ? <a className="font-semibold text-primary-700" href={`mailto:${contact.email}`}>{contact.email}</a> : null}
                {contact.phone ? <a className="font-semibold text-primary-700" href={`tel:${contact.phone}`}>{contact.phone}</a> : null}
              </div>
            );
          })}
        </div>
      ) : null}
      {canManageTeam ? (
        <div className="mt-3 min-w-0 overflow-hidden rounded-lg border border-white/80 bg-white p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.04em] ${statusClassName}`}>{statusLabel}</span>
            {player.active ? (
              <button type="button" className="secondary-button !min-h-11 text-xs" disabled={creatingInvite} onClick={onToggleInvite} aria-expanded={inviteExpanded} aria-controls={`parent-invite-editor-${player.id}`}>
                <LinkIcon className="h-3.5 w-3.5" aria-hidden="true" />
                {inviteExpanded ? 'Close invite' : 'Manage invite'}
              </button>
            ) : null}
          </div>
          {player.active && inviteExpanded ? (
            <div id={`parent-invite-editor-${player.id}`} data-testid="parent-invite-editor" className="mt-3 min-w-0 space-y-3">
              <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_10rem]">
              <label className="min-w-0 text-xs font-black text-gray-700">
                Recipient email
                <input
                  className="auth-input mt-1 min-w-0 max-w-full"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  aria-label={`Recipient email for ${player.name}`}
                  placeholder="parent@example.com"
                  value={parentEmail}
                  onChange={(event) => setParentEmail(event.target.value)}
                  disabled={creatingInvite}
                />
              </label>
              <label className="min-w-0 text-xs font-black text-gray-700">
                Relation
                <select className="auth-input mt-1 min-w-0 max-w-full" aria-label={`Parent relation for ${player.name}`} value={parentRelation} onChange={(event) => setParentRelation(event.target.value)} disabled={creatingInvite}>
                  <option value="Parent">Parent</option>
                  <option value="Mother">Mother</option>
                  <option value="Father">Father</option>
                  <option value="Guardian">Guardian</option>
                  <option value="Other">Other</option>
                </select>
              </label>
              <div className="text-[11px] font-semibold text-gray-500 sm:col-span-2">Enter an email to send the invite, or leave it blank for a shareable link and code.</div>
              </div>
              <button type="button" className="primary-button !min-h-11 w-full text-xs sm:w-auto" disabled={creatingInvite} onClick={createInvite}>
                {creatingInvite ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <LinkIcon className="h-3.5 w-3.5" aria-hidden="true" />}
                {creatingInvite ? 'Creating invite...' : 'Create invite'}
              </button>
              {inviteResult ? (
                <InviteResultCard
                  code={inviteResult.code}
                  inviteUrl={inviteResult.inviteUrl}
                  recipientEmail={inviteResult.email}
                  emailSent={inviteResult.emailSent}
                  title="Invite code"
                  shareTitle={`${player.name} parent invite`}
                  shareText={`Join ${teamName} on ALL PLAYS for ${player.name}.`}
                  onStatus={(message) => setInviteStatus({ success: !message.startsWith('Unable'), message })}
                />
              ) : null}
              {inviteStatus ? <div className={`text-xs font-black ${inviteStatus.success ? 'text-emerald-700' : 'text-rose-700'}`} role="status">{inviteStatus.message}</div> : null}
            </div>
          ) : null}
          {inviteSummary?.status === 'accepted' && inviteSummary.acceptedParentCount > 0 ? <div className="mt-2 text-xs font-semibold text-emerald-700">{inviteSummary.acceptedParentCount} linked parent{inviteSummary.acceptedParentCount === 1 ? '' : 's'}.</div> : null}
          {inviteSummary?.status === 'pending' && inviteSummary.pendingInviteCount > 0 && !inviteResult ? <div className="mt-2 text-xs font-semibold text-amber-700">{inviteSummary.pendingInviteCount} pending invite{inviteSummary.pendingInviteCount === 1 ? '' : 's'}.</div> : null}
          {!player.active ? <div className="mt-2 text-xs font-semibold text-gray-500">Reactivate the player to send a parent invite.</div> : null}
        </div>
      ) : null}
    </div>
  );
}


function PlayerPhoto({ name, photoUrl, small = false }: { name: string; photoUrl?: string | null; small?: boolean }) {
  const sizeClass = small ? 'h-8 w-8 text-[10px]' : 'h-11 w-11 text-xs';
  if (photoUrl) {
    return (
      <AvatarImage
        src={photoUrl}
        alt={`${name} player photo`}
        loading="lazy"
        className={`${sizeClass} flex-none rounded-full object-cover ring-1 ring-gray-200`}
        fallback={(
          <span className={`${sizeClass} flex flex-none items-center justify-center rounded-full bg-gray-900 font-black text-white`}>
            {getInitials(name)}
          </span>
        )}
      />
    );
  }
  return (
    <span className={`${sizeClass} flex flex-none items-center justify-center rounded-full bg-gray-900 font-black text-white`}>
      {getInitials(name)}
    </span>
  );
}


function getInitials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'AP';
}
