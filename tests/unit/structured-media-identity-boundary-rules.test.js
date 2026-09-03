import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
    assertFails,
    assertSucceeds,
    initializeTestEnvironment
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { buildReplayNativeCompatibilityRules } from '../../scripts/build-replay-native-compat-rules.mjs';

const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
const compatibilityRules = buildReplayNativeCompatibilityRules(rules);
const deployWorkflow = readFileSync(
    new URL('../../.github/workflows/deploy-prod.yml', import.meta.url),
    'utf8'
);

describe('structured media identity write boundary contract', () => {
    it('freezes every finite identity-bearing field only in final rules', () => {
        expect(rules).toContain('function teamReplayArchiveFields()');
        expect(rules).toContain('.hasAny(teamReplayArchiveFields())');
        expect(rules).toContain('function teamMediaVideoUrlFields()');
        expect(rules).toContain(".hasAny(teamMediaVideoUrlFields().concat(['type', 'mediaType']))");
        expect(rules).toContain('function drillVideoUrlFields()');
        expect(rules).toContain('.hasAny(drillVideoUrlFields())');
        expect(rules).toContain('function athleteProfileMediaFields()');
        expect(rules).toContain('.hasAny(athleteProfileMediaFields())');
        expect(rules).toContain("'clips', 'gameClips', 'seasons',");

        expect(compatibilityRules).toContain(
            'mutateStructuredMediaIdentity for fixed team video fields'
        );
        expect(compatibilityRules).toContain(
            'mutateStructuredMediaIdentity for typed video-link creation/removal'
        );
        expect(compatibilityRules).not.toContain(
            '!request.resource.data.keys().hasAny(drillVideoUrlFields())'
        );
        expect(compatibilityRules).not.toContain(
            '.hasAny(athleteProfileMediaFields());'
        );
    });

    it('keeps both identity ledgers server-only', () => {
        expect(rules).toContain('match /replayProtectedIdentities/{identityId}');
        expect(rules).toContain('match /replayClipIdentities/{identityId}');
        expect(rules).toContain('allow read, write: if false;');
    });

    it('stages the structured mutation callable before the native hold, Hosting, and final rules', () => {
        const stagedTargets = deployWorkflow.indexOf(
            'functions:saveAthleteProfileProjection,functions:mutateStructuredMediaIdentity'
        );
        const callableDeploy = deployWorkflow.indexOf(
            '"replay-private-archive-reader-compatibility"'
        );
        const nativeHold = deployWorkflow.indexOf(
            'if [[ "$replay_native_callable_ready" != "true" ]]'
        );
        const hostingDeploy = deployWorkflow.indexOf(
            '"replay-callable-client-compatibility"'
        );
        const finalRules = deployWorkflow.indexOf(
            'activate_firestore_ruleset_with_retry "$replay_final_ruleset_name"'
        );

        expect(stagedTargets).toBeGreaterThan(-1);
        expect(callableDeploy).toBeGreaterThan(stagedTargets);
        expect(nativeHold).toBeGreaterThan(callableDeploy);
        expect(hostingDeploy).toBeGreaterThan(nativeHold);
        expect(finalRules).toBeGreaterThan(hostingDeploy);
        expect(deployWorkflow).toContain(
            '`manageGameReplayArchive`, `saveGameHighlightClips`, `saveAthleteProfileProjection`, and `mutateStructuredMediaIdentity`'
        );
    });
});

function installRulesEngineSuite(label, source, { compatibility }) {
    describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)(label, () => {
        let testEnv;

        beforeAll(async () => {
            testEnv = await initializeTestEnvironment({
                projectId: `allplays-structured-media-${compatibility ? 'compat' : 'final'}-${Date.now()}`,
                firestore: { rules: source }
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
                await setDoc(doc(firestore, 'teams/team-1'), {
                    ownerId: 'owner-1',
                    adminEmails: [],
                    name: 'Vipers'
                });
                await setDoc(doc(firestore, 'teams/team-1/mediaItems/video-1'), {
                    folderId: 'folder-1',
                    title: 'Replay',
                    type: 'video-link',
                    url: 'https://youtu.be/abcdefghijk'
                });
                await setDoc(doc(firestore, 'drillLibrary/drill-1'), {
                    source: 'custom',
                    teamId: 'team-1',
                    createdBy: 'owner-1',
                    title: 'Passing drill',
                    publishedToCommunity: false
                });
                await setDoc(doc(firestore, 'athleteProfiles/profile-1'), {
                    parentUserId: 'owner-1',
                    privacy: 'public',
                    clips: []
                });
            });
        });

        afterAll(async () => {
            await testEnv?.cleanup();
        });

        function ownerDb() {
            return testEnv.authenticatedContext('owner-1', {
                email: 'owner@example.test',
                email_verified: true
            }).firestore();
        }

        if (compatibility) {
            it('retains legacy direct identity writers until native readiness is proven', async () => {
                const firestore = ownerDb();
                await assertSucceeds(updateDoc(doc(firestore, 'teams/team-1'), {
                    streamEmbedUrl: 'https://www.youtube.com/embed/abcdefghijk'
                }));
                await assertSucceeds(setDoc(doc(firestore, 'teams/team-1/mediaItems/video-2'), {
                    folderId: 'folder-1',
                    title: 'Second replay',
                    type: 'video-link',
                    url: 'https://youtu.be/lmnopqrstuv'
                }));
                await assertSucceeds(updateDoc(doc(firestore, 'drillLibrary/drill-1'), {
                    resourceUrl: 'https://youtu.be/lmnopqrstuv'
                }));
                await assertSucceeds(updateDoc(doc(firestore, 'athleteProfiles/profile-1'), {
                    clips: [{ url: 'https://youtu.be/lmnopqrstuv' }]
                }));
            });
        } else {
            it('rejects direct identity changes while preserving unrelated edits and removals', async () => {
                const firestore = ownerDb();
                await assertFails(updateDoc(doc(firestore, 'teams/team-1'), {
                    streamEmbedUrl: 'https://www.youtube.com/embed/lmnopqrstuv'
                }));
                await assertSucceeds(updateDoc(doc(firestore, 'teams/team-1'), {
                    name: 'Vipers 2030'
                }));

                await assertFails(setDoc(doc(firestore, 'teams/team-1/mediaItems/video-2'), {
                    folderId: 'folder-1',
                    title: 'Second replay',
                    type: 'video-link',
                    url: 'https://youtu.be/lmnopqrstuv'
                }));
                await assertFails(updateDoc(doc(firestore, 'teams/team-1/mediaItems/video-1'), {
                    url: 'https://youtu.be/lmnopqrstuv'
                }));
                await assertSucceeds(updateDoc(doc(firestore, 'teams/team-1/mediaItems/video-1'), {
                    title: 'Renamed replay'
                }));

                await assertFails(updateDoc(doc(firestore, 'drillLibrary/drill-1'), {
                    youtubeUrl: 'https://youtu.be/lmnopqrstuv'
                }));
                await assertSucceeds(updateDoc(doc(firestore, 'drillLibrary/drill-1'), {
                    title: 'Renamed drill'
                }));
                await assertFails(updateDoc(doc(firestore, 'athleteProfiles/profile-1'), {
                    clips: [{ url: 'https://youtu.be/lmnopqrstuv' }]
                }));
            });

            it('denies client access to permanent and protected identity ledgers', async () => {
                const firestore = ownerDb();
                for (const collection of ['replayProtectedIdentities', 'replayClipIdentities']) {
                    const ref = doc(firestore, `${collection}/youtube:${'a'.repeat(64)}`);
                    await assertFails(getDoc(ref));
                    await assertFails(setDoc(ref, {
                        schema: collection,
                        version: 1,
                        kind: 'youtube',
                        identityHash: 'a'.repeat(64)
                    }));
                }
            });
        }
    });
}

installRulesEngineSuite(
    'structured media compatibility rules engine coverage',
    compatibilityRules,
    { compatibility: true }
);
installRulesEngineSuite(
    'structured media final rules engine coverage',
    rules,
    { compatibility: false }
);
