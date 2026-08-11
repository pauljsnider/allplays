import { listParentTeamFeeRecipients as legacyListParentTeamFeeRecipients } from './adapters/legacyHomeFees';
import { getPrimaryAppCheckHeaders } from './adapters/legacyFirebaseAppCheck';
import { firebaseAuth, getNativeAuthIdToken } from './authService';
import { isNativeRuntime } from './nativeRuntime';

type ParentFeeChildLink = {
  teamId?: string | null;
  playerId?: string | null;
};

type FirestoreValue = Record<string, unknown>;

function compactString(value: unknown) {
  return String(value || '').trim();
}

function getProjectId() {
  const projectId = compactString(firebaseAuth.app?.options?.projectId);
  if (!projectId) throw new Error('Firebase project ID is missing.');
  return projectId;
}

function getFirestoreBaseUrl() {
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(getProjectId())}/databases/(default)/documents`;
}

function decodeFirestoreValue(value: any): any {
  if (!value || typeof value !== 'object') return null;
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue || 0);
  if ('doubleValue' in value) return Number(value.doubleValue || 0);
  if ('timestampValue' in value) return new Date(value.timestampValue);
  if ('nullValue' in value) return null;
  if ('arrayValue' in value) return (value.arrayValue?.values || []).map(decodeFirestoreValue);
  if ('mapValue' in value) return decodeFirestoreFields(value.mapValue?.fields || {});
  return null;
}

function decodeFirestoreFields(fields: Record<string, FirestoreValue> = {}) {
  return Object.keys(fields).reduce<Record<string, any>>((decoded, key) => {
    decoded[key] = decodeFirestoreValue(fields[key]);
    return decoded;
  }, {});
}

function decodeFeeRecipientDocument(document: any) {
  const name = compactString(document?.name);
  if (!name) return null;
  const path = name.split('/documents/')[1] || name;
  const parts = path.split('/');
  const teamIndex = parts.indexOf('teams');
  const data = decodeFirestoreFields(document.fields || {});
  const teamId = compactString(data.teamId || (teamIndex >= 0 ? parts[teamIndex + 1] : ''));
  const playerId = compactString(data.playerId || data.childId);
  return {
    id: parts[parts.length - 1] || '',
    ...data,
    teamId,
    playerKey: compactString(data.playerKey || (teamId && playerId ? `${teamId}::${playerId}` : '')),
    __path: path
  };
}

function isAllowedParentFeeRecipient(data: Record<string, any>, userId: string, parentPlayerKeys: Set<string>) {
  if ([data.parentUserId, data.accountUserId, data.userId].includes(userId)) return true;
  return Boolean(data.playerKey && parentPlayerKeys.has(data.playerKey));
}

async function getNativeHeaders(requestUrl: string) {
  const token = await getNativeAuthIdToken(true);
  if (!token) throw new Error('Native auth token is unavailable.');
  return getPrimaryAppCheckHeaders({
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  }, requestUrl);
}

async function nativeRunFeeRecipientQuery(teamId: string, fieldPath: string, value: string) {
  const requestUrl = `${getFirestoreBaseUrl()}:runQuery`;
  const response = await fetch(requestUrl, {
    method: 'POST',
    headers: await getNativeHeaders(requestUrl),
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'feeRecipients', allDescendants: true }],
        where: {
          compositeFilter: {
            op: 'AND',
            filters: [
              {
                fieldFilter: {
                  field: { fieldPath: 'teamId' },
                  op: 'EQUAL',
                  value: { stringValue: teamId }
                }
              },
              {
                fieldFilter: {
                  field: { fieldPath },
                  op: 'EQUAL',
                  value: { stringValue: value }
                }
              }
            ]
          }
        }
      }
    })
  });
  const payload = await response.json().catch(() => []);
  if (!response.ok) {
    const error = new Error(payload?.error?.message || `Fee recipient request failed (${response.status}).`) as Error & {
      code?: string;
      status?: number;
    };
    error.status = response.status;
    if (response.status === 401) error.code = 'unauthenticated';
    if (response.status === 403) error.code = 'permission-denied';
    throw error;
  }
  return Array.isArray(payload)
    ? payload.map((entry) => decodeFeeRecipientDocument(entry.document)).filter(Boolean)
    : [];
}

async function listNativeParentTeamFeeRecipients(userId: string, children: ParentFeeChildLink[]) {
  const childLinksByKey = new Map<string, { teamId: string; playerId: string; playerKey: string }>();
  children.forEach((child) => {
    const teamId = compactString(child?.teamId);
    const playerId = compactString(child?.playerId);
    if (!teamId || !playerId) return;
    const playerKey = `${teamId}::${playerId}`;
    childLinksByKey.set(playerKey, { teamId, playerId, playerKey });
  });
  const childLinks = [...childLinksByKey.values()];
  if (!childLinks.length) return [];

  const parentPlayerKeys = new Set(childLinks.map((child) => child.playerKey));
  const teamIds = [...new Set(childLinks.map((child) => child.teamId))];
  const queryJobs = [
    ...teamIds.flatMap((teamId) => [
      nativeRunFeeRecipientQuery(teamId, 'parentUserId', userId),
      nativeRunFeeRecipientQuery(teamId, 'accountUserId', userId),
      nativeRunFeeRecipientQuery(teamId, 'userId', userId)
    ]),
    ...childLinks.map((child) => nativeRunFeeRecipientQuery(child.teamId, 'playerKey', child.playerKey))
  ];

  // A failed query means the result is incomplete. Reject the whole load so an
  // empty partial result cannot be cached or rendered as proof that no fees exist.
  const queryResults = await Promise.all(queryJobs);
  const feesByPath = new Map<string, Record<string, any>>();
  queryResults.flat().forEach((fee: any) => {
    if (!fee || !isAllowedParentFeeRecipient(fee, userId, parentPlayerKeys)) return;
    const { __path, ...publicFee } = fee;
    feesByPath.set(__path, publicFee);
  });
  return [...feesByPath.values()];
}

export async function listParentTeamFeeRecipientsForApp(
  userId: string,
  children: ParentFeeChildLink[] = []
) {
  if (!userId) return [];
  if (!isNativeRuntime()) {
    return Promise.resolve(legacyListParentTeamFeeRecipients(userId, children));
  }
  return listNativeParentTeamFeeRecipients(userId, children);
}
