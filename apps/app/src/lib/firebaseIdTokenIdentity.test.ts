import { describe, expect, it } from 'vitest';
import { assertFirebaseIdTokenIdentity, decodeFirebaseIdTokenClaims } from './firebaseIdTokenIdentity';

function token(claims: Record<string, unknown>) {
  const encode = (value: unknown) => btoa(JSON.stringify(value))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${encode({ alg: 'RS256', kid: 'test' })}.${encode(claims)}.signature`;
}

describe('Firebase ID token identity checks', () => {
  const nowMs = Date.UTC(2026, 6, 18, 12, 0, 0);
  const validClaims = {
    aud: 'game-flow-c6311',
    iss: 'https://securetoken.google.com/game-flow-c6311',
    sub: 'user-1',
    user_id: 'user-1',
    iat: nowMs / 1000 - 10,
    exp: nowMs / 1000 + 3600
  };

  it('accepts the expected Firebase project and uid claims', () => {
    expect(assertFirebaseIdTokenIdentity(token(validClaims), {
      expectedUid: 'user-1',
      projectId: 'game-flow-c6311',
      nowMs
    })).toMatchObject(validClaims);
  });

  it.each([
    ['audience', { aud: 'attacker-project' }],
    ['issuer', { iss: 'https://securetoken.google.com/attacker-project' }],
    ['subject', { sub: 'other-user' }],
    ['user id', { user_id: 'other-user' }],
    ['expiry', { exp: nowMs / 1000 - 60 }],
    ['future issue time', { iat: nowMs / 1000 + 301 }]
  ])('rejects an unexpected %s claim', (_label, claimOverride) => {
    expect(() => assertFirebaseIdTokenIdentity(token({ ...validClaims, ...claimOverride }), {
      expectedUid: 'user-1',
      projectId: 'game-flow-c6311',
      nowMs
    })).toThrow('unexpected identity');
  });

  it('rejects malformed and incomplete tokens without echoing token material', () => {
    expect(() => decodeFirebaseIdTokenClaims('not-a-token')).toThrow('malformed authentication token');
    expect(() => decodeFirebaseIdTokenClaims(token({ sub: 'user-1' }))).toThrow('malformed authentication token');
  });
});
