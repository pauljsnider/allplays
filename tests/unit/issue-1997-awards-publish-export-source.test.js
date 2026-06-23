import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const teamCertificatesSource = readFileSync(new URL('../../apps/app/src/pages/TeamCertificates.tsx', import.meta.url), 'utf8');
const certificateDraftServiceSource = readFileSync(new URL('../../apps/app/src/lib/certificateDraftService.ts', import.meta.url), 'utf8');
const certificateAwardServiceSource = readFileSync(new URL('../../apps/app/src/lib/certificateAwardService.ts', import.meta.url), 'utf8');
const publicActionsSource = readFileSync(new URL('../../apps/app/src/lib/publicActions.ts', import.meta.url), 'utf8');
const certificateDraftServiceTestSource = readFileSync(new URL('../../apps/app/src/lib/certificateDraftService.test.ts', import.meta.url), 'utf8');
const certificateAwardServiceTestSource = readFileSync(new URL('../../apps/app/src/lib/certificateAwardService.test.ts', import.meta.url), 'utf8');
const teamCertificatesTestSource = readFileSync(new URL('../../apps/app/src/pages/TeamCertificates.test.tsx', import.meta.url), 'utf8');
const rendererSource = readFileSync(new URL('../../js/certificates/renderer.js', import.meta.url), 'utf8');
const aiDescriptionSource = readFileSync(new URL('../../js/certificates/aiDescriptions.js', import.meta.url), 'utf8');
const exporterSource = readFileSync(new URL('../../js/certificates/exporter.js', import.meta.url), 'utf8');

describe('issue 1997 awards publish export source contract', () => {
    it('keeps the app awards screen on native create, AI review, publish, and export work', () => {
        expect(teamCertificatesSource).toContain('renderCertificate({');
        expect(teamCertificatesSource).toContain('Preview only. Create drafts before generating AI narratives, publishing, or exporting.');
        expect(teamCertificatesSource).toContain('await saveCertificateDraftsForApp({');
        expect(teamCertificatesSource).toContain('generateCertificateAwardNarrativesForApp({');
        expect(teamCertificatesSource).toContain('publishCertificateAwardsForApp({');
        expect(teamCertificatesSource).toContain('exportCertificatePngFile(');
        expect(teamCertificatesSource).toContain('I reviewed these certificate descriptions and they are ready for parents.');
        expect(teamCertificatesSource).not.toContain('AI narratives, publish, and print stay in the website flow for now.');
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

    it('ports app narrative, publish, and export through legacy-compatible helpers', () => {
        expect(certificateAwardServiceSource).toContain('buildCertificateAwardNarrativePromptForApp');
        expect(certificateAwardServiceSource).toContain('return buildCertificateDescriptionPrompt(context);');
        expect(certificateAwardServiceSource).toContain('generateDescriptionsForDrafts({');
        expect(certificateAwardServiceSource).toContain('updateCertificate(');
        expect(certificateAwardServiceSource).toContain("{ action: 'published' }");
        expect(certificateAwardServiceSource).toContain("status: 'published'");
        expect(certificateAwardServiceSource).toContain('parentVisibility: publishDrafts.map');
        expect(publicActionsSource).toContain('exportCertificatePngFile');
        expect(publicActionsSource).toContain("path: `certificate-exports/${Date.now()}-${safeFilename}`");
        expect(publicActionsSource).toContain("dialogTitle: 'Export certificate'");
    });

    it('keeps AI narrative, renderer, PNG/ZIP export, and print helpers available in legacy studio code', () => {
        expect(rendererSource).toContain('export function renderCertificate');
        expect(aiDescriptionSource).toContain('export async function generateDescriptionsForDrafts');
        expect(aiDescriptionSource).toContain('Write one youth-sports award certificate paragraph.');
        expect(exporterSource).toContain('export async function downloadCertificatePng');
        expect(exporterSource).toContain('export async function downloadCertificateZip');
        expect(exporterSource).toContain('export async function printCertificates');
    });

    it('keeps focused tests for draft creation plus native AI/publish/export', () => {
        expect(certificateDraftServiceTestSource).toContain('creates one draft certificate per selected player and returns a web studio batch URL');
        expect(certificateDraftServiceTestSource).toContain('builds team-only and batch continuation URLs for the web awards studio');
        expect(certificateDraftServiceTestSource).toContain('builds a draft payload that matches the saved web studio shape');
        expect(certificateAwardServiceTestSource).toContain('uses the legacy certificate narrative prompt verbatim');
        expect(certificateAwardServiceTestSource).toContain('publishes the same certificate payload shape parent certificate reads expect');
        expect(certificateAwardServiceTestSource).toContain('keeps drafts safe when AI fails and does not publish without confirmation');
        expect(teamCertificatesTestSource).toContain('creates drafts, generates editable narratives, and does not hand off to the website');
        expect(teamCertificatesTestSource).toContain('requires explicit review confirmation before publishing generated awards');
        expect(teamCertificatesTestSource).toContain('shows export failures without changing the drafted award');
    });
});
