import { Link, useParams } from 'react-router-dom';
import type { AuthState } from '../lib/types';
import { resourcePacketsAvailable } from '../lib/resourcePacketsService';
import { ResourcePacketQueue } from '../components/schedule/ResourcePacketQueue';

/** A direct authenticated route also serves linked player accounts without parent-only Schedule discovery. */
export function PlayerResourcePackets({ auth }: { auth: AuthState }) {
  const { teamId = '', playerId = '' } = useParams();
  return (
    <main className="mx-auto max-w-3xl space-y-4 p-4 pb-24">
      <Link className="inline-block min-h-11 py-3 text-emerald-800 underline" to="/schedule?view=packets">
        Back to Schedule
      </Link>
      <h1 className="text-2xl font-bold">Player practice resources</h1>
      {resourcePacketsAvailable() && auth.user ? (
        <ResourcePacketQueue
          singlePlayer
          uid={auth.user.uid}
          children={[{ teamId, playerId, teamName: 'Selected team', playerName: 'Selected player' }]}
          staffTeams={[]}
        />
      ) : (
        <p>Resource packets are not available in this app.</p>
      )}
    </main>
  );
}
