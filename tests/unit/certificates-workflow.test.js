import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePath) {
    return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

function extractFunction(source, signature) {
    const start = source.indexOf(signature);
    if (start === -1) {
        throw new Error(`Unable to find ${signature}`);
    }

    const bodyStart = source.indexOf('{', start);
    let depth = 0;

    for (let index = bodyStart; index < source.length; index += 1) {
        const char = source[index];
        if (char === '{') depth += 1;
        if (char === '}') depth -= 1;
        if (depth === 0) {
            return source.slice(start, index + 1);
        }
    }

    throw new Error(`Unable to extract ${signature}`);
}

function createCertificateStudioHarness() {
    const studio = readRepoFile('js/certificates/studio.js');
    const snippets = [
        'function getSelectedDrafts',
        'function getDraftsForSaveStatus',
        'function buildCertificatePayload',
        'function createDraftFromSavedCertificate',
        'function getPublishBlockedDrafts',
        'function formatPublishBlockedDraftNames',
        'function guardPublishableDraftDescriptions',
        'function getActiveSavedCertificates',
        'async function listActiveSavedCertificates',
        'async function archiveSavedCertificate',
        'function saveDraftsToLocalHistory',
        'async function openSavedBatch',
        'async function openSavedCertificate',
        'function startCustomCertificate',
        'async function waitForActiveRegeneration',
        'async function saveDrafts'
    ].map((signature) => extractFunction(studio, signature)).join('\n\n');

    const deps = {
        state: {
            demoMode: false,
            certificatePersistenceUnavailable: false,
            teamId: 'team-1',
            team: { name: 'Demo Team' },
            shared: {
                templateId: 'banner',
                colorMode: 'custom',
                customColors: { accentColor: '#123456' },
                teamNameOverride: 'Demo Team',
                statsWindow: 10,
                seasonLabel: 'Fall 2026',
                footerUrl: 'allplays.ai',
                framePurchaseLink: 'https://frames.example.test/team-store',
                fonts: { heading: 'classic', recipient: 'classic', body: 'friendly' },
                signers: [],
                foregroundImageRef: null,
                backgroundImageRef: null,
                backgroundOpacity: 18,
                watermarkImageRef: null,
                watermarkOpacity: 12,
                awardTitle: 'Team MVP'
            },
            drafts: [],
            savedCertificates: [],
            savedBatches: [],
            selectedPlayerIds: new Set(),
            selectedDraftId: null,
            descriptionGeneration: null,
            mode: 'setup'
        },
        truncateCertificateDescription: (value) => String(value || '').slice(0, 350),
        resolveColors: (shared) => shared.customColors,
        normalizeSigners: (signers) => signers || [],
        clonePlain: (value) => JSON.parse(JSON.stringify(value || null)),
        buildSharedFromSavedSource: (defaults = {}, certificate = {}) => ({
            templateId: certificate.templateId || defaults.templateId || 'banner',
            colorMode: certificate.colorMode || defaults.colorMode || 'custom',
            customColors: certificate.colors || defaults.customColors || {},
            teamNameOverride: certificate.teamNameOverride || defaults.teamNameOverride || 'Demo Team',
            awardTitle: certificate.awardTitle || defaults.awardTitle || '',
            statsWindow: certificate.statsWindow || defaults.statsWindow || 10,
            seasonLabel: certificate.seasonLabel || defaults.seasonLabel || '',
            footerUrl: certificate.footerUrl || defaults.footerUrl || '',
            framePurchaseLink: certificate.framePurchaseLink || defaults.framePurchaseLink || '',
            fonts: certificate.fonts || defaults.fonts || {},
            signers: certificate.signers || defaults.signers || [],
            foregroundImageRef: certificate.foregroundImageRef || defaults.foregroundImageRef || null,
            backgroundImageRef: certificate.backgroundImageRef || defaults.backgroundImageRef || null,
            backgroundOpacity: certificate.backgroundOpacity ?? defaults.backgroundOpacity ?? 18,
            watermarkImageRef: certificate.watermarkImageRef || defaults.watermarkImageRef || null,
            watermarkOpacity: certificate.watermarkOpacity ?? defaults.watermarkOpacity ?? 12
        }),
        renderReview: vi.fn(),
        renderReviewGrid: vi.fn(),
        renderSavedWorkLanding: vi.fn(),
        showSavedWorkMode: vi.fn(),
        showAlert: vi.fn(),
        renderSidebar: vi.fn(),
        getCertificateBatch: vi.fn(),
        getCertificate: vi.fn(),
        createCertificateBatch: vi.fn(async () => 'batch-1'),
        createCertificate: vi.fn(async (_teamId, payload) => `created-${payload.playerId || payload.recipientName}`),
        updateCertificate: vi.fn(async () => undefined),
        archiveCertificate: vi.fn(async () => undefined),
        updateCertificateBatch: vi.fn(async () => undefined),
        setCertificateDefaults: vi.fn(async () => undefined),
        listCertificates: vi.fn(async () => []),
        listCertificateBatches: vi.fn(async () => []),
        loadOptionalCertificateResource: async (_label, loader, fallback) => {
            try {
                return await loader();
            } catch {
                return fallback;
            }
        },
        isPermissionError: () => false
    };

    deps.loadCertificatesForSavedBatch = async (batch) => batch.generatedCertificateIds.map((id) => {
        const certificate = deps.state.savedCertificates.find((item) => item.id === id);
        return certificate || null;
    }).filter(Boolean);

    return new Function('deps', `
        const state = deps.state;
        const truncateCertificateDescription = deps.truncateCertificateDescription;
        const resolveColors = deps.resolveColors;
        const normalizeSigners = deps.normalizeSigners;
        const clonePlain = deps.clonePlain;
        const buildSharedFromSavedSource = deps.buildSharedFromSavedSource;
        const renderReview = deps.renderReview;
        const renderReviewGrid = deps.renderReviewGrid;
        const renderSavedWorkLanding = deps.renderSavedWorkLanding;
        const showSavedWorkMode = deps.showSavedWorkMode;
        const showAlert = deps.showAlert;
        const renderSidebar = deps.renderSidebar;
        const loadCertificatesForSavedBatch = deps.loadCertificatesForSavedBatch;
        const getCertificateBatch = deps.getCertificateBatch;
        const getCertificate = deps.getCertificate;
        const createCertificateBatch = deps.createCertificateBatch;
        const createCertificate = deps.createCertificate;
        const updateCertificate = deps.updateCertificate;
        const archiveCertificate = deps.archiveCertificate;
        const updateCertificateBatch = deps.updateCertificateBatch;
        const setCertificateDefaults = deps.setCertificateDefaults;
        const listCertificates = deps.listCertificates;
        const listCertificateBatches = deps.listCertificateBatches;
        const loadOptionalCertificateResource = deps.loadOptionalCertificateResource;
        const isPermissionError = deps.isPermissionError;
        const upsertSavedCertificate = (certificate) => {
            if (!certificate?.id) return;
            state.savedCertificates = [
                certificate,
                ...state.savedCertificates.filter((item) => item.id !== certificate.id)
            ];
        };
        const upsertSavedBatch = (batch) => {
            if (!batch?.id) return;
            state.savedBatches = [
                batch,
                ...state.savedBatches.filter((item) => item.id !== batch.id)
            ];
        };
        ${snippets}
        return {
            state,
            showAlert,
            renderReviewGrid,
            buildCertificatePayload,
            createDraftFromSavedCertificate,
            getPublishBlockedDrafts,
            formatPublishBlockedDraftNames,
            guardPublishableDraftDescriptions,
            getActiveSavedCertificates,
            listActiveSavedCertificates,
            archiveSavedCertificate,
            saveDraftsToLocalHistory,
            saveDrafts,
            openSavedBatch,
            openSavedCertificate,
            startCustomCertificate,
            createCertificate,
            updateCertificate,
            archiveCertificate,
            updateCertificateBatch,
            listCertificates
        };
    `)(deps);
}

describe('awards and certificates workflow wiring', () => {
    it('adds the certificates studio page with the expected workflow mount points', () => {
        const html = readRepoFile('certificates.html');
        const studio = readRepoFile('js/certificates/studio.js');
        const css = readRepoFile('css/certificates.css');
        const assets = readRepoFile('js/certificates/assets.js');
        const firebaseConfig = readRepoFile('firebase.json');
        const packageJson = readRepoFile('package.json');

        expect(html).toContain('<link rel="stylesheet" href="css/certificates.css?v=5">');
        expect(html).toContain('id="cert-setup"');
        expect(html).toContain('id="cert-player-selection"');
        expect(html).toContain('id="cert-review-grid"');
        expect(html).toContain('id="cert-preview"');
        expect(html).toContain('id="cert-custom-recipient-btn"');
        expect(html).toContain('Start new run');
        expect(html).toContain('View saved work');
        expect(html).toContain('Create one-off certificate');
        expect(html).toContain('./js/certificates/studio.js?v=15');
        expect(studio).toContain("from './templates.js?v=2'");
        expect(studio).toContain("from './renderer.js?v=2'");
        expect(studio).toContain("from './aiDescriptions.js?v=4'");
        expect(studio).toContain("from '../db.js?v=107'");

        expect(studio).toContain('Create drafts for selected players');
        expect(studio).toContain('Saved work');
        expect(studio).toContain('showSavedWorkMode');
        expect(studio).toContain('renderSavedWorkLanding');
        expect(studio).toContain('Save setup for future runs');
        expect(studio).toContain('Reset setup');
        expect(studio).toContain('data-font-slot');
        expect(studio).toContain('Previous uploads');
        expect(studio).toContain('Save progress');
        expect(studio).toContain('Publish certificates');
        expect(studio).toContain('Print selected');
        expect(studio).toContain('PNG selected');
        expect(studio).toContain('downloadDraftPngById');
        expect(studio).toContain('data-open-batch');
        expect(studio).toContain('data-open-certificate');
        expect(studio).toContain('data-share-batch');
        expect(studio).toContain('data-share-certificate');
        expect(studio).toContain('data-archive-certificate');
        expect(studio).toContain('data-toggle-saved-list');
        expect(studio).toContain('Show fewer');
        expect(studio).toContain('formatSavedTime');
        expect(studio).toContain('shareSavedWork');
        expect(studio).toContain('certificateLimit = 6');
        expect(studio).toContain('Showing ${visible.length} of ${items.length}');
        expect(studio).toContain('openSavedBatch');
        expect(studio).toContain('await getCertificateBatch(state.teamId, batchId)');
        expect(studio).toContain('upsertSavedBatch(batch);');
        expect(studio).toContain('openSavedCertificate');
        expect(studio).toContain("params.get('certificateId')");
        expect(studio).toContain("params.get('batchId')");
        expect(studio).toContain('renderParentCertificateDetail');
        expect(studio).toContain('cert-parent-png-btn');
        expect(studio).toContain('getParentCertificateLinks');
        expect(studio).toContain('parentPlayerKeys');
        expect(studio).toContain('setCoachActionButtonsVisible(false)');
        expect(studio).toContain("runCoachCertificateAction(showSetupMode)");
        expect(studio).toContain('saveDraftsToLocalHistory');
        expect(studio).toContain('startCustomCertificate');
        expect(studio).toContain('selectRecentCompletedGames');
        expect(studio).toContain("'allplays.ai'");
        expect(studio).toContain("window.location.href = 'login.html'");
        expect(studio).toContain('loadOptionalCertificateResource');
        expect(studio).toContain('certificatePersistenceUnavailable');
        expect(studio).toContain('Deploy the Firestore certificate rules');
        expect(studio).toContain('readFileAsDataUrl');
        expect(studio).toContain('formatImageUploadError');
        expect(studio).toContain('Local preview only');
        expect(studio).toContain('Uploaded for this run');
        expect(studio).toContain('backgroundOpacity');
        expect(css).toContain('@media print');
        expect(css).toContain('.cert-template-banner');
        expect(css).toContain('.cert-image-thumb');
        expect(css).toContain('.cert-upload-button');
        expect(css).toContain('.cert-image-badge');
        expect(css).toContain('.cert-image-stack');
        expect(css).toContain('.cert-image-opacity');
        expect(assets).toContain('MAX_CERTIFICATE_ASSET_BYTES = 5 * 1024 * 1024');
        expect(assets).toContain("image/png', 'image/jpeg', 'image/jpg', 'image/webp");
        expect(assets).toContain('sanitizeCertificateFilename');
        expect(assets).toContain('validateCertificateStorageId');
        expect(assets).toContain('/^[A-Za-z0-9_-]+$/');
        expect(firebaseConfig).toContain('"host": "localhost"');
        expect(firebaseConfig).toContain('"port": 8000');
        expect(packageJson).toContain('"serve:firebase"');
    });

    it('archives a saved certificate and removes it from active studio history', async () => {
        const harness = createCertificateStudioHarness();
        vi.stubGlobal('confirm', vi.fn(() => true));
        harness.state.mode = 'saved';
        harness.state.savedCertificates = [
            { id: 'cert-1', batchId: 'batch-1', recipientName: 'Lee Star', status: 'published' },
            { id: 'cert-2', recipientName: 'Sam Star', status: 'draft' }
        ];
        harness.state.savedBatches = [{
            id: 'batch-1',
            generatedCertificateIds: ['cert-1', 'cert-2']
        }];

        try {
            await harness.archiveSavedCertificate('cert-1');

            expect(harness.archiveCertificate).toHaveBeenCalledWith('team-1', 'cert-1');
            expect(harness.updateCertificateBatch).toHaveBeenCalledWith('team-1', 'batch-1', {
                generatedCertificateIds: ['cert-2']
            });
            expect(harness.state.savedCertificates.map((certificate) => certificate.id)).toEqual(['cert-2']);
            expect(harness.state.savedBatches[0].generatedCertificateIds).toEqual(['cert-2']);
            expect(harness.showAlert).toHaveBeenCalledWith('Archived the certificate for Lee Star.', 'success');
            expect(harness.getActiveSavedCertificates([
                { id: 'active', status: 'published' },
                { id: 'archived', status: 'archived' }
            ])).toEqual([{ id: 'active', status: 'published' }]);
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('queries active certificate statuses before applying the saved-history limit', async () => {
        const harness = createCertificateStudioHarness();
        harness.listCertificates.mockResolvedValue([
            { id: 'draft', status: 'draft' },
            { id: 'published', status: 'published' },
            { id: 'archived', status: 'archived' }
        ]);

        await expect(harness.listActiveSavedCertificates()).resolves.toEqual([
            { id: 'draft', status: 'draft' },
            { id: 'published', status: 'published' }
        ]);
        expect(harness.listCertificates).toHaveBeenCalledWith('team-1', {
            statuses: ['draft', 'published']
        });
    });

    it('keeps generate/edit/print local until the coach explicitly saves or publishes', () => {
        const studio = readRepoFile('js/certificates/studio.js');
        const generateBody = studio.match(/async function generateTeamCertificates\(\) \{[\s\S]*?function renderReview\(\)/)?.[0] || '';
        const saveBody = studio.match(/async function saveDrafts\(status\) \{[\s\S]*?function renderReviewPreview\(\)/)?.[0] || '';

        expect(generateBody).toContain('const batchId = state.demoMode ? `demo-batch-${Date.now()}` : null;');
        expect(generateBody).not.toContain('createCertificateBatch(state.teamId');
        expect(generateBody).not.toContain('createCertificate(state.teamId');
        expect(saveBody).toContain('if (!guardPublishableDraftDescriptions(status)) return;');
        expect(saveBody).toContain('createCertificateBatch(state.teamId');
        expect(saveBody).toContain('createCertificate(state.teamId');
    });

    it('persists a distinct frame purchase link and renders only safe parent actions', async () => {
        const studio = readRepoFile('js/certificates/studio.js');
        const framePurchaseHelpers = new Function(`
            ${extractFunction(studio, 'function escapeAttr')}
            ${extractFunction(studio, 'function getSafeFramePurchaseUrl')}
            ${extractFunction(studio, 'function renderFramePurchaseAction')}
            return { getSafeFramePurchaseUrl, renderFramePurchaseAction };
        `)();
        const harness = createCertificateStudioHarness();
        harness.state.drafts = [{
            id: 'draft-1',
            recipientName: 'Pat Star',
            description: 'Pat brought energy to every match.',
            descriptionStatus: 'ready'
        }];

        const payload = harness.buildCertificatePayload(harness.state.drafts[0], 'published');
        expect(payload).toMatchObject({
            footerUrl: 'allplays.ai',
            framePurchaseLink: 'https://frames.example.test/team-store',
            status: 'published'
        });

        harness.state.savedCertificates = [{
            id: 'cert-1',
            recipientName: 'Pat Star',
            description: 'Pat brought energy to every match.',
            footerUrl: 'certificate-footer.example',
            framePurchaseLink: 'https://vendor.example.test/pat',
            status: 'published'
        }];
        await harness.openSavedCertificate('cert-1');
        expect(harness.state.shared).toMatchObject({
            footerUrl: 'certificate-footer.example',
            framePurchaseLink: 'https://vendor.example.test/pat'
        });

        expect(framePurchaseHelpers.getSafeFramePurchaseUrl(' https://vendor.example.test/frame?id=1 ')).toBe('https://vendor.example.test/frame?id=1');
        expect(framePurchaseHelpers.getSafeFramePurchaseUrl('http://vendor.example.test/frame')).toBe('http://vendor.example.test/frame');
        expect(framePurchaseHelpers.getSafeFramePurchaseUrl('javascript:alert(1)')).toBe('');
        expect(framePurchaseHelpers.getSafeFramePurchaseUrl('data:text/html,bad')).toBe('');
        expect(framePurchaseHelpers.getSafeFramePurchaseUrl('/relative-frame-store')).toBe('');
        expect(framePurchaseHelpers.getSafeFramePurchaseUrl('not a url')).toBe('');
        expect(framePurchaseHelpers.renderFramePurchaseAction('')).toBe('');
        expect(framePurchaseHelpers.renderFramePurchaseAction('javascript:alert(1)')).toBe('');
        expect(framePurchaseHelpers.renderFramePurchaseAction('https://vendor.example.test/frame?a=1&b=2')).toContain(
            'href="https://vendor.example.test/frame?a=1&amp;b=2" target="_blank" rel="noopener noreferrer"'
        );
        expect(framePurchaseHelpers.renderFramePurchaseAction('https://vendor.example.test/frame')).toContain('>Buy a frame</a>');

        expect(studio).toContain('id="cert-frame-purchase-link"');
        expect(studio).toContain('data-shared-field="framePurchaseLink"');
        expect(studio).toContain('id="cert-review-frame-purchase-link"');
        expect(studio).toContain('const framePurchaseAction = renderFramePurchaseAction(certificate.framePurchaseLink);');
        expect(studio).toContain('id="cert-parent-frame-link"');
        expect(studio).toContain('target="_blank" rel="noopener noreferrer"');
        expect(studio).toContain('>Buy a frame</a>');
    });

    it('blocks publishing while initial certificate descriptions are still generating', () => {
        const studio = readRepoFile('js/certificates/studio.js');
        const generateBody = studio.match(/async function generateTeamCertificates\(\) \{[\s\S]*?function renderReview\(\)/)?.[0] || '';
        const reviewGridBody = studio.match(/function renderReviewGrid\(\) \{[\s\S]*?function bindReviewEvents\(\)/)?.[0] || '';
        const waitBody = studio.match(/async function waitForActiveRegeneration\(\) \{[\s\S]*?async function runDraftRegeneration/)?.[0] || '';

        expect(generateBody).toContain('const descriptionRun = (async () =>');
        expect(generateBody).toContain('state.activeRegenerationPromise = descriptionRun;');
        expect(generateBody).toContain('const results = await descriptionRun;');
        expect(generateBody).toContain("state.descriptionGeneration = null;\n        renderReviewGrid();\n        showAlert(error?.message || 'Unable to generate certificates.', 'error');");
        expect(generateBody).toContain('state.activeRegenerationPromise = null;');
        expect(waitBody).toContain('await state.activeRegenerationPromise;');
        expect(reviewGridBody).toContain('const descriptionGenerationActive = Boolean(state.descriptionGeneration?.active);');
        expect(reviewGridBody).toContain("? 'Descriptions are still generating'");
        expect(reviewGridBody).toContain("? 'Review or fix descriptions before publishing'");
        expect(reviewGridBody).toContain('disabled aria-disabled="true" title="${escapeAttr(publishDisabledReason)}"');
        expect(reviewGridBody).toContain('<button id="cert-publish-btn"');
        expect(reviewGridBody).toContain('${publishDisabledAttrs}>Publish certificates</button>');
    });

    it('blocks website certificate publishing until every selected description is ready', () => {
        const harness = createCertificateStudioHarness();
        harness.state.drafts = [
            {
                id: 'cert-1',
                recipientName: 'Pat Star',
                descriptionStatus: 'ready',
                includeInExport: true
            },
            {
                id: 'cert-2',
                recipientName: 'Sam Star',
                descriptionStatus: 'needs-review',
                includeInExport: true
            },
            {
                id: 'cert-3',
                recipientName: 'Lee Star',
                descriptionStatus: 'error',
                includeInExport: false
            }
        ];

        expect(harness.getPublishBlockedDrafts().map((draft) => draft.recipientName)).toEqual(['Sam Star']);
        expect(harness.guardPublishableDraftDescriptions('draft')).toBe(true);
        expect(harness.guardPublishableDraftDescriptions('published')).toBe(false);
        expect(harness.showAlert).toHaveBeenCalledWith(
            'Review or fix certificates marked Needs review or Error before publishing: Sam Star.',
            'error'
        );
        expect(harness.renderReviewGrid).toHaveBeenCalled();
    });

    it('publishes only selected legacy certificate drafts while preserving batch metadata', async () => {
        const harness = createCertificateStudioHarness();
        harness.state.drafts = [
            {
                id: 'draft-1',
                batchId: 'batch-1',
                certificateId: 'cert-1',
                playerId: 'player-1',
                recipientName: 'Pat Star',
                descriptionStatus: 'ready',
                description: 'Pat brought energy to every match.',
                includeInExport: true,
                status: 'draft'
            },
            {
                id: 'draft-2',
                batchId: 'batch-1',
                certificateId: 'cert-2',
                playerId: 'player-2',
                recipientName: 'Sam Star',
                descriptionStatus: 'ready',
                description: 'Sam led the group with effort.',
                includeInExport: false,
                status: 'draft'
            },
            {
                id: 'draft-3',
                batchId: 'batch-1',
                certificateId: null,
                playerId: 'player-3',
                recipientName: 'Lee Star',
                descriptionStatus: 'ready',
                description: 'Lee made steady progress.',
                includeInExport: true,
                status: 'draft'
            }
        ];

        await harness.saveDrafts('published');

        expect(harness.updateCertificate).toHaveBeenCalledTimes(1);
        expect(harness.updateCertificate).toHaveBeenCalledWith(
            'team-1',
            'cert-1',
            expect.objectContaining({ recipientName: 'Pat Star', status: 'published' }),
            { action: 'published' }
        );
        expect(harness.createCertificate).toHaveBeenCalledTimes(1);
        expect(harness.createCertificate).toHaveBeenCalledWith(
            'team-1',
            expect.objectContaining({ recipientName: 'Lee Star', status: 'published' })
        );
        expect(harness.state.drafts[0].status).toBe('published');
        expect(harness.state.drafts[1]).toMatchObject({ certificateId: 'cert-2', status: 'draft' });
        expect(harness.state.drafts[2]).toMatchObject({ certificateId: 'created-player-3', status: 'published' });
        expect(harness.updateCertificateBatch).toHaveBeenCalledWith('team-1', 'batch-1', expect.objectContaining({
            generatedCertificateIds: ['cert-1', 'cert-2', 'created-player-3'],
            status: 'published'
        }));
    });

    it('persists one-off certificate drafts with stable ids and restores export selection on reopen', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-28T04:24:16Z'));

        try {
            const timestamp = Date.now();
            const harness = createCertificateStudioHarness();
            harness.startCustomCertificate();

            expect(harness.state.drafts).toHaveLength(1);
            expect(harness.state.drafts[0]).toMatchObject({
                batchId: null,
                certificateId: null,
                playerId: null,
                includeInExport: true,
                recipientName: 'Custom Recipient'
            });

            harness.state.drafts[0].recipientName = 'Coach Choice';
            harness.state.drafts[0].awardTitle = 'Leadership Award';
            harness.state.drafts[0].description = 'Closed out the season with steady leadership.';
            harness.state.drafts[0].includeInExport = false;

            expect(harness.buildCertificatePayload(harness.state.drafts[0], 'draft')).toMatchObject({
                batchId: null,
                playerId: null,
                recipientName: 'Coach Choice',
                awardTitle: 'Leadership Award',
                includeInExport: false,
                status: 'draft'
            });

            harness.saveDraftsToLocalHistory('draft');

            const expectedBatchId = `local-batch-${timestamp}`;
            const expectedCertificateId = `local-cert-${expectedBatchId}-custom-${timestamp}`;

            expect(harness.state.savedBatches).toHaveLength(1);
            expect(harness.state.savedCertificates).toHaveLength(1);
            expect(harness.state.drafts[0].batchId).toBe(expectedBatchId);
            expect(harness.state.drafts[0].certificateId).toBe(expectedCertificateId);
            expect(harness.state.savedBatches[0].selectedPlayerIds).toEqual([]);
            expect(harness.state.savedCertificates[0]).toMatchObject({
                id: expectedCertificateId,
                batchId: expectedBatchId,
                playerId: null,
                recipientName: 'Coach Choice',
                awardTitle: 'Leadership Award',
                includeInExport: false
            });

            await harness.openSavedCertificate(harness.state.savedCertificates[0].id);
            expect(harness.state.drafts).toHaveLength(1);
            expect(harness.state.drafts[0]).toMatchObject({
                certificateId: expectedCertificateId,
                batchId: expectedBatchId,
                playerId: null,
                recipientName: 'Coach Choice',
                awardTitle: 'Leadership Award',
                includeInExport: false
            });
            expect([...harness.state.selectedPlayerIds]).toEqual([]);

            await harness.openSavedBatch(harness.state.savedBatches[0].id);
            expect(harness.state.drafts).toHaveLength(1);
            expect(harness.state.drafts[0]).toMatchObject({
                playerId: null,
                recipientName: 'Coach Choice',
                includeInExport: false
            });
            expect([...harness.state.selectedPlayerIds]).toEqual([]);
        } finally {
            vi.useRealTimers();
        }
    });

    it('adds coach and parent navigation without exposing certificates on the public team page', () => {
        const banner = readRepoFile('js/team-admin-banner.js');
        const dashboard = readRepoFile('dashboard.html');
        const parentDashboard = readRepoFile('parent-dashboard.html');
        const publicTeam = readRepoFile('team.html');

        expect(banner).toContain('certificates: `certificates.html#teamId=${teamId}`');
        expect(banner).toContain("label: 'Certificates', iconName: 'certificates', active: active === 'certificates'");
        expect(dashboard).toContain('href="certificates.html#teamId=${team.id}"');
        expect(parentDashboard).toContain('listCertificatesForPlayer');
        expect(parentDashboard).toContain('Certificates');
        expect(publicTeam).not.toContain('certificates.html#teamId=');
    });

    it('adds Firestore certificate helpers, rules, and indexes', () => {
        const db = readRepoFile('js/db.js');
        const rules = readRepoFile('firestore.rules');
        const indexes = readRepoFile('firestore.indexes.json');

        [
            'getCertificateDefaults',
            'setCertificateDefaults',
            'createCertificateBatch',
            'getCertificateBatch',
            'listCertificateBatches',
            'createCertificate',
            'updateCertificate',
            'getCertificate',
            'archiveCertificate',
            'listCertificatesForPlayer'
        ].forEach((helperName) => {
            expect(db).toContain(`export async function ${helperName}`);
        });
        expect(db).toContain('export function canAccessCertificates');
        expect(db).toContain('export function canViewSavedCertificate');
        expect(db).toContain("where('status', 'in', statuses)");
        expect(db).toContain('options.limit || 250');
        expect(db).toContain('options.limit || 100');

        expect(rules).toContain('match /certificateBatches/{batchId}');
        expect(rules).toContain('match /certificates/{certificateId}');
        expect(rules).toContain('isPublishedLinkedCertificate(teamId, resource.data)');
        expect(rules).toContain('match /settings/{settingId}');

        expect(indexes).toContain('"collectionGroup": "certificates"');
        expect(indexes).toContain('"collectionGroup": "certificateBatches"');
        expect(indexes).toContain('"fieldPath": "playerId"');
    });

    it('falls back to loading the requested parent certificate by id', () => {
        const studio = readRepoFile('js/certificates/studio.js');
        const parentLoadBody = studio.match(/async function loadParentCertificates\(params = getParams\(\)\) \{[\s\S]*?\n\}/)?.[0] || '';

        expect(parentLoadBody).toContain('let certificate = entries');
        expect(parentLoadBody).toContain('const requestedCertificate = await getCertificate(state.teamId, certificateId);');
        expect(parentLoadBody).toContain('if (!certificate && !state.demoMode) {');
        expect(parentLoadBody).not.toContain('if (!certificate && !state.demoMode && !state.certificatePersistenceUnavailable) {');
        expect(parentLoadBody).toContain('if (canViewSavedCertificate(state.user, state.team, requestedCertificate)) {');
        expect(parentLoadBody).toContain('matchingEntry.certificates.unshift(certificate);');
        expect(parentLoadBody).toContain("showAlert('Saved certificate could not be found for your linked players.', 'warning');");
    });

    it('wires team color editing for certificate palettes and PNG-backed print', () => {
        const editTeam = readRepoFile('edit-team.html');
        const studio = readRepoFile('js/certificates/studio.js');
        const exporter = readRepoFile('js/certificates/exporter.js');
        const css = readRepoFile('css/certificates.css');

        expect(editTeam).toContain('id="teamColorPrimary"');
        expect(editTeam).toContain('id="teamColorSecondary"');
        expect(editTeam).toContain('colors: {');
        expect(editTeam).toContain("primary: normalizeHexColor(document.getElementById('teamColorPrimary').value");
        expect(studio).toContain('printCertificateBlobs');
        expect(studio).toContain('blobs.push(await renderDraftToBlob(draft));');
        expect(studio).toContain('printCertificates(drafts.map');
        expect(exporter).toContain('export async function printCertificateBlobs');
        expect(exporter).toContain('cert-print-image');
        expect(exporter).toContain('cert-print-dom-frame');
        expect(css).toContain('size: letter landscape');
        expect(css).toContain('.cert-print-image');
        expect(css).toContain('.cert-print-dom-frame');
    });
});
