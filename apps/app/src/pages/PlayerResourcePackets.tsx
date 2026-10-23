import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { AuthState } from '../lib/types';
import { resourcePacketsAvailable, loadResourcePacketLinkedPlayers } from '../lib/resourcePacketsService';
import { ResourcePacketQueue } from '../components/schedule/ResourcePacketQueue';

/** A direct authenticated route also serves linked player accounts without parent-only Schedule discovery. */
export function PlayerResourcePackets({ auth }: { auth: AuthState }) {
  const { teamId = '', playerId = '' } = useParams();
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
      .then((result) => {
        if (!cancelled) {
          setPlayers(result.players);
          setLoadedUid(uid);
        }
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Unable to load your players.');
      });
    return () => {
      cancelled = true;
    };
  }, [uid, enabled, teamId, playerId, reload]);
  return (
    <main className="mx-auto max-w-3xl space-y-4 p-4 pb-24">
      <Link className="inline-block min-h-11 py-3 text-emerald-800 underline" to="/schedule?view=packets">
        Back to Schedule
      </Link>
      <h1 className="text-2xl font-bold">Player practice resources</h1>
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
            ) : players.length ? (
              <ul>
                {players.map((player) => (
                  <li key={`${player.teamId}:${player.playerId}`}>
                    <Link
                      className="inline-block min-h-11 py-3 text-emerald-800 underline"
                      to={`/players/${encodeURIComponent(player.teamId)}/${encodeURIComponent(player.playerId)}/resources`}
                    >
                      {player.playerName} · {player.teamName}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p>No active players are linked to your account.</p>
            )}
          </section>
        )
      ) : (
        <p>Resource packets are not available in this app.</p>
      )}
    </main>
  );
}
