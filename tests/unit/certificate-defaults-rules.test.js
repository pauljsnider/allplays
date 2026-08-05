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
const functionsSource = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');

describe('certificate defaults Firestore rules', () => {
    it('uses the shared canonical-owner authorization boundary in the server writer', () => {
        const helperStart = functionsSource.indexOf('async function requireCertificateTeamAdmin');
        const helperEnd = functionsSource.indexOf('\nfunction getCertificateSignatureCleanupId', helperStart);
        const helperSource = functionsSource.slice(helperStart, helperEnd);

        expect(helperSource).toContain('hasTeamAdminAccess({');
        expect(helperSource).not.toContain('ownerEmails.includes(callerEmail)');
    });

    it('keeps shared defaults readable to team admins but server-writable only', () => {
        expect(rules).toMatch(/match \/settings\/\{settingId\}[\s\S]*allow read:[\s\S]*certificateDefaults/);
        expect(rules).toMatch(/match \/settings\/\{settingId\}[\s\S]*allow create, update, delete: if false;/);
    });

    it('requires saved-output writers to serialize with signature retirement', () => {
        expect(repositoryInstructions).toMatch(/Canonicalize the Storage identity to bucket[\s\S]*immutable generation/);
        expect(repositoryInstructions).toMatch(
            /durable retired-object deny-list[\s\S]*reject every URL\/token\/encoding alias[\s\S]*signature URL and path remain byte-for-byte unchanged[\s\S]*Firestore Rules race regressions/
        );
        expect(rules).toContain('retiredSignatureImagePaths');
        expect(rules).toContain('certificateSignersHaveCanonicalImagePaths');
        expect(rules).toContain('certificateSignersUseCurrentImages');
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
        const inventoryProducer = deployWorkflow.indexOf('certificate-signature-inventory-producer');
        const inventoryBackfill = deployWorkflow.indexOf('backfill-certificate-legacy-signature-inventory.mjs" --apply');
        const compatibilityCleanup = deployWorkflow.indexOf('certificate-signature-cleanup-compatibility');
        const compatibilityFunction = deployWorkflow.indexOf('certificate-defaults-writer-compatibility');
        const firestoreChangeBranch = deployWorkflow.indexOf('if [[ "$FIRESTORE_CONFIG_CHANGED" == "true" ]]');
        const compatibilityRules = deployWorkflow.indexOf('certificate-defaults-rules-compatibility');
        const application = deployWorkflow.indexOf('retry_firebase_deploy "hosting,functions" "application"');
        const finalRules = deployWorkflow.indexOf('certificate-defaults-rules-final');
        const nativeReadinessGate = deployWorkflow.indexOf('[[ "$native_callable_ready" == "true" ]]');

        expect(inventoryProducer).toBeGreaterThan(-1);
        expect(deployWorkflow).toContain(
            'retry_enabled_inventory_producer_target="functions:indexCertificateLegacySignaturesOnDefaultsWrite"'
        );
        expect(deployWorkflow).toContain(
            'retry_enabled_cleanup_compatibility_target="functions:cleanupCertificateSignature"'
        );
        expect(deployWorkflow).toContain(
            '&& "$deploy_targets" != "$retry_enabled_inventory_producer_target" \\'
        );
        expect(deployWorkflow).toContain(
            '&& "$deploy_targets" != "$retry_enabled_cleanup_compatibility_target" ]]; then'
        );
        expect(deployWorkflow).toMatch(
            /retry_firebase_deploy\s+\\\s+"\$retry_enabled_inventory_producer_target"\s+\\\s+"certificate-signature-inventory-producer"\s+\\\s+3\s+\\\s+15\s+\\\s+true/
        );
        expect(deployWorkflow).toMatch(
            /retry_firebase_deploy\s+\\\s+"\$retry_enabled_cleanup_compatibility_target"\s+\\\s+"certificate-signature-cleanup-compatibility"\s+\\\s+3\s+\\\s+15\s+\\\s+true/
        );
        expect(deployWorkflow).toContain('cp _migration/firebase-admin-credential.mjs \\');
        expect(deployWorkflow).toContain(
            'test -f "$bundle/_migration/firebase-admin-credential.mjs"'
        );
        expect(inventoryProducer).toBeLessThan(compatibilityCleanup);
        expect(compatibilityCleanup).toBeLessThan(inventoryBackfill);
        expect(compatibilityCleanup).toBeGreaterThan(-1);
        expect(inventoryBackfill).toBeLessThan(firestoreChangeBranch);
        expect(compatibilityFunction).toBeGreaterThan(inventoryBackfill);
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
        expect(deployWorkflow).toMatch(
            /write_unrecognized_active_firestore_rules_evidence[\s\S]*remote_source_sha256=\$\{active_ruleset_observed_source_sha256\}/
        );
        expect(deployWorkflow).toContain(
            'Only immutable identifiers and SHA-256 digests are reported; rule source and credentials remain redacted.'
        );
        expect(deployWorkflow).toContain(
            'certificate_active_recovery_ruleset="projects/game-flow-c6311/rulesets/537ed719-d2fa-4cae-9a20-97273db4e11a"'
        );
        expect(deployWorkflow).toMatch(
            /git archive "\$recovery_sha"[\s\S]*firestore-active-recovery\.rules[\s\S]*recovery_source_sha256/
        );
        expect(deployWorkflow).toMatch(
            /verify_active_firestore_rules "\$active_recovery_firestore_rules"[\s\S]*active_rules_variant="historical-compatibility"/
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

    it('reconstructs a baseline with only that exact baseline SHA toolchain', () => {
        const baselineStage = deployWorkflow.slice(
            deployWorkflow.indexOf('- name: Stage exact Firestore baseline variants'),
            deployWorkflow.indexOf('- name: Stage exact active Firestore recovery proof')
        );

        expect(baselineStage).toContain('git archive "$FIRESTORE_BASELINE_SHA"');
        expect(baselineStage).toContain('baseline_checkout/scripts/compact-firestore-rules.mjs');
        expect(baselineStage).toContain('baseline_checkout/scripts/build-certificate-defaults-compat-rules.mjs');
        expect(baselineStage).toContain('cd "$baseline_checkout"');
        expect(baselineStage).toContain('baseline_node_major=');
        expect(baselineStage).toContain('current_node_major=');
        expect(baselineStage).not.toContain('node scripts/compact-firestore-rules.mjs');
        expect(baselineStage).not.toContain('node scripts/build-certificate-defaults-compat-rules.mjs');
        expect(repositoryInstructions).toMatch(
            /historical baseline variant only from an isolated checkout of that exact baseline SHA[\s\S]*complete generation pipeline[\s\S]*current-workspace code or dependencies[\s\S]*must never establish historical deployment provenance/i
        );
    });

    it('reconstructs the active recovery source from its pinned deployment commit', () => {
        const recoveryStage = deployWorkflow.slice(
            deployWorkflow.indexOf('- name: Stage exact active Firestore recovery proof'),
            deployWorkflow.indexOf('- name: Archive installed Functions runtime into trusted handoff')
        );

        expect(recoveryStage).toContain('recovery_sha="b637109b4f51d9b8627bb081eaea1489dfc8b8c3"');
        expect(recoveryStage).toContain('git merge-base --is-ancestor "$recovery_sha" "$GITHUB_SHA"');
        expect(recoveryStage).toContain('git archive "$recovery_sha"');
        expect(recoveryStage).toContain('cd "$recovery_checkout"');
        expect(recoveryStage).toContain('recovery_node_major=');
        expect(recoveryStage).toContain('recovery_source_sha256="033fc321f5a10457a9093262ff1b8c907aa1a583624a7edf8455804f4f3ba1ef"');
        expect(recoveryStage).toContain('The pinned Firestore recovery source did not reproduce exactly.');
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
                    retiredSignatureImageObjectKeys: ['bucket\nretired.png\n1700000000000000'],
                    retiredSignatureImagePaths: ['certificate-signatures/teams/team-a/retired.png']
                });
            });
            const ownerDb = compatibilityEnv.authenticatedContext('owner-a').firestore();
            const defaultsRef = doc(ownerDb, 'teams/team-a/settings/certificateDefaults');

            await assertSucceeds(updateDoc(defaultsRef, { signers: [{ name: 'Coach' }] }));
            await assertFails(updateDoc(defaultsRef, { retiredSignatureImageObjectKeys: [] }));
            await assertFails(updateDoc(defaultsRef, { retiredSignatureImagePaths: [] }));
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
                await setDoc(doc(firestore, 'teams/conflicting-legacy-team'), {
                    ownerEmail: 'current@example.com',
                    ownerEmailLower: 'former@example.com',
                    adminEmails: []
                });
                await setDoc(doc(firestore, 'teams/conflicting-legacy-team/settings/certificateDefaults'), {
                    signers: []
                });
                await setDoc(doc(firestore, 'teams/team-a/settings/certificateDefaults'), {
                    retiredSignatureImageObjectKeys: ['bucket\ncertificate-signatures/teams/team-a/retired.png\n1700000000000000'],
                    retiredSignatureImagePaths: ['certificate-signatures/teams/team-a/retired.png'],
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
                    signers: [{
                        signatureImageUrl: 'https://images.example.test/current-signature.png',
                        signatureImagePath: 'certificate-signatures/teams/team-a/current.png'
                    }],
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

        it('denies both conflicting legacy owner aliases', async () => {
            const defaultsPath = 'teams/conflicting-legacy-team/settings/certificateDefaults';
            const currentAliasDb = testEnv.authenticatedContext('current-alias', { email: 'current@example.com' }).firestore();
            const formerAliasDb = testEnv.authenticatedContext('former-alias', { email: 'former@example.com' }).firestore();

            await assertFails(getDoc(doc(currentAliasDb, defaultsPath)));
            await assertFails(getDoc(doc(formerAliasDb, defaultsPath)));
        });

        it('keeps cleanup tombstones private and server-writable only', async () => {
            const ownerDb = testEnv.authenticatedContext('owner-a').firestore();
            const cleanupPath = 'teams/team-a/certificateSignatureCleanup/server-job';
            const inventoryPath = 'certificateLegacySignatureInventory/legacy-object-key';
            const migrationPath = 'systemMigrations/certificateLegacySignatureInventoryV1';

            await assertFails(getDoc(doc(ownerDb, cleanupPath)));
            await assertFails(updateDoc(doc(ownerDb, cleanupPath), { status: 'pending' }));
            await assertFails(setDoc(doc(ownerDb, 'teams/team-a/certificateSignatureCleanup/forged'), {
                teamId: 'team-a',
                storagePath: 'certificate-signatures/users/victim/known.png',
                requestedBy: 'owner-a',
                status: 'pending'
            }));
            await assertFails(getDoc(doc(ownerDb, inventoryPath)));
            await assertFails(setDoc(doc(ownerDb, inventoryPath), {
                teamId: 'team-a',
                signerIndex: 0,
                objectKey: 'bucket\ncertificate-signatures/users/victim/known.png\n1700000000000000'
            }));
            await assertFails(getDoc(doc(ownerDb, migrationPath)));
            await assertFails(setDoc(doc(ownerDb, migrationPath), { status: 'completed' }));
        });

        it('allows exact historical URL-only defaults in new saved output snapshots', async () => {
            const ownerDb = testEnv.authenticatedContext('owner-a').firestore();
            const historicalUrl = 'https://firebasestorage.googleapis.com/v0/b/game-flow-img.firebasestorage.app/o/user-photos%2F1700000000000_certificate-signature_owner-a_signature.png?alt=media&token=historical-token';
            await testEnv.withSecurityRulesDisabled(async (context) => {
                await setDoc(doc(context.firestore(), 'teams/team-a/settings/certificateDefaults'), {
                    signers: [{ signatureImageUrl: historicalUrl }],
                    retiredSignatureImageObjectKeys: [],
                    retiredSignatureImagePaths: []
                });
            });

            await assertSucceeds(setDoc(doc(ownerDb, 'teams/team-a/certificates/historical-url-only'), {
                signers: [{ signatureImageUrl: historicalUrl }],
                status: 'draft'
            }));
            await assertSucceeds(setDoc(doc(ownerDb, 'teams/team-a/certificateBatches/historical-url-only'), {
                shared: { signers: [{ signatureImageUrl: historicalUrl }] },
                status: 'draft'
            }));

            await testEnv.withSecurityRulesDisabled(async (context) => {
                await setDoc(doc(context.firestore(), 'teams/team-a/settings/certificateDefaults'), {
                    signers: [{
                        signatureImageUrl: 'https://images.example.test/current-signature.png',
                        signatureImagePath: 'certificate-signatures/teams/team-a/current.png'
                    }],
                    retiredSignatureImageObjectKeys: ['bucket\ncertificate-signatures/teams/team-a/retired.png\n1700000000000000'],
                    retiredSignatureImagePaths: ['certificate-signatures/teams/team-a/retired.png'],
                    updatedBy: 'server'
                });
            });
        });

        it('rejects stale certificate and batch references after signature retirement', async () => {
            const ownerDb = testEnv.authenticatedContext('owner-a').firestore();
            const retiredSigner = [{
                signatureImageUrl: 'https://images.example.test/retired-signature.png?token=alias-a',
                signatureImagePath: 'certificate-signatures/teams/team-a/retired.png'
            }];
            const retiredAliasSigner = [{
                signatureImageUrl: 'https://images.example.test/retired-signature.png?token=alias-b&alt=media',
                signatureImagePath: 'certificate-signatures/teams/team-a/retired.png'
            }];
            const currentSigner = [{
                signatureImageUrl: 'https://images.example.test/current-signature.png',
                signatureImagePath: 'certificate-signatures/teams/team-a/current.png'
            }];

            await assertFails(setDoc(doc(ownerDb, 'teams/team-a/certificates/stale-create'), {
                signers: retiredSigner,
                status: 'draft'
            }));
            await assertFails(setDoc(doc(ownerDb, 'teams/team-a/certificateBatches/stale-create'), {
                shared: { signers: retiredSigner },
                status: 'draft'
            }));
            await assertFails(updateDoc(doc(ownerDb, 'teams/team-a/certificates/clean'), {
                signers: retiredAliasSigner
            }));
            await assertFails(updateDoc(doc(ownerDb, 'teams/team-a/certificateBatches/clean'), {
                shared: { signers: retiredAliasSigner }
            }));
            await assertFails(setDoc(doc(ownerDb, 'teams/team-a/certificates/url-only-alias'), {
                signers: [{ signatureImageUrl: 'https://images.example.test/retired-signature.png?token=alias-c' }],
                status: 'draft'
            }));
            await assertFails(setDoc(doc(ownerDb, 'teams/team-a/certificates/forged-path-alias'), {
                signers: [{
                    signatureImageUrl: 'https://images.example.test/retired-signature.png?token=alias-d',
                    signatureImagePath: 'certificate-signatures/teams/team-a/forged.png'
                }],
                status: 'draft'
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

        it('retains a reference written before retirement for the worker final re-read', async () => {
            const ownerDb = testEnv.authenticatedContext('owner-a').firestore();
            const racePath = 'certificate-signatures/teams/team-a/race.png';
            const raceRef = doc(ownerDb, 'teams/team-a/certificates/pre-retirement-race');
            const raceSigner = {
                signatureImageUrl: 'https://images.example.test/race.png?token=first',
                signatureImagePath: racePath
            };

            await testEnv.withSecurityRulesDisabled(async (context) => {
                await updateDoc(doc(context.firestore(), 'teams/team-a/settings/certificateDefaults'), {
                    signers: [raceSigner]
                });
            });

            await assertSucceeds(setDoc(raceRef, {
                signers: [raceSigner],
                status: 'draft'
            }));
            await testEnv.withSecurityRulesDisabled(async (context) => {
                await updateDoc(doc(context.firestore(), 'teams/team-a/settings/certificateDefaults'), {
                    signers: [],
                    retiredSignatureImagePaths: [
                        'certificate-signatures/teams/team-a/retired.png',
                        racePath
                    ]
                });
                expect((await getDoc(doc(
                    context.firestore(),
                    'teams/team-a/certificates/pre-retirement-race'
                ))).exists()).toBe(true);
            });
            await assertFails(setDoc(doc(ownerDb, 'teams/team-a/certificates/post-retirement-race'), {
                signers: [{
                    signatureImageUrl: 'https://images.example.test/race.png?token=alias',
                    signatureImagePath: racePath
                }],
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
