import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { backfillCertificateLegacySignatureInventory } from '../../_migration/backfill-certificate-legacy-signature-inventory.js';
import { getMigrationAdminAppOptions } from '../../_migration/firebase-admin-credential.mjs';

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
                if (path === 'systemMigrations/certificateLegacySignatureInventoryV1') return markerRef;
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

        expect(result).toMatchObject({ defaultsDocuments: 1, references: 1, conflicts: 0 });
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
            conflicts: 0
        });
    });
});
