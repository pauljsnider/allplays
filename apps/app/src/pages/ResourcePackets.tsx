import { useEffect, useState, type FormEvent } from 'react';
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

const field = 'mt-1 block min-h-11 w-full rounded-lg border border-gray-300 p-2';
const button = 'min-h-11 rounded-lg bg-emerald-800 px-4 py-2 font-semibold text-white disabled:opacity-50';
const toggle = (values: string[], id: string) => (values.includes(id) ? values.filter((value) => value !== id) : [...values, id]);

export function ResourcePackets({ auth }: { auth: AuthState }) {
  const { teamId = '' } = useParams();
  return <ResourcePacketsContent key={`${auth.user?.uid}:${teamId}`} auth={auth} />;
}

function ResourcePacketsContent({ auth }: { auth: AuthState }) {
  const { teamId = '' } = useParams();
  const [data, setData] = useState<PacketStaffView | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [resource, setResource] = useState<Partial<PacketResource>>({});
  const [newDraftId, setNewDraftId] = useState(() => crypto.randomUUID());
  const [draft, setDraft] = useState<PacketAssignment | null>(null);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [resourceIds, setResourceIds] = useState<string[]>([]);
  const [playerIds, setPlayerIds] = useState<string[]>([]);
  const [practiceId, setPracticeId] = useState('');
  const [dueLocal, setDueLocal] = useState('');
  const [review, setReview] = useState<PacketAssignment | null>(null);
  const [notify, setNotify] = useState(false);
  const [search, setSearch] = useState('');
  const [drills, setDrills] = useState<TeamDrillSummary[]>([]);
  const enabled = resourcePacketsAvailable();
  const uid = auth.user?.uid;
  useEffect(() => {
    if (!enabled || !uid) return;
    let cancelled = false;
    setData(null);
    setError('');
    void loadResourcePacketStaff(teamId)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Unable to load packets.');
      });
    return () => {
      cancelled = true;
    };
  }, [teamId, uid, enabled, reload]);
  async function run(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError('');
    setStatus('');
    try {
      await action();
      setStatus(message);
      setReview(null);
      setReload((value) => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save. Retry your change.');
    } finally {
      setBusy(false);
    }
  }
  function editDraft(row: PacketAssignment | null) {
    setNewDraftId(crypto.randomUUID());
    setDraft(row);
    setTitle(row?.title || '');
    setNotes(row?.notes || '');
    setResourceIds(row?.items.map((item) => item.resourceId) || []);
    setPlayerIds(row?.playerIds || []);
    setPracticeId(row?.practiceId || '');
    const date = row?.dueAt ? new Date(row.dueAt) : null;
    setDueLocal(date ? new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');
  }
  function saveResource(event: FormEvent) {
    event.preventDefault();
    const resourceId = resource.resourceId || crypto.randomUUID();
    setResource((value) => ({ ...value, resourceId }));
    void run(async () => {
      await resourcePacketCommand(auth.user!.uid, {
        teamId,
        action: 'saveResource',
        resourceId,
        expectedRevision: resource.version || 0,
        title: resource.title || '',
        teachingPoint: resource.teachingPoint || '',
        url: resource.url || '',
        ...(resource.drillId ? { drillId: resource.drillId } : {})
      });
      setResource({});
    }, 'Resource saved. Existing published packets keep their original resource version.');
  }
  function saveDraft(event: FormEvent) {
    event.preventDefault();
    const assignmentId = draft?.assignmentId || newDraftId;
    const revision = draft?.revision || 0;
    void run(async () => {
      const next = (await resourcePacketCommand(auth.user!.uid, {
        teamId,
        action: 'saveDraft',
        assignmentId,
        expectedRevision: revision,
        title,
        notes,
        resourceIds,
        playerIds,
        practiceId: practiceId || null,
        dueAt: packetDueDate(dueLocal),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
      })) as PacketAssignment;
      setDraft(next);
    }, 'Draft saved. Families will see it only after you publish.');
  }
  if (!enabled)
    return (
      <main className="p-6">
        <h1 className="text-xl font-bold">Resource packets are not available in this app.</h1>
        <Link to="/schedule">Return to Schedule</Link>
      </main>
    );
  return (
    <main className="mx-auto max-w-5xl space-y-6 p-4 pb-24">
      <Link className="inline-block py-3 text-emerald-800 underline" to={`/teams/${encodeURIComponent(teamId)}/drills`}>
        Back to drill library
      </Link>
      <header>
        <h1 className="text-2xl font-bold">Resources and practice packets</h1>
        <p className="mt-2 text-gray-600">
          Save a teaching resource, build a packet, then review and publish it to families. Progress is private to staff and the relevant
          family.
        </p>
      </header>
      {error && (
        <div role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">
          {error}{' '}
          <button type="button" className="min-h-11 underline" onClick={() => setReload((value) => value + 1)}>
            Reload
          </button>
        </div>
      )}
      {status && (
        <p role="status" className="rounded-xl bg-emerald-50 p-4">
          {status}
        </p>
      )}
      {!data && !error && <p role="status">Loading resources…</p>}
      {data && (
        <>
          {Object.values(data.cursors).some(Boolean) && (
            <div className="rounded-xl border p-4">
              <p>More resources, roster entries, packets or progress are available. Load all pages before selecting the entire roster.</p>
              <button
                type="button"
                className="min-h-11 underline"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void loadResourcePacketStaff(teamId, data.cursors)
                    .then((page) =>
                      setData({
                        cursors: page.cursors,
                        resources: [...data.resources, ...page.resources],
                        assignments: [...data.assignments, ...page.assignments],
                        tasks: [...data.tasks, ...page.tasks],
                        players: [...data.players, ...page.players],
                        practices: [...data.practices, ...page.practices],
                        deliveries: [...data.deliveries, ...page.deliveries]
                      })
                    )
                    .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Unable to load more.'))
                    .finally(() => setBusy(false));
                }}
              >
                Load more records
              </button>
            </div>
          )}

          <section className="space-y-4 rounded-xl border bg-white p-4">
            <h2 className="text-lg font-bold">1. Reusable resources</h2>
            <form onSubmit={saveResource} className="space-y-3">
              <label className="block">
                Title
                <input
                  className={field}
                  required
                  maxLength={160}
                  value={resource.title || ''}
                  onChange={(event) => setResource({ ...resource, title: event.target.value })}
                />
              </label>
              <label className="block">
                External HTTPS link
                <input
                  className={field}
                  type="url"
                  required
                  maxLength={2048}
                  value={resource.url || ''}
                  onChange={(event) => setResource({ ...resource, url: event.target.value })}
                />
              </label>
              <label className="block">
                Teaching point
                <textarea
                  className={field}
                  required
                  maxLength={2000}
                  value={resource.teachingPoint || ''}
                  onChange={(event) => setResource({ ...resource, teachingPoint: event.target.value })}
                />
              </label>
              <button className={button} disabled={busy} type="submit">
                {resource.version ? 'Save resource revision' : 'Save resource'}
              </button>
              <button className="ml-4 min-h-11 underline" type="button" onClick={() => setResource({})}>
                Clear resource editor
              </button>
            </form>
            <div className="flex flex-wrap gap-2">
              {data.resources.map((row) => (
                <button
                  key={row.resourceId}
                  className="min-h-11 rounded-lg border px-3 text-left"
                  type="button"
                  onClick={() => setResource(row)}
                >
                  Edit {row.title} · v{row.version}
                </button>
              ))}
            </div>
            <form
              className="border-t pt-4"
              onSubmit={(event) => {
                event.preventDefault();
                setBusy(true);
                setError('');
                void loadTeamDrillLibraryPage(teamId, auth.user, { searchText: search })
                  .then((page) => setDrills(page.drills))
                  .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Library search failed.'))
                  .finally(() => setBusy(false));
              }}
            >
              <label className="block">
                Find an existing library drill
                <input className={field} value={search} onChange={(event) => setSearch(event.target.value)} />
              </label>
              <button className="min-h-11 py-2 text-emerald-800 underline" disabled={busy} type="submit">
                Search drill library
              </button>
              {drills.map((drill) => (
                <div key={drill.id} className="py-2">
                  <button
                    disabled={!drill.youtubeUrl}
                    type="button"
                    className="min-h-11 text-left underline disabled:text-gray-400"
                    onClick={() =>
                      setResource({
                        title: drill.title,
                        url: drill.youtubeUrl || '',
                        teachingPoint: drill.description || '',
                        drillId: drill.id
                      })
                    }
                  >
                    Use {drill.title}
                    {!drill.youtubeUrl ? ' (no external link)' : ''}
                  </button>
                </div>
              ))}
            </form>
          </section>
          <section className="space-y-4 rounded-xl border bg-white p-4">
            <h2 className="text-lg font-bold">2. Build a packet</h2>
            <button type="button" className="min-h-11 underline" onClick={() => editDraft(null)}>
              Start a new packet
            </button>
            <form onSubmit={saveDraft} className="space-y-4">
              <label className="block">
                Packet title
                <input className={field} required maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} />
              </label>
              <label className="block">
                Notes for families
                <textarea className={field} maxLength={2000} value={notes} onChange={(event) => setNotes(event.target.value)} />
              </label>
              <fieldset>
                <legend className="font-semibold">Resources (choose 1–12)</legend>
                {data.resources.map((row) => (
                  <label key={row.resourceId} className="flex min-h-11 items-center gap-2">
                    <input
                      type="checkbox"
                      checked={resourceIds.includes(row.resourceId)}
                      onChange={() => setResourceIds(toggle(resourceIds, row.resourceId))}
                    />
                    {row.title} · v{row.version}
                  </label>
                ))}
              </fieldset>
              <fieldset>
                <legend className="font-semibold">Assigned players</legend>
                <button
                  className="min-h-11 underline"
                  type="button"
                  disabled={Boolean(data.cursors.players)}
                  onClick={() => setPlayerIds(data.players.map((player) => player.id))}
                >
                  Select current team roster
                </button>
                {data.players.map((player) => (
                  <label key={player.id} className="flex min-h-11 items-center gap-2">
                    <input
                      type="checkbox"
                      checked={playerIds.includes(player.id)}
                      onChange={() => setPlayerIds(toggle(playerIds, player.id))}
                    />
                    {player.name}
                  </label>
                ))}
              </fieldset>
              <label className="block">
                Linked practice (optional)
                <select className={field} value={practiceId} onChange={(event) => setPracticeId(event.target.value)}>
                  <option value="">No linked practice</option>
                  {data.practices.map((practice) => (
                    <option key={practice.id} value={practice.id}>
                      {practice.title}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                Due date (optional, {Intl.DateTimeFormat().resolvedOptions().timeZone})
                <input className={field} type="datetime-local" value={dueLocal} onChange={(event) => setDueLocal(event.target.value)} />
              </label>
              <button className={button} disabled={busy || !resourceIds.length || !playerIds.length} type="submit">
                Save packet draft
              </button>
            </form>
          </section>
          <section className="space-y-4">
            <h2 className="text-lg font-bold">3. Review, publish and follow progress</h2>
            {data.assignments.map((row) => (
              <article key={row.assignmentId} className="space-y-3 rounded-xl border bg-white p-4">
                <h3 className="font-bold">{row.title}</h3>
                <p className="text-sm">
                  {row.items.length} resources · {row.playerIds.length} players ·{' '}
                  {row.publishedVersion ? `Published version ${row.publishedVersion}` : 'Draft only'}
                </p>
                <div className="flex gap-4">
                  <button type="button" className="min-h-11 underline" onClick={() => editDraft(row)}>
                    Edit draft
                  </button>
                  <button
                    type="button"
                    className={button}
                    disabled={busy || row.playerIds.some((id) => !data.players.some((player) => player.id === id))}
                    onClick={() => {
                      setReview(row);
                      setNotify(false);
                    }}
                  >
                    Review publication
                  </button>
                </div>
                {data.deliveries
                  .filter((delivery) => delivery.assignmentId === row.assignmentId)
                  .map((delivery) => (
                    <p className="text-sm" key={delivery.version}>
                      Version {delivery.version} notification: {delivery.state}
                      {['pending', 'dispatching'].includes(delivery.state) && (
                        <button
                          type="button"
                          disabled={busy}
                          className="ml-3 min-h-11 underline"
                          onClick={() =>
                            void run(
                              () =>
                                resourcePacketCommand(auth.user!.uid, {
                                  teamId,
                                  action: 'retryNotification',
                                  deliveryId: delivery.deliveryId,
                                  confirm: true
                                }),
                              'Notification recovery checked. Uncertain sends are never repeated.'
                            )
                          }
                        >
                          {delivery.state === 'pending' ? 'Retry pending delivery' : 'Reconcile status (after 15 minutes)'}
                        </button>
                      )}
                    </p>
                  ))}
                <div className="space-y-2">
                  {data.tasks
                    .filter((task) => task.assignmentId === row.assignmentId)
                    .map((task) => (
                      <div key={task.playerId} className="border-t pt-2 text-sm">
                        <strong>
                          {task.playerName} · v{task.version}
                        </strong>
                        {task.items.map((item) => {
                          const signals = task.signals[item.resourceId] || {};
                          return (
                            <p key={item.resourceId}>
                              {item.title}: {signals.opened ? 'Link opened' : 'No recorded open'} · Watched report:{' '}
                              {signals.watched?.value ? 'yes' : 'not reported'} · Practiced report:{' '}
                              {signals.practiced?.value ? 'yes' : 'not reported'}
                            </p>
                          );
                        })}
                      </div>
                    ))}
                </div>
              </article>
            ))}
          </section>
          {review && (
            <section className="space-y-3 rounded-xl border-2 border-emerald-700 bg-white p-4" aria-labelledby="publish-review">
              <h2 id="publish-review" className="text-lg font-bold">
                Publish {review.title}?
              </h2>
              <p>
                This publishes version {review.publishedVersion + 1} to{' '}
                {review.playerIds.map((id) => data.players.find((player) => player.id === id)?.name || 'Unavailable player').join(', ')}. A
                new version resets current progress; prior evidence is retained.
              </p>
              <ul className="list-disc pl-6">
                {review.items.map((item) => (
                  <li key={item.resourceId}>
                    {item.title} · resource version {item.resourceVersion}
                  </li>
                ))}
              </ul>
              <label className="flex min-h-11 items-center gap-2">
                <input type="checkbox" checked={notify} onChange={(event) => setNotify(event.target.checked)} />
                Notify eligible guardians using their existing preferences
              </label>
              <p className="text-sm text-gray-600">
                Delivery depends on eligible channels and preferences. Email is not guaranteed. An uncertain delivery will not be resent
                automatically.
              </p>
              <button
                className={button}
                disabled={busy}
                type="button"
                onClick={() =>
                  void run(
                    async () => {
                      const result = (await resourcePacketCommand(auth.user!.uid, {
                        teamId,
                        action: 'publish',
                        assignmentId: review.assignmentId,
                        expectedRevision: review.revision,
                        confirm: true,
                        notify
                      })) as { assignmentId: string; revision: number; version: number };
                      setDraft((current) =>
                        current?.assignmentId === result.assignmentId
                          ? { ...current, revision: result.revision, publishedVersion: result.version }
                          : current
                      );
                    },
                    'Packet published. Review notification status below.'
                  )
                }
              >
                Confirm publish{notify ? ' and notify' : ' without notification'}
              </button>
              <button className="ml-4 min-h-11 underline" type="button" onClick={() => setReview(null)}>
                Cancel
              </button>
            </section>
          )}
        </>
      )}
    </main>
  );
}
