import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { loadResourcePacketFamily, loadResourcePacketLinkedPlayers, type PacketTask } from '../../lib/resourcePacketsService';
import { assignmentPath, assignmentProgress } from '../../lib/resourceAssignmentPresentation';

export function HomeAssignments({ uid, onCount }: { uid: string; onCount?: (count: number | null) => void }) {
  return <FamilyAssignments key={uid} onCount={onCount} />;
}
function FamilyAssignments({ onCount }: { onCount?: (count: number | null) => void }) {
  const [tasks, setTasks] = useState<PacketTask[] | null>(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setError('');
    onCount?.(null);
    void (async () => {
      const { players } = await loadResourcePacketLinkedPlayers();
      const result: PacketTask[] = [];
      // Bounded concurrency keeps a household refresh from fanning out requests.
      for (const player of players) {
        let cursor: string | undefined;
        let pages = 0;
        do {
          if (++pages > 100) throw new Error('Unable to load the complete assignment list.');
          const page = await loadResourcePacketFamily(player.teamId, player.playerId, cursor);
          result.push(...page.tasks);
          cursor = page.cursors.tasks || undefined;
        } while (cursor);
      }
      if (!cancelled) {
        setTasks(result);
        onCount?.(result.filter((task) => !assignmentProgress(task).complete).length);
      }
    })().catch(() => {
      if (!cancelled) setError('Video assignments could not load.');
    });
    return () => {
      cancelled = true;
    };
  }, [reload, onCount]);
  const outstanding = tasks?.filter((task) => !assignmentProgress(task).complete);
  return (
    <section className="my-4 space-y-3 rounded-2xl border bg-white p-4" aria-label="Family video assignments">
      <div className="flex flex-wrap justify-between gap-3">
        <h2 className="text-lg font-bold">Video assignments{outstanding ? ` (${outstanding.length} to do)` : ''}</h2>
        <Link className="min-h-12 py-3 font-semibold text-emerald-800 underline" to="/practice-resources">
          View all
        </Link>
      </div>
      {error ? (
        <p role="alert">
          {error}{' '}
          <button className="min-h-12 underline" onClick={() => setReload((value) => value + 1)}>
            Retry
          </button>
        </p>
      ) : !tasks ? (
        <p role="status">Checking assignments…</p>
      ) : !outstanding?.length ? (
        <p className="text-gray-600">No videos to open. You’re up to date.</p>
      ) : (
        outstanding.map((task) => (
          <Link
            key={`${task.teamId}:${task.playerId}:${task.assignmentId}`}
            className="block rounded-xl bg-emerald-50 p-4"
            to={assignmentPath(task.teamId, task.assignmentId, task.playerId)}
          >
            <strong>{task.title}</strong>
            <p className="mt-1 text-sm">
              For {task.playerName} · {assignmentProgress(task).opened} of {task.items.length} opened
            </p>
          </Link>
        ))
      )}
    </section>
  );
}
