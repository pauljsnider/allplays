import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, Timestamp } from 'firebase/firestore';

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('badge scoreboard ownership', () => {
    let env;
    beforeAll(async () => {
        env = await initializeTestEnvironment({ projectId: `demo-badge-${Date.now()}`, firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
    }, 30000);
    afterAll(async () => { await env?.cleanup(); });
    beforeEach(async () => {
        await env.clearFirestore();
        await env.withSecurityRulesDisabled(async context => {
            const db = context.firestore();
            await setDoc(doc(db, 'users/owner'), { email: 'owner@example.com', isAdmin: false });
            await setDoc(doc(db, 'teams/t'), { ownerId: 'owner', name: 'Falcons', isPublic: true });
            await setDoc(doc(db, 'teams/t/games/g'), { opponent: 'Owls', date: Timestamp.now(), type: 'game', status: 'scheduled', homeScore: 0, awayScore: 0, badgeScoreControl: true });
            await setDoc(doc(db, 'teams/t/games/free'), { opponent: 'Owls', date: Timestamp.now(), type: 'game', status: 'scheduled', homeScore: 0, awayScore: 0 });
            await setDoc(doc(db, 'badgeScoreDevices/private'), { uid: 'owner' });
            await setDoc(doc(db, 'badgeScoreLocks/private'), { deviceId: 'private' });
        });
    });
    const owner = () => env.authenticatedContext('owner', { email: 'owner@example.com', email_verified: true }).firestore();
    it('blocks score, clock, lock edits and events even from the manager', async () => {
        const db = owner();
        for (const change of [{ scoreOrientation: 'team-opponent' }, { homeScore: 2 }, { liveClockRunning: true }, { badgeScoreControl: false }, { liveClockPeriod: 'Q2' }]) {
            await assertFails(updateDoc(doc(db, 'teams/t/games/g'), change));
        }
        for (const collection of ['events', 'aggregatedStats', 'teamStats', 'privatePlayerStats', 'liveEvents']) {
            await assertFails(setDoc(doc(db, `teams/t/games/g/${collection}/new`), { type: 'clock_sync', homeScore: 9 }));
        }
        await assertSucceeds(updateDoc(doc(db, 'teams/t/games/g'), { location: 'Court 2' }));
    });
    it('keeps unclaimed games writable and prevents clients claiming new/existing games', async () => {
        const db = owner();
        await assertSucceeds(updateDoc(doc(db, 'teams/t/games/free'), { homeScore: 2, scoreOrientation: 'venue' }));
        await assertFails(updateDoc(doc(db, 'teams/t/games/free'), { badgeScoreControl: true }));
        await assertFails(setDoc(doc(db, 'teams/t/games/new'), { badgeScoreControl: true }));
    });
    it('keeps grants, locks and receipts server private', async () => {
        for (const db of [owner(), env.unauthenticatedContext().firestore()]) {
            for (const path of ['badgeScoreDevices/private', 'badgeScoreLocks/private', 'badgeScoreLocks/private/receipts/one']) {
                await assertFails(getDoc(doc(db, path)));
                await assertFails(setDoc(doc(db, path), { owned: true }));
            }
        }
    });
});
