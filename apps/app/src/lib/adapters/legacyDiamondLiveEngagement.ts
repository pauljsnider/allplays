import {
  collection,
  db,
  limit,
  onSnapshot,
  orderBy,
  query,
  functions as legacyFunctions,
  httpsCallable as legacyHttpsCallable,
} from '@legacy/firebase.js';

export const functions: unknown = legacyFunctions;
export const httpsCallable = legacyHttpsCallable as (...args: any[]) => (...args: any[]) => Promise<any>;

type LegacySnapshotDocument = {
  id: string;
  data: () => Record<string, unknown>;
};

type LegacyReactionSnapshot = {
  docs: LegacySnapshotDocument[];
  metadata?: { fromCache?: boolean };
  docChanges: () => Array<{ type: string; doc: LegacySnapshotDocument }>;
};

function liveGenerationQuery(
  teamId: string,
  gameId: string,
  collectionId: 'chat' | 'reactions',
  instanceId: string,
  maximum: number,
) {
  return query(
    collection(db, `teams/${teamId}/games/${gameId}/diamondLiveGenerations/${instanceId}/${collectionId}`),
    orderBy('createdAt', 'desc'),
    limit(maximum),
  );
}

export function subscribeDiamondLiveChat<T>(
  teamId: string,
  gameId: string,
  instanceId: string,
  callback: (messages: T[]) => void,
  onError?: (error: unknown) => void,
) {
  return onSnapshot(
    liveGenerationQuery(teamId, gameId, 'chat', instanceId, 100),
    (snapshot: any) => callback(
      snapshot.docs.map((entry: any) => ({ id: entry.id, ...entry.data() }) as T),
    ),
    onError,
  );
}

export function subscribeDiamondLiveReactions<T>(
  teamId: string,
  gameId: string,
  instanceId: string,
  callback: (reaction: T) => void,
  onError?: (error: unknown) => void,
) {
  let baselineEstablished = false;
  const observedReactionIds = new Set<string>();
  return onSnapshot(
    liveGenerationQuery(teamId, gameId, 'reactions', instanceId, 20),
    { includeMetadataChanges: true },
    (snapshot: LegacyReactionSnapshot) => {
      if (!baselineEstablished) {
        snapshot.docs.forEach((entry) => observedReactionIds.add(entry.id));
        if (snapshot.metadata?.fromCache !== true) {
          baselineEstablished = true;
        }
        return;
      }
      snapshot.docChanges().forEach((change) => {
        const reactionId = change.doc.id;
        if (change.type !== 'added' || observedReactionIds.has(reactionId)) return;
        observedReactionIds.add(reactionId);
        callback({ id: reactionId, ...change.doc.data() } as T);
      });
    },
    onError,
  );
}
