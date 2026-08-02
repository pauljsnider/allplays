import { describe, expect, it, vi } from 'vitest';
import { backfillCertificateLegacySignatureInventory } from '../../_migration/backfill-certificate-legacy-signature-inventory.js';

describe('certificate legacy signature inventory backfill', () => {
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
