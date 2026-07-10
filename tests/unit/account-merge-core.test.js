import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
    normalizeAccountMergePreviewInput,
    hashAccountMergeVerificationToken,
    requireAccountMergeVerificationToken,
    validateAccountMergeVerificationRecord,
    assertNotSelfMerge,
    buildAccountMergePreview
} = require('../../functions/account-merge-core.cjs');

describe('account merge preview helpers', () => {
    it('rejects a preview request with no source account identifier or token', () => {
        expect(() => normalizeAccountMergePreviewInput({})).toThrow('source account identifier or verification token');
    });

    it('requires verified ownership before accepting raw source identifiers for preview', () => {
        expect(() => requireAccountMergeVerificationToken(normalizeAccountMergePreviewInput({
            sourceEmail: 'source@example.com'
        }))).toThrow('Verify ownership');
        expect(() => requireAccountMergeVerificationToken(normalizeAccountMergePreviewInput({
            sourceUid: 'source-1'
        }))).toThrow('Verify ownership');
        expect(requireAccountMergeVerificationToken(normalizeAccountMergePreviewInput({
            sourceEmail: 'source@example.com',
            verificationToken: 'verified-token'
        }))).toBe('verified-token');
    });

    it('rejects self-merge attempts by uid or email', () => {
        expect(() => assertNotSelfMerge({
            destinationUid: 'user-1',
            sourceUid: 'user-1'
        })).toThrow('must be different');

        expect(() => assertNotSelfMerge({
            destinationEmail: 'Parent@Example.com',
            sourceEmail: 'parent@example.com'
        })).toThrow('must be different');
    });

    it('validates verified account merge tokens before resolving source accounts', () => {
        const sourceUid = validateAccountMergeVerificationRecord({
            destinationUid: 'dest-1',
            record: {
                status: 'verified',
                sourceUid: 'source-1',
                destinationUid: 'dest-1',
                expiresAt: { toMillis: () => 2_000 }
            },
            nowMs: 1_000
        });

        expect(sourceUid).toBe('source-1');
        expect(hashAccountMergeVerificationToken(' token-123 ')).toHaveLength(64);
        expect(() => validateAccountMergeVerificationRecord({
            destinationUid: 'dest-1',
            record: {
                status: 'pending',
                sourceUid: 'source-1',
                destinationUid: 'dest-1'
            }
        })).toThrow('not verified');
        expect(() => validateAccountMergeVerificationRecord({
            destinationUid: 'dest-2',
            record: {
                status: 'verified',
                sourceUid: 'source-1',
                destinationUid: 'dest-1'
            }
        })).toThrow('different destination');
        expect(() => validateAccountMergeVerificationRecord({
            destinationUid: 'dest-1',
            record: {
                status: 'verified',
                sourceUid: 'source-1'
            }
        })).toThrow('different destination');
    });

    it('returns the source and destination parent/team/player links that would be unioned', () => {
        const preview = buildAccountMergePreview({
            sourceUid: 'source-1',
            destinationUid: 'dest-1',
            sourceUser: {
                email: 'source@example.com',
                parentOf: [
                    { teamId: 'team-1', playerId: 'player-1', relation: 'parent' },
                    { teamId: 'team-2', playerId: 'player-2', relation: 'guardian' }
                ],
                parentTeamIds: ['team-1', 'team-2'],
                parentPlayerKeys: ['team-1::player-1', 'team-2::player-2'],
                roles: ['parent']
            },
            destinationUser: {
                email: 'dest@example.com',
                parentOf: [{ teamId: 'team-1', playerId: 'player-1', relation: 'parent' }],
                parentTeamIds: ['team-1'],
                parentPlayerKeys: ['team-1::player-1'],
                roles: ['coach']
            }
        });

        expect(preview.source.uid).toBe('source-1');
        expect(preview.destination.uid).toBe('dest-1');
        expect(preview.additions.parentOf).toEqual([
            { teamId: 'team-2', playerId: 'player-2', relation: 'guardian' }
        ]);
        expect(preview.additions.parentTeamIds).toEqual(['team-2']);
        expect(preview.additions.parentPlayerKeys).toEqual(['team-2::player-2']);
        expect(preview.unioned.parentTeamIds).toEqual(['team-1', 'team-2']);
        expect(preview.unioned.parentPlayerKeys).toEqual(['team-1::player-1', 'team-2::player-2']);
        expect(preview.mutationPlanned).toBe(false);
    });
});
