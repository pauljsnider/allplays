import { describe, expect, it } from 'vitest';
import {
    certificateDefaultsMatch,
    normalizeCertificateDefaultsForComparison
} from '../../js/certificates/defaultsReconciliation.js';

const expectedDefaults = {
    templateId: 'banner',
    colorMode: 'custom',
    customColors: { accent: '#123456', background: '#ffffff' },
    footerUrl: 'https://allplays.ai',
    signers: [{
        name: 'Coach Rivera',
        signatureStyle: 'image',
        signatureImageUrl: 'https://storage.example.test/signature.png',
        signatureImagePath: 'certificate-signatures/teams/team-1/signature.png'
    }]
};

describe('certificate defaults persistence reconciliation', () => {
    it('matches the complete normalized writable payload while ignoring server fields and key order', () => {
        const authoritative = {
            updatedBy: 'admin-1',
            retiredSignatureImageObjectKeys: [],
            ...expectedDefaults,
            customColors: { background: '#ffffff', accent: '#123456' }
        };

        expect(certificateDefaultsMatch(expectedDefaults, authoritative)).toBe(true);
        expect(normalizeCertificateDefaultsForComparison(authoritative))
            .toEqual(normalizeCertificateDefaultsForComparison(expectedDefaults));
    });

    it.each([
        ['template', { templateId: 'classic' }],
        ['color', { customColors: { accent: '#654321', background: '#ffffff' } }],
        ['footer', { footerUrl: 'https://example.test' }]
    ])('does not report an ambiguous %s save as committed when only signers match', (_label, change) => {
        expect(certificateDefaultsMatch(expectedDefaults, { ...expectedDefaults, ...change })).toBe(false);
    });
});
