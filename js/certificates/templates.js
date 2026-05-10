function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, '&#096;');
}

function getSafeImageUrl(url) {
    const raw = String(url || '').trim();
    if (!raw) return '';
    if (/^(https?:|blob:)/i.test(raw)) return raw;
    if (/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(raw)) return raw;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(raw) && /^[a-z0-9._~/?#=&%-]+$/i.test(raw)) return raw;
    return '';
}

function getDisplayTeamName(shared, team) {
    return shared?.teamNameOverride || team?.name || 'Team';
}

function getDisplayAwardTitle(shared, draft) {
    return draft?.awardTitle || shared?.awardTitle || '';
}

function renderImage(url, className, alt) {
    const safeUrl = getSafeImageUrl(url);
    if (!safeUrl) return '';
    return `<img src="${escapeAttr(safeUrl)}" alt="${escapeAttr(alt)}" class="${className}">`;
}

function renderBackgroundImage(url, opacity) {
    const safeUrl = getSafeImageUrl(url);
    if (!safeUrl) return '';
    return `<img src="${escapeAttr(safeUrl)}" alt="" class="cert-background-image" style="opacity:${opacity}">`;
}

function renderWatermarkImage(url, opacity) {
    const safeUrl = getSafeImageUrl(url);
    if (!safeUrl) return '';
    return `<img src="${escapeAttr(safeUrl)}" alt="" class="cert-watermark-image" style="opacity:${opacity}">`;
}

function getOpacityPercent(value, fallback) {
    const numeric = Number(value);
    const percent = Number.isFinite(numeric) ? numeric : fallback;
    return Math.max(0, Math.min(100, percent)) / 100;
}

function renderSigner(signer, index) {
    const name = signer?.name || (index === 0 ? 'Head Coach' : 'Assistant Coach');
    const role = signer?.role || (index === 0 ? 'Head Coach' : 'Assistant Coach');
    const signatureStyle = signer?.signatureStyle || 'script';
    const signatureImageUrl = signer?.signatureImageUrl || '';
    const signature = signatureStyle === 'image' && signatureImageUrl
        ? renderImage(signatureImageUrl, 'cert-signature-image', `${name} signature`)
        : `<div class="cert-signature-name ${signatureStyle === 'typed' ? 'cert-signature-typed' : 'cert-signature-script'}">${escapeHtml(name)}</div>`;

    return `
        <div class="cert-signer">
            <div class="cert-signature-line">
                ${signature}
            </div>
            <div class="cert-signer-role">${escapeHtml(`${name}, ${role}`)}</div>
        </div>
    `;
}

function getNormalizedSigners(signers = []) {
    const normalized = signers.length ? signers.slice(0, 4) : [
        { name: 'Head Coach', role: 'Head Coach', signatureStyle: 'script' },
        { name: 'Assistant Coach', role: 'Assistant Coach', signatureStyle: 'script' }
    ];
    return normalized.slice(0, 4);
}

function renderSignerSlots(signers = []) {
    const normalized = getNormalizedSigners(signers);
    const left = normalized.length >= 4
        ? normalized.slice(0, 2)
        : normalized.slice(0, 1);
    const right = normalized.length >= 4
        ? normalized.slice(2, 4)
        : normalized.slice(1, 4);

    return {
        count: normalized.length,
        left: left.map(renderSigner).join(''),
        right: right.map((signer, index) => renderSigner(signer, index + left.length)).join(''),
        all: normalized.map(renderSigner).join('')
    };
}

function renderBanner({ shared, draft, team, imageUrls }) {
    const teamName = getDisplayTeamName(shared, team);
    const recipientName = draft?.recipientName || 'Recipient Name';
    const description = draft?.description || 'Generated player description will appear here for review and editing before print.';
    const seasonLabel = shared?.seasonLabel || '';
    const awardTitle = getDisplayAwardTitle(shared, draft);
    const footerUrl = shared?.footerUrl || '';
    const { count, left, right } = renderSignerSlots(shared?.signers || []);
    const logoUrl = imageUrls?.foreground || '';
    const watermarkUrl = imageUrls?.watermark || '';
    const backgroundUrl = imageUrls?.background || '';
    const backgroundOpacity = getOpacityPercent(shared?.backgroundOpacity, 18);
    const watermarkOpacity = getOpacityPercent(shared?.watermarkOpacity, 12);
    const descriptionClass = description.length > 300 ? 'cert-description cert-description-long' : 'cert-description';

    return `
        <div class="cert-template cert-template-banner">
            ${renderBackgroundImage(backgroundUrl, backgroundOpacity)}
            ${renderWatermarkImage(watermarkUrl, watermarkOpacity)}
            <div class="cert-team-title">${escapeHtml(teamName)}</div>
            <div class="cert-recipient-name">${escapeHtml(recipientName)}</div>
            ${awardTitle ? `<div class="cert-award-title">${escapeHtml(awardTitle)}</div>` : ''}
            <div class="${descriptionClass}">${escapeHtml(description)}</div>
            ${seasonLabel ? `<div class="cert-season-label">${escapeHtml(seasonLabel)}</div>` : ''}
            <div class="cert-bottom cert-signer-count-${count}">
                <div class="cert-signers-left">${left}</div>
                <div class="cert-crest-wrap">
                    ${logoUrl ? renderImage(logoUrl, 'cert-crest-image', `${teamName} crest`) : ''}
                </div>
                <div class="cert-signers-right">${right}</div>
            </div>
            ${footerUrl ? `<div class="cert-footer-url">${escapeHtml(footerUrl)}</div>` : ''}
        </div>
    `;
}

function renderHeader({ shared, draft, team, imageUrls }) {
    const teamName = getDisplayTeamName(shared, team);
    const recipientName = draft?.recipientName || 'Recipient Name';
    const playerNumber = draft?.playerNumber ? `#${draft.playerNumber}` : '';
    const description = draft?.description || 'Generated player description will appear here for review and editing before print.';
    const seasonLabel = shared?.seasonLabel || '';
    const awardTitle = getDisplayAwardTitle(shared, draft);
    const footerUrl = shared?.footerUrl || '';
    const logoUrl = imageUrls?.foreground || '';
    const backgroundUrl = imageUrls?.background || '';
    const backgroundOpacity = getOpacityPercent(shared?.backgroundOpacity, 18);
    const { count, all } = renderSignerSlots(shared?.signers || []);
    const descriptionClass = description.length > 300 ? 'cert-header-description cert-header-description-long' : 'cert-header-description';

    return `
        <div class="cert-template cert-template-header">
            ${renderBackgroundImage(backgroundUrl, backgroundOpacity)}
            <div class="cert-header-bar"></div>
            <div class="cert-header-topline">${escapeHtml(teamName)}</div>
            <div class="cert-header-main">
                <div>
                    <div class="cert-header-number">${escapeHtml(playerNumber)}</div>
                    <div class="cert-header-name">${escapeHtml(recipientName)}</div>
                    ${awardTitle ? `<div class="cert-header-award">${escapeHtml(awardTitle)}</div>` : ''}
                </div>
                <div class="cert-header-crest">
                    ${logoUrl ? renderImage(logoUrl, 'cert-header-crest-img', `${teamName} crest`) : ''}
                </div>
            </div>
            <div class="${descriptionClass}">${escapeHtml(description)}</div>
            ${seasonLabel ? `<div class="cert-header-season">${escapeHtml(seasonLabel)}</div>` : ''}
            <div class="cert-header-signers cert-header-signer-count-${count}">
                ${all}
            </div>
            ${footerUrl ? `<div class="cert-header-footer">${escapeHtml(footerUrl)}</div>` : ''}
        </div>
    `;
}

export const TEMPLATES = {
    banner: {
        id: 'banner',
        displayName: 'Banner',
        thumbnailUrl: '',
        aspect: { width: 2050, height: 1153 },
        colorSlots: ['borderColor', 'accentColor', 'textColor'],
        variables: [
            'teamName',
            'recipientName',
            'playerNumber',
            'awardTitle',
            'description',
            'seasonLabel',
            'signers',
            'foregroundImage',
            'backgroundImage',
            'backgroundOpacity',
            'watermarkImage',
            'footerUrl'
        ],
        render: renderBanner
    },
    header: {
        id: 'header',
        displayName: 'Header',
        thumbnailUrl: '',
        aspect: { width: 2050, height: 1153 },
        colorSlots: ['borderColor', 'accentColor', 'textColor'],
        variables: [
            'teamName',
            'recipientName',
            'playerNumber',
            'awardTitle',
            'description',
            'seasonLabel',
            'signers',
            'foregroundImage',
            'backgroundImage',
            'backgroundOpacity',
            'footerUrl'
        ],
        render: renderHeader
    }
};

export function getTemplate(templateId) {
    return TEMPLATES[templateId] || TEMPLATES.banner;
}
