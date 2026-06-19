import { renderCertificate as legacyRenderCertificate } from '@legacy/certificates/renderer.js';

export type LegacyCertificateRenderInput = {
    shared?: Record<string, unknown>;
    draft?: Record<string, unknown>;
    team?: Record<string, unknown>;
};

export function renderCertificate(input: LegacyCertificateRenderInput): HTMLDivElement {
    return legacyRenderCertificate(input);
}
