import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { AuthState } from '../lib/types';
import {
  loadResourcePacketStaff,
  packetDueDate,
  resourcePacketCommand,
  resourcePacketsAvailable,
  type PacketAssignment,
  type PacketResource,
  type PacketStaffView
} from '../lib/resourcePacketsService';
import { loadTeamDrillLibraryPage, type TeamDrillSummary } from '../lib/teamDrillsService';
import { assignmentAiPath, assignmentProgress, videoPreview } from '../lib/resourceAssignmentPresentation';
import { Modal } from '../components/Modal';
import { VideoCard } from '../components/assignments/VideoCard';

const field = 'mt-1 block min-h-12 w-full rounded-xl border border-gray-300 p-3';
const primary = 'min-h-12 rounded-xl bg-emerald-800 px-5 py-3 font-bold text-white disabled:opacity-50';
const secondary = 'min-h-12 rounded-xl border border-gray-300 px-4 py-3 font-semibold';
type EditableItem = PacketResource;
const blankItem = (): EditableItem => ({ resourceId: crypto.randomUUID(), version: 0, title: '', url: '', teachingPoint: '' });

export function ResourcePackets({ auth }: { auth: AuthState }) {
  const { teamId = '' } = useParams();
  return <AssignmentWorkspace key={`${auth.user?.uid}:${teamId}`} auth={auth} teamId={teamId} />;
}
function AssignmentWorkspace({ auth, teamId }: { auth: AuthState; teamId: string }) {
  const [data, setData] = useState<PacketStaffView | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [editing, setEditing] = useState(false);
  const [assignmentId, setAssignmentId] = useState('');
  const [revision, setRevision] = useState(0);
  const [items, setItems] = useState<EditableItem[]>([]);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [players, setPlayers] = useState<string[]>([]);
  const [due, setDue] = useState('');
  const [practiceId, setPracticeId] = useState('');
  const originalItems = useRef(new Map<string, EditableItem>());
  const resourceCache = useRef(new Map<string, PacketResource>());
  const [pendingPublication, setPendingPublication] = useState<Record<string, unknown> | null>(null);
  const [notify, setNotify] = useState(true);
  const [preview, setPreview] = useState(false);
  const [search, setSearch] = useState('');
  const [drills, setDrills] = useState<TeamDrillSummary[]>([]);
  const progressRef = useRef<HTMLElement>(null);
  const [selected, setSelected] = useState('');
  const [filter, setFilter] = useState('all');
  const uid = auth.user?.uid;
  useEffect(() => {
    if (selected) {
      progressRef.current?.focus();
      progressRef.current?.scrollIntoView?.({ block: 'start' });
    }
  }, [selected]);
  useEffect(() => {
    if (!uid || !resourcePacketsAvailable()) return;
    let cancelled = false;
    setError('');
    void (async () => {
      const view = await loadResourcePacketStaff(teamId);
      // Counts and whole-team selection must never use a truncated roster/task page.
      for (let page = 0; Object.values(view.cursors).some(Boolean); page++) {
        if (page >= 100) throw new Error('Too many assignments to load safely. Please contact support.');
        const next = await loadResourcePacketStaff(teamId, view.cursors);
        for (const key of ['resources', 'assignments', 'tasks', 'players', 'practices', 'deliveries'] as const) {
          (view[key] as unknown[]).push(...next[key]);
        }
        view.cursors = next.cursors;
      }
      if (!cancelled) setData(view);
    })().catch((cause) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : 'Unable to load assignments.');
    });
    return () => {
      cancelled = true;
    };
  }, [uid, teamId, refresh]);
  function start(row?: PacketAssignment) {
    const nextItems = row ? row.items.map((item) => ({ ...item, version: item.resourceVersion })) : [blankItem()];
    originalItems.current = new Map(nextItems.map((item) => [item.resourceId, item]));
    setAssignmentId(row?.assignmentId || crypto.randomUUID());
    setRevision(row?.revision || 0);
    setTitle(row?.title || '');
    setNotes(row?.notes || '');
    setItems(nextItems);
    setPlayers(row?.playerIds || data!.players.map((player) => player.id));
    const date = row?.dueAt ? new Date(row.dueAt) : null;
    setDue(date ? new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');
    setPracticeId(row?.practiceId || '');
    setNotify(!row?.publishedVersion);
    setEditing(true);
    setPreview(false);
    setError('');
  }
  function updateItem(index: number, value: Partial<EditableItem>) {
    setItems((old) => old.map((item, i) => (i === index ? { ...item, ...value } : item)));
  }
  async function send(event: FormEvent) {
    event.preventDefault();
    if (!uid || !data) return;
    setBusy(true);
    setError('');
    setStatus('');
    try {
      if (pendingPublication) {
        await resourcePacketCommand(uid, pendingPublication);
        setPendingPublication(null);
        setEditing(false);
        setSelected(assignmentId);
        setRefresh((value) => value + 1);
        setStatus('Assignment shared. Notification intent was preserved.');
        return;
      }
      const dueAt = packetDueDate(due);
      const saved = [...items];
      for (let i = 0; i < saved.length; i++) {
        const item = saved[i];
        const existing =
          resourceCache.current.get(item.resourceId) || data.resources.find((resource) => resource.resourceId === item.resourceId);
        const original = originalItems.current.get(item.resourceId);
        if (original && original.title === item.title && original.url === item.url && original.teachingPoint === item.teachingPoint)
          continue;
        if (existing && existing.title === item.title && existing.url === item.url && existing.teachingPoint === item.teachingPoint) {
          saved[i] = existing;
          continue;
        }
        // Revision checks prevent overwriting a newer resource edit.
        saved[i] = (await resourcePacketCommand(uid, {
          teamId,
          action: 'saveResource',
          resourceId: item.resourceId,
          expectedRevision: item.version,
          title: item.title,
          url: item.url,
          teachingPoint: item.teachingPoint,
          ...(item.drillId ? { drillId: item.drillId } : {})
        })) as PacketResource;
        resourceCache.current.set(saved[i].resourceId, saved[i]);
        setItems([...saved]);
      }
      const draft = (await resourcePacketCommand(uid, {
        teamId,
        action: 'saveDraft',
        assignmentId,
        expectedRevision: revision,
        title: title.trim() || saved[0].title,
        notes,
        resourceIds: saved.map((item) => item.resourceId),
        resourceVersions: saved.map((item) => item.version),
        playerIds: players,
        practiceId: practiceId || null,
        dueAt,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
      })) as PacketAssignment;
      setRevision(draft.revision);
      const publication = { teamId, action: 'publish', assignmentId, expectedRevision: draft.revision, confirm: true, notify };
      setPendingPublication(publication);
      const result = (await resourcePacketCommand(uid, publication)) as { revision: number };
      setPendingPublication(null);
      setRevision(result.revision);
      setEditing(false);
      setSelected(assignmentId);
      setRefresh((value) => value + 1);
      setStatus(notify ? 'Assignment shared. Notifications follow family preferences.' : 'Assignment shared without notifications.');
    } catch (cause) {
      // Definitive callable rejections did not commit. Unlock editing; ambiguous
      // transport failures keep the exact publication frozen for idempotent retry.
      const wrapped = cause as { code?: string; cause?: { code?: string } };
      const code = wrapped?.cause?.code || wrapped?.code;
      if (
        ['functions/aborted', 'functions/failed-precondition', 'functions/permission-denied', 'functions/invalid-argument'].includes(
          code || ''
        )
      ) {
        setPendingPublication(null);
        setRefresh((value) => value + 1);
      }
      setError(cause instanceof Error ? cause.message : 'Unable to share. Your work is still here; retry when ready.');
    } finally {
      setBusy(false);
    }
  }
  if (!resourcePacketsAvailable()) return <main className="p-4">Assignments are not available in this app.</main>;
  const current = data?.assignments.find((row) => row.assignmentId === selected);
  const tasks = data?.tasks.filter((task) => task.assignmentId === selected) || [];
  return (
    <main className="mx-auto max-w-4xl space-y-6 p-4 pb-28">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link className="text-sm text-emerald-800 underline" to={`/teams/${teamId}`}>
            {data?.teamName || 'Back to team'}
          </Link>
          <h1 className="mt-2 text-2xl font-bold">Video assignments</h1>
          <p className="mt-1 text-gray-600">Share something useful. See who has opened it.</p>
        </div>
        {data && !editing && (
          <button className={primary} onClick={() => start()}>
            Share a video
          </button>
        )}
      </header>
      {error && (
        <div role="alert" className="rounded-xl bg-red-50 p-4 text-red-900">
          {error}{' '}
          <button className="min-h-12 underline" onClick={() => setRefresh((value) => value + 1)}>
            Reload assignments
          </button>
        </div>
      )}
      {status && (
        <p role="status" className="rounded-xl bg-emerald-50 p-4">
          {status}
        </p>
      )}
      {!data && !error && <p role="status">Loading assignments and progress…</p>}
      {data && editing ? (
        <form onSubmit={(event) => void send(event)} className="space-y-5 rounded-2xl border bg-white p-4 sm:p-6">
          <fieldset disabled={busy || Boolean(pendingPublication)} className="space-y-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-xl font-bold">{revision ? 'Edit assignment' : 'Share a video'}</h2>
              <button type="button" disabled={busy} className={secondary} onClick={() => setEditing(false)}>
                Cancel
              </button>
            </div>
            <p className="text-sm text-gray-600">Opening each video completes it. Playback is not verified.</p>
            {items.map((item, index) => (
              <section key={item.resourceId} className="space-y-3" aria-label={`Video ${index + 1}`}>
                <label className="block font-semibold">
                  Video link {index + 1}
                  <input
                    autoFocus={index === 0}
                    className={field}
                    required
                    type="url"
                    maxLength={2048}
                    placeholder="Paste an HTTPS video link"
                    value={item.url}
                    disabled={busy}
                    onChange={(event) => updateItem(index, { url: event.target.value })}
                  />
                </label>
                <label className="block font-semibold">
                  Video title {index + 1}
                  <input
                    className={field}
                    required
                    maxLength={160}
                    value={item.title}
                    disabled={busy}
                    placeholder="What is this video about?"
                    onChange={(event) => updateItem(index, { title: event.target.value })}
                  />
                </label>
                {videoPreview(item.url) && (
                  <VideoCard url={item.url} title={item.title} note={item.teachingPoint}>
                    <a
                      className="inline-flex min-h-12 items-center font-semibold text-emerald-800 underline"
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Preview video ↗
                    </a>
                  </VideoCard>
                )}
                {items.length > 1 && (
                  <button
                    type="button"
                    disabled={busy}
                    className="min-h-12 text-red-800 underline"
                    onClick={() => setItems(items.filter((_, i) => i !== index))}
                  >
                    Remove video {index + 1}
                  </button>
                )}
              </section>
            ))}
            <div className="flex flex-wrap gap-3">
              <button
                className={secondary}
                type="button"
                disabled={busy || items.length >= 12}
                onClick={() => setItems([...items, blankItem()])}
              >
                Add another video
              </button>
              <Link
                className={secondary}
                to={assignmentAiPath(
                  teamId,
                  `Help prepare a video assignment for team ${teamId}. ${items[0]?.url ? `The coach supplied this URL: ${items[0].url}.` : ''} Ask what players should focus on. Use only authorized library notes; do not claim to know video content. Prepare an editable assignment for explicit confirmation.`
                )}
              >
                Help me with AI
              </Link>
            </div>
            <details className="rounded-xl border p-3">
              <summary className="cursor-pointer py-2 font-semibold">Choose from our library</summary>
              <div className="space-y-3 pt-3">
                {data.resources.map((resource) => (
                  <button
                    className={secondary}
                    type="button"
                    key={resource.resourceId}
                    disabled={busy || items.some((item) => item.resourceId === resource.resourceId)}
                    onClick={(event) => {
                      event.currentTarget.closest('details')?.removeAttribute('open');
                      setItems(items.length === 1 && !items[0].url ? [resource] : [...items, resource].slice(0, 12));
                    }}
                  >
                    {resource.title}
                  </button>
                ))}
                <label className="block">
                  Find a drill
                  <input className={field} value={search} onChange={(event) => setSearch(event.target.value)} />
                </label>
                <button
                  type="button"
                  className={secondary}
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    void loadTeamDrillLibraryPage(teamId, auth.user, { searchText: search })
                      .then((page) => setDrills(page.drills))
                      .catch((cause) => setError(String(cause)))
                      .finally(() => setBusy(false));
                  }}
                >
                  Search library
                </button>
                {drills.map((drill) => (
                  <button
                    key={drill.id}
                    type="button"
                    className={secondary}
                    disabled={!drill.youtubeUrl || busy}
                    onClick={(event) => {
                      event.currentTarget.closest('details')?.removeAttribute('open');
                      const item = {
                        ...blankItem(),
                        title: drill.title,
                        url: drill.youtubeUrl || '',
                        teachingPoint: drill.description || '',
                        drillId: drill.id
                      };
                      setItems(items.length === 1 && !items[0].url ? [item] : [...items, item].slice(0, 12));
                    }}
                  >
                    Use {drill.title}
                  </button>
                ))}
              </div>
            </details>
            <label className="block font-semibold">
              Coaching note (optional)
              <textarea
                className={field}
                maxLength={2000}
                placeholder="What should players focus on?"
                value={notes}
                disabled={busy}
                onChange={(event) => setNotes(event.target.value)}
              />
            </label>
            <div className="flex flex-wrap items-start gap-2">
              <details className="rounded-xl border p-3">
                <summary className="cursor-pointer font-semibold">
                  {players.length === data.players.length ? 'Whole team' : `${players.length} player${players.length === 1 ? '' : 's'}`}
                </summary>
                <button type="button" className="min-h-12 underline" onClick={() => setPlayers(data.players.map((player) => player.id))}>
                  Select whole team
                </button>
                {data.players.map((player) => (
                  <label key={player.id} className="flex min-h-12 items-center gap-3">
                    <input
                      type="checkbox"
                      disabled={busy}
                      checked={players.includes(player.id)}
                      onChange={() =>
                        setPlayers(players.includes(player.id) ? players.filter((id) => id !== player.id) : [...players, player.id])
                      }
                    />
                    {player.name}
                  </label>
                ))}
              </details>
              <details className="rounded-xl border p-3">
                <summary className="cursor-pointer font-semibold">{due ? 'Due date set' : 'No due date'}</summary>
                <label className="block pt-3">
                  Due date ({Intl.DateTimeFormat().resolvedOptions().timeZone})
                  <input
                    className={field}
                    type="datetime-local"
                    value={due}
                    disabled={busy}
                    onChange={(event) => setDue(event.target.value)}
                  />
                </label>
              </details>
              <label className="flex min-h-12 items-center gap-3 rounded-xl border p-3">
                <input type="checkbox" checked={notify} disabled={busy} onChange={(event) => setNotify(event.target.checked)} />
                Notify families
              </label>
            </div>
            <details className="rounded-xl border p-3">
              <summary className="cursor-pointer py-2 font-semibold">More options</summary>
              <label className="block">
                Assignment title
                <input
                  className={field}
                  value={title}
                  maxLength={160}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder={items[0]?.title}
                />
              </label>
              <label className="mt-3 block">
                Linked practice
                <select className={field} value={practiceId} onChange={(event) => setPracticeId(event.target.value)}>
                  <option value="">No linked practice</option>
                  {data.practices.map((practice) => (
                    <option key={practice.id} value={practice.id}>
                      {practice.title}
                    </option>
                  ))}
                </select>
              </label>
            </details>
            <button className={secondary} type="button" onClick={() => setPreview(!preview)}>
              {preview ? 'Hide family preview' : 'Preview family view'}
            </button>
            {preview && (
              <Modal ariaLabel="Family preview" onClose={() => setPreview(false)}>
                <section
                  aria-label="Family preview"
                  className="max-h-[85vh] w-full max-w-md space-y-4 overflow-y-auto rounded-2xl bg-emerald-50 p-4"
                >
                  <button type="button" className={secondary} onClick={() => setPreview(false)}>
                    Close preview
                  </button>
                  <h2 className="text-xl font-bold">{title || items[0]?.title || 'Your assignment'}</h2>
                  <p>{notes}</p>
                  {items.map((item) => (
                    <VideoCard key={item.resourceId} url={item.url} title={item.title} note={item.teachingPoint}>
                      <span className={primary}>Watch</span>
                    </VideoCard>
                  ))}
                  <p className="text-sm">Opening the video completes the item. This preview never records completion.</p>
                </section>
              </Modal>
            )}
            {revision > 0 && (
              <p className="text-sm text-gray-600">
                Text changes keep progress. Replaced or added videos need a new open; unchanged videos stay complete.
              </p>
            )}
          </fieldset>
          {pendingPublication && (
            <p role="status">
              Publication needs confirmation from the server. Retry the same assignment before editing; it will not send twice.
            </p>
          )}
          <div className="sticky bottom-20 space-y-2 rounded-xl border bg-white p-4 shadow-lg">
            <p className="text-sm">
              {items.length} video{items.length === 1 ? '' : 's'} · {players.length} player{players.length === 1 ? '' : 's'} ·{' '}
              {notify ? 'Notify eligible families using their preferences' : 'No notifications'}
            </p>
            <button className={`${primary} w-full`} disabled={busy || !players.length} type="submit">
              {busy ? 'Sharing…' : notify ? 'Assign & notify' : 'Assign without notifying'}
            </button>
          </div>
        </form>
      ) : (
        data && (
          <section className="space-y-4" aria-labelledby="assignments-heading">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="assignments-heading" className="text-xl font-bold">
                Assignments
              </h2>
              <Link
                className={secondary}
                to={assignmentAiPath(
                  teamId,
                  `Read all authorized resource assignment progress for team ${teamId}, including all pages. Summarize outstanding players and notification issues. Link opened means completion, not verified playback. Do not send anything.`
                )}
              >
                Summarize with AI
              </Link>
            </div>
            {!data.assignments.length && (
              <div className="rounded-2xl bg-emerald-50 p-6">
                <h3 className="font-bold">Give your team one thing to focus on</h3>
                <p className="mt-2">Share a video or choose a drill. Families open it; you see progress here.</p>
              </div>
            )}
            {data.assignments.map((row) => {
              const assigned = data.tasks.filter((task) => task.assignmentId === row.assignmentId);
              const complete = assigned.filter((task) => assignmentProgress(task).complete).length;
              return (
                <article key={row.assignmentId} className="space-y-3 rounded-2xl border bg-white p-5">
                  <h3 className="text-lg font-bold">{row.title}</h3>
                  <p>{row.publishedVersion ? `${complete} of ${assigned.length} complete` : 'Draft — not shared'}</p>
                  <p className="text-sm text-gray-600">
                    {row.items.length} video{row.items.length === 1 ? '' : 's'}
                    {row.dueAt ? ` · Due ${new Date(row.dueAt).toLocaleDateString()}` : ''}
                  </p>
                  <div className="flex flex-wrap gap-3">
                    <button
                      className={secondary}
                      onClick={() => {
                        setSelected(row.assignmentId);
                        setFilter('all');
                      }}
                    >
                      View progress
                    </button>
                    <button className={secondary} onClick={() => start(row)}>
                      Edit assignment
                    </button>
                  </div>
                </article>
              );
            })}
            {current && (
              <section
                className="space-y-4 rounded-2xl border border-emerald-700 bg-white p-5"
                aria-label="Assignment progress"
                ref={progressRef}
                tabIndex={-1}
              >
                <h2 className="text-xl font-bold">Progress: {current.title}</h2>
                <p className="text-sm text-gray-600">Complete means every video link was opened. Playback is not verified.</p>
                <div className="flex flex-wrap items-start gap-2">
                  {['all', 'outstanding', 'complete'].map((value) => (
                    <button key={value} className={secondary} aria-pressed={filter === value} onClick={() => setFilter(value)}>
                      {value === 'all' ? 'All players' : value === 'outstanding' ? 'Outstanding' : 'Complete'} (
                      {tasks.filter((task) => value === 'all' || assignmentProgress(task).complete === (value === 'complete')).length})
                    </button>
                  ))}
                </div>
                <ul className="divide-y">
                  {tasks
                    .filter((task) => filter === 'all' || assignmentProgress(task).complete === (filter === 'complete'))
                    .map((task) => {
                      const progress = assignmentProgress(task);
                      return (
                        <li key={task.playerId} className="py-4">
                          <strong>{task.playerName}</strong>
                          <p>{progress.complete ? 'Complete — video opened' : `${progress.opened} of ${progress.total} opened`}</p>
                        </li>
                      );
                    })}
                </ul>
                <details>
                  <summary className="min-h-12 cursor-pointer py-3 font-semibold">Notification status</summary>
                  {data.deliveries
                    .filter((delivery) => delivery.assignmentId === current.assignmentId)
                    .map((delivery) => (
                      <p key={delivery.version}>
                        Publication {delivery.version}: {delivery.state}. This is not proof of reading.
                      </p>
                    ))}
                </details>
                <Link
                  className={secondary}
                  to={assignmentAiPath(
                    teamId,
                    `Read current authorized progress for assignment ${current.assignmentId} in team ${teamId}. Draft a short reminder for outstanding players' guardians; show the exact eligible audience and text for approval. Do not send without explicit confirmation.`
                  )}
                >
                  Draft a reminder with AI
                </Link>
              </section>
            )}
          </section>
        )
      )}
    </main>
  );
}
