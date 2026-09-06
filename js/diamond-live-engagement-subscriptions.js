import {
  collection,
  db,
  functions,
  getDocs,
  httpsCallable,
  limit as limitQuery,
  onSnapshot,
  orderBy,
  query,
} from "./firebase.js?v=4433195";

const DIAMOND_ENGINE = "diamond-v2";
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const pendingChatRequests = new Map();
const pendingReactionRequests = new Map();

function normalizeId(value, field) {
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    !value ||
    value.length > 128 ||
    value.includes("/")
  ) {
    throw new Error(`${field} is invalid.`);
  }
  return value;
}

function generationQuery(teamId, gameId, collectionId, instanceId, maximum) {
  const normalizedTeamId = normalizeId(teamId, "teamId");
  const normalizedGameId = normalizeId(gameId, "gameId");
  if (typeof instanceId !== "string" || !UUID_V4_PATTERN.test(instanceId)) {
    throw new Error("Diamond game generation is invalid.");
  }
  return query(
    collection(
      db,
      `teams/${normalizedTeamId}/games/${normalizedGameId}/diamondLiveGenerations/${instanceId.toLowerCase()}/${collectionId}`,
    ),
    orderBy("createdAt", "desc"),
    limitQuery(maximum),
  );
}

function secureRequestId() {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === "function") {
    const value = cryptoApi.randomUUID();
    if (UUID_V4_PATTERN.test(value)) return value.toLowerCase();
  }
  if (typeof cryptoApi?.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    cryptoApi.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (value) =>
      value.toString(16).padStart(2, "0"),
    ).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  throw new Error("Secure live-interaction identity is unavailable.");
}

function engagementIdentity(teamId, gameId, instanceId) {
  const normalizedTeamId = normalizeId(teamId, "teamId");
  const normalizedGameId = normalizeId(gameId, "gameId");
  const normalizedInstanceId =
    typeof instanceId === "string" ? instanceId.trim().toLowerCase() : "";
  if (!UUID_V4_PATTERN.test(normalizedInstanceId)) {
    throw new Error("Diamond game generation is invalid.");
  }
  return {
    teamId: normalizedTeamId,
    gameId: normalizedGameId,
    instanceId: normalizedInstanceId,
  };
}

async function submitInteraction(functionName, request, resultField) {
  const response = (await httpsCallable(functions, functionName)(request))?.data;
  if (
    !response ||
    response.outcome !== "accepted" ||
    response.requestId !== request.requestId ||
    response.instanceId !== request.expectedInstanceId ||
    typeof response[resultField] !== "string" ||
    !response[resultField]
  ) {
    throw new Error("The server did not confirm the live interaction.");
  }
  return response;
}

export function subscribeLiveChat(
  teamId,
  gameId,
  options,
  callback,
  onError,
) {
  const liveQuery = generationQuery(
    teamId,
    gameId,
    "chat",
    options?.instanceId,
    Math.min(100, Math.max(1, Number(options?.limit) || 100)),
  );
  return onSnapshot(
    liveQuery,
    (snapshot) => {
      callback(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
    },
    onError,
  );
}

export function subscribeReactions(
  teamId,
  gameId,
  options,
  callback,
  onError,
) {
  const liveQuery = generationQuery(
    teamId,
    gameId,
    "reactions",
    options?.instanceId,
    20,
  );
  return onSnapshot(
    liveQuery,
    (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === "added") {
          callback({ id: change.doc.id, ...change.doc.data() });
        }
      });
    },
    onError,
  );
}

export async function getLiveChatHistory(teamId, gameId, instanceId) {
  const snapshot = await getDocs(
    generationQuery(teamId, gameId, "chat", instanceId, 100),
  );
  return snapshot.docs
    .map((entry) => ({ id: entry.id, ...entry.data() }))
    .reverse();
}

export async function getLiveReactions(teamId, gameId, instanceId) {
  const snapshot = await getDocs(
    generationQuery(teamId, gameId, "reactions", instanceId, 100),
  );
  return snapshot.docs
    .map((entry) => ({ id: entry.id, ...entry.data() }))
    .reverse();
}

export async function postDiamondLiveChat(teamId, gameId, instanceId, text) {
  const identity = engagementIdentity(teamId, gameId, instanceId);
  const normalizedText =
    typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "";
  if (!normalizedText || normalizedText.length > 2000) {
    throw new Error("Enter a live-chat message of 2,000 characters or fewer.");
  }
  const pendingKey = JSON.stringify([
    identity.teamId,
    identity.gameId,
    identity.instanceId,
    normalizedText,
  ]);
  const requestId = pendingChatRequests.get(pendingKey) || secureRequestId();
  pendingChatRequests.set(pendingKey, requestId);
  const response = await submitInteraction(
    "postDiamondLiveChat",
    {
      schemaVersion: 1,
      requestId,
      teamId: identity.teamId,
      gameId: identity.gameId,
      expectedInstanceId: identity.instanceId,
      viewerMode: "live",
      text: normalizedText,
    },
    "messageId",
  );
  if (pendingChatRequests.get(pendingKey) === requestId) {
    pendingChatRequests.delete(pendingKey);
  }
  return response;
}

export async function postDiamondLiveReaction(
  teamId,
  gameId,
  instanceId,
  type,
) {
  const identity = engagementIdentity(teamId, gameId, instanceId);
  if (!["fire", "clap", "wow", "heart", "hundred"].includes(type)) {
    throw new Error("Reaction type is invalid.");
  }
  const pendingKey = JSON.stringify([
    identity.teamId,
    identity.gameId,
    identity.instanceId,
    type,
  ]);
  const requestId = pendingReactionRequests.get(pendingKey) || secureRequestId();
  pendingReactionRequests.set(pendingKey, requestId);
  const response = await submitInteraction(
    "postDiamondLiveReaction",
    {
      schemaVersion: 1,
      requestId,
      teamId: identity.teamId,
      gameId: identity.gameId,
      expectedInstanceId: identity.instanceId,
      viewerMode: "live",
      type,
    },
    "reactionId",
  );
  if (pendingReactionRequests.get(pendingKey) === requestId) {
    pendingReactionRequests.delete(pendingKey);
  }
  return response;
}
