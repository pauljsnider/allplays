import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { backfillCertificateLegacySignatureInventory } from '../../_migration/backfill-certificate-legacy-signature-inventory.js';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import {
    getMigrationAdminAppOptions,
    getMigrationFirestore,
    getMigrationStorageBucket
} from '../../_migration/firebase-admin-credential.mjs';

describe('certificate legacy signature inventory backfill', () => {
    it('uses the workload-identity access token instead of parsing its external-account file', async () => {
        const options = getMigrationAdminAppOptions({
            projectId: 'game-flow-c6311',
            storageBucket: 'game-flow-img.firebasestorage.app',
            env: {
                GOOGLE_OAUTH_ACCESS_TOKEN: 'oidc-access-token',
                GOOGLE_APPLICATION_CREDENTIALS: '/tmp/external-account.json'
            },
            serviceAccountUrl: new URL('file:///does-not-exist.json')
        });

        await expect(options.credential.getAccessToken()).resolves.toEqual({
            access_token: 'oidc-access-token',
            expires_in: 300
        });
        expect(options).toMatchObject({
            projectId: 'game-flow-c6311',
            storageBucket: 'game-flow-img.firebasestorage.app'
        });

        const app = initializeApp(options, `migration-credential-${Date.now()}`);
        try {
            expect(() => getAuth(app)).not.toThrow();
            expect(() => getFirestore(app)).toThrow(/Failed to initialize Google Cloud Firestore/i);
            const db = getMigrationFirestore({
                projectId: 'game-flow-c6311',
                env: { GOOGLE_OAUTH_ACCESS_TOKEN: 'oidc-access-token' }
            });
            expect(db).toBeInstanceOf((await import('firebase-admin/firestore')).Firestore);
            expect(db._settings.auth.cachedCredential.credentials.access_token)
                .toBe('oidc-access-token');

            expect(() => getStorage(app)).toThrow(/Failed to initialize Google Cloud Storage/i);
            const bucket = getMigrationStorageBucket({
                projectId: 'game-flow-c6311',
                bucketName: 'game-flow-img.firebasestorage.app',
                env: { GOOGLE_OAUTH_ACCESS_TOKEN: 'oidc-access-token' }
            });
            expect(bucket.name).toBe('game-flow-img.firebasestorage.app');
            expect(bucket.storage.authClient.cachedCredential.credentials.access_token)
                .toBe('oidc-access-token');
        } finally {
            await deleteApp(app);
        }
    });

    it('routes every automatically deployed Admin SDK backfill through the workload-identity helper', () => {
        for (const migrationName of [
            'backfill-certificate-legacy-signature-inventory.js',
            'backfill-team-fee-checkout-attempts.js',
            'backfill-registration-checkout-attempts.js'
        ]) {
            const source = readFileSync(
                new URL(`../../_migration/${migrationName}`, import.meta.url),
                'utf8'
            );
            expect(source).toContain("from './firebase-admin-credential.mjs'");
            expect(source).toContain('getMigrationAdminAppOptions({');
            expect(source).not.toContain('credential: applicationDefault()');
        }
    });

    it('persists an exact team/signer/object binding before marking the migration complete', async () => {
        const legacyPath = 'user-photos/1700000000000_certificate-signature_owner_admin_signature.png';
        const legacyUrl = `https://firebasestorage.googleapis.com/v0/b/game-flow-img.firebasestorage.app/o/${encodeURIComponent(legacyPath)}?alt=media&token=legacy-token`;
        const inventoryWrites = [];
        const markerWrites = [];
        const markerRef = {
            get: vi.fn(async () => ({ exists: false, data: () => null })),
            set: vi.fn(async (data) => markerWrites.push(data))
        };
        const db = {
            collection: vi.fn(() => ({
                get: vi.fn(async () => ({ docs: [] }))
            })),
            collectionGroup: vi.fn(() => ({
                get: vi.fn(async () => ({
                    docs: [{
                        id: 'certificateDefaults',
                        ref: { path: 'teams/team-1/settings/certificateDefaults' },
                        data: () => ({ signers: [{ signatureImageUrl: legacyUrl }] })
                    }]
                }))
            })),
            doc: vi.fn((path) => {
                if (path === 'systemMigrations/certificateLegacySignatureInventoryV2') return markerRef;
                if (path === 'teams/team-1') {
                    return {
                        get: vi.fn(async () => ({
                            exists: true,
                            data: () => ({ ownerId: 'owner_admin', ownerEmail: 'owner@example.test' })
                        }))
                    };
                }
                return { path };
            }),
            runTransaction: vi.fn(async (callback) => callback({
                get: vi.fn(async () => ({ exists: false, data: () => null })),
                set: vi.fn((ref, data) => inventoryWrites.push({ ref, data }))
            }))
        };
        const auth = {
            getUsers: vi.fn(async () => ({ users: [{ uid: 'owner_admin' }] }))
        };
        const legacyBucket = {
            file: vi.fn((path) => ({
                getMetadata: vi.fn(async () => {
                    expect(path).toBe(legacyPath);
                    return [{
                        generation: '1700000000000001',
                        metadata: { firebaseStorageDownloadTokens: 'legacy-token' }
                    }];
                })
            }))
        };

        const result = await backfillCertificateLegacySignatureInventory({
            db,
            auth,
            legacyBucket,
            apply: true
        });

        expect(result).toMatchObject({
            defaultsDocuments: 1,
            references: 1,
            conflicts: 0,
            invalidatedBindings: 0
        });
        expect(inventoryWrites).toHaveLength(1);
        expect(inventoryWrites[0].ref.path).toMatch(/^certificateLegacySignatureInventory\/[a-f0-9]{64}$/);
        expect(inventoryWrites[0].data).toMatchObject({
            conflicted: false,
            legacyOwnerId: 'owner_admin',
            signerField: 'certificateDefaults.signers.0.signatureImageUrl',
            storageBucketName: 'game-flow-img.firebasestorage.app',
            storagePath: legacyPath,
            teamId: 'team-1'
        });
        expect(inventoryWrites[0].data.objectKey).toBe(
            `game-flow-img.firebasestorage.app\n${legacyPath}\n1700000000000001`
        );
        expect(markerWrites).toHaveLength(1);
        expect(markerWrites[0]).toMatchObject({
            status: 'completed',
            defaultsDocuments: 1,
            references: 1,
            conflicts: 0,
            invalidatedBindings: 0
        });
    });

    it('invalidates stale owner bindings before rediscovering current defaults', async () => {
        const staleBindingSet = vi.fn(async () => {});
        const currentBindingSet = vi.fn(async () => {});
        const markerWrites = [];
        const adminEmails = [
            ...Array.from({ length: 100 }, (_, index) => `admin-${index}@example.test`),
            'current-admin@example.test'
        ];
        const teamRef = {
            get: vi.fn(async () => ({
                exists: true,
                data: () => ({
                    ownerId: 'current-owner',
                    ownerEmail: 'former-owner@example.test',
                    ownerEmailLower: 'former-owner@example.test',
                    adminEmails
                })
            }))
        };
        const db = {
            collection: vi.fn((name) => {
                expect(name).toBe('certificateLegacySignatureInventory');
                return {
                    get: vi.fn(async () => ({
                        docs: [{
                            ref: { set: staleBindingSet },
                            data: () => ({ teamId: 'team-1', legacyOwnerId: 'former-owner' })
                        }, {
                            ref: { set: currentBindingSet },
                            data: () => ({ teamId: 'team-1', legacyOwnerId: 'admin-user' })
                        }]
                    }))
                };
            }),
            collectionGroup: vi.fn(() => ({
                get: vi.fn(async () => ({ docs: [] }))
            })),
            doc: vi.fn((path) => {
                if (path === 'systemMigrations/certificateLegacySignatureInventoryV2') {
                    return {
                        get: vi.fn(async () => ({ exists: false, data: () => null })),
                        set: vi.fn(async (data) => markerWrites.push(data))
                    };
                }
                if (path === 'teams/team-1') return teamRef;
                throw new Error(`Unexpected document path: ${path}`);
            })
        };
        const auth = {
            getUsers: vi.fn(async (identifiers) => {
                return {
                    users: identifiers.some(({ email }) => email === 'current-admin@example.test')
                        ? [{ uid: 'admin-user' }]
                        : []
                };
            })
        };

        const result = await backfillCertificateLegacySignatureInventory({
            db,
            auth,
            legacyBucket: {},
            apply: true
        });

        expect(result).toMatchObject({
            defaultsDocuments: 0,
            references: 0,
            conflicts: 0,
            invalidatedBindings: 1
        });
        expect(staleBindingSet).toHaveBeenCalledOnce();
        expect(staleBindingSet).toHaveBeenCalledWith(expect.objectContaining({
            conflicted: true,
            invalidationReason: 'owner-authorization-changed'
        }), { merge: true });
        expect(currentBindingSet).not.toHaveBeenCalled();
        expect(teamRef.get).toHaveBeenCalledOnce();
        expect(auth.getUsers).toHaveBeenCalledTimes(2);
        expect(auth.getUsers.mock.calls.map(([identifiers]) => identifiers.length)).toEqual([100, 2]);
        expect(markerWrites).toHaveLength(1);
        expect(markerWrites[0]).toMatchObject({
            status: 'completed',
            invalidatedBindings: 1
        });
    });

    it('invalidates a legacy binding when the matching team manager is disabled', async () => {
        const bindingSet = vi.fn(async () => {});
        const markerSet = vi.fn(async () => {});
        const db = {
            collection: vi.fn(() => ({
                get: vi.fn(async () => ({
                    docs: [{
                        ref: { set: bindingSet },
                        data: () => ({ teamId: 'team-1', legacyOwnerId: 'disabled-manager' })
                    }]
                }))
            })),
            collectionGroup: vi.fn(() => ({
                get: vi.fn(async () => ({ docs: [] }))
            })),
            doc: vi.fn((path) => {
                if (path === 'systemMigrations/certificateLegacySignatureInventoryV2') {
                    return {
                        get: vi.fn(async () => ({ exists: false, data: () => null })),
                        set: markerSet
                    };
                }
                if (path === 'teams/team-1') {
                    return {
                        get: vi.fn(async () => ({
                            exists: true,
                            data: () => ({ adminEmails: ['disabled@example.test'] })
                        }))
                    };
                }
                throw new Error(`Unexpected document path: ${path}`);
            })
        };
        const auth = {
            getUsers: vi.fn(async () => ({
                users: [{
                    uid: 'disabled-manager',
                    email: 'disabled@example.test',
                    disabled: true
                }]
            }))
        };

        const result = await backfillCertificateLegacySignatureInventory({
            db,
            auth,
            legacyBucket: {},
            apply: true
        });

        expect(result.invalidatedBindings).toBe(1);
        expect(bindingSet).toHaveBeenCalledWith(expect.objectContaining({
            conflicted: true,
            invalidationReason: 'owner-authorization-changed'
        }), { merge: true });
        expect(markerSet).toHaveBeenCalledWith(expect.objectContaining({
            invalidatedBindings: 1
        }));
    });

    it('invalidates a legacy binding when the canonical team owner is disabled', async () => {
        const bindingSet = vi.fn(async () => {});
        const markerSet = vi.fn(async () => {});
        const db = {
            collection: vi.fn(() => ({
                get: vi.fn(async () => ({
                    docs: [{
                        ref: { set: bindingSet },
                        data: () => ({ teamId: 'team-1', legacyOwnerId: 'disabled-owner' })
                    }]
                }))
            })),
            collectionGroup: vi.fn(() => ({
                get: vi.fn(async () => ({ docs: [] }))
            })),
            doc: vi.fn((path) => {
                if (path === 'systemMigrations/certificateLegacySignatureInventoryV2') {
                    return {
                        get: vi.fn(async () => ({ exists: false, data: () => null })),
                        set: markerSet
                    };
                }
                if (path === 'teams/team-1') {
                    return {
                        get: vi.fn(async () => ({
                            exists: true,
                            data: () => ({ ownerId: 'disabled-owner' })
                        }))
                    };
                }
                throw new Error(`Unexpected document path: ${path}`);
            })
        };
        const auth = {
            getUsers: vi.fn(async (identifiers) => {
                expect(identifiers).toEqual([{ uid: 'disabled-owner' }]);
                return {
                    users: [{ uid: 'disabled-owner', disabled: true }]
                };
            })
        };

        const result = await backfillCertificateLegacySignatureInventory({
            db,
            auth,
            legacyBucket: {},
            apply: true
        });

        expect(result.invalidatedBindings).toBe(1);
        expect(bindingSet).toHaveBeenCalledWith(expect.objectContaining({
            conflicted: true,
            invalidationReason: 'owner-authorization-changed'
        }), { merge: true });
        expect(markerSet).toHaveBeenCalledWith(expect.objectContaining({
            invalidatedBindings: 1
        }));
    });
});
