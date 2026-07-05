import { checkAuth } from '../auth.js?v=40';
import {
    getTeam,
    getUserProfile,
    getUserByEmail,
    getPlayers,
    getGames,
    getAggregatedStatsForGames,
    getUnreadChatCounts,
    getCertificateDefaults,
    setCertificateDefaults,
    listCertificateAssets,
    listCertificateBatches,
    getCertificateBatch,
    listCertificates,
    listCertificatesForPlayer,
    createCertificateBatch,
    updateCertificateBatch,
    createCertificate,
    updateCertificate,
    getCertificate,
    canAccessCertificates,
    canViewSavedCertificate
} from '../db.js?v=80';
import { renderHeader, renderFooter, escapeHtml, shareOrCopy } from '../utils.js?v=8';
import { renderTeamAdminBanner, getTeamAccessInfo } from '../team-admin-banner.js?v=4';
import { TEMPLATES } from './templates.js?v=2';
import { CERTIFICATE_FONT_OPTIONS, renderCertificate, createPreviewDraft, resolveColors, getContrastWarning } from './renderer.js?v=2';
import { buildDefaultSigners, normalizeSigners } from './signers.js?v=1';
import {
    CERTIFICATE_DESCRIPTION_CHAR_LIMIT,
    generateCertificateDescription,
    generateDescriptionsForDrafts,
    selectRecentCompletedGames,
    truncateCertificateDescription
} from './aiDescriptions.js?v=4';
import {
    downloadCertificatePng,
    downloadCertificateZip,
    getCertificateFilename,
    printCertificates,
    printCertificateBlobs,
    renderNodeToPngBlob
} from './exporter.js?v=1';

const DESCRIPTION_MAX_LENGTH = CERTIFICATE_DESCRIPTION_CHAR_LIMIT;
const DESCRIPTION_SOFT_LIMIT = 300;
const PREVIEW_DEBOUNCE_MS = 120;

const state = {
    teamId: null,
    user: null,
    profile: null,
    team: null,
    accessInfo: null,
    roster: [],
    games: [],
    assets: [],
    savedBatches: [],
    savedCertificates: [],
    selectedPlayerIds: new Set(),
    shared: null,
    drafts: [],
    selectedDraftId: null,
    mode: 'setup',
    previewZoom: 'fit',
    demoMode: false,
    certificatePersistenceUnavailable: false,
    activeRegenerationPromise: null,
    imageUploadStatus: {},
    pendingPreviewTimer: null,
    descriptionGeneration: null,
    savedListExpanded: {},
    advancedCustomizationOpen: false
};

renderFooter(document.getElementById('footer-container'));

function escapeAttr(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function getParams() {
    const params = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    for (const [key, value] of hashParams) params.set(key, value);
    return params;
}

function isLocalDemoMode(params) {
    const host = window.location.hostname;
    const allowedDemoHosts = new Set(['localhost', '127.0.0.1', '', 'allplays.ai', 'www.allplays.ai']);
    return allowedDemoHosts.has(host) && (params.get('demo') === '1' || params.get('certDemo') === '1');
}

function showAlert(message, tone = 'info') {
    const el = document.getElementById('cert-alert');
    if (!el) return;
    const classes = {
        info: 'border-primary-200 bg-primary-50 text-primary-800',
        success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
        warning: 'border-amber-200 bg-amber-50 text-amber-800',
        error: 'border-red-200 bg-red-50 text-red-800'
    };
    el.className = `mb-4 rounded-lg border px-4 py-3 text-sm ${classes[tone] || classes.info}`;
    el.textContent = message;
    el.classList.remove('hidden');
}

function isPermissionError(error) {
    return error?.code === 'permission-denied' ||
        /missing or insufficient permissions/i.test(String(error?.message || ''));
}

async function loadOptionalCertificateResource(label, loader, fallback) {
    try {
        return await loader();
    } catch (error) {
        if (isPermissionError(error)) {
            console.warn(`[certificates] ${label} unavailable due to permissions:`, error);
            state.certificatePersistenceUnavailable = true;
            return fallback;
        }
        throw error;
    }
}

function hideLoading() {
    document.getElementById('cert-loading')?.classList.add('hidden');
}

function showStudio() {
    document.getElementById('cert-studio')?.classList.remove('hidden');
    document.getElementById('cert-parent-view')?.classList.add('hidden');
    setCoachActionButtonsVisible(true);
}

function setCoachActionButtonsVisible(visible) {
    ['cert-new-run-btn', 'cert-view-saved-btn', 'cert-custom-recipient-btn'].forEach((id) => {
        document.getElementById(id)?.classList.toggle('hidden', !visible);
    });
}

function runCoachCertificateAction(action) {
    const hasCoachStudioAccess = state.demoMode ||
        (state.accessInfo?.hasAccess === true && state.accessInfo?.accessLevel !== 'parent');
    if (!hasCoachStudioAccess || !state.shared) return;
    action();
}

function getDefaultCustomColors(team = {}) {
    const primary = team.colors?.primary || '#5ec9c5';
    const secondary = team.colors?.secondary || '#d32f3a';
    return {
        borderColor: secondary,
        accentColor: primary,
        textColor: '#0f2430'
    };
}

function getDemoData() {
    const teamId = 'demo-junior-current';
    return {
        user: {
            uid: 'demo-coach',
            email: 'paul@paulsnider.net',
            displayName: 'Paul Snider',
            isAdmin: true,
            parentOf: [],
            parentPlayerKeys: []
        },
        profile: {
            isAdmin: true,
            email: 'paul@paulsnider.net',
            fullName: 'Paul Snider'
        },
        team: {
            id: teamId,
            name: 'Junior Current',
            sport: 'Soccer',
            ownerId: 'demo-coach',
            ownerName: 'Brian Karpuk',
            adminEmails: ['paul@paulsnider.net', 'tim@example.com'],
            colors: {
                primary: '#5ec9c5',
                secondary: '#d32f3a'
            },
            photoUrl: 'img/certificate-jr-current-crest.png'
        },
        roster: [
            { id: 'vivian-karpuk', name: 'Vivian Karpuk', number: '4', active: true },
            { id: 'emily-clements', name: 'Emily Clements', number: '7', active: true },
            { id: 'ava-williams', name: 'Ava Williams', number: '11', active: true },
            { id: 'riley-johnson', name: 'Riley Johnson', number: '3', active: true },
            { id: 'payton-smith', name: 'Payton Smith', number: '10', active: true },
            { id: 'harper-lee', name: 'Harper Lee', number: '12', active: true },
            { id: 'mia-garcia', name: 'Mia Garcia', number: '14', active: true },
            { id: 'zoe-martin', name: 'Zoe Martin', number: '15', active: true },
            { id: 'lily-brown', name: 'Lily Brown', number: '18', active: true },
            { id: 'nora-davis', name: 'Nora Davis', number: '20', active: true },
            { id: 'ella-wilson', name: 'Ella Wilson', number: '22', active: true },
            { id: 'sophie-clark', name: 'Sophie Clark', number: '24', active: true }
        ],
        games: [
            { id: 'g1', status: 'completed', date: new Date('2025-10-26'), opponent: 'Blue Valley', summary: 'Controlled midfield and held shape late.' },
            { id: 'g2', status: 'final', date: new Date('2025-10-19'), opponent: 'North Stars', summary: 'Won key second balls and supported transitions.' }
        ],
        totalsByPlayer: {
            'vivian-karpuk': { tackles: 12, interceptions: 8, assists: 2 },
            'emily-clements': { goals: 5, assists: 3, shots: 14 },
            'ava-williams': { saves: 18, clearances: 5 },
            'riley-johnson': { tackles: 10, assists: 2, clearances: 4 },
            'payton-smith': { goals: 4, assists: 4, interceptions: 6 },
            'harper-lee': { shots: 9, goals: 2, tackles: 7 },
            'mia-garcia': { assists: 5, interceptions: 5, recoveries: 8 },
            'zoe-martin': { goals: 3, shots: 10, tackles: 4 },
            'lily-brown': { clearances: 7, interceptions: 9, assists: 1 },
            'nora-davis': { tackles: 8, recoveries: 11, shots: 3 },
            'ella-wilson': { goals: 2, assists: 6, shots: 8 },
            'sophie-clark': { saves: 10, clearances: 8, recoveries: 5 }
        },
        assets: [
            {
                id: 'crest',
                kind: 'foreground',
                url: 'img/certificate-jr-current-crest.png',
                originalFilename: 'Junior Current crest'
            },
            {
                id: 'all-plays-logo',
                kind: 'generic',
                url: 'img/logo_small.png',
                originalFilename: 'Previous upload sample'
            }
        ]
    };
}

async function buildSharedDefaults({ team, defaults, currentUser }) {
    const signers = defaults?.signers?.length
        ? normalizeSigners(defaults.signers)
        : await buildDefaultSigners(team, currentUser, { getUserProfile, getUserByEmail });
    const teamLogoUrl = getTeamLogoUrl(team);

    return {
        templateId: defaults?.templateId || 'banner',
        teamNameOverride: defaults?.teamNameOverride || team?.name || 'Team',
        awardTitle: defaults?.awardTitle || '',
        seasonLabel: defaults?.seasonLabel || '',
        footerUrl: defaults?.footerUrl || '',
        colorMode: defaults?.colorMode || (team?.colors ? 'team' : 'template'),
        customColors: {
            ...getDefaultCustomColors(team),
            ...(defaults?.customColors || {})
        },
        descriptionTone: defaults?.descriptionTone || 'celebratory and specific',
        statsWindow: Number(defaults?.statsWindow || 10) === 5 ? 5 : 10,
        fonts: {
            heading: defaults?.fonts?.heading || 'classic',
            recipient: defaults?.fonts?.recipient || 'classic',
            body: defaults?.fonts?.body || 'friendly'
        },
        signers,
        foregroundImageRef: defaults?.foregroundImageRef || (teamLogoUrl ? { url: teamLogoUrl, source: 'team-logo' } : null),
        backgroundImageRef: defaults?.backgroundImageRef || null,
        backgroundOpacity: Number.isFinite(Number(defaults?.backgroundOpacity)) ? Number(defaults.backgroundOpacity) : 18,
        watermarkImageRef: defaults?.watermarkImageRef || null,
        watermarkOpacity: Number.isFinite(Number(defaults?.watermarkOpacity)) ? Number(defaults.watermarkOpacity) : 12
    };
}

function getSelectedPlayers() {
    return state.roster.filter((player) => state.selectedPlayerIds.has(player.id));
}

function getSelectedDrafts() {
    return state.drafts.filter((draft) => draft.includeInExport !== false);
}

function getSelectedDraft() {
    return state.drafts.find((draft) => draft.id === state.selectedDraftId) || state.drafts[0] || createPreviewDraft(state.roster, state.shared);
}

function clonePlain(value) {
    return JSON.parse(JSON.stringify(value || null));
}

function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value || {}, key);
}

function certificateTeamName() {
    return state.shared?.teamNameOverride || state.team?.name || 'Team';
}

function toDateValue(value) {
    if (!value) return null;
    if (typeof value.toDate === 'function') return value.toDate();
    if (typeof value.toMillis === 'function') return new Date(value.toMillis());
    if (value instanceof Date) return value;
    if (typeof value === 'number') return new Date(value);
    if (typeof value === 'string') return new Date(value);
    return null;
}

function formatSavedTime(value) {
    const date = toDateValue(value);
    if (!date || Number.isNaN(date.getTime())) return 'No date';
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const days = Math.round((startOfToday - startOfDate) / 86400000);
    const absolute = date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
    if (days <= 0) return `Today · ${absolute}`;
    if (days === 1) return `Yesterday · ${absolute}`;
    if (days < 30) return `${days} days ago · ${absolute}`;
    return absolute;
}

function getSavedItemTimestamp(item = {}) {
    return item.updatedAt || item.createdAt || null;
}

function schedulePreviewRender() {
    clearTimeout(state.pendingPreviewTimer);
    state.pendingPreviewTimer = setTimeout(() => {
        if (state.mode === 'review') {
            renderReviewPreview();
        } else {
            renderSetupPreview();
        }
    }, PREVIEW_DEBOUNCE_MS);
}

function applyPreviewScale(container, canvas) {
    const scaleTarget = container.querySelector('.cert-preview-scale');
    if (!scaleTarget || !canvas) return;
    const canvasWidth = Number.parseInt(canvas.style.width, 10) || 2050;
    let scale = 1;
    if (state.previewZoom === 'fit') {
        scale = Math.min(1, Math.max(0.12, (container.clientWidth - 32) / canvasWidth));
    } else if (state.previewZoom === '200') {
        scale = 2;
    }
    scaleTarget.style.transform = `scale(${scale})`;
    scaleTarget.style.width = `${canvasWidth}px`;
    scaleTarget.style.height = `${(Number.parseInt(canvas.style.height, 10) || 1153) * scale}px`;
}

function renderPreviewControls() {
    const downloadButton = state.mode === 'review' && state.drafts.length
        ? '<button id="cert-preview-png-btn" type="button" class="rounded-lg border border-primary-200 bg-primary-50 px-3 py-1.5 text-xs font-semibold text-primary-700">PNG</button>'
        : '';
    return `
        <div class="mb-3 flex items-center justify-between gap-2">
            <div>
                <h2 class="text-lg font-bold text-gray-900">Preview</h2>
                <p class="text-xs text-gray-500">Same canvas used for print and export.</p>
            </div>
            <div class="flex flex-wrap items-center justify-end gap-2">
                ${downloadButton}
                <div class="flex rounded-lg border border-gray-200 bg-white p-0.5">
                    ${['fit', '100', '200'].map((zoom) => `
                        <button type="button" data-preview-zoom="${zoom}" class="rounded-md px-2 py-1 text-xs font-semibold ${state.previewZoom === zoom ? 'bg-primary-600 text-white' : 'text-gray-600 hover:bg-gray-100'}">${zoom === 'fit' ? 'Fit' : `${zoom}%`}</button>
                    `).join('')}
                </div>
            </div>
        </div>
    `;
}

function renderCertificateInto(container, draft) {
    const viewport = container.querySelector('.cert-preview-viewport');
    if (!viewport) return;
    const scaleTarget = viewport.querySelector('.cert-preview-scale');
    scaleTarget.innerHTML = '';
    const canvas = renderCertificate({ shared: state.shared, draft, team: state.team });
    scaleTarget.appendChild(canvas);
    requestAnimationFrame(() => applyPreviewScale(viewport, canvas));
}

function bindPreviewControls(container) {
    container.querySelectorAll('[data-preview-zoom]').forEach((button) => {
        button.addEventListener('click', () => {
            state.previewZoom = button.dataset.previewZoom;
            if (state.mode === 'review') renderReviewPreview();
            else renderSetupPreview();
        });
    });
    container.querySelector('#cert-preview-png-btn')?.addEventListener('click', () => downloadDraftPngById(getSelectedDraft().id));
}

function renderSetupPreview() {
    const container = document.getElementById('cert-preview');
    if (!container) return;
    container.innerHTML = `
        <div class="cert-panel-body">
            ${renderPreviewControls()}
            <div class="cert-preview-viewport">
                <div class="cert-preview-scale"></div>
            </div>
        </div>
    `;
    bindPreviewControls(container);
    renderCertificateInto(container, createPreviewDraft(state.roster, state.shared));
}

function updateSharedFromInput(input) {
    const key = input.dataset.sharedField;
    if (!key) return;
    const value = input.type === 'number' || input.type === 'range'
        ? Number(input.value)
        : input.value;
    state.shared[key] = value;
}

function updateCustomColorFromInput(input) {
    const key = input.dataset.colorSlot;
    if (!key) return;
    state.shared.customColors[key] = input.value;
}

function updateFontFromInput(input) {
    const key = input.dataset.fontSlot;
    if (!key) return;
    state.shared.fonts = {
        ...(state.shared.fonts || {}),
        [key]: input.value
    };
}

function getTeamLogoUrl(team = state.team) {
    return team?.photoUrl || team?.logoUrl || team?.teamLogoUrl || team?.imageUrl || '';
}

function imageRefToUrl(ref) {
    if (!ref) return '';
    if (typeof ref === 'string') return ref;
    return ref.url || ref.downloadURL || ref.photoUrl || ref.imageUrl || '';
}

function imageRefToLabel(ref, fallback = 'Selected image') {
    if (!ref) return 'No image selected';
    if (typeof ref === 'string') return fallback;
    if (ref.source === 'team-logo') return 'Team logo';
    return ref.originalFilename || ref.name || ref.kind || fallback;
}

function getSelectableImageAssets(teamLogoUrl = '') {
    const byUrl = new Map();
    const add = (asset, fallbackLabel = 'Team image') => {
        const url = imageRefToUrl(asset);
        if (!url || url === teamLogoUrl || byUrl.has(url)) return;
        byUrl.set(url, {
            ...asset,
            url,
            originalFilename: imageRefToLabel(asset, fallbackLabel)
        });
    };

    state.assets.forEach((asset) => add(asset, 'Uploaded image'));

    [
        ['logoUrl', 'Team logo'],
        ['teamLogoUrl', 'Team logo'],
        ['imageUrl', 'Team image']
    ].forEach(([key, label]) => {
        if (state.team?.[key]) add({ url: state.team[key], originalFilename: label, source: key }, label);
    });

    return Array.from(byUrl.values());
}

function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error || new Error('Unable to preview image.'));
        reader.readAsDataURL(file);
    });
}

function formatImageUploadError(error) {
    const message = String(error?.message || 'Image upload failed.');
    if (/requests-from-referer-http:\/\/127\.0\.0\.1:8000-are-blocked/i.test(message)) {
        return 'Open this page at http://localhost:8000 instead of http://127.0.0.1:8000 to upload images.';
    }
    if (/requests-from-referer-http:\/\/localhost:(?!8000)\d+-are-blocked/i.test(message)) {
        return 'Image uploads are allowlisted for http://localhost:8000. Open that exact local URL to upload.';
    }
    if (/requests-from-referer/i.test(message)) {
        return 'This local URL is not allowlisted for image uploads. Use http://localhost:8000 or the deployed site.';
    }
    if (/permission/i.test(message)) {
        return 'Upload reached Firebase, but this account does not have permission to save the image asset.';
    }
    return message;
}

function renderOpacityControl(fieldKey, label) {
    if (!fieldKey) return '';
    const value = Number.isFinite(Number(state.shared[fieldKey])) ? Number(state.shared[fieldKey]) : 0;
    const inputId = `cert-${fieldKey.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)}`;
    return `
        <div class="cert-image-opacity">
            <div class="cert-image-opacity-row">
                <label for="${inputId}">${escapeHtml(label)}</label>
                <span>${value}%</span>
            </div>
            <input id="${inputId}" type="range" min="0" max="100" data-shared-field="${escapeAttr(fieldKey)}" value="${escapeAttr(value)}">
        </div>
    `;
}

function renderImageSlot(slotKey, label, options = {}) {
    const teamLogoUrl = getTeamLogoUrl();
    const value = state.shared[slotKey];
    const selectedUrl = imageRefToUrl(value);
    const selectedLabel = imageRefToLabel(value, label);
    const status = state.imageUploadStatus[slotKey] || null;
    const statusMessage = status?.message || (selectedUrl ? `Selected: ${selectedLabel}` : 'PNG, JPG, or WebP up to 5 MB');
    const statusState = status?.state || (selectedUrl ? 'ready' : '');
    const uploadLabel = selectedUrl ? 'Replace image' : 'Choose image';
    const badgeText = status?.state === 'uploading' ? 'Uploading' : (selectedUrl ? 'Image selected' : 'No image');
    const selectableAssets = getSelectableImageAssets(teamLogoUrl);
    const assetOptions = selectableAssets.map((asset) => (
        `<option value="${escapeAttr(asset.url)}" ${selectedUrl === asset.url ? 'selected' : ''}>${escapeHtml(asset.originalFilename || asset.kind || 'Uploaded image')}</option>`
    )).join('');
    const hasCurrentOption = selectedUrl &&
        selectedUrl !== teamLogoUrl &&
        !selectableAssets.some((asset) => asset.url === selectedUrl);
    return `
        <div class="cert-field">
            <label for="${slotKey}-source">${label}</label>
            <div class="cert-image-slot ${selectedUrl ? 'has-image' : ''}">
                <div class="cert-image-thumb ${selectedUrl ? '' : 'is-empty'}">
                    ${selectedUrl ? `<img src="${escapeAttr(selectedUrl)}" alt="${escapeAttr(selectedLabel)}">` : '<span>No image</span>'}
                </div>
                <div class="cert-image-controls">
                    <select id="${slotKey}-source" class="cert-select" data-image-slot="${slotKey}">
                        <option value="">None</option>
                        <option value="team-logo" ${selectedUrl && selectedUrl === teamLogoUrl ? 'selected' : ''} ${teamLogoUrl ? '' : 'disabled'}>Use team logo</option>
                        ${hasCurrentOption ? `<option value="${escapeAttr(selectedUrl)}" selected>${escapeHtml(selectedLabel)}</option>` : ''}
                        ${assetOptions ? `<optgroup label="Previous uploads">${assetOptions}</optgroup>` : ''}
                    </select>
                    <div class="cert-image-actions">
                        <label class="cert-upload-button ${selectedUrl ? 'has-image' : ''}">
                            <span class="cert-upload-icon" aria-hidden="true">
                                <svg viewBox="0 0 24 24" focusable="false">
                                    <path d="M12 4v11"></path>
                                    <path d="m7 9 5-5 5 5"></path>
                                    <path d="M5 20h14"></path>
                                </svg>
                            </span>
                            <span class="cert-upload-copy">
                                <span class="cert-upload-main">${escapeHtml(uploadLabel)}</span>
                                <span class="cert-upload-sub">PNG, JPG, WebP</span>
                            </span>
                            <input type="file" accept="image/png,image/jpeg,image/webp" class="cert-file-input" data-image-upload="${slotKey}">
                        </label>
                        <span class="cert-image-badge ${selectedUrl ? 'is-ready' : 'is-empty'}">${escapeHtml(badgeText)}</span>
                    </div>
                    <div class="cert-image-status ${statusState ? `is-${statusState}` : ''}">
                        ${escapeHtml(statusMessage)}
                    </div>
                    ${renderOpacityControl(options.opacityField, options.opacityLabel)}
                </div>
            </div>
        </div>
    `;
}

function renderSignerEditor() {
    const rows = state.shared.signers.map((signer, index) => `
        <div class="rounded-lg border border-gray-200 p-3" data-signer-row="${index}">
            <div class="grid grid-cols-1 gap-2 md:grid-cols-2">
                <input class="cert-input" data-signer-field="name" data-signer-index="${index}" value="${escapeAttr(signer.name)}" placeholder="Signer name">
                <input class="cert-input" data-signer-field="role" data-signer-index="${index}" value="${escapeAttr(signer.role)}" placeholder="Role">
            </div>
            <div class="mt-2 flex flex-wrap items-center gap-2">
                <select class="cert-select max-w-[170px]" data-signer-field="signatureStyle" data-signer-index="${index}">
                    <option value="script" ${signer.signatureStyle === 'script' ? 'selected' : ''}>Script font</option>
                    <option value="typed" ${signer.signatureStyle === 'typed' ? 'selected' : ''}>Typed</option>
                    <option value="image" ${signer.signatureStyle === 'image' ? 'selected' : ''}>Image</option>
                </select>
                <label class="inline-flex cursor-pointer items-center rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50">
                    Signature PNG
                    <input type="file" accept="image/png,image/jpeg,image/webp" class="hidden" data-signature-upload="${index}">
                </label>
                <button type="button" data-signer-up="${index}" class="rounded-lg border border-gray-300 px-2 py-1 text-xs font-semibold text-gray-600">Up</button>
                <button type="button" data-signer-down="${index}" class="rounded-lg border border-gray-300 px-2 py-1 text-xs font-semibold text-gray-600">Down</button>
                <button type="button" data-signer-remove="${index}" class="rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs font-semibold text-red-700">Remove</button>
            </div>
        </div>
    `).join('');

    return `
        <div class="space-y-2">
            <div class="flex items-center justify-between gap-2">
                <div class="cert-label mb-0">Signature block</div>
                <button id="cert-add-signer-btn" type="button" class="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50" ${state.shared.signers.length >= 4 ? 'disabled' : ''}>Add signer</button>
            </div>
            ${rows || '<p class="text-sm text-gray-500">No signers yet.</p>'}
        </div>
    `;
}

function renderSetup() {
    const colors = resolveColors(state.shared, state.team);
    const contrastWarning = getContrastWarning(colors);
    const customVisible = state.shared.colorMode === 'custom';
    const teamColorsHint = !state.team?.colors
        ? `<a href="edit-team.html#teamId=${escapeAttr(state.teamId)}" class="font-semibold text-primary-700 underline">Set team colors</a>`
        : '';

    document.getElementById('cert-setup').innerHTML = `
        <div class="cert-panel-header">
            <h2 class="text-xl font-bold text-gray-900">Shared setup</h2>
            <p class="mt-1 text-sm text-gray-500">Start with the essentials, then customize the design only if needed.</p>
        </div>
        <div class="cert-panel-body space-y-5">
            <div class="cert-form-grid">
                <div class="cert-field">
                    <label for="cert-team-name">Team name banner</label>
                    <input id="cert-team-name" class="cert-input" data-shared-field="teamNameOverride" value="${escapeAttr(state.shared.teamNameOverride)}">
                </div>
                <div class="cert-field">
                    <label for="cert-season-label">Season label</label>
                    <input id="cert-season-label" class="cert-input" data-shared-field="seasonLabel" value="${escapeAttr(state.shared.seasonLabel)}" placeholder="Fall 2025">
                </div>
                <div class="cert-field">
                    <label for="cert-award-title">Award title</label>
                    <input id="cert-award-title" class="cert-input" data-shared-field="awardTitle" value="${escapeAttr(state.shared.awardTitle)}" placeholder="Optional">
                </div>
            </div>

            <details id="cert-advanced-customization" class="rounded-xl border border-gray-200 bg-gray-50/70" ${state.advancedCustomizationOpen ? 'open' : ''}>
                <summary class="cursor-pointer px-4 py-3 text-sm font-bold text-gray-800">Customize certificate design</summary>
                <div class="space-y-5 border-t border-gray-200 bg-white px-4 py-5">
                    <div>
                        <div class="cert-label">Template</div>
                        <div class="cert-template-picker">
                            ${Object.values(TEMPLATES).map((template) => `
                                <button type="button" class="cert-template-option" data-template-id="${template.id}" aria-pressed="${state.shared.templateId === template.id}">
                                    <div class="cert-template-swatch ${template.id === 'header' ? 'cert-template-swatch-header' : ''}"></div>
                                    <div class="mt-2 text-sm font-bold text-gray-900">${escapeHtml(template.displayName)}</div>
                                </button>
                            `).join('')}
                        </div>
                    </div>

                    <div class="cert-field">
                        <label for="cert-footer-url">Footer URL</label>
                        <input id="cert-footer-url" class="cert-input" data-shared-field="footerUrl" value="${escapeAttr(state.shared.footerUrl)}" placeholder="www.jrkccurrent.com">
                    </div>

                    <div>
                        <div class="cert-label">Color mode</div>
                        <div class="cert-segmented">
                            ${[
                                ['team', 'Use team colors'],
                                ['template', 'Template default'],
                                ['custom', 'Custom']
                            ].map(([value, label]) => `
                                <label><input type="radio" name="cert-color-mode" value="${value}" ${state.shared.colorMode === value ? 'checked' : ''}> <span>${label}</span></label>
                            `).join('')}
                        </div>
                        ${teamColorsHint ? `<p class="mt-2 text-xs text-amber-700">${teamColorsHint} to use a team-specific palette.</p>` : ''}
                        <div id="cert-custom-colors" class="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3 ${customVisible ? '' : 'hidden'}">
                            ${[
                                ['borderColor', 'Border'],
                                ['accentColor', 'Accent'],
                                ['textColor', 'Text']
                            ].map(([slot, label]) => `
                                <label class="text-xs font-semibold text-gray-600">${label}
                                    <input type="color" data-color-slot="${slot}" value="${escapeAttr(state.shared.customColors[slot])}" class="mt-1 h-10 w-full cursor-pointer rounded border border-gray-300">
                                </label>
                            `).join('')}
                        </div>
                        ${contrastWarning ? `<p id="cert-contrast-warning" class="mt-2 text-xs font-semibold text-amber-700">${escapeHtml(contrastWarning)}</p>` : ''}
                    </div>

                    <div class="cert-image-stack">
                        ${renderImageSlot('foregroundImageRef', 'Foreground crest')}
                        ${renderImageSlot('backgroundImageRef', 'Background image', { opacityField: 'backgroundOpacity', opacityLabel: 'Background opacity' })}
                        ${renderImageSlot('watermarkImageRef', 'Watermark image', { opacityField: 'watermarkOpacity', opacityLabel: 'Watermark opacity' })}
                    </div>

                    <div class="cert-form-grid">
                        <div class="cert-field">
                            <label for="cert-description-tone">Description tone</label>
                            <input id="cert-description-tone" class="cert-input" data-shared-field="descriptionTone" value="${escapeAttr(state.shared.descriptionTone)}">
                        </div>
                        <div class="cert-field">
                            <label for="cert-stats-window">Stats window</label>
                            <select id="cert-stats-window" class="cert-select" data-shared-field="statsWindow">
                                <option value="10" ${state.shared.statsWindow === 10 ? 'selected' : ''}>Last 10 completed games</option>
                                <option value="5" ${state.shared.statsWindow === 5 ? 'selected' : ''}>Last 5 completed games</option>
                            </select>
                        </div>
                    </div>

                    <div>
                        <div class="cert-label">Fonts</div>
                        <div class="cert-form-grid">
                            ${[
                                ['heading', 'Team and title'],
                                ['recipient', 'Recipient name'],
                                ['body', 'Description and footer']
                            ].map(([slot, label]) => `
                                <div class="cert-field">
                                    <label for="cert-font-${slot}">${label}</label>
                                    <select id="cert-font-${slot}" class="cert-select" data-font-slot="${slot}">
                                        ${Object.entries(CERTIFICATE_FONT_OPTIONS).map(([value, option]) => `
                                            <option value="${escapeAttr(value)}" ${state.shared.fonts?.[slot] === value ? 'selected' : ''}>${escapeHtml(option.label)}</option>
                                        `).join('')}
                                    </select>
                                </div>
                            `).join('')}
                        </div>
                    </div>

                    ${renderSignerEditor()}

                    <div class="flex flex-wrap gap-2 border-t border-gray-100 pt-4">
                        <button id="cert-save-default-btn" type="button" class="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">Save setup for future runs</button>
                        <button id="cert-reset-defaults-btn" type="button" class="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">Reset setup</button>
                    </div>
                    <p class="-mt-3 text-xs text-gray-500">Saved setup changes the starting values for future runs. Reset setup restores the basic team defaults.</p>
                </div>
            </details>
        </div>
    `;

    bindSetupEvents();
}

function renderPlayerSelection() {
    const selectedCount = state.selectedPlayerIds.size;
    document.getElementById('cert-player-selection').innerHTML = `
        <div class="cert-panel-header">
            <div class="flex items-center justify-between gap-3">
                <div>
                    <h2 class="text-xl font-bold text-gray-900">Players</h2>
                    <p class="mt-1 text-sm text-gray-500">${selectedCount} selected from the active roster.</p>
                </div>
                <div class="flex gap-2">
                    <button id="cert-select-all-btn" type="button" class="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700">All</button>
                    <button id="cert-select-none-btn" type="button" class="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700">None</button>
                </div>
            </div>
        </div>
        <div class="cert-panel-body">
            <div class="cert-player-list">
                ${state.roster.map((player) => `
                    <label class="cert-player-option">
                        <input type="checkbox" data-player-id="${escapeAttr(player.id)}" ${state.selectedPlayerIds.has(player.id) ? 'checked' : ''}>
                        <span class="min-w-0">
                            <span class="font-semibold text-gray-900">${player.number ? `#${escapeHtml(player.number)} ` : ''}${escapeHtml(player.name || 'Player')}</span>
                        </span>
                    </label>
                `).join('') || '<div class="text-sm text-gray-500">No active roster players found.</div>'}
            </div>
            <div class="mt-4 border-t border-gray-100 pt-4">
                <button id="cert-generate-btn" type="button" class="w-full rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-700">Create drafts for selected players</button>
                <p class="mt-2 text-xs text-gray-500">Creates editable certificates for the checked players. Nothing is saved or published until the review step.</p>
            </div>
        </div>
    `;

    document.querySelectorAll('[data-player-id]').forEach((input) => {
        input.addEventListener('change', () => {
            if (input.checked) state.selectedPlayerIds.add(input.dataset.playerId);
            else state.selectedPlayerIds.delete(input.dataset.playerId);
            renderPlayerSelection();
        });
    });
    document.getElementById('cert-select-all-btn')?.addEventListener('click', () => {
        state.selectedPlayerIds = new Set(state.roster.map((player) => player.id));
        renderPlayerSelection();
    });
    document.getElementById('cert-select-none-btn')?.addEventListener('click', () => {
        state.selectedPlayerIds = new Set();
        renderPlayerSelection();
    });
    document.getElementById('cert-generate-btn')?.addEventListener('click', generateTeamCertificates);
}

function bindSetupEvents() {
    document.getElementById('cert-advanced-customization')?.addEventListener('toggle', (event) => {
        state.advancedCustomizationOpen = event.target.open;
    });

    document.querySelectorAll('[data-template-id]').forEach((button) => {
        button.addEventListener('click', () => {
            state.shared.templateId = button.dataset.templateId;
            renderSetup();
            schedulePreviewRender();
        });
    });

    document.querySelectorAll('[data-shared-field]').forEach((input) => {
        input.addEventListener('input', () => {
            updateSharedFromInput(input);
            if (input.dataset.sharedField === 'watermarkOpacity' || input.dataset.sharedField === 'backgroundOpacity') {
                const valueLabel = input.closest('.cert-image-opacity')?.querySelector('.cert-image-opacity-row span') || input.nextElementSibling;
                if (valueLabel) valueLabel.textContent = `${Number(input.value)}%`;
            }
            schedulePreviewRender();
        });
        input.addEventListener('change', () => {
            updateSharedFromInput(input);
            if (input.dataset.sharedField === 'watermarkOpacity' || input.dataset.sharedField === 'backgroundOpacity') renderSetup();
            schedulePreviewRender();
        });
    });

    document.querySelectorAll('input[name="cert-color-mode"]').forEach((input) => {
        input.addEventListener('change', () => {
            state.shared.colorMode = input.value;
            renderSetup();
            schedulePreviewRender();
        });
    });

    document.querySelectorAll('[data-color-slot]').forEach((input) => {
        input.addEventListener('input', () => {
            updateCustomColorFromInput(input);
            schedulePreviewRender();
        });
    });

    document.querySelectorAll('[data-font-slot]').forEach((select) => {
        select.addEventListener('change', () => {
            updateFontFromInput(select);
            schedulePreviewRender();
        });
    });

    document.querySelectorAll('[data-image-slot]').forEach((select) => {
        select.addEventListener('change', () => {
            const slot = select.dataset.imageSlot;
            if (select.value === 'team-logo') {
                const teamLogoUrl = getTeamLogoUrl();
                state.shared[slot] = teamLogoUrl ? { url: teamLogoUrl, source: 'team-logo' } : null;
            } else if (!select.value) {
                state.shared[slot] = null;
            } else {
                const asset = getSelectableImageAssets(getTeamLogoUrl()).find((item) => item.url === select.value);
                state.shared[slot] = asset || { url: select.value, source: 'asset' };
            }
            state.imageUploadStatus[slot] = null;
            renderSetup();
            schedulePreviewRender();
        });
    });

    document.querySelectorAll('[data-image-upload]').forEach((input) => {
        input.addEventListener('change', async () => {
            const file = input.files?.[0];
            if (!file) return;
            const slot = input.dataset.imageUpload;
            const kind = slot === 'foregroundImageRef' ? 'foreground' : slot === 'backgroundImageRef' ? 'background' : 'watermark';
            input.disabled = true;
            try {
                const previewUrl = await readFileAsDataUrl(file);
                state.shared[slot] = {
                    url: previewUrl,
                    source: 'local-upload',
                    originalFilename: file.name || 'Selected image'
                };
                state.imageUploadStatus[slot] = { state: 'uploading', message: `Uploading ${file.name || 'image'}...` };
                renderSetup();
                schedulePreviewRender();

                const { uploadCertificateAsset } = await import('./assets.js?v=2');
                const asset = await uploadCertificateAsset(state.teamId, file, kind, state.user?.uid || null);
                state.assets.unshift(asset);
                state.shared[slot] = asset;
                state.imageUploadStatus[slot] = asset.firestoreSaveFailed
                    ? { state: 'ready', message: 'Uploaded for this run.' }
                    : { state: 'ready', message: `Uploaded ${asset.originalFilename || file.name || 'image'}.` };
                renderSetup();
                schedulePreviewRender();
                showAlert(
                    asset.firestoreSaveFailed
                        ? 'Image uploaded for this certificate run.'
                        : 'Image uploaded.',
                    'success'
                );
            } catch (error) {
                state.imageUploadStatus[slot] = { state: 'warning', message: `Local preview only. ${formatImageUploadError(error)}` };
                renderSetup();
                schedulePreviewRender();
                showAlert('Image upload failed. The selected image remains in this browser session for preview, print, and export.', 'warning');
            } finally {
                input.disabled = false;
            }
        });
    });

    document.querySelectorAll('[data-signer-field]').forEach((input) => {
        input.addEventListener('input', () => {
            const index = Number(input.dataset.signerIndex);
            const field = input.dataset.signerField;
            state.shared.signers[index][field] = input.value;
            schedulePreviewRender();
        });
        input.addEventListener('change', () => {
            const index = Number(input.dataset.signerIndex);
            const field = input.dataset.signerField;
            state.shared.signers[index][field] = input.value;
            schedulePreviewRender();
        });
    });

    document.querySelectorAll('[data-signature-upload]').forEach((input) => {
        input.addEventListener('change', async () => {
            const file = input.files?.[0];
            if (!file) return;
            const index = Number(input.dataset.signatureUpload);
            try {
                const { uploadSignatureImage } = await import('./assets.js?v=2');
                const result = await uploadSignatureImage(state.user?.uid, file);
                state.shared.signers[index].signatureStyle = 'image';
                state.shared.signers[index].signatureImageUrl = result.url;
                renderSetup();
                schedulePreviewRender();
                showAlert('Signature image uploaded.', 'success');
            } catch (error) {
                showAlert(error?.message || 'Signature upload failed.', 'error');
            }
        });
    });

    document.querySelectorAll('[data-signer-remove]').forEach((button) => {
        button.addEventListener('click', () => {
            state.shared.signers.splice(Number(button.dataset.signerRemove), 1);
            renderSetup();
            schedulePreviewRender();
        });
    });
    document.querySelectorAll('[data-signer-up]').forEach((button) => {
        button.addEventListener('click', () => {
            const index = Number(button.dataset.signerUp);
            if (index <= 0) return;
            [state.shared.signers[index - 1], state.shared.signers[index]] = [state.shared.signers[index], state.shared.signers[index - 1]];
            renderSetup();
            schedulePreviewRender();
        });
    });
    document.querySelectorAll('[data-signer-down]').forEach((button) => {
        button.addEventListener('click', () => {
            const index = Number(button.dataset.signerDown);
            if (index >= state.shared.signers.length - 1) return;
            [state.shared.signers[index], state.shared.signers[index + 1]] = [state.shared.signers[index + 1], state.shared.signers[index]];
            renderSetup();
            schedulePreviewRender();
        });
    });

    document.getElementById('cert-add-signer-btn')?.addEventListener('click', () => {
        if (state.shared.signers.length >= 4) return;
        state.shared.signers.push({
            userId: null,
            name: 'Assistant Coach',
            role: 'Assistant Coach',
            signatureStyle: 'script',
            signatureImageUrl: null
        });
        renderSetup();
        schedulePreviewRender();
    });

    document.getElementById('cert-save-default-btn')?.addEventListener('click', saveTeamDefaults);
    document.getElementById('cert-reset-defaults-btn')?.addEventListener('click', resetTeamDefaults);
}

async function saveTeamDefaults() {
    if (state.demoMode) {
        showAlert('Demo defaults updated for this session.', 'success');
        return;
    }
    try {
        await setCertificateDefaults(state.teamId, state.shared);
        showAlert('Certificate defaults saved for this team.', 'success');
    } catch (error) {
        showAlert(error?.message || 'Unable to save certificate defaults.', 'error');
    }
}

async function resetTeamDefaults() {
    state.shared = await buildSharedDefaults({ team: state.team, defaults: null, currentUser: state.user });
    renderSetup();
    renderPlayerSelection();
    renderSetupPreview();
}

function createDraftFromPlayer(player, batchId, index) {
    return {
        id: `draft-${player.id || index}`,
        certificateId: null,
        batchId,
        playerId: player.id,
        recipientName: player.name || player.playerName || 'Player',
        playerNumber: player.number || '',
        playerPhotoUrl: player.photoUrl || null,
        awardTitle: state.shared.awardTitle || '',
        description: '',
        restoreDescription: '',
        descriptionSource: 'ai',
        descriptionStatus: 'pending',
        statsWindow: state.shared.statsWindow,
        includeInExport: true,
        errorMessage: null,
        status: 'draft'
    };
}

function buildCertificatePayload(draft, status = draft.status || 'draft') {
    return {
        batchId: draft.batchId || null,
        templateId: state.shared.templateId,
        colorMode: state.shared.colorMode,
        colors: resolveColors(state.shared, state.team),
        teamNameOverride: state.shared.teamNameOverride || null,
        playerId: draft.playerId || null,
        recipientName: draft.recipientName,
        playerNumber: draft.playerNumber || null,
        playerPhotoUrl: draft.playerPhotoUrl || null,
        awardTitle: draft.awardTitle || null,
        description: truncateCertificateDescription(draft.description || ''),
        descriptionSource: draft.descriptionSource || 'manual',
        statsWindow: draft.statsWindow || state.shared.statsWindow,
        seasonLabel: state.shared.seasonLabel || '',
        footerUrl: state.shared.footerUrl || '',
        fonts: state.shared.fonts || null,
        signers: normalizeSigners(state.shared.signers),
        foregroundImageRef: state.shared.foregroundImageRef || null,
        backgroundImageRef: state.shared.backgroundImageRef || null,
        backgroundOpacity: state.shared.backgroundOpacity,
        watermarkImageRef: state.shared.watermarkImageRef || null,
        watermarkOpacity: state.shared.watermarkOpacity,
        includeInExport: draft.includeInExport !== false,
        exportedPngUrl: draft.exportedPngUrl || null,
        exportedPdfUrl: draft.exportedPdfUrl || null,
        status
    };
}

function applyDescriptionResultToDraft(draft, result) {
    if (!draft || !result) return;
    const userEditedPendingDescription = draft.descriptionSource === 'manual' && draft.descriptionStatus === 'ready';
    if (userEditedPendingDescription) {
        draft.errorMessage = null;
        return;
    }
    draft.description = truncateCertificateDescription(result.description);
    draft.descriptionStatus = result.status;
    draft.descriptionSource = result.source;
    draft.errorMessage = result.errorMessage;
}

function updateDescriptionGenerationProgress(completed, total, label = 'Generating descriptions') {
    state.descriptionGeneration = {
        active: completed < total,
        completed,
        total,
        label
    };
}

async function generateTeamCertificates() {
    const selectedPlayers = getSelectedPlayers();
    if (selectedPlayers.length === 0) {
        showAlert('Select at least one player before creating certificate drafts.', 'warning');
        return;
    }

    const button = document.getElementById('cert-generate-btn');
    if (button) {
        button.disabled = true;
        button.textContent = 'Creating drafts...';
    }

    try {
        const batchId = state.demoMode ? `demo-batch-${Date.now()}` : null;

        state.drafts = selectedPlayers.map((player, index) => createDraftFromPlayer(player, batchId, index));
        state.selectedDraftId = state.drafts[0]?.id || null;
        state.descriptionGeneration = {
            active: true,
            completed: 0,
            total: state.drafts.length,
            label: 'Generating descriptions'
        };
        state.mode = 'review';
        renderReview();
        showAlert(`Generating descriptions for ${state.drafts.length} certificates. Completed rows will fill in as they finish.`, 'info');

        const descriptionRun = (async () => {
            const recentGames = selectRecentCompletedGames(state.games, state.shared.statsWindow);
            const totalsByPlayer = state.demoMode
                ? getDemoData().totalsByPlayer
                : await getAggregatedStatsForGames(state.teamId, recentGames.map((game) => game.id));
            const demoDescription = "proved to be a composed and reliable mid-fielder who reads the game exceptionally well. Her smart positioning, hustle in midfield, and support in transition made her a dependable two-way player and a key part of the team's defensive success!";
            return generateDescriptionsForDrafts({
                drafts: state.drafts,
                team: state.team,
                shared: state.shared,
                games: state.games,
                totalsByPlayer,
                generator: state.demoMode
                    ? async ({ player }) => player.name === 'Vivian Karpuk' ? demoDescription : `${player.name} showed commitment, energy, and a team-first approach throughout the season while making important contributions in key moments.`
                    : generateCertificateDescription,
                concurrency: state.demoMode ? 3 : 2,
                onResult: ({ draft, result, completed, total }) => {
                    const currentDraft = state.drafts.find((item) => item.id === draft.id);
                    applyDescriptionResultToDraft(currentDraft, result);
                    updateDescriptionGenerationProgress(completed, total);
                    renderReviewGrid();
                    if (currentDraft?.id === state.selectedDraftId) renderReviewPreview();
                }
            });
        })();
        state.activeRegenerationPromise = descriptionRun;
        const results = await descriptionRun;

        state.drafts.forEach((draft) => {
            const result = results.get(draft.id);
            applyDescriptionResultToDraft(draft, result);
        });
        updateDescriptionGenerationProgress(state.drafts.length, state.drafts.length);

        renderReview();
        showAlert('Certificate drafts created. Make edits in the grid, then print selected.', 'success');
    } catch (error) {
        console.error('[certificates] generate failed:', error);
        state.descriptionGeneration = null;
        renderReviewGrid();
        showAlert(error?.message || 'Unable to generate certificates.', 'error');
    } finally {
        state.activeRegenerationPromise = null;
        if (button) {
            button.disabled = false;
            button.textContent = 'Create drafts for selected players';
        }
    }
}

function renderReview() {
    document.getElementById('cert-setup-layout')?.classList.add('hidden');
    document.getElementById('cert-review-layout')?.classList.remove('hidden');
    renderSidebar();
    renderReviewGrid();
    renderReviewPreview();
}

function getSavedRunCount(batch = {}) {
    return (batch.generatedCertificateIds || []).length || (batch.selectedPlayerIds || []).length || 0;
}

function getSavedShareUrl(type, id) {
    const hash = new URLSearchParams({ teamId: state.teamId || '' });
    if (type === 'batch') hash.set('batchId', id || '');
    else hash.set('certificateId', id || '');
    return `${window.location.origin}${window.location.pathname}#${hash.toString()}`;
}

function renderSavedItemShell({ type, id, title, meta, timestamp, itemClass }) {
    const openAttr = type === 'batch' ? 'data-open-batch' : 'data-open-certificate';
    const shareAttr = type === 'batch' ? 'data-share-batch' : 'data-share-certificate';
    const shareLabel = type === 'batch' ? 'Share run' : 'Share certificate';
    return `
        <div class="cert-saved-item">
            <button type="button" ${openAttr}="${escapeAttr(id)}" class="${itemClass}">
                <div class="font-semibold text-gray-900">${escapeHtml(title)}</div>
                <div class="text-xs text-gray-500">${escapeHtml(meta)}</div>
                <div class="mt-1 text-xs text-gray-400">${escapeHtml(formatSavedTime(timestamp))}</div>
            </button>
            <button type="button" ${shareAttr}="${escapeAttr(id)}" class="cert-saved-share-btn">${shareLabel}</button>
        </div>
    `;
}

function limitSavedItems(items, limitValue) {
    const limitCount = Number(limitValue);
    return Number.isFinite(limitCount) && limitCount > 0 ? items.slice(0, limitCount) : items;
}

function renderSavedListToggle({ key, total, canToggle, expanded }) {
    if (!canToggle) return '';
    return `
        <button type="button" data-toggle-saved-list="${escapeAttr(key)}" class="cert-saved-toggle">
            ${expanded ? 'Show fewer' : `Show all ${total}`}
        </button>
    `;
}

function renderSavedListSection({ context, kind, label, emptyText, items, collapsedLimit, renderItem }) {
    const key = `${context}-${kind}`;
    const expanded = Boolean(state.savedListExpanded[key]);
    const collapsedItems = limitSavedItems(items, collapsedLimit);
    const visible = expanded ? items : collapsedItems;
    const canToggle = items.length > collapsedItems.length;
    const countLabel = items.length > visible.length
        ? `<span class="cert-saved-count">Showing ${visible.length} of ${items.length}</span>`
        : '';
    return `
        <div>
            <div class="cert-saved-section-heading">
                <span>${escapeHtml(label)}</span>
                ${countLabel}
            </div>
            ${visible.length ? visible.map(renderItem).join('') : `<p class="text-sm text-gray-500">${escapeHtml(emptyText)}</p>`}
            ${renderSavedListToggle({ key, total: items.length, canToggle, expanded })}
        </div>
    `;
}

function renderSavedWorkLists({ context = 'sidebar', batchLimit = 5, certificateLimit = 6, itemClass = 'block w-full rounded-lg border border-gray-200 p-2 text-left text-sm hover:bg-gray-50' } = {}) {
    const batches = state.savedBatches;
    const certs = state.savedCertificates;
    return `
            ${renderSavedListSection({
                context,
                kind: 'batches',
                label: 'Runs',
                emptyText: 'No saved runs yet.',
                items: batches,
                collapsedLimit: batchLimit,
                renderItem: (batch) => renderSavedItemShell({
                    type: 'batch',
                    id: batch.id,
                    title: batch.shared?.seasonLabel || batch.status || 'Certificate run',
                    meta: `${batch.status || 'draft'} · ${getSavedRunCount(batch)} certificates`,
                    timestamp: getSavedItemTimestamp(batch),
                    itemClass
                })
            })}
            ${renderSavedListSection({
                context,
                kind: 'certificates',
                label: 'Certificates',
                emptyText: 'No saved certificates yet.',
                items: certs,
                collapsedLimit: certificateLimit,
                renderItem: (cert) => renderSavedItemShell({
                    type: 'certificate',
                    id: cert.id,
                    title: cert.recipientName || 'Certificate',
                    meta: cert.seasonLabel || cert.status || 'draft',
                    timestamp: getSavedItemTimestamp(cert),
                    itemClass
                })
            })}
    `;
}

function renderSidebar() {
    const container = document.getElementById('cert-sidebar');
    if (!container) return;
    container.innerHTML = `
        <div class="cert-panel-header">
            <h2 class="text-lg font-bold text-gray-900">Saved</h2>
            <p class="mt-1 text-xs text-gray-500">Open a saved run or certificate for edits, export, or print.</p>
        </div>
        <div class="cert-panel-body space-y-4">
            ${renderSavedWorkLists()}
        </div>
    `;
    bindSidebarEvents(container);
}

function bindSidebarEvents(root = document) {
    root.querySelectorAll('[data-open-batch]').forEach((button) => {
        button.addEventListener('click', () => openSavedBatch(button.dataset.openBatch));
    });
    root.querySelectorAll('[data-open-certificate]').forEach((button) => {
        button.addEventListener('click', () => openSavedCertificate(button.dataset.openCertificate));
    });
    root.querySelectorAll('[data-share-batch]').forEach((button) => {
        button.addEventListener('click', () => shareSavedWork('batch', button.dataset.shareBatch));
    });
    root.querySelectorAll('[data-share-certificate]').forEach((button) => {
        button.addEventListener('click', () => shareSavedWork('certificate', button.dataset.shareCertificate));
    });
    root.querySelectorAll('[data-toggle-saved-list]').forEach((button) => {
        button.addEventListener('click', () => {
            const key = button.dataset.toggleSavedList;
            state.savedListExpanded[key] = !state.savedListExpanded[key];
            if (key.startsWith('landing-')) {
                renderSavedWorkLanding();
            } else {
                renderSidebar();
            }
        });
    });
}

async function shareSavedWork(type, id) {
    if (!id) return;
    const isBatch = type === 'batch';
    const item = isBatch
        ? state.savedBatches.find((batch) => batch.id === id)
        : state.savedCertificates.find((cert) => cert.id === id);
    const url = getSavedShareUrl(type, id);
    const title = isBatch
        ? `Certificate run: ${item?.shared?.seasonLabel || item?.status || 'Saved run'}`
        : `Certificate: ${item?.recipientName || 'Saved certificate'}`;
    const result = await shareOrCopy({
        title,
        text: 'Open this saved certificate work in ALL PLAYS. Team coaches and admins with access can view and edit it.',
        url,
        clipboardText: `${title}\n${url}`
    });
    if (result.status === 'shared') {
        showAlert('Share sheet opened.', 'success');
    } else if (result.status === 'copied') {
        showAlert('Share link copied. Team coaches and admins with access can open it.', 'success');
    } else if (result.status !== 'aborted') {
        showAlert(url, 'info');
    }
}

function renderSavedWorkLanding() {
    const container = document.getElementById('cert-review-grid');
    if (!container) return;
    const hasSavedWork = state.savedBatches.length || state.savedCertificates.length;
    container.innerHTML = `
        <div class="cert-panel-header">
            <h2 class="text-xl font-bold text-gray-900">Saved work</h2>
            <p class="mt-1 text-sm text-gray-500">${hasSavedWork ? 'Choose a saved run or certificate from the Saved panel.' : 'Saved runs and certificates will appear here after you save progress or publish.'}</p>
        </div>
        <div class="cert-panel-body">
            ${hasSavedWork ? `
                <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
                    ${renderSavedWorkLists({
                        context: 'landing',
                        itemClass: 'block w-full rounded-lg border border-gray-200 p-3 text-left text-sm hover:bg-gray-50'
                    })}
                </div>
            ` : '<p class="text-sm text-gray-500">No saved work yet.</p>'}
        </div>
    `;
    bindSidebarEvents(container);
}

function renderSavedWorkPreviewPlaceholder() {
    const container = document.getElementById('cert-review-preview');
    if (!container) return;
    container.innerHTML = `
        <div class="cert-panel-body">
            ${renderPreviewControls()}
            <div class="flex min-h-[320px] items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50 px-6 text-center text-sm text-gray-500">
                Select saved work to preview, edit, print, or export.
            </div>
        </div>
    `;
    bindPreviewControls(container);
}

function getFinitePercent(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.min(100, Math.max(0, parsed)) : fallback;
}

function normalizeSavedFonts(...sources) {
    const fonts = sources.reduce((acc, source) => ({ ...acc, ...(source || {}) }), {});
    const isValid = (value) => hasOwn(CERTIFICATE_FONT_OPTIONS, value);
    return {
        heading: isValid(fonts.heading) ? fonts.heading : 'classic',
        recipient: isValid(fonts.recipient) ? fonts.recipient : 'classic',
        body: isValid(fonts.body) ? fonts.body : 'friendly'
    };
}

function pickSavedValue(key, fallback, ...sources) {
    for (const source of sources) {
        if (hasOwn(source, key)) return source[key];
    }
    return fallback;
}

function pickSavedImageRef(key, fallback, ...sources) {
    for (const source of sources) {
        if (hasOwn(source, key)) return source[key] || null;
    }
    return fallback || null;
}

function buildSharedFromSavedSource(defaults = {}, certificate = {}) {
    const current = state.shared || {};
    const teamLogoUrl = getTeamLogoUrl();
    const foregroundFallback = teamLogoUrl ? { url: teamLogoUrl, source: 'team-logo' } : null;
    const savedStatsWindow = Number(pickSavedValue('statsWindow', current.statsWindow || 10, defaults, certificate));

    return {
        templateId: pickSavedValue('templateId', current.templateId || 'banner', defaults, certificate),
        teamNameOverride: pickSavedValue('teamNameOverride', current.teamNameOverride || state.team?.name || 'Team', defaults, certificate),
        awardTitle: pickSavedValue('awardTitle', current.awardTitle || '', defaults, certificate),
        seasonLabel: pickSavedValue('seasonLabel', current.seasonLabel || '', defaults, certificate),
        footerUrl: pickSavedValue('footerUrl', current.footerUrl || '', defaults, certificate),
        colorMode: pickSavedValue('colorMode', current.colorMode || (state.team?.colors ? 'team' : 'template'), defaults, certificate),
        customColors: {
            ...getDefaultCustomColors(state.team),
            ...(current.customColors || {}),
            ...(defaults.customColors || {}),
            ...(certificate.customColors || {}),
            ...(certificate.colors || {})
        },
        descriptionTone: pickSavedValue('descriptionTone', current.descriptionTone || 'celebratory and specific', defaults, certificate),
        statsWindow: savedStatsWindow === 5 ? 5 : 10,
        fonts: normalizeSavedFonts(current.fonts, defaults.fonts, certificate.fonts),
        signers: normalizeSigners(pickSavedValue('signers', current.signers || [], defaults, certificate)),
        foregroundImageRef: pickSavedImageRef('foregroundImageRef', foregroundFallback, defaults, certificate),
        backgroundImageRef: pickSavedImageRef('backgroundImageRef', null, defaults, certificate),
        backgroundOpacity: getFinitePercent(pickSavedValue('backgroundOpacity', current.backgroundOpacity, defaults, certificate), 18),
        watermarkImageRef: pickSavedImageRef('watermarkImageRef', null, defaults, certificate),
        watermarkOpacity: getFinitePercent(pickSavedValue('watermarkOpacity', current.watermarkOpacity, defaults, certificate), 12)
    };
}

function createDraftFromSavedCertificate(certificate, index = 0) {
    const certId = certificate?.id || `certificate-${index}`;
    const description = truncateCertificateDescription(certificate?.description || '');
    return {
        id: `saved-${certId}`,
        certificateId: certificate?.id || null,
        batchId: certificate?.batchId || null,
        playerId: certificate?.playerId || null,
        recipientName: certificate?.recipientName || 'Recipient',
        playerNumber: certificate?.playerNumber || '',
        playerPhotoUrl: certificate?.playerPhotoUrl || null,
        awardTitle: certificate?.awardTitle || '',
        description,
        restoreDescription: '',
        descriptionSource: certificate?.descriptionSource || 'manual',
        descriptionStatus: certificate?.descriptionStatus || (description ? 'ready' : 'pending'),
        statsWindow: certificate?.statsWindow || state.shared?.statsWindow || 10,
        includeInExport: certificate?.includeInExport !== false,
        errorMessage: null,
        status: certificate?.status || 'draft',
        exportedPngUrl: certificate?.exportedPngUrl || null,
        exportedPdfUrl: certificate?.exportedPdfUrl || null
    };
}

function upsertSavedCertificate(certificate) {
    if (!certificate?.id) return;
    state.savedCertificates = [
        certificate,
        ...state.savedCertificates.filter((item) => item.id !== certificate.id)
    ];
}

function upsertSavedBatch(batch) {
    if (!batch?.id) return;
    state.savedBatches = [
        batch,
        ...state.savedBatches.filter((item) => item.id !== batch.id)
    ];
}

function saveDraftsToLocalHistory(status) {
    const prefix = state.demoMode ? 'demo' : 'local';
    const existingBatchId = state.drafts.find((draft) => draft.batchId)?.batchId;
    const batchId = existingBatchId || `${prefix}-batch-${Date.now()}`;
    const ids = [];

    state.drafts.forEach((draft) => {
        draft.status = status;
        draft.batchId = draft.batchId || batchId;
        draft.certificateId = draft.certificateId || `${prefix}-cert-${batchId}-${draft.id}`;
        ids.push(draft.certificateId);
        upsertSavedCertificate({
            id: draft.certificateId,
            ...buildCertificatePayload(draft, status),
            updatedAt: new Date().toISOString()
        });
    });

    upsertSavedBatch({
        id: batchId,
        shared: clonePlain(state.shared),
        selectedPlayerIds: state.drafts.map((draft) => draft.playerId).filter(Boolean),
        generatedCertificateIds: ids,
        status,
        updatedAt: new Date().toISOString()
    });
}

async function loadCertificatesForSavedBatch(batch) {
    let certificates = state.savedCertificates.filter((certificate) => certificate.batchId === batch?.id);
    const missingIds = (batch?.generatedCertificateIds || [])
        .filter((id) => id && !certificates.some((certificate) => certificate.id === id));

    if (missingIds.length && !state.demoMode && !state.certificatePersistenceUnavailable) {
        for (const id of missingIds) {
            try {
                const certificate = await getCertificate(state.teamId, id);
                if (certificate) {
                    upsertSavedCertificate(certificate);
                    certificates.push(certificate);
                }
            } catch (error) {
                if (!isPermissionError(error)) throw error;
                state.certificatePersistenceUnavailable = true;
                showAlert('Saved certificate data could not be loaded. You can still create, edit, export, and print certificates.', 'warning');
                break;
            }
        }
    }

    if (batch?.generatedCertificateIds?.length) {
        const order = new Map(batch.generatedCertificateIds.map((id, index) => [id, index]));
        certificates = certificates.slice().sort((a, b) => {
            const aIndex = order.has(a.id) ? order.get(a.id) : Number.MAX_SAFE_INTEGER;
            const bIndex = order.has(b.id) ? order.get(b.id) : Number.MAX_SAFE_INTEGER;
            return aIndex - bIndex;
        });
    }

    return certificates;
}

async function openSavedBatch(batchId) {
    let batch = state.savedBatches.find((item) => item.id === batchId);
    if (!batch && !state.demoMode && !state.certificatePersistenceUnavailable) {
        try {
            batch = await getCertificateBatch(state.teamId, batchId);
            if (batch) {
                upsertSavedBatch(batch);
            }
        } catch (error) {
            if (!isPermissionError(error)) throw error;
            state.certificatePersistenceUnavailable = true;
            showAlert('Saved certificate data could not be loaded. You can still create, edit, export, and print certificates.', 'warning');
            return;
        }
    }
    if (!batch) {
        showAlert('Saved run could not be found.', 'warning');
        return;
    }

    try {
        const certificates = await loadCertificatesForSavedBatch(batch);
        if (!certificates.length) {
            showAlert('This saved run does not have saved certificates yet.', 'warning');
            return;
        }

        state.shared = buildSharedFromSavedSource(batch.shared || {}, certificates[0] || {});
        state.drafts = certificates.map((certificate, index) => createDraftFromSavedCertificate(certificate, index));
        state.selectedPlayerIds = new Set(certificates.map((certificate) => certificate.playerId).filter(Boolean));
        state.selectedDraftId = state.drafts[0]?.id || null;
        state.descriptionGeneration = null;
        state.mode = 'review';
        renderReview();
        showAlert('Saved run opened for editing, export, and print.', 'success');
    } catch (error) {
        showAlert(error?.message || 'Unable to open saved run.', 'error');
    }
}

async function openSavedCertificate(certificateId) {
    let certificate = state.savedCertificates.find((item) => item.id === certificateId);
    if (!certificate && !state.demoMode && !state.certificatePersistenceUnavailable) {
        try {
            certificate = await getCertificate(state.teamId, certificateId);
            if (certificate) upsertSavedCertificate(certificate);
        } catch (error) {
            if (!isPermissionError(error)) throw error;
            state.certificatePersistenceUnavailable = true;
            showAlert('Saved certificate data could not be loaded. You can still create, edit, export, and print certificates.', 'warning');
            return;
        }
    }

    if (!certificate) {
        showAlert('Saved certificate could not be found.', 'warning');
        return;
    }

    state.shared = buildSharedFromSavedSource({}, certificate);
    state.drafts = [createDraftFromSavedCertificate(certificate)];
    state.selectedPlayerIds = new Set(certificate.playerId ? [certificate.playerId] : []);
    state.selectedDraftId = state.drafts[0]?.id || null;
    state.descriptionGeneration = null;
    state.mode = 'review';
    renderReview();
    showAlert('Saved certificate opened for editing, export, and print.', 'success');
}

function statusClass(status) {
    if (status === 'ready') return 'cert-status-ready';
    if (status === 'needs-review') return 'cert-status-needs-review';
    if (status === 'error') return 'cert-status-error';
    return 'cert-status-pending';
}

function statusLabel(status) {
    if (status === 'pending') return 'Writing';
    if (status === 'needs-review') return 'Review';
    if (status === 'ready') return 'Ready';
    if (status === 'error') return 'Error';
    return status || 'Writing';
}

function renderDescriptionProgress() {
    const progress = state.descriptionGeneration;
    if (!progress?.total) return '';
    const completed = Math.min(progress.completed || 0, progress.total);
    const percent = Math.round((completed / progress.total) * 100);
    const title = progress.active
        ? `${progress.label || 'Generating descriptions'}: ${completed}/${progress.total}`
        : `Descriptions ready: ${completed}/${progress.total}`;
    const message = progress.active
        ? 'Rows fill in as each description finishes. You can review completed rows while the rest keep writing.'
        : 'Review the generated narratives and make any edits before saving, publishing, or printing.';
    return `
        <div id="cert-description-progress" class="cert-description-progress" aria-live="polite">
            <div class="cert-description-progress-row">
                <div class="flex min-w-0 items-center gap-2">
                    ${progress.active ? '<span class="cert-progress-spinner" aria-hidden="true"></span>' : ''}
                    <span class="font-semibold text-gray-900">${escapeHtml(title)}</span>
                </div>
                <span class="text-xs font-semibold text-gray-500">${percent}%</span>
            </div>
            <div class="cert-description-progress-bar" aria-hidden="true">
                <span style="width:${percent}%"></span>
            </div>
            <p>${escapeHtml(message)}</p>
        </div>
    `;
}

function getPublishBlockedDrafts() {
    return state.drafts.filter((draft) => draft.descriptionStatus !== 'ready');
}

function formatPublishBlockedDraftNames(drafts) {
    return drafts.map((draft) => draft.recipientName || 'certificate').join(', ');
}

function guardPublishableDraftDescriptions(status) {
    if (status !== 'published') return true;
    const blockedDrafts = getPublishBlockedDrafts();
    if (!blockedDrafts.length) return true;
    showAlert(`Review or fix certificates marked Needs review or Error before publishing: ${formatPublishBlockedDraftNames(blockedDrafts)}.`, 'error');
    renderReviewGrid();
    return false;
}

function renderReviewGrid() {
    const descriptionGenerationActive = Boolean(state.descriptionGeneration?.active);
    const blockedPublishDrafts = getPublishBlockedDrafts();
    const publishDisabledReason = descriptionGenerationActive
        ? 'Descriptions are still generating'
        : blockedPublishDrafts.length
            ? 'Review or fix descriptions before publishing'
            : '';
    const publishDisabledAttrs = publishDisabledReason
        ? `disabled aria-disabled="true" title="${escapeAttr(publishDisabledReason)}"`
        : '';
    const rows = state.drafts.map((draft) => {
        const remaining = DESCRIPTION_MAX_LENGTH - String(draft.description || '').length;
        const pendingDescription = draft.descriptionStatus === 'pending';
        return `
            <tr data-draft-row="${escapeAttr(draft.id)}" class="${draft.id === state.selectedDraftId ? 'is-selected' : ''}">
                <td><input type="checkbox" data-draft-field="includeInExport" data-draft-id="${escapeAttr(draft.id)}" ${draft.includeInExport !== false ? 'checked' : ''}></td>
                <td>
                    <input class="cert-input" data-draft-field="recipientName" data-draft-id="${escapeAttr(draft.id)}" value="${escapeAttr(draft.recipientName)}">
                </td>
                <td style="width:72px">
                    <input class="cert-input" data-draft-field="playerNumber" data-draft-id="${escapeAttr(draft.id)}" value="${escapeAttr(draft.playerNumber)}">
                </td>
                <td>
                    <input class="cert-input mb-2" data-draft-field="awardTitle" data-draft-id="${escapeAttr(draft.id)}" value="${escapeAttr(draft.awardTitle || '')}" placeholder="Award title">
                    <textarea class="cert-textarea ${pendingDescription ? 'is-pending' : ''}" maxlength="${DESCRIPTION_MAX_LENGTH}" data-draft-field="description" data-draft-id="${escapeAttr(draft.id)}" placeholder="${pendingDescription ? 'AI description is being written...' : 'Description'}" ${pendingDescription ? 'aria-busy="true"' : ''}>${escapeHtml(draft.description || '')}</textarea>
                    <div class="mt-1 flex items-center justify-between gap-2 text-xs ${remaining < DESCRIPTION_MAX_LENGTH - DESCRIPTION_SOFT_LIMIT ? 'text-amber-700' : 'text-gray-500'}">
                        <span>${String(draft.description || '').length}/${DESCRIPTION_MAX_LENGTH}</span>
                        ${draft.restoreDescription ? `<button type="button" data-restore-description="${escapeAttr(draft.id)}" class="font-semibold text-primary-700">Restore previous</button>` : ''}
                    </div>
                    ${draft.errorMessage ? `<div class="mt-1 text-xs text-red-600">${escapeHtml(draft.errorMessage)}</div>` : ''}
                </td>
                <td>
                    <span class="cert-status ${statusClass(draft.descriptionStatus)}">${pendingDescription ? '<span class="cert-status-dot" aria-hidden="true"></span>' : ''}${escapeHtml(statusLabel(draft.descriptionStatus))}</span>
                    <button type="button" data-regenerate-draft="${escapeAttr(draft.id)}" class="mt-2 block rounded-lg border border-gray-300 px-2 py-1 text-xs font-semibold text-gray-700">Regenerate</button>
                    <button type="button" data-download-draft="${escapeAttr(draft.id)}" class="mt-2 block rounded-lg border border-primary-200 bg-primary-50 px-2 py-1 text-xs font-semibold text-primary-700">PNG</button>
                </td>
            </tr>
        `;
    }).join('');

    document.getElementById('cert-review-grid').innerHTML = `
        <div class="cert-panel-header">
            <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                    <h2 class="text-xl font-bold text-gray-900">Review generated certificates</h2>
                    <p class="mt-1 text-sm text-gray-500">Save progress keeps drafts editable. Publish makes finished certificates available to linked families.</p>
                </div>
                <div class="flex flex-wrap gap-2">
                    <button id="cert-regenerate-selected-btn" type="button" class="rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-700">Regenerate selected</button>
                    <button id="cert-save-drafts-btn" type="button" class="rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-700">Save progress</button>
                    <button id="cert-publish-btn" type="button" class="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 disabled:cursor-not-allowed disabled:opacity-50" ${publishDisabledAttrs}>Publish certificates</button>
                    <button id="cert-print-btn" type="button" class="rounded-lg bg-primary-600 px-3 py-2 text-xs font-semibold text-white">Print selected</button>
                    <button id="cert-png-btn" type="button" class="rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-700">PNG selected</button>
                    <button id="cert-zip-btn" type="button" class="rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-700">ZIP</button>
                </div>
                <div class="mt-2 text-xs text-gray-500">
                    Looking for frames? <a href="https://a.co/d/0ggfYYG5" target="_blank" rel="noopener noreferrer" class="font-semibold text-primary-700 hover:underline">Buy certificate frames on Amazon</a>
                </div>
            </div>
        </div>
        <div class="cert-panel-body overflow-auto">
            ${renderDescriptionProgress()}
            <table class="cert-review-table">
                <thead>
                    <tr>
                        <th>Print</th>
                        <th>Recipient</th>
                        <th>#</th>
                        <th>Description</th>
                        <th>Status</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
    `;

    bindReviewEvents();
}

function bindReviewEvents() {
    document.querySelectorAll('[data-draft-row]').forEach((row) => {
        row.addEventListener('click', (event) => {
            if (event.target.closest('input, textarea, button')) return;
            state.selectedDraftId = row.dataset.draftRow;
            renderReviewGrid();
            renderReviewPreview();
        });
    });

    document.querySelectorAll('[data-draft-field]').forEach((input) => {
        const update = () => {
            const draft = state.drafts.find((item) => item.id === input.dataset.draftId);
            if (!draft) return;
            const field = input.dataset.draftField;
            if (field === 'includeInExport') draft.includeInExport = input.checked;
            else {
                draft[field] = input.value.slice(0, field === 'description' ? DESCRIPTION_MAX_LENGTH : undefined);
                if (field === 'description') {
                    draft.descriptionSource = 'manual';
                    draft.descriptionStatus = 'ready';
                }
            }
            if (draft.id === state.selectedDraftId) schedulePreviewRender();
        };
        input.addEventListener('input', update);
        input.addEventListener('change', () => {
            update();
            if (input.dataset.draftField === 'includeInExport') renderReviewGrid();
        });
    });

    document.querySelectorAll('[data-regenerate-draft]').forEach((button) => {
        button.addEventListener('click', () => regenerateDrafts([button.dataset.regenerateDraft]));
    });
    document.querySelectorAll('[data-download-draft]').forEach((button) => {
        button.addEventListener('click', () => downloadDraftPngById(button.dataset.downloadDraft));
    });
    document.querySelectorAll('[data-restore-description]').forEach((button) => {
        button.addEventListener('click', () => {
            const draft = state.drafts.find((item) => item.id === button.dataset.restoreDescription);
            if (!draft || !draft.restoreDescription) return;
            [draft.description, draft.restoreDescription] = [draft.restoreDescription, draft.description];
            draft.descriptionSource = 'manual';
            draft.descriptionStatus = 'ready';
            renderReviewGrid();
            renderReviewPreview();
        });
    });

    document.getElementById('cert-regenerate-selected-btn')?.addEventListener('click', () => regenerateDrafts(getSelectedDrafts().map((draft) => draft.id)));
    document.getElementById('cert-save-drafts-btn')?.addEventListener('click', () => saveDrafts('draft'));
    document.getElementById('cert-publish-btn')?.addEventListener('click', () => saveDrafts('published'));
    document.getElementById('cert-print-btn')?.addEventListener('click', printSelectedDrafts);
    document.getElementById('cert-png-btn')?.addEventListener('click', downloadSelectedPng);
    document.getElementById('cert-zip-btn')?.addEventListener('click', downloadSelectedZip);
}

async function waitForActiveRegeneration() {
    if (!state.activeRegenerationPromise) return;
    showAlert('Finishing certificate descriptions before continuing.', 'info');
    await state.activeRegenerationPromise;
}

async function runDraftRegeneration(draftIds) {
    const drafts = state.drafts.filter((draft) => draftIds.includes(draft.id));
    if (!drafts.length) return;
    drafts.forEach((draft) => {
        draft.restoreDescription = draft.description;
        draft.descriptionStatus = 'pending';
        draft.errorMessage = null;
    });
    state.descriptionGeneration = {
        active: true,
        completed: 0,
        total: drafts.length,
        label: drafts.length === 1 ? 'Regenerating description' : 'Regenerating descriptions'
    };
    renderReviewGrid();

    try {
        const recentGames = selectRecentCompletedGames(state.games, state.shared.statsWindow);
        const totalsByPlayer = state.demoMode
            ? getDemoData().totalsByPlayer
            : await getAggregatedStatsForGames(state.teamId, recentGames.map((game) => game.id));
        const progressLabel = drafts.length === 1 ? 'Regenerating description' : 'Regenerating descriptions';
        const results = await generateDescriptionsForDrafts({
            drafts,
            team: state.team,
            shared: state.shared,
            games: state.games,
            totalsByPlayer,
            generator: state.demoMode
                ? async ({ player }) => `${player.name} continued to stand out with reliable effort, smart decisions, and a team-first attitude that made a clear impact throughout the season.`
                : generateCertificateDescription,
            concurrency: state.demoMode ? 3 : 2,
            onResult: ({ draft, result, completed, total }) => {
                const currentDraft = state.drafts.find((item) => item.id === draft.id);
                applyDescriptionResultToDraft(currentDraft, result);
                updateDescriptionGenerationProgress(completed, total, progressLabel);
                renderReviewGrid();
                if (currentDraft?.id === state.selectedDraftId) renderReviewPreview();
            }
        });

        drafts.forEach((draft) => {
            const result = results.get(draft.id);
            applyDescriptionResultToDraft(draft, result);
        });
        updateDescriptionGenerationProgress(drafts.length, drafts.length, progressLabel);
        renderReviewGrid();
        renderReviewPreview();
        showAlert(drafts.length === 1 ? 'Certificate description regenerated.' : 'Selected certificate descriptions regenerated.', 'success');
    } catch (error) {
        state.descriptionGeneration = null;
        renderReviewGrid();
        renderReviewPreview();
        throw error;
    }
}

async function regenerateDrafts(draftIds) {
    await waitForActiveRegeneration();
    const run = runDraftRegeneration(draftIds);
    state.activeRegenerationPromise = run;
    try {
        await run;
    } finally {
        if (state.activeRegenerationPromise === run) {
            state.activeRegenerationPromise = null;
        }
    }
}

async function saveDrafts(status) {
    await waitForActiveRegeneration();

    if (!guardPublishableDraftDescriptions(status)) return;

    if (state.demoMode || state.certificatePersistenceUnavailable) {
        saveDraftsToLocalHistory(status);
        renderSidebar();
        renderReviewGrid();
        if (state.demoMode) {
            showAlert(status === 'published' ? 'Demo certificates published for this session.' : 'Demo drafts saved for this session.', 'success');
        } else {
            showAlert(
                status === 'published'
                    ? 'Certificates marked published for this browser session. Deploy the Firestore certificate rules before saving them to team history.'
                    : 'Drafts saved for this browser session. Deploy the Firestore certificate rules before they appear in saved runs.',
                'warning'
            );
        }
        return;
    }

    try {
        let batchId = state.drafts.find((draft) => draft.batchId)?.batchId || null;
        if (!batchId) {
            batchId = await createCertificateBatch(state.teamId, {
                shared: state.shared,
                selectedPlayerIds: state.drafts.map((draft) => draft.playerId).filter(Boolean),
                generatedCertificateIds: [],
                status: 'draft'
            });
            state.drafts.forEach((draft) => {
                draft.batchId = batchId;
            });
        }

        const ids = [];
        for (const draft of state.drafts) {
            draft.status = status;
            const payload = buildCertificatePayload(draft, status);
            if (draft.certificateId) {
                await updateCertificate(state.teamId, draft.certificateId, payload, { action: status === 'published' ? 'published' : 'updated' });
            } else {
                draft.certificateId = await createCertificate(state.teamId, payload);
            }
            ids.push(draft.certificateId);
        }
        if (batchId) {
            await updateCertificateBatch(state.teamId, batchId, {
                generatedCertificateIds: ids,
                shared: state.shared,
                status
            });
        }
        try {
            await setCertificateDefaults(state.teamId, state.shared);
        } catch (error) {
            if (!isPermissionError(error)) throw error;
            console.warn('[certificates] Unable to save certificate defaults after save:', error);
            showAlert('Certificates saved, but team defaults could not be updated because of permissions.', 'warning');
        }
        state.savedCertificates = await loadOptionalCertificateResource('saved certificates', () => listCertificates(state.teamId), state.savedCertificates);
        state.savedBatches = await loadOptionalCertificateResource('certificate batches', () => listCertificateBatches(state.teamId), state.savedBatches);
        renderSidebar();
        renderReviewGrid();
        showAlert(status === 'published' ? 'Certificates published.' : 'Drafts saved.', 'success');
    } catch (error) {
        const message = isPermissionError(error)
            ? 'Unable to save certificates because Firestore permissions denied the write. You can still print or export the generated certificates.'
            : (error?.message || 'Unable to save certificates.');
        showAlert(message, 'error');
    }
}

function renderReviewPreview() {
    const container = document.getElementById('cert-review-preview');
    if (!container) return;
    container.innerHTML = `
        <div class="cert-panel-body">
            ${renderPreviewControls()}
            <div class="cert-preview-viewport">
                <div class="cert-preview-scale"></div>
            </div>
        </div>
    `;
    bindPreviewControls(container);
    renderCertificateInto(container, getSelectedDraft());
}

function createExportNode(draft) {
    return renderCertificate({ shared: state.shared, draft, team: state.team });
}

function ensureExportRoot() {
    let root = document.getElementById('cert-export-root');
    if (!root) {
        root = document.createElement('div');
        root.id = 'cert-export-root';
        root.style.cssText = 'position:fixed;left:-10000px;top:0;width:2050px;pointer-events:none;';
        document.body.appendChild(root);
    }
    return root;
}

async function renderDraftToBlob(draft) {
    const root = ensureExportRoot();
    const node = createExportNode(draft);
    root.appendChild(node);
    try {
        return await renderNodeToPngBlob(node);
    } finally {
        node.remove();
    }
}

async function downloadDraftPng(draft) {
    const node = createExportNode(draft);
    const root = ensureExportRoot();
    root.appendChild(node);
    try {
        return await downloadCertificatePng(node, getCertificateFilename({
            teamName: certificateTeamName(),
            recipientName: draft.recipientName,
            seasonLabel: state.shared.seasonLabel || 'season',
            extension: 'png'
        }));
    } finally {
        node.remove();
    }
}

async function downloadDraftPngById(draftId) {
    await waitForActiveRegeneration();
    const draft = state.drafts.find((item) => item.id === draftId) || getSelectedDraft();
    if (!draft) {
        showAlert('Choose a certificate to download.', 'warning');
        return;
    }
    try {
        await downloadDraftPng(draft);
        showAlert(`Downloaded ${draft.recipientName || 'certificate'} as a PNG.`, 'success');
    } catch (error) {
        showAlert(error?.message || 'Unable to export PNG. Use Print selected if the image is blocked by browser canvas rules.', 'error');
    }
}

async function downloadSelectedPng() {
    await waitForActiveRegeneration();

    const drafts = getSelectedDrafts();
    if (!drafts.length) {
        showAlert('Select at least one certificate to export.', 'warning');
        return;
    }
    try {
        for (const draft of drafts) {
            await downloadDraftPng(draft);
        }
        showAlert(drafts.length === 1 ? 'Downloaded 1 PNG.' : `Downloaded ${drafts.length} PNG files.`, 'success');
    } catch (error) {
        showAlert(error?.message || 'Unable to export PNG. Use Print selected if the image is blocked by browser canvas rules.', 'error');
    }
}

async function downloadSelectedZip() {
    await waitForActiveRegeneration();

    const drafts = getSelectedDrafts();
    if (!drafts.length) {
        showAlert('Select at least one certificate to export.', 'warning');
        return;
    }
    try {
        const files = [];
        for (const draft of drafts) {
            files.push({
                name: getCertificateFilename({
                    teamName: certificateTeamName(),
                    recipientName: draft.recipientName,
                    seasonLabel: state.shared.seasonLabel || 'season',
                    extension: 'png'
                }),
                blob: await renderDraftToBlob(draft)
            });
        }
        await downloadCertificateZip(files, `${certificateTeamName().toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'team'}-certificates.zip`);
    } catch (error) {
        showAlert(error?.message || 'Unable to export ZIP. Use Print selected if an image blocks canvas export.', 'error');
    }
}

async function printSelectedDrafts() {
    await waitForActiveRegeneration();

    const drafts = getSelectedDrafts();
    if (!drafts.length) {
        showAlert('Select at least one certificate to print.', 'warning');
        return;
    }
    try {
        const blobs = [];
        for (const draft of drafts) {
            blobs.push(await renderDraftToBlob(draft));
        }
        await printCertificateBlobs(blobs);
    } catch (error) {
        console.warn('[certificates] PNG-backed print failed; falling back to browser print.', error);
        try {
            await printCertificates(drafts.map((draft) => createExportNode(draft)));
            showAlert('Printed with browser-safe rendering because one image blocked PNG rendering.', 'warning');
        } catch (fallbackError) {
            showAlert(fallbackError?.message || error?.message || 'Unable to prepare certificates for print.', 'error');
        }
    }
}

function renderParentView(certificatesByPlayer = []) {
    hideLoading();
    document.getElementById('cert-studio')?.classList.add('hidden');
    setCoachActionButtonsVisible(false);
    const container = document.getElementById('cert-parent-view');
    container.classList.remove('hidden');
    const certificates = certificatesByPlayer.flatMap((entry) => entry.certificates.map((cert) => ({ ...cert, playerName: entry.playerName })));
    container.innerHTML = `
        <div class="cert-panel">
            <div class="cert-panel-header">
                <h2 class="text-xl font-bold text-gray-900">Saved certificates</h2>
                <p class="mt-1 text-sm text-gray-500">Published certificates for your linked players.</p>
            </div>
            <div class="cert-panel-body">
                ${certificates.length ? `<div class="grid grid-cols-1 gap-4 md:grid-cols-2">${certificates.map((cert) => `
                    <article class="rounded-lg border border-gray-200 p-4">
                        <div class="font-bold text-gray-900">${escapeHtml(cert.recipientName || cert.playerName || 'Certificate')}</div>
                        <div class="mt-1 text-sm text-gray-500">${escapeHtml(cert.seasonLabel || '')}</div>
                        <a href="certificates.html#teamId=${escapeAttr(state.teamId)}&certificateId=${escapeAttr(cert.id)}" class="mt-3 inline-flex rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-sm font-semibold text-primary-700">Open certificate</a>
                    </article>
                `).join('')}</div>` : '<div class="text-sm text-gray-500">No published certificates yet.</div>'}
            </div>
        </div>
    `;
}

function renderParentCertificateDetail(certificate) {
    hideLoading();
    document.getElementById('cert-studio')?.classList.add('hidden');
    setCoachActionButtonsVisible(false);
    const container = document.getElementById('cert-parent-view');
    container.classList.remove('hidden');

    state.shared = buildSharedFromSavedSource({}, certificate);
    const draft = createDraftFromSavedCertificate(certificate);
    state.drafts = [draft];
    state.selectedDraftId = draft.id;
    state.mode = 'parent-detail';

    container.innerHTML = `
        <div class="cert-panel">
            <div class="cert-panel-header">
                <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                        <h2 class="text-xl font-bold text-gray-900">${escapeHtml(certificate.recipientName || 'Saved certificate')}</h2>
                        <p class="mt-1 text-sm text-gray-500">${escapeHtml(certificate.seasonLabel || 'Saved certificate')}</p>
                    </div>
                    <div class="flex flex-wrap gap-2">
                        <a href="certificates.html#teamId=${escapeAttr(state.teamId)}" class="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700">Back to saved</a>
                        <button id="cert-parent-png-btn" type="button" class="rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-sm font-semibold text-primary-700">PNG</button>
                        <button id="cert-parent-print-btn" type="button" class="rounded-lg bg-primary-600 px-3 py-2 text-sm font-semibold text-white">Print</button>
                    </div>
                </div>
            </div>
            <div class="cert-panel-body">
                <div class="cert-preview-viewport">
                    <div class="cert-preview-scale"></div>
                </div>
            </div>
        </div>
    `;

    const canvas = renderCertificate({ shared: state.shared, draft, team: state.team });
    const viewport = container.querySelector('.cert-preview-viewport');
    viewport.querySelector('.cert-preview-scale').appendChild(canvas);
    requestAnimationFrame(() => applyPreviewScale(viewport, canvas));
    container.querySelector('#cert-parent-png-btn')?.addEventListener('click', () => downloadDraftPngById(draft.id));
    container.querySelector('#cert-parent-print-btn')?.addEventListener('click', printSelectedDrafts);
}

function showSetupMode() {
    state.mode = 'setup';
    state.descriptionGeneration = null;
    document.getElementById('cert-review-layout')?.classList.add('hidden');
    document.getElementById('cert-setup-layout')?.classList.remove('hidden');
    renderSetup();
    renderPlayerSelection();
    renderSetupPreview();
}

function showSavedWorkMode() {
    state.mode = 'saved';
    state.descriptionGeneration = null;
    document.getElementById('cert-setup-layout')?.classList.add('hidden');
    document.getElementById('cert-review-layout')?.classList.remove('hidden');
    renderSidebar();
    renderSavedWorkLanding();
    renderSavedWorkPreviewPlaceholder();
}

function startCustomCertificate() {
    const customId = `custom-${Date.now()}`;
    state.descriptionGeneration = null;
    state.drafts = [{
        id: customId,
        certificateId: null,
        batchId: null,
        playerId: null,
        recipientName: 'Custom Recipient',
        playerNumber: '',
        playerPhotoUrl: null,
        awardTitle: state.shared.awardTitle || '',
        description: 'Add a custom certificate description here.',
        descriptionSource: 'manual',
        descriptionStatus: 'ready',
        statsWindow: state.shared.statsWindow,
        includeInExport: true,
        errorMessage: null,
        status: 'draft'
    }];
    state.selectedDraftId = customId;
    state.mode = 'review';
    renderReview();
}

function getParentCertificateLinks() {
    const links = [];
    const seen = new Set();
    const addLink = (teamId, playerId, playerName = '') => {
        if (!teamId || !playerId || teamId !== state.teamId) return;
        const key = `${teamId}::${playerId}`;
        if (seen.has(key)) return;
        seen.add(key);
        links.push({ teamId, playerId, playerName });
    };

    (state.profile?.parentOf || []).forEach((entry) => {
        addLink(entry?.teamId, entry?.playerId, entry?.playerName || entry?.name || '');
    });

    [
        ...(state.profile?.parentPlayerKeys || []),
        ...(state.user?.parentPlayerKeys || [])
    ].forEach((key) => {
        const raw = String(key || '');
        const separatorIndex = raw.indexOf('::');
        if (separatorIndex <= 0) return;
        addLink(raw.slice(0, separatorIndex), raw.slice(separatorIndex + 2), '');
    });

    return links;
}

async function loadParentCertificates(params = getParams()) {
    const parentLinks = getParentCertificateLinks();
    const entries = [];
    for (const link of parentLinks) {
        const certificates = await loadOptionalCertificateResource(
            'parent certificates',
            () => listCertificatesForPlayer(state.teamId, link.playerId, { status: 'published' }),
            []
        );
        entries.push({
            playerId: link.playerId,
            playerName: link.playerName,
            certificates: certificates.filter((cert) => canViewSavedCertificate(state.user, state.team, cert))
        });
    }
    const certificateId = params.get('certificateId');
    if (certificateId) {
        let certificate = entries
            .flatMap((entry) => entry.certificates)
            .find((cert) => cert.id === certificateId);

        if (!certificate && !state.demoMode) {
            try {
                const requestedCertificate = await getCertificate(state.teamId, certificateId);
                if (canViewSavedCertificate(state.user, state.team, requestedCertificate)) {
                    certificate = requestedCertificate;
                    const matchingEntry = entries.find((entry) => entry.playerId === certificate.playerId);
                    if (matchingEntry && !matchingEntry.certificates.some((item) => item.id === certificate.id)) {
                        matchingEntry.certificates.unshift(certificate);
                    }
                }
            } catch (error) {
                if (!isPermissionError(error)) throw error;
                state.certificatePersistenceUnavailable = true;
            }
        }

        if (certificate) {
            renderParentCertificateDetail(certificate);
            return;
        }
        renderParentView(entries);
        showAlert('Saved certificate could not be found for your linked players.', 'warning');
        return;
    }
    renderParentView(entries);
}

async function initDemo(params) {
    const demo = getDemoData();
    state.demoMode = true;
    state.teamId = demo.team.id;
    state.user = demo.user;
    state.profile = demo.profile;
    state.team = demo.team;
    state.roster = demo.roster;
    state.games = demo.games;
    state.assets = demo.assets;
    state.shared = await buildSharedDefaults({
        team: demo.team,
        defaults: {
            seasonLabel: 'Fall 2025',
            footerUrl: 'www.jrkccurrent.com',
            foregroundImageRef: { url: 'img/certificate-jr-current-crest.png' },
            watermarkImageRef: { url: 'img/certificate-jr-current-crest.png' },
            colorMode: 'custom',
            customColors: {
                borderColor: '#d32f3a',
                accentColor: '#5ec9c5',
                textColor: '#0f2430'
            },
            signers: [
                { name: 'Brian Karpuk', role: 'Head Coach', signatureStyle: 'script' },
                { name: 'Paul Snider', role: 'Assistant Coach', signatureStyle: 'script' },
                { name: 'Tim Sleddens', role: 'Assistant Coach', signatureStyle: 'script' }
            ],
            watermarkOpacity: 5,
            statsWindow: 10
        },
        currentUser: demo.user
    });
    state.selectedPlayerIds = new Set(params.get('playerId') ? [params.get('playerId')] : demo.roster.map((player) => player.id));
    renderHeader(document.getElementById('header-container'), demo.user);
    renderTeamAdminBanner(document.getElementById('team-admin-banner'), {
        team: demo.team,
        teamId: demo.team.id,
        active: 'certificates',
        accessLevel: 'full',
        exitUrl: 'dashboard.html'
    });
    hideLoading();
    showStudio();
    showSetupMode();
}

async function initAuthenticated(params) {
    checkAuth(async (authUser) => {
        if (!authUser) {
            window.location.href = 'login.html';
            return;
        }

        state.teamId = params.get('teamId');
        if (!state.teamId) {
            alert('No team specified');
            window.location.href = 'dashboard.html';
            return;
        }

        try {
            const [profile, team] = await Promise.all([
                getUserProfile(authUser.uid),
                getTeam(state.teamId, { includeInactive: true })
            ]);
            if (!team) {
                alert('Team not found');
                window.location.href = 'dashboard.html';
                return;
            }

            state.profile = profile || {};
            state.user = {
                ...authUser,
                parentOf: profile?.parentOf || [],
                parentPlayerKeys: profile?.parentPlayerKeys || [],
                coachOf: profile?.coachOf || [],
                isAdmin: profile?.isAdmin || false,
                profileEmail: profile?.email || profile?.profileEmail
            };
            state.team = { ...team, id: state.teamId };
            state.accessInfo = getTeamAccessInfo(state.user, state.team);

            renderHeader(document.getElementById('header-container'), state.user);
            let unreadCount = 0;
            try {
                const counts = await getUnreadChatCounts(state.user.uid, [state.teamId]);
                unreadCount = counts[state.teamId] || 0;
            } catch (error) {
                console.warn('[certificates] unread count failed:', error);
            }
            renderTeamAdminBanner(document.getElementById('team-admin-banner'), {
                team: state.team,
                teamId: state.teamId,
                active: 'certificates',
                unreadCount,
                accessLevel: state.accessInfo.accessLevel,
                exitUrl: state.accessInfo.exitUrl
            });

            if (state.accessInfo.accessLevel === 'parent') {
                await loadParentCertificates(params);
                return;
            }

            if (!state.accessInfo.hasAccess || !canAccessCertificates(state.user, state.team)) {
                alert('You do not have access to certificate management for this team.');
                window.location.href = state.accessInfo.exitUrl || 'dashboard.html';
                return;
            }

            const [roster, games] = await Promise.all([
                getPlayers(state.teamId),
                getGames(state.teamId)
            ]);
            const [defaults, assets, batches, certs] = await Promise.all([
                loadOptionalCertificateResource('certificate defaults', () => getCertificateDefaults(state.teamId), null),
                loadOptionalCertificateResource('certificate assets', () => listCertificateAssets(state.teamId), []),
                loadOptionalCertificateResource('certificate batches', () => listCertificateBatches(state.teamId), []),
                loadOptionalCertificateResource('saved certificates', () => listCertificates(state.teamId), [])
            ]);

            state.roster = roster;
            state.assets = assets;
            state.savedBatches = batches;
            state.savedCertificates = certs;
            state.games = games;
            state.shared = await buildSharedDefaults({ team: state.team, defaults, currentUser: state.user });
            const playerId = params.get('playerId');
            state.selectedPlayerIds = new Set(playerId ? [playerId] : roster.map((player) => player.id));
            hideLoading();
            showStudio();
            showSetupMode();
            if (params.get('certificateId')) {
                await openSavedCertificate(params.get('certificateId'));
            } else if (params.get('batchId')) {
                await openSavedBatch(params.get('batchId'));
            }
        } catch (error) {
            console.error('[certificates] init failed:', error);
            showAlert(error?.message || 'Unable to load certificate studio.', 'error');
            hideLoading();
        }
    });
}

document.getElementById('cert-new-run-btn')?.addEventListener('click', () => runCoachCertificateAction(showSetupMode));
document.getElementById('cert-view-saved-btn')?.addEventListener('click', () => runCoachCertificateAction(showSavedWorkMode));
document.getElementById('cert-custom-recipient-btn')?.addEventListener('click', () => runCoachCertificateAction(startCustomCertificate));
document.getElementById('cert-mobile-preview-btn')?.addEventListener('click', () => {
    document.getElementById(state.mode === 'review' ? 'cert-review-preview' : 'cert-preview')?.scrollIntoView({ behavior: 'smooth' });
});
document.getElementById('cert-mobile-print-btn')?.addEventListener('click', printSelectedDrafts);

const params = getParams();
if (isLocalDemoMode(params)) {
    initDemo(params);
} else {
    initAuthenticated(params);
}
