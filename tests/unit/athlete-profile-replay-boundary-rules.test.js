import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
    assertFails,
    assertSucceeds,
    initializeTestEnvironment
} from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc, Timestamp, updateDoc } from 'firebase/firestore';
import { buildReplayNativeCompatibilityRules } from '../../scripts/build-replay-native-compat-rules.mjs';

const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
const compatibilityRules = buildReplayNativeCompatibilityRules(rules);
const deployWorkflow = readFileSync(
    new URL('../../.github/workflows/deploy-prod.yml', import.meta.url),
    'utf8'
);

describe('athlete profile generated replay boundary contract', () => {
    it('freezes intentional clips, generated media, and server mutation markers', () => {
        expect(rules).toContain('function athleteProfileMediaFields()');
        expect(rules).toContain("'clips', 'gameClips', 'seasons',");
        expect(rules).toContain("'profileProjectionMutationId',");
        expect(rules).toContain('.hasAny(athleteProfileMediaFields());');
        expect(rules).toContain('match /systemControls/replayAthleteProfileProjectionBoundary');
    });

    it('generates an exact installed-native compatibility variant without reopening server markers', () => {
        expect(compatibilityRules).toContain('Transitional installed-native compatibility only.');
        expect(compatibilityRules).not.toContain('.hasAny(athleteProfileMediaFields());');
        expect(compatibilityRules).toContain("'profileProjectionMutationId',");
        expect(compatibilityRules).toContain('isReplayArchiveOnlyUpdate()');
        expect(compatibilityRules).toContain('legacy managers may');
        expect(() => buildReplayNativeCompatibilityRules(compatibilityRules)).toThrow(
            'Expected exactly one server-only athlete profile generated-media rules block.'
        );
    });

    it('keeps unrelated final-source constraints intact in the generated compatibility variant', () => {
        const sentinelRules = rules.replace(
            'isBroadcastSessionOnlyUpdate() &&',
            '/* structured-provider-final-sentinel */ isBroadcastSessionOnlyUpdate() &&'
        );
        expect(buildReplayNativeCompatibilityRules(sentinelRules)).toContain(
            '/* structured-provider-final-sentinel */'
        );
        expect(compatibilityRules).toContain('hasNoReadableCompletedReplayFallback(request.resource.data)');
    });

    it('stages callables only until broad native readiness, then freezes before migration', () => {
        const freezeActivation = deployWorkflow.indexOf(
            'activate_firestore_ruleset_with_retry "$replay_final_ruleset_name"'
        );
        const freezeVerification = deployWorkflow.indexOf(
            'verify_active_firestore_rules "$replay_final_rules_source"'
        );
        const closeGate = deployWorkflow.indexOf(
            'backfill-game-replay-archives.mjs" --close-gate'
        );
        const callableDeploy = deployWorkflow.indexOf(
            '"replay-private-archive-reader-compatibility"'
        );
        const hostingDeploy = deployWorkflow.indexOf(
            '"replay-callable-client-compatibility"'
        );
        const nativeHold = deployWorkflow.indexOf(
            'if [[ "$replay_native_callable_ready" != "true" ]]'
        );
        const boundaryActivation = deployWorkflow.indexOf(
            'backfill-game-replay-archives.mjs" --activate-profile-boundary'
        );
        const migration = deployWorkflow.indexOf(
            'backfill-game-replay-archives.mjs" --apply'
        );

        expect(deployWorkflow).toContain(
            'REPLAY_NATIVE_CALLABLE_READY: ${{ vars.REPLAY_NATIVE_CALLABLE_READY }}'
        );
        expect(deployWorkflow).toContain(
            'functions:manageGameReplayArchive,functions:saveGameHighlightClips,functions:saveAthleteProfileProjection,functions:mutateStructuredMediaIdentity'
        );
        expect(deployWorkflow).toContain(
            'team fixed video, typed team media links, drills, and athlete clips'
        );
        expect(deployWorkflow).toContain('scripts/build-replay-native-compat-rules.mjs');
        expect(callableDeploy).toBeGreaterThan(-1);
        expect(nativeHold).toBeGreaterThan(callableDeploy);
        expect(hostingDeploy).toBeGreaterThan(nativeHold);
        expect(freezeActivation).toBeGreaterThan(hostingDeploy);
        expect(freezeVerification).toBeGreaterThan(freezeActivation);
        expect(closeGate).toBeGreaterThan(freezeVerification);
        expect(boundaryActivation).toBeGreaterThan(closeGate);
        expect(migration).toBeGreaterThan(boundaryActivation);
        const falseReadinessBlock = deployWorkflow.slice(nativeHold, hostingDeploy);
        expect(falseReadinessBlock).toContain('write_replay_native_hold_summary');
        expect(falseReadinessBlock).toContain('exit 2');
        expect(falseReadinessBlock).not.toContain('--close-gate');
        expect(falseReadinessBlock).not.toContain('--activate-profile-boundary');
        expect(falseReadinessBlock).not.toContain('activate_firestore_ruleset_with_retry');
        expect(deployWorkflow).toContain('active_replay_boundary="$baseline_replay_mode"');
    });
});

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)(
    'athlete profile generated replay compatibility rules engine coverage',
    () => {
        let compatibilityEnv;

        beforeAll(async () => {
            compatibilityEnv = await initializeTestEnvironment({
                projectId: `allplays-athlete-profile-replay-compat-${Date.now()}`,
                firestore: { rules: compatibilityRules }
            });
        }, 30_000);

        beforeEach(async () => {
            await compatibilityEnv.clearFirestore();
            await compatibilityEnv.withSecurityRulesDisabled(async (context) => {
                await setDoc(doc(context.firestore(), 'securityPolicies/verifiedEmail'), {
                    mode: 'observe',
                    exemptUserIds: []
                });
                await setDoc(doc(context.firestore(), 'teams/team-1'), {
                    ownerId: 'parent-1',
                    adminEmails: []
                });
                await setDoc(doc(context.firestore(), 'teams/team-1/games/game-1'), {
                    type: 'game',
                    status: 'completed',
                    liveStatus: 'completed'
                });
            });
        });

        afterAll(async () => {
            await compatibilityEnv?.cleanup();
        });

        it('preserves generated media writes for installed clients but never permits marker writes', async () => {
            const firestore = compatibilityEnv.authenticatedContext('parent-1', {
                email: 'parent-1@example.test',
                email_verified: true
            }).firestore();
            await assertSucceeds(setDoc(doc(firestore, 'athleteProfiles/legacy-profile'), {
                parentUserId: 'parent-1',
                privacy: 'public',
                clips: [{ url: 'https://youtu.be/zyxwvutsrqp' }],
                gameClips: [{ url: 'https://youtu.be/abcdefghijk' }],
                seasons: [{ gameClips: [{ url: 'https://youtu.be/abcdefghijk' }] }]
            }));
            await assertFails(updateDoc(doc(firestore, 'athleteProfiles/legacy-profile'), {
                profileProjectionMutationId: 'forged-client-marker'
            }));
        });

        it('preserves the bounded legacy replay mutation and replay-bearing delete paths', async () => {
            const firestore = compatibilityEnv.authenticatedContext('parent-1', {
                email: 'parent-1@example.test',
                email_verified: true
            }).firestore();
            await assertSucceeds(updateDoc(doc(firestore, 'teams/team-1/games/game-1'), {
                replayVideo: {
                    provider: 'youtube',
                    videoId: 'abcdefghijk',
                    embedUrl: 'https://www.youtube.com/embed/abcdefghijk',
                    publicUrl: 'https://www.youtube.com/watch?v=abcdefghijk',
                    status: 'ready',
                    linkedBy: 'parent-1',
                    linkedAt: Timestamp.now()
                }
            }));
            await assertSucceeds(deleteDoc(doc(firestore, 'teams/team-1/games/game-1')));
        });
    }
);

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)(
    'athlete profile generated replay boundary rules engine coverage',
    () => {
        let testEnv;

        beforeAll(async () => {
            testEnv = await initializeTestEnvironment({
                projectId: `allplays-athlete-profile-replay-${Date.now()}`,
                firestore: { rules }
            });
        }, 30_000);

        beforeEach(async () => {
            await testEnv.clearFirestore();
            await testEnv.withSecurityRulesDisabled(async (context) => {
                const firestore = context.firestore();
                await setDoc(doc(firestore, 'securityPolicies/verifiedEmail'), {
                    mode: 'observe',
                    exemptUserIds: []
                });
                await setDoc(doc(firestore, 'athleteProfiles/profile-1'), {
                    parentUserId: 'parent-1',
                    privacy: 'public',
                    athlete: { name: 'Athlete One' },
                    bio: { hometown: 'Chicago' },
                    clips: [{ id: 'intentional', url: 'https://youtu.be/zyxwvutsrqp' }],
                    gameClips: [{ id: 'game-1-clip', url: 'https://youtu.be/abcdefghijk' }],
                    seasons: [{
                        seasonKey: 'team-1::player-1',
                        gameClips: [{ id: 'game-1-clip', url: 'https://youtu.be/abcdefghijk' }]
                    }],
                    profileProjectionSchemaVersion: 1,
                    profileProjectionMutationId: 'server-mutation-1',
                    profileProjectionMutationHash: 'a'.repeat(64)
                });
                await setDoc(doc(firestore, 'systemControls/replayAthleteProfileProjectionBoundary'), {
                    schema: 'replay-athlete-profile-projection-boundary',
                    version: 1,
                    status: 'ready'
                });
                await setDoc(doc(firestore, 'teams/team-1'), {
                    ownerId: 'parent-1',
                    adminEmails: []
                });
                await setDoc(doc(firestore, 'teams/team-1/games/game-1'), {
                    type: 'game',
                    status: 'completed',
                    liveStatus: 'completed'
                });
            });
        });

        afterAll(async () => {
            await testEnv?.cleanup();
        });

        function parentDb(uid = 'parent-1') {
            return testEnv.authenticatedContext(uid, {
                email: `${uid}@example.test`,
                email_verified: true
            }).firestore();
        }

        it('allows only a media-free owner reservation on direct create', async () => {
            const firestore = parentDb();
            await assertSucceeds(setDoc(doc(firestore, 'athleteProfiles/reservation-1'), {
                parentUserId: 'parent-1',
                mediaUploadReservation: true
            }));
            await assertFails(setDoc(doc(firestore, 'athleteProfiles/stale-create'), {
                parentUserId: 'parent-1',
                privacy: 'public',
                gameClips: [{ url: 'https://youtu.be/abcdefghijk' }],
                seasons: []
            }));
        });

        it('rejects intentional and generated clip changes while allowing unrelated edits with byte-identical media', async () => {
            const firestore = parentDb();
            const profileRef = doc(firestore, 'athleteProfiles/profile-1');
            const current = (await getDoc(profileRef)).data();

            await assertSucceeds(setDoc(profileRef, {
                ...current,
                bio: { hometown: 'Evanston' }
            }, { merge: true }));

            await assertFails(updateDoc(profileRef, {
                clips: [
                    ...current.clips,
                    { id: 'intentional-2', url: 'https://youtu.be/lmnopqrstuv' }
                ]
            }));

            await assertFails(updateDoc(profileRef, {
                gameClips: [
                    ...current.gameClips,
                    { id: 'stale-copy', url: 'https://youtu.be/abcdefghijk' }
                ]
            }));
            await assertFails(updateDoc(profileRef, {
                seasons: [{
                    ...current.seasons[0],
                    gameClips: [
                        ...current.seasons[0].gameClips,
                        { id: 'stale-copy', url: 'https://youtu.be/abcdefghijk' }
                    ]
                }]
            }));
        });

        it('rejects direct mutation of server reconciliation markers and all client access to the rollout control', async () => {
            const firestore = parentDb();
            await assertFails(updateDoc(doc(firestore, 'athleteProfiles/profile-1'), {
                profileProjectionMutationId: 'forged-client-marker'
            }));
            await assertFails(getDoc(doc(
                firestore,
                'systemControls/replayAthleteProfileProjectionBoundary'
            )));
            await assertFails(setDoc(doc(
                firestore,
                'systemControls/replayAthleteProfileProjectionBoundary'
            ), {
                schema: 'replay-athlete-profile-projection-boundary',
                version: 1,
                status: 'ready'
            }));
            const receiptRef = doc(
                firestore,
                `athleteProfileProjectionMutations/${'a'.repeat(64)}`
            );
            await assertFails(getDoc(receiptRef));
            await assertFails(setDoc(receiptRef, {
                schema: 'athlete-profile-projection-mutation',
                version: 1,
                profileId: 'profile-1',
                mutationId: 'forged-client-mutation',
                requestHash: 'b'.repeat(64),
                committedAt: Timestamp.now()
            }));
        });

        it('keeps another signed-in parent outside the profile boundary', async () => {
            const firestore = parentDb('parent-2');
            await assertFails(updateDoc(doc(firestore, 'athleteProfiles/profile-1'), {
                bio: { hometown: 'Unauthorized' }
            }));
        });

        it('denies the same legacy replay mutation and replay-bearing delete after finalization', async () => {
            const firestore = parentDb();
            const gameRef = doc(firestore, 'teams/team-1/games/game-1');
            await assertFails(updateDoc(gameRef, {
                replayVideo: {
                    provider: 'youtube',
                    videoId: 'abcdefghijk',
                    embedUrl: 'https://www.youtube.com/embed/abcdefghijk',
                    publicUrl: 'https://www.youtube.com/watch?v=abcdefghijk',
                    status: 'ready',
                    linkedBy: 'parent-1',
                    linkedAt: Timestamp.now()
                }
            }));
            await testEnv.withSecurityRulesDisabled(async (context) => {
                await updateDoc(doc(context.firestore(), 'teams/team-1/games/game-1'), {
                    replayVideoUrl: 'https://www.youtube.com/watch?v=abcdefghijk'
                });
            });
            await assertFails(deleteDoc(gameRef));
        });
    }
);
