import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const teamCertificatesSource = readFileSync(new URL('../../apps/app/src/pages/TeamCertificates.tsx', import.meta.url), 'utf8');
const certificateDraftServiceSource = readFileSync(new URL('../../apps/app/src/lib/certificateDraftService.ts', import.meta.url), 'utf8');
const certificateDraftServiceTestSource = readFileSync(new URL('../../apps/app/src/lib/certificateDraftService.test.ts', import.meta.url), 'utf8');
const teamCertificatesTestSource = readFileSync(new URL('../../apps/app/src/pages/TeamCertificates.test.tsx', import.meta.url), 'utf8');
const rendererSource = readFileSync(new URL('../../js/certificates/renderer.js', import.meta.url), 'utf8');
const aiDescriptionSource = readFileSync(new URL('../../js/certificates/aiDescriptions.js', import.meta.url), 'utf8');
const exporterSource = readFileSync(new URL('../../js/certificates/exporter.js', import.meta.url), 'utf8');

describe('issue 1997 awards publish export source contract', () => {
    it('keeps the app awards screen creating drafts and handing off final publish/print work', () => {
        expect(teamCertificatesSource).toContain('renderCertificate({');
        expect(teamCertificatesSource).toContain('Preview only. Save the draft to continue editing in the full web studio.');
        expect(teamCertificatesSource).toContain('await saveCertificateDraftsForApp({');
        expect(teamCertificatesSource).toContain('await openPublicUrl(result.webUrl);');
        expect(teamCertificatesSource).toContain('Pick a template, choose players, preview, then continue in the full web studio for AI, publish, and print.');
        expect(teamCertificatesSource).toContain('AI narratives, publish, and print stay in the website flow for now.');
    });

    it('keeps draft service output compatible with the website certificate studio', () => {
        expect(certificateDraftServiceSource).toContain('export async function saveCertificateDraftsForApp');
        expect(certificateDraftServiceSource).toContain("status: 'draft'");
        expect(certificateDraftServiceSource).toContain('generatedCertificateIds: certificateIds');
        expect(certificateDraftServiceSource).toContain('webUrl: getCertificateStudioUrl(teamId, batchId)');
        expect(certificateDraftServiceSource).toContain('export function buildCertificatePayloadForApp');
        expect(certificateDraftServiceSource).toContain("descriptionSource: 'manual'");
        expect(certificateDraftServiceSource).toContain("const url = new URL('certificates.html', 'https://allplays.ai');");
    });

    it('keeps AI narrative, renderer, PNG/ZIP export, and print helpers available in legacy studio code', () => {
        expect(rendererSource).toContain('export function renderCertificate');
        expect(aiDescriptionSource).toContain('export async function generateDescriptionsForDrafts');
        expect(aiDescriptionSource).toContain('Write one youth-sports award certificate paragraph.');
        expect(exporterSource).toContain('export async function downloadCertificatePng');
        expect(exporterSource).toContain('export async function downloadCertificateZip');
        expect(exporterSource).toContain('export async function printCertificates');
    });

    it('keeps focused tests for draft creation and the web-studio continuation', () => {
        expect(certificateDraftServiceTestSource).toContain('creates one draft certificate per selected player and returns a web studio batch URL');
        expect(certificateDraftServiceTestSource).toContain('builds team-only and batch continuation URLs for the web awards studio');
        expect(certificateDraftServiceTestSource).toContain('builds a draft payload that matches the saved web studio shape');
        expect(teamCertificatesTestSource).toContain('opens the awards web studio for AI narratives, publish, and print continuation');
    });
});
