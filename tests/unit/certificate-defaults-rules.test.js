import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
    assertFails,
    assertSucceeds,
    initializeTestEnvironment
} from '@firebase/rules-unit-testing';
import {
    deleteDoc,
    doc,
    getDoc,
    setDoc,
    updateDoc
} from 'firebase/firestore';
import { buildCertificateDefaultsCompatibilityRules } from '../../scripts/build-certificate-defaults-compat-rules.mjs';
import { compactFirestoreRules } from '../../scripts/compact-firestore-rules.mjs';

const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
const compatibilityRules = compactFirestoreRules(buildCertificateDefaultsCompatibilityRules(rules));
const deployWorkflow = readFileSync(new URL('../../.github/workflows/deploy-prod.yml', import.meta.url), 'utf8');
const repositoryInstructions = readFileSync(new URL('../../AGENTS.md', import.meta.url), 'utf8');

describe('certificate defaults Firestore rules', () => {
    it('keeps shared defaults readable to team admins but server-writable only', () => {
        expect(rules).toMatch(/match \/settings\/\{settingId\}[\s\S]*allow read:[\s\S]*certificateDefaults/);
        expect(rules).toMatch(/match \/settings\/\{settingId\}[\s\S]*allow create, update, delete: if false;/);
    });

    it('requires saved-output writers to serialize with signature retirement', () => {
        expect(repositoryInstructions).toMatch(
            /durable retired-reference deny-list[\s\S]*reject creates or changed snapshots[\s\S]*signature reference remains byte-for-byte unchanged[\s\S]*real Firestore Rules race regression/
        );
        expect(rules).toContain('retiredSignatureImageUrls');
        expect(rules).toContain('isCertificateOutputUpdateSafe');
        expect(rules).toContain('isCertificateBatchUpdateSafe');
    });

    it('builds a narrowly scoped transitional ruleset', () => {
        const sourceCompatibilityRules = buildCertificateDefaultsCompatibilityRules(rules);

        expect(sourceCompatibilityRules).toContain('isLegacyCertificateDefaultsCreateSafe(request.resource.data)');
        expect(sourceCompatibilityRules).toContain('isLegacyCertificateDefaultsUpdateSafe()');
        expect(sourceCompatibilityRules).toContain('allow delete: if false;');
        expect(sourceCompatibilityRules).not.toContain(
            '// All writes must cross the callable\'s trusted provenance/tombstone checks.'
        );
        expect(() => buildCertificateDefaultsCompatibilityRules(sourceCompatibilityRules)).toThrow(
            'Expected exactly one server-only certificate defaults rules block.'
        );
    });

    it('keeps installed native callers compatible and gates the final denial after updated callers', () => {
        const compatibilityCleanup = deployWorkflow.indexOf('certificate-signature-cleanup-compatibility');
        const compatibilityFunction = deployWorkflow.indexOf('certificate-defaults-writer-compatibility');
        const firestoreChangeBranch = deployWorkflow.indexOf('if [[ "$FIRESTORE_CONFIG_CHANGED" == "true" ]]');
        const compatibilityRules = deployWorkflow.indexOf('certificate-defaults-rules-compatibility');
        const application = deployWorkflow.indexOf('retry_firebase_deploy "hosting,functions" "application"');
        const finalRules = deployWorkflow.indexOf('certificate-defaults-rules-final');
        const nativeReadinessGate = deployWorkflow.indexOf('[[ "$native_callable_ready" == "true" ]]');

        expect(compatibilityCleanup).toBeGreaterThan(-1);
        expect(compatibilityCleanup).toBeLessThan(firestoreChangeBranch);
        expect(compatibilityFunction).toBeGreaterThan(compatibilityCleanup);
        expect(compatibilityFunction).toBeGreaterThan(-1);
        expect(compatibilityRules).toBeGreaterThan(compatibilityFunction);
        expect(application).toBeGreaterThan(compatibilityRules);
        expect(finalRules).toBeGreaterThan(application);
        expect(nativeReadinessGate).toBeGreaterThan(compatibilityRules);
        expect(nativeReadinessGate).toBeLessThan(application);
        expect(deployWorkflow).toContain('native_callable_ready="${CERTIFICATE_DEFAULTS_NATIVE_CALLABLE_READY:-false}"');
        expect(deployWorkflow).toContain(
            'Keeping certificate-defaults compatibility rules until supported installed native versions use the callable.'
        );
        expect(deployWorkflow).toMatch(
            /baseline_firestore_mode" == "compatibility"[\s\S]*firestore_component_description="Firestore compatibility rules at/
        );
        expect(deployWorkflow).toMatch(
            /native_callable_ready" == "true"[\s\\]*&& "\$CERTIFICATE_DEFAULTS_LOCKDOWN_NEEDED" == "true"[\s\S]*FIRESTORE_CONFIG_CHANGED="true"/
        );
    });

    it('blocks unreadable or unrecognized active rules instead of reopening compatibility', () => {
        expect(deployWorkflow).toMatch(
            /verify_active_firestore_rules\(\)[\s\S]*release_json[\s\S]*return 2[\s\S]*ruleset_json[\s\S]*return 2/
        );
        expect(deployWorkflow).toContain('active_rules_variant="baseline-${baseline_firestore_mode}"');
        expect(deployWorkflow).toContain(
            'active Firestore rules did not match a trusted final or compatibility baseline'
        );
        expect(deployWorkflow).toContain('[[ "$active_rules_variant" == *-final ]]');
        expect(deployWorkflow).toContain('firestore-baseline-compat.rules');
        expect(deployWorkflow).toContain('advancing its SHA and forcing live mode classification');
        expect(deployWorkflow).toContain('The protected native-readiness gate can finalize the same');
        expect(deployWorkflow).toContain(
            'The latest prior production run identity is missing or did not produce the active component marker; forcing live mode classification.'
        );
        expect(deployWorkflow).toContain('deployment_log_url=');
        expect(deployWorkflow).toContain('select((.id | tostring) != $current)');
        expect(deployWorkflow).toMatch(
            /! "\$latest_prior_run_id" =~ \^\[0-9\]\+\$[\s\S]*! "\$firestore_success_run_id" =~ \^\[0-9\]\+\$[\s\S]*"\$firestore_success_run_id" != "\$latest_prior_run_id"/
        );
        expect(deployWorkflow).toMatch(
            /No valid successful production deploy baseline was found[\s\S]*component_marker_found" == "true"[\s\S]*firestore_baseline_sha=\$firestore_success_sha[\s\S]*Preserving the durable Firestore component baseline despite unavailable successful workflow history/
        );
        expect(deployWorkflow).toMatch(
            /last successful production deploy commit is unavailable locally[\s\S]*conservatively enabling every non-Firestore migration/
        );
        expect(deployWorkflow).toMatch(
            /component_page=1[\s\S]*per_page=100[\s\S]*page="\$component_page"[\s\S]*deployment_page_count < 100[\s\S]*component_page=\$\(\(component_page \+ 1\)\)/
        );
        expect(deployWorkflow).toContain('[.[] | select(.state == "success")][0] // empty');
        expect(deployWorkflow).toMatch(
            /Pre-migration baselines already contain the legacy direct-write[\s\S]*FIRESTORE_BASELINE_MODE="compatibility"[\s\S]*firestore-baseline\.mode/
        );
        expect(deployWorkflow).toContain(
            'The Firestore component deployment lookup failed; the active release mode is unknown.'
        );
        expect(deployWorkflow).toContain('firestore_success_mode="ambiguous"');
        expect(deployWorkflow).toContain('forcing live exact-source classification');
    });

    describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('transitional emulator coverage', () => {
        let compatibilityEnv;

        beforeAll(async () => {
            compatibilityEnv = await initializeTestEnvironment({
                projectId: `allplays-certificate-defaults-compat-${Date.now()}`,
                firestore: { rules: compatibilityRules }
            });
        }, 30000);

        beforeEach(async () => {
            await compatibilityEnv.clearFirestore();
            await compatibilityEnv.withSecurityRulesDisabled(async (context) => {
                await setDoc(doc(context.firestore(), 'teams/team-a'), {
                    ownerId: 'owner-a',
                    adminEmails: []
                });
            });
        });

        afterAll(async () => {
            await compatibilityEnv?.cleanup();
        });

        it('keeps only authorized legacy defaults writes open during caller rollout', async () => {
            const ownerDb = compatibilityEnv.authenticatedContext('owner-a').firestore();
            const outsiderDb = compatibilityEnv.authenticatedContext('outsider').firestore();
            const defaultsPath = 'teams/team-a/settings/certificateDefaults';

            await assertSucceeds(setDoc(doc(ownerDb, defaultsPath), { signers: [] }));
            await assertFails(setDoc(doc(outsiderDb, defaultsPath), { signers: [] }));
        });

        it('keeps the server retirement deny-list immutable for legacy callers', async () => {
            await compatibilityEnv.withSecurityRulesDisabled(async (context) => {
                await setDoc(doc(context.firestore(), 'teams/team-a/settings/certificateDefaults'), {
                    signers: [],
                    retiredSignatureImageUrls: ['https://images.example.test/retired-signature.png']
                });
            });
            const ownerDb = compatibilityEnv.authenticatedContext('owner-a').firestore();
            const defaultsRef = doc(ownerDb, 'teams/team-a/settings/certificateDefaults');

            await assertSucceeds(updateDoc(defaultsRef, { signers: [{ name: 'Coach' }] }));
            await assertFails(updateDoc(defaultsRef, { retiredSignatureImageUrls: [] }));
            await assertFails(updateDoc(defaultsRef, {
                signers: [{
                    name: 'Coach',
                    signatureImageUrl: 'https://images.example.test/new-signature.png',
                    signatureImagePath: 'certificate-signatures/teams/team-a/new-signature.png'
                }]
            }));
            await assertFails(deleteDoc(defaultsRef));
        });
    });

    describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('emulator authorization coverage', () => {
        let testEnv;

        beforeAll(async () => {
            testEnv = await initializeTestEnvironment({
                projectId: `allplays-certificate-defaults-${Date.now()}`,
                firestore: { rules }
            });
        }, 30000);

        beforeEach(async () => {
            await testEnv.clearFirestore();
            await testEnv.withSecurityRulesDisabled(async (context) => {
                const firestore = context.firestore();
                await setDoc(doc(firestore, 'teams/team-a'), {
                    ownerId: 'owner-a',
                    adminEmails: ['admin-a@example.com']
                });
                await setDoc(doc(firestore, 'teams/team-a/settings/certificateDefaults'), {
                    retiredSignatureImageUrls: ['https://images.example.test/retired-signature.png'],
                    signers: [{
                        signatureImageUrl: 'https://images.example.test/current-signature.png',
                        signatureImagePath: 'certificate-signatures/teams/team-a/current.png'
                    }]
                });
                await setDoc(doc(firestore, 'teams/team-a/certificateSignatureCleanup/server-job'), {
                    teamId: 'team-a',
                    storagePath: 'certificate-signatures/teams/team-a/retired.png',
                    status: 'completed'
                });
                await setDoc(doc(firestore, 'teams/team-a/certificates/historical'), {
                    signers: [{ signatureImageUrl: 'https://images.example.test/retired-signature.png' }],
                    status: 'published'
                });
                await setDoc(doc(firestore, 'teams/team-a/certificates/clean'), {
                    signers: [{ signatureImageUrl: 'https://images.example.test/current-signature.png' }],
                    status: 'draft'
                });
                await setDoc(doc(firestore, 'teams/team-a/certificateBatches/historical'), {
                    shared: {
                        signers: [{ signatureImageUrl: 'https://images.example.test/retired-signature.png' }]
                    },
                    status: 'published'
                });
                await setDoc(doc(firestore, 'teams/team-a/certificateBatches/clean'), {
                    shared: {
                        signers: [{ signatureImageUrl: 'https://images.example.test/current-signature.png' }]
                    },
                    status: 'draft'
                });
            });
        });

        afterAll(async () => {
            await testEnv?.cleanup();
        });

        it('allows owner/admin reads while denying every client defaults mutation', async () => {
            const ownerDb = testEnv.authenticatedContext('owner-a').firestore();
            const adminDb = testEnv.authenticatedContext('admin-a', { email: 'admin-a@example.com' }).firestore();
            const defaultsPath = 'teams/team-a/settings/certificateDefaults';

            await assertSucceeds(getDoc(doc(ownerDb, defaultsPath)));
            await assertSucceeds(getDoc(doc(adminDb, defaultsPath)));
            await assertFails(updateDoc(doc(ownerDb, defaultsPath), { signers: [] }));
            await assertFails(setDoc(doc(adminDb, defaultsPath), { signers: [] }));
            await assertFails(deleteDoc(doc(ownerDb, defaultsPath)));
        });

        it('keeps cleanup tombstones private and server-writable only', async () => {
            const ownerDb = testEnv.authenticatedContext('owner-a').firestore();
            const cleanupPath = 'teams/team-a/certificateSignatureCleanup/server-job';

            await assertFails(getDoc(doc(ownerDb, cleanupPath)));
            await assertFails(updateDoc(doc(ownerDb, cleanupPath), { status: 'pending' }));
            await assertFails(setDoc(doc(ownerDb, 'teams/team-a/certificateSignatureCleanup/forged'), {
                teamId: 'team-a',
                storagePath: 'certificate-signatures/users/victim/known.png',
                requestedBy: 'owner-a',
                status: 'pending'
            }));
        });

        it('rejects stale certificate and batch references after signature retirement', async () => {
            const ownerDb = testEnv.authenticatedContext('owner-a').firestore();
            const retiredSigner = [{ signatureImageUrl: 'https://images.example.test/retired-signature.png' }];
            const currentSigner = [{ signatureImageUrl: 'https://images.example.test/current-signature.png' }];

            await assertFails(setDoc(doc(ownerDb, 'teams/team-a/certificates/stale-create'), {
                signers: retiredSigner,
                status: 'draft'
            }));
            await assertFails(setDoc(doc(ownerDb, 'teams/team-a/certificateBatches/stale-create'), {
                shared: { signers: retiredSigner },
                status: 'draft'
            }));
            await assertFails(updateDoc(doc(ownerDb, 'teams/team-a/certificates/clean'), {
                signers: retiredSigner
            }));
            await assertFails(updateDoc(doc(ownerDb, 'teams/team-a/certificateBatches/clean'), {
                shared: { signers: retiredSigner }
            }));

            await assertSucceeds(setDoc(doc(ownerDb, 'teams/team-a/certificates/current-create'), {
                signers: currentSigner,
                status: 'draft'
            }));
            await assertSucceeds(setDoc(doc(ownerDb, 'teams/team-a/certificateBatches/current-create'), {
                shared: { signers: currentSigner },
                status: 'draft'
            }));
        });

        it('allows unrelated edits to historical outputs without reintroducing their signature', async () => {
            const ownerDb = testEnv.authenticatedContext('owner-a').firestore();

            await assertSucceeds(updateDoc(doc(ownerDb, 'teams/team-a/certificates/historical'), {
                status: 'archived'
            }));
            await assertSucceeds(updateDoc(doc(ownerDb, 'teams/team-a/certificateBatches/historical'), {
                status: 'archived'
            }));
        });
    });
});
