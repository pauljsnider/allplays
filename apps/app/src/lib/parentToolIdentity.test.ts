import { describe, expect, it } from 'vitest';
import type { AuthState } from './types';
import { getParentToolIdentity } from './parentToolIdentity';

describe('retained parent tool identity', () => {
    const auth = { user: { uid: 'first', email: 'first@example.com', emailVerified: true } } as AuthState;
    it('changes across account, sign-out, and authoritative email transitions', () => {
        for (const user of [null, { ...auth.user!, uid: 'second' }, { ...auth.user!, email: '' }, { ...auth.user!, emailVerified: false }]) {
            expect(getParentToolIdentity({ ...auth, user })).not.toBe(getParentToolIdentity(auth));
        }
    });
    it('preserves state for a same-principal profile rehydrate', () => {
        expect(getParentToolIdentity({ ...auth, user: { ...auth.user!, displayName: 'Updated name' } })).toBe(getParentToolIdentity(auth));
    });
});
