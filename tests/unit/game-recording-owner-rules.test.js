import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteField, doc, getDoc, setDoc, Timestamp, updateDoc } from 'firebase/firestore';
import { compactFirestoreRules } from '../../scripts/compact-firestore-rules.mjs';
import { buildCertificateDefaultsCompatibilityRules } from '../../scripts/build-certificate-defaults-compat-rules.mjs';
import { buildYouTubeReplayVideo } from '../../js/game-replay-video.js';
import { resolveReplayVideoOptions } from '../../js/live-game-video.js';

const source = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
const rules = compactFirestoreRules(buildCertificateDefaultsCompatibilityRules(source));

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('owner recording lifecycle with deployed-compatible Rules', () => {
    let env;
    let ownerDb;
    const gamePath = 'teams/recording-team/games/past-game';
    const original = {
        type: 'game', status: 'completed', liveStatus: 'scheduled', visibility: 'public',
        date: Timestamp.fromMillis(1700000000000), homeScore: 4, awayScore: 2,
        summary: 'Existing report', opponentStats: { goals: 2 },
        videoUrl: 'https://youtu.be/PK1HyC37doc'
    };
    beforeAll(async () => {
        env = await initializeTestEnvironment({ projectId: 'allplays-recording-owner', firestore: { rules } });
        ownerDb = env.authenticatedContext('owner', { email: 'owner@example.com', email_verified: true }).firestore();
    });
    beforeEach(async () => {
        await env.clearFirestore();
        await env.withSecurityRulesDisabled(async (context) => {
            const db = context.firestore();
            await setDoc(doc(db, 'users/owner'), { isAdmin: false });
            await setDoc(doc(db, 'teams/recording-team'), { ownerId: 'owner', adminEmails: [], isPublic: true, active: true });
            await setDoc(doc(db, gamePath), original);
            await setDoc(doc(db, `${gamePath}/events/goal`), { type: 'goal', playerId: 'player-1', clock: 100 });
            await setDoc(doc(db, `${gamePath}/stats/player-1`), { goals: 2, minutes: 20 });
        });
    });
    afterAll(async () => env?.cleanup());

    it('links, reloads, replaces and removes without changing game data or resurrecting a fallback', async () => {
        const ref = doc(ownerDb, gamePath);
        // Both current overlay and legacy replay import this same playback resolver.
        for (const videoId of ['0IuY8Oryi1k', 'dQw4w9WgXcQ']) {
            const replayVideo = buildYouTubeReplayVideo(`https://youtu.be/${videoId}`, {
                linkedBy: 'owner', linkedAt: Timestamp.now()
            });
            await assertSucceeds(updateDoc(ref, { replayVideo, updatedAt: Timestamp.now() }));
            const reloaded = (await getDoc(ref)).data();
            expect(reloaded).toMatchObject(original);
            expect(resolveReplayVideoOptions({ team: {}, game: reloaded, isReplay: true })).toMatchObject({
                hasVideo: true, isRecordedReplay: true,
                publicUrl: `https://www.youtube.com/watch?v=${videoId}`
            });
            await assertFails(updateDoc(ref, { replayVideo: { ...replayVideo, embedUrl: 'https://evil.example/embed' } }));
            await assertFails(updateDoc(ref, { replayVideo: { ...replayVideo, title: 'Mixed edit' }, homeScore: 999 }));
        }
        await assertSucceeds(updateDoc(ref, { replayVideo: null, replayVideoFallbackDisabled: true, updatedAt: Timestamp.now() }));
        const removed = (await getDoc(ref)).data();
        expect(removed).toMatchObject(original);
        expect(resolveReplayVideoOptions({ team: {}, game: removed, isReplay: true }).hasVideo).toBe(false);
        const linkedAgain = buildYouTubeReplayVideo('https://youtu.be/0IuY8Oryi1k', { linkedBy: 'owner', linkedAt: Timestamp.now() });
        await assertSucceeds(updateDoc(ref, { replayVideo: linkedAgain, replayVideoFallbackDisabled: deleteField(), updatedAt: Timestamp.now() }));
        expect(resolveReplayVideoOptions({ team: {}, game: (await getDoc(ref)).data(), isReplay: true }).hasVideo).toBe(true);
        await env.withSecurityRulesDisabled(async (context) => {
            const db = context.firestore();
            expect((await getDoc(doc(db, `${gamePath}/events/goal`))).data()).toEqual({ type: 'goal', playerId: 'player-1', clock: 100 });
            expect((await getDoc(doc(db, `${gamePath}/stats/player-1`))).data()).toEqual({ goals: 2, minutes: 20 });
        });
    });

    it('denies unrelated writers and does not finalize a past scheduled game to accept a recording', async () => {
        const replayVideo = buildYouTubeReplayVideo('https://youtu.be/0IuY8Oryi1k', { linkedBy: 'outsider', linkedAt: Timestamp.now() });
        const outsider = env.authenticatedContext('outsider', { email: 'other@example.com', email_verified: true }).firestore();
        await assertFails(updateDoc(doc(outsider, gamePath), { replayVideo }));
        await env.withSecurityRulesDisabled(async (context) => {
            await updateDoc(doc(context.firestore(), gamePath), { status: 'scheduled' });
        });
        await assertFails(updateDoc(doc(ownerDb, gamePath), { replayVideo: { ...replayVideo, linkedBy: 'owner' } }));
        expect((await getDoc(doc(ownerDb, gamePath))).data().status).toBe('scheduled');
    });
});
