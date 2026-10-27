import { VideoCard } from '../assignments/VideoCard';
import { assignmentAiPath, assignmentProgress } from '../../lib/resourceAssignmentPresentation';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { ParentScheduleChild, ParentScheduleStaffTeam } from '../../lib/scheduleService';
import { loadResourcePacketFamily, openResourcePacketLink, resourcePacketCommand, type PacketTask } from '../../lib/resourcePacketsService';

export function ResourcePacketQueue({
  uid,
  linkedChildren,
  staffTeams,
  singlePlayer = false
}: {
  uid: string;
  linkedChildren: ParentScheduleChild[];
  staffTeams: ParentScheduleStaffTeam[];
  singlePlayer?: boolean;
}) {
  return <ResourcePacketQueueContent key={uid} uid={uid} linkedChildren={linkedChildren} staffTeams={staffTeams} singlePlayer={singlePlayer} />;
}

function ResourcePacketQueueContent({
  uid,
  linkedChildren: children,
  staffTeams,
  singlePlayer
}: {
  uid: string;
  linkedChildren: ParentScheduleChild[];
  staffTeams: ParentScheduleStaffTeam[];
  singlePlayer: boolean;
}) {
  const [params] = useSearchParams();
  const assignmentId = params.get('assignmentId') || undefined;
  const [loadedScope, setLoadedScope] = useState('');
  const [selected, setSelected] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);
  const [tasks, setTasks] = useState<PacketTask[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [reload, setReload] = useState(0);
  const selectedChild = children.find((child) => `${child.teamId}::${child.playerId}` === selected) || children[0];
  const teamId = selectedChild?.teamId;
  const playerId = selectedChild?.playerId;
  useEffect(() => {
    let cancelled = false;
    setTasks([]);
    setCursor(null);
    setError('');
    if (!teamId || !playerId) return;
    setLoading(true);
    void loadResourcePacketFamily(teamId, playerId, undefined, assignmentId)
      .then((rows) => {
        if (!cancelled) {
          setLoadedScope(`${teamId}::${playerId}`);
          setTasks(rows.tasks);
          setCursor(rows.cursors.tasks);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Unable to load packets.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [uid, teamId, playerId, reload, assignmentId]);
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await action();
      setReload((value) => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save. Try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="mb-6 space-y-4 rounded-2xl border border-gray-200 bg-white p-4" aria-labelledby="resource-packet-title">
      <div>
        <h2 id="resource-packet-title" className="text-xl font-bold text-gray-950">
          Practice
        </h2>
        <p className="mt-1 text-sm text-gray-600">
          {singlePlayer ? 'Watch the coach’s video, return here, and tell the coach when you practiced.' : 'Choose your child, watch the coach’s video, then record the practice.'}
        </p>
      </div>
      {children.length > 0 ? (
        singlePlayer ? null : (
          <label className="block text-sm font-semibold">
            Child and team
            <select
              className="mt-1 block min-h-11 w-full rounded-lg border border-gray-300 p-2"
              value={selectedChild ? `${teamId}::${playerId}` : ''}
              disabled={busy}
              onChange={(event) => setSelected(event.target.value)}
            >
              {children.map((child) => (
                <option key={`${child.teamId}::${child.playerId}`} value={`${child.teamId}::${child.playerId}`}>
                  {child.playerName} · {child.teamName}
                </option>
              ))}
            </select>
          </label>
        )
      ) : (
        <p className="text-sm text-gray-600">No linked children are available in this schedule.</p>
      )}
      {loading && <p role="status">Loading practice resources…</p>}
      {busy && <p role="status">Saving your progress…</p>}
      {error && (
        <div role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">
          {error}{' '}
          <button className="min-h-11 underline" type="button" onClick={() => setReload((value) => value + 1)}>
            Reload
          </button>
        </div>
      )}
      {!loading && !error && selectedChild && tasks.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-300 p-5 text-center">
          <p className="font-bold">No practice due for {selectedChild.playerName}</p>
          <p className="mt-1 text-sm text-gray-600">New coach assignments will appear here and on Home.</p>
        </div>
      )}
      {cursor && (
        <button
          className="min-h-11 underline"
          disabled={busy}
          type="button"
          onClick={() => {
            if (!teamId || !playerId) return;
            setBusy(true);
            void loadResourcePacketFamily(teamId, playerId, cursor)
              .then((page) => {
                setTasks((previous) => [...previous, ...page.tasks]);
                setCursor(page.cursors.tasks);
              })
              .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Unable to load more packets.'))
              .finally(() => setBusy(false));
          }}
        >
          Load more resource packets
        </button>
      )}
      {(loadedScope === `${teamId}::${playerId}` ? tasks : []).map((task) => {
        const progress = assignmentProgress(task);
        return (
        <article key={`${task.assignmentId}:${task.version}`} className="space-y-4 rounded-xl border border-gray-200 p-4 shadow-sm">
          <h3 className="text-lg font-bold">{task.title}</h3>
          <p className="text-sm text-gray-600">
            For {task.playerName} · {selectedChild.teamName}
            {task.dueAt
              ? ` · Due ${new Date(task.dueAt).toLocaleString(undefined, { timeZone: task.timeZone || undefined })} (${task.timeZone})`
              : ''}
          </p>
          <div className={`rounded-lg px-3 py-2 text-sm font-semibold ${progress.complete ? 'bg-emerald-50 text-emerald-800' : 'bg-blue-50 text-blue-800'}`}>
            {progress.legacy
              ? progress.complete ? 'Legacy assignment complete — every link was opened' : `${progress.opened} of ${progress.total} links opened · legacy assignment`
              : progress.complete ? 'Practice reported to the coach' : `${progress.practiced} of ${progress.total} practice items reported`}
          </div>
          {task.notes && <p className="whitespace-pre-wrap">{task.notes}</p>}
          {task.items.map((item) => {
            const signals = task.signals[item.resourceId] || {};
            return (
              <VideoCard
                key={item.resourceId}
                url={item.url}
                title={item.title}
                note={item.teachingPoint}
                showTitle={task.items.length > 1 || item.title !== task.title}
              >
                <button
                  className="min-h-12 w-full rounded-xl bg-emerald-800 px-5 py-3 font-bold text-white disabled:opacity-50"
                  disabled={busy}
                  type="button"
                  onClick={() => void run(() => openResourcePacketLink(uid, task, item))}
                >
                  {signals.opened?.value ? 'Open video again' : 'Open video'}
                </button>
                <p className="text-sm text-gray-600">
                  {signals.opened?.value
                    ? 'Opened. ALL PLAYS does not claim the whole video was watched.'
                    : 'Opens YouTube or the video site. Come back here when you finish.'}
                </p>
                {task.completionPolicy === 'practice_ack' && (signals.practiced?.value ? (
                  <div className="rounded-xl bg-emerald-50 p-3 text-emerald-900">
                    <p className="font-bold">Practice reported</p>
                    <p className="text-sm">{new Date(signals.practiced.at).toLocaleString()}</p>
                    <button
                      className="mt-2 min-h-11 font-semibold underline disabled:opacity-50"
                      disabled={busy}
                      type="button"
                      onClick={() => void run(() => resourcePacketCommand(uid, {
                        teamId: task.teamId,
                        action: 'report',
                        assignmentId: task.assignmentId,
                        version: task.version,
                        playerId: task.playerId,
                        resourceId: item.resourceId,
                        kind: 'practiced',
                        value: false
                      }))}
                    >
                      Undo
                    </button>
                  </div>
                ) : (
                  <button
                    className="min-h-12 w-full rounded-xl border-2 border-emerald-800 px-5 py-3 font-bold text-emerald-900 disabled:opacity-50"
                    disabled={busy}
                    type="button"
                    onClick={() => void run(() => resourcePacketCommand(uid, {
                      teamId: task.teamId,
                      action: 'report',
                      assignmentId: task.assignmentId,
                      version: task.version,
                      playerId: task.playerId,
                      resourceId: item.resourceId,
                      kind: 'practiced',
                      value: true
                    }))}
                  >
                    We practiced this
                  </button>
                ))}
              </VideoCard>
            );
          })}
          <Link
            className="inline-block min-h-11 py-3 text-emerald-800 underline"
            to={assignmentAiPath(
              task.teamId,
              `Help explain the coach notes for assignment ${task.assignmentId}, player ${task.playerId}, team ${task.teamId}. Read only authorized notes. Do not claim to know the video content.`
            )}
          >
            Ask AI about your practice notes
          </Link>
        </article>
      )})}
      {staffTeams.length > 0 && (
        <details className="border-t border-gray-200 pt-3">
          <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-gray-700">Coach tools</summary>
          {staffTeams.map((team) => (
            <Link
              className="mr-4 inline-block min-h-11 py-3 font-semibold text-emerald-800 underline"
              key={team.teamId}
              to={`/teams/${encodeURIComponent(team.teamId)}/resources`}
            >
              Assign practice for {team.teamName}
            </Link>
          ))}
        </details>
      )}
    </section>
  );
}
