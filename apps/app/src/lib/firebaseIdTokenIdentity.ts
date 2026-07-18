export type FirebaseIdTokenClaims = {
  aud: string;
  exp: number;
  iat?: number;
  iss: string;
  sub: string;
  user_id?: string;
};

type FirebaseIdTokenIdentity = {
  expectedUid: string;
  projectId: string;
  nowMs?: number;
  allowExpired?: boolean;
};

/**
 * Confirms that a token returned over Firebase's TLS endpoint belongs to the
 * configured Firebase project and the user the response names. Signature
 * verification remains a server responsibility; every privileged backend
 * still verifies the token independently.
 */
export function assertFirebaseIdTokenIdentity(
  token: string,
  { expectedUid, projectId, nowMs = Date.now(), allowExpired = false }: FirebaseIdTokenIdentity
) {
  const normalizedProjectId = String(projectId || '').trim();
  const normalizedUid = String(expectedUid || '').trim();
  if (!normalizedProjectId || !normalizedUid) {
    throw new Error('Firebase auth identity context is incomplete.');
  }

  const claims = decodeFirebaseIdTokenClaims(token);
  const expectedIssuer = `https://securetoken.google.com/${normalizedProjectId}`;
  const nowSeconds = Math.floor(nowMs / 1000);
  if (
    claims.aud !== normalizedProjectId
    || claims.iss !== expectedIssuer
    || claims.sub !== normalizedUid
    || (claims.user_id && claims.user_id !== normalizedUid)
    || !Number.isFinite(claims.exp)
    || (!allowExpired && claims.exp <= nowSeconds - 30)
    || (Number.isFinite(claims.iat) && Number(claims.iat) > nowSeconds + 300)
  ) {
    throw new Error('Firebase returned an authentication token for an unexpected identity.');
  }

  return claims;
}

export function decodeFirebaseIdTokenClaims(token: string): FirebaseIdTokenClaims {
  const segments = String(token || '').split('.');
  if (segments.length !== 3 || !segments[1]) {
    throw new Error('Firebase returned a malformed authentication token.');
  }

  try {
    const base64 = segments[1]
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(segments[1].length / 4) * 4, '=');
    if (typeof atob !== 'function') {
      throw new Error('base64 decoder unavailable');
    }
    const decoded = atob(base64);
    const json = decodeURIComponent([...decoded]
      .map((character) => `%${character.charCodeAt(0).toString(16).padStart(2, '0')}`)
      .join(''));
    const claims = JSON.parse(json) as Partial<FirebaseIdTokenClaims>;
    if (
      typeof claims.aud !== 'string'
      || typeof claims.iss !== 'string'
      || typeof claims.sub !== 'string'
      || typeof claims.exp !== 'number'
    ) {
      throw new Error('missing claims');
    }
    return claims as FirebaseIdTokenClaims;
  } catch {
    throw new Error('Firebase returned a malformed authentication token.');
  }
}
