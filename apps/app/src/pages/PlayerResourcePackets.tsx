import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import type { AuthState } from '../lib/types';
import { resourcePacketsAvailable, loadResourcePacketLinkedPlayers, loadResourcePacketFamily } from '../lib/resourcePacketsService';
import { ResourcePacketQueue } from '../components/schedule/ResourcePacketQueue';

/** A direct authenticated route also serves linked player accounts without parent-only Schedule discovery. */
export function PlayerResourcePackets({ auth }: { auth: AuthState }) {
  const { teamId = '', playerId = '' } = useParams();
  const [params] = useSearchParams();
  const assignmentId = params.get('assignmentId');
  const assignmentTeam = params.get('teamId');
  const [players, setPlayers] = useState<Awaited<ReturnType<typeof loadResourcePacketLinkedPlayers>>['players']>([]);
  const [loadedUid, setLoadedUid] = useState('');
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const uid = auth.user?.uid;
  const enabled = resourcePacketsAvailable();
  useEffect(() => {
    if (!enabled || !uid || (teamId && playerId)) return;
    let cancelled = false;
    setLoadedUid('');
    setError('');
    void loadResourcePacketLinkedPlayers()
      .then(async (result) => {
        let linked = result.players.filter((player) => !assignmentTeam || player.teamId === assignmentTeam);
        if (assignmentId) {
          const assigned = [];
          for (const player of linked) {
            const page = await loadResourcePacketFamily(player.teamId, player.playerId, undefined, assignmentId);
            if (page.tasks.length) assigned.push(player);
          }
          linked = assigned;
        }
        if (!cancelled) {
          setPlayers(linked);
          setLoadedUid(uid);
        }
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Unable to load your players.');
      });
    return () => {
      cancelled = true;
    };
  }, [uid, enabled, teamId, playerId, reload, assignmentTeam, assignmentId]);
  return (
    <main className="mx-auto max-w-3xl space-y-4 p-4 pb-24">
      <Link className="inline-block min-h-11 py-3 text-emerald-800 underline" to="/home">
        Back to Home
      </Link>
      <h1 className="text-2xl font-bold">Practice task</h1>
      {enabled && auth.user ? (
        teamId && playerId ? (
          <ResourcePacketQueue
            singlePlayer
            uid={auth.user.uid}
            children={[{ teamId, playerId, teamName: 'Selected team', playerName: 'Selected player' }]}
            staffTeams={[]}
          />
        ) : (
          <section aria-label="Your linked players">
            {error ? (
              <div role="alert">
                {error}{' '}
                <button className="min-h-11 underline" onClick={() => setReload((value) => value + 1)}>
                  Retry
                </button>
              </div>
            ) : loadedUid !== uid ? (
              <p role="status">Loading your players…</p>
            ) : players.length === 1 && assignmentId ? (
              <ResourcePacketQueue uid={auth.user.uid} children={players} staffTeams={[]} singlePlayer />
            ) : players.length ? (
              <ul>
                {players.map((player) => (
                  <li key={`${player.teamId}:${player.playerId}`}>
                    <Link
                      className="inline-block min-h-11 py-3 text-emerald-800 underline"
                      to={`/players/${encodeURIComponent(player.teamId)}/${encodeURIComponent(player.playerId)}/resources${assignmentId ? `?assignmentId=${encodeURIComponent(assignmentId)}` : ''}`}
                    >
                      {player.playerName} · {player.teamName}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p>
                {assignmentId
                  ? 'This assignment is not available for your linked players.'
                  : 'No active players are linked to your account.'}
              </p>
            )}
          </section>
        )
      ) : (
        <p>Practice tasks are not available right now.</p>
      )}
    </main>
  );
}
