import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { loadResourcePacketFamily, loadResourcePacketLinkedPlayers, type PacketTask } from '../../lib/resourcePacketsService';
import { assignmentPath, assignmentProgress } from '../../lib/resourceAssignmentPresentation';

export type HomeAssignmentLinkedPlayer = { teamId: string; playerId: string };

type AssignmentLoadError = { code: string | null; message: string };

// A failed load is remembered per account so a Home remount — the panel lives
// in a hidden div and remounts with the page — does not silently re-fire the
// same failing callable while the error is already shown. Retry is the
// explicit way back in (#5307).
const LOAD_FAILURE_TTL_MS = 5 * 60 * 1000;
const recentLoadFailures = new Map<string, { error: AssignmentLoadError; at: number }>();
export function __resetHomeAssignmentLoadFailuresForTests() {
  recentLoadFailures.clear();
}
function readRecentLoadFailure(uid: string): AssignmentLoadError | null {
  const entry = recentLoadFailures.get(uid);
  if (!entry) return null;
  if (Date.now() - entry.at > LOAD_FAILURE_TTL_MS) {
    recentLoadFailures.delete(uid);
    return null;
  }
  return entry.error;
}

function describeAssignmentLoadError(error: unknown): AssignmentLoadError {
  const cause = (error as { cause?: unknown } | null)?.cause;
  const codeRaw = (cause as { code?: unknown } | null)?.code ?? (error as { code?: unknown } | null)?.code;
  const code = typeof codeRaw === 'string' ? codeRaw.replace(/^functions\//, '') : null;
  const message = error instanceof Error && error.message ? error.message : 'Video assignments could not load.';
  return { code, message };
}

function normalizeFallbackPlayers(value: unknown): HomeAssignmentLinkedPlayer[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const teamId = typeof (entry as { teamId?: unknown } | null)?.teamId === 'string' ? (entry as { teamId: string }).teamId.trim() : '';
    const playerId =
      typeof (entry as { playerId?: unknown } | null)?.playerId === 'string' ? (entry as { playerId: string }).playerId.trim() : '';
    return teamId && playerId ? [{ teamId, playerId }] : [];
  });
}

export function HomeAssignments({
  uid,
  onCount,
  linkedPlayersFallback
}: {
  uid: string;
  onCount?: (count: number | null) => void;
  linkedPlayersFallback?: unknown;
}) {
  return <FamilyAssignments key={uid} uid={uid} onCount={onCount} linkedPlayersFallback={linkedPlayersFallback} />;
}
function FamilyAssignments({
  uid,
  onCount,
  linkedPlayersFallback
}: {
  uid: string;
  onCount?: (count: number | null) => void;
  linkedPlayersFallback?: unknown;
}) {
  const [tasks, setTasks] = useState<PacketTask[] | null>(null);
  const [error, setError] = useState<AssignmentLoadError | null>(() => readRecentLoadFailure(uid));
  const [reload, setReload] = useState(0);
  const [retryingWithFallback, setRetryingWithFallback] = useState(false);
  const fallbackPlayers = normalizeFallbackPlayers(linkedPlayersFallback);
  useEffect(() => {
    // While an error is already shown, do not re-fire the load on remount.
    if (error) return;
    let cancelled = false;
    onCount?.(null);
    void (async () => {
      // Bounded retry with a different path: if the linkedPlayers callable
      // fails, fall back once to the profile parentOf list instead of
      // replaying the identical failing call.
      let players: HomeAssignmentLinkedPlayer[];
      try {
        ({ players } = await loadResourcePacketLinkedPlayers());
      } catch (linkedError) {
        if (cancelled || !fallbackPlayers.length) throw linkedError;
        setRetryingWithFallback(true);
        players = fallbackPlayers;
      }
      if (cancelled) return;
      const result: PacketTask[] = [];
      // Bounded concurrency keeps a household refresh from fanning out requests.
      for (const player of players) {
        let cursor: string | undefined;
        let pages = 0;
        do {
          if (cancelled) return;
          if (++pages > 100) throw new Error('Unable to load the complete assignment list.');
          const page = await loadResourcePacketFamily(player.teamId, player.playerId, cursor);
          if (cancelled) return;
          result.push(...page.tasks);
          cursor = page.cursors.tasks || undefined;
        } while (cursor);
      }
      if (!cancelled) {
        setTasks(result);
        setRetryingWithFallback(false);
        onCount?.(result.filter((task) => !assignmentProgress(task).complete).length);
      }
    })().catch((caught: unknown) => {
      if (cancelled) return;
      const described = describeAssignmentLoadError(caught);
      recentLoadFailures.set(uid, { error: described, at: Date.now() });
      setRetryingWithFallback(false);
      setError(described);
    });
    return () => {
      cancelled = true;
    };
    // The error state is intentionally not a dependency: a shown error stops
    // re-firing, and Retry clears it before bumping `reload`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          Video assignments could not load.{error.code ? ` (${error.code})` : ''}{' '}
          <button
            className="min-h-12 underline"
            onClick={() => {
              recentLoadFailures.delete(uid);
              setError(null);
              setReload((value) => value + 1);
            }}
          >
            Retry
          </button>
          {error.message && error.message !== 'Video assignments could not load.' ? (
            <span className="mt-1 block text-sm text-gray-600">{error.message}</span>
          ) : null}
        </p>
      ) : !tasks ? (
        <p role="status">{retryingWithFallback ? 'Retrying with your linked players…' : 'Checking assignments…'}</p>
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
