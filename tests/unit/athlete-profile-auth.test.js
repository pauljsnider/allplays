import { describe, it, expect } from 'vitest';
import { createAthleteProfileAuthLoader } from '../../js/athlete-profile-auth.js';

describe('athlete profile auth loading', () => {
    it('loads public profiles for anonymous visitors once', () => {
        const loads = [];
        const handleAuthChange = createAthleteProfileAuthLoader((user) => loads.push(user));

        handleAuthChange(null);
        handleAuthChange(null);

        expect(loads).toEqual([null]);
    });

    it('retries after cold auth restore changes from anonymous to signed-in user', () => {
        const loads = [];
        const signedInParent = { uid: 'parent-1' };
        const handleAuthChange = createAthleteProfileAuthLoader((user) => loads.push(user));

        handleAuthChange(null);
        handleAuthChange(signedInParent);
        handleAuthChange(signedInParent);

        expect(loads).toEqual([null, signedInParent]);
    });

    it('does not replace an authenticated load with a later signed-out update', () => {
        const loads = [];
        const signedInParent = { uid: 'parent-1' };
        const handleAuthChange = createAthleteProfileAuthLoader((user) => loads.push(user));

        handleAuthChange(signedInParent);
        handleAuthChange(null);

        expect(loads).toEqual([signedInParent]);
    });

    it('marks anonymous cold-restore loads stale when a signed-in retry starts', () => {
        const loads = [];
        const signedInParent = { uid: 'parent-1' };
        const handleAuthChange = createAthleteProfileAuthLoader((user, isCurrentLoad) => {
            loads.push({ user, isCurrentLoad });
        });

        handleAuthChange(null);
        expect(loads[0].isCurrentLoad()).toBe(true);

        handleAuthChange(signedInParent);

        expect(loads).toHaveLength(2);
        expect(loads[0].user).toBe(null);
        expect(loads[0].isCurrentLoad()).toBe(false);
        expect(loads[1].user).toBe(signedInParent);
        expect(loads[1].isCurrentLoad()).toBe(true);
    });
});
