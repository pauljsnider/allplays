import { getTemplate } from './templates.js?v=2';

export const DEFAULT_CERTIFICATE_COLORS = {
    borderColor: '#d32f3a',
    accentColor: '#5ec9c5',
    textColor: '#0f2430'
};

export const CERTIFICATE_FONT_OPTIONS = {
    classic: {
        label: 'Classic serif',
        family: 'Georgia, "Times New Roman", serif'
    },
    formal: {
        label: 'Formal serif',
        family: '"Times New Roman", Times, serif'
    },
    modern: {
        label: 'Modern sans',
        family: 'Arial, Helvetica, sans-serif'
    },
    friendly: {
        label: 'Friendly sans',
        family: '"Trebuchet MS", Arial, sans-serif'
    },
    athletic: {
        label: 'Athletic block',
        family: 'Impact, "Arial Black", sans-serif'
    }
};

function normalizeHex(value) {
    const raw = String(value || '').trim();
    if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw.toLowerCase();
    if (/^#[0-9a-fA-F]{3}$/.test(raw)) {
        return `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`.toLowerCase();
    }
    return '';
}

function getTeamColors(team = {}) {
    const colors = team.colors || {};
    const primary = normalizeHex(colors.primary || team.primaryColor || team.colorPrimary);
    const secondary = normalizeHex(colors.secondary || team.secondaryColor || team.colorSecondary);

    return {
        borderColor: secondary || DEFAULT_CERTIFICATE_COLORS.borderColor,
        accentColor: primary || DEFAULT_CERTIFICATE_COLORS.accentColor,
        textColor: DEFAULT_CERTIFICATE_COLORS.textColor
    };
}

export function resolveColors(shared = {}, team = {}) {
    const colorMode = shared.colorMode || (team.colors ? 'team' : 'template');
    if (colorMode === 'template') {
        return { ...DEFAULT_CERTIFICATE_COLORS };
    }

    if (colorMode === 'custom') {
        const custom = shared.customColors || {};
        return {
            borderColor: normalizeHex(custom.borderColor) || DEFAULT_CERTIFICATE_COLORS.borderColor,
            accentColor: normalizeHex(custom.accentColor) || DEFAULT_CERTIFICATE_COLORS.accentColor,
            textColor: normalizeHex(custom.textColor) || DEFAULT_CERTIFICATE_COLORS.textColor
        };
    }

    return getTeamColors(team);
}

function imageRefToUrl(ref) {
    if (!ref) return '';
    if (typeof ref === 'string') return ref;
    return ref.url || ref.downloadURL || ref.photoUrl || ref.imageUrl || '';
}

function getTeamLogoUrl(team = {}) {
    return team.photoUrl || team.logoUrl || team.teamLogoUrl || team.imageUrl || '';
}

export function resolveImageUrls(shared = {}, team = {}) {
    const hasForegroundSetting = Object.prototype.hasOwnProperty.call(shared, 'foregroundImageRef');
    const foreground = imageRefToUrl(shared.foregroundImageRef) || (hasForegroundSetting ? '' : getTeamLogoUrl(team));
    return {
        foreground,
        background: imageRefToUrl(shared.backgroundImageRef),
        watermark: imageRefToUrl(shared.watermarkImageRef)
    };
}

function resolveFontFamily(value, fallback = 'classic') {
    return CERTIFICATE_FONT_OPTIONS[value]?.family || CERTIFICATE_FONT_OPTIONS[fallback].family;
}

export function renderCertificate({ shared = {}, draft = {}, team = {} } = {}) {
    const template = getTemplate(shared.templateId || 'banner');
    const colors = resolveColors(shared, team, template);
    const imageUrls = resolveImageUrls(shared, team);
    const fonts = shared.fonts || {};
    const node = document.createElement('div');
    node.className = 'cert-canvas';
    node.dataset.templateId = template.id;
    node.style.width = `${template.aspect.width}px`;
    node.style.height = `${template.aspect.height}px`;
    node.style.setProperty('--cert-border', colors.borderColor);
    node.style.setProperty('--cert-accent', colors.accentColor);
    node.style.setProperty('--cert-text', colors.textColor);
    node.style.setProperty('--cert-heading-font', resolveFontFamily(fonts.heading, 'classic'));
    node.style.setProperty('--cert-recipient-font', resolveFontFamily(fonts.recipient, 'classic'));
    node.style.setProperty('--cert-body-font', resolveFontFamily(fonts.body, 'friendly'));
    node.innerHTML = template.render({ shared, draft, team, colors, imageUrls });
    return node;
}

export function createPreviewDraft(roster = [], shared = {}) {
    const firstPlayer = roster.find((player) => player?.active !== false) || roster[0] || {};
    return {
        id: 'preview',
        playerId: firstPlayer.id || null,
        recipientName: firstPlayer.name || firstPlayer.playerName || 'Vivian Karpuk',
        playerNumber: firstPlayer.number || '4',
        awardTitle: shared.awardTitle || '',
        description: firstPlayer.previewDescription || "proved to be a composed and reliable midfielder who reads the game well. Her smart positioning, steady hustle, and support in transition made her a dependable teammate and a key part of the team's defensive success.",
        descriptionStatus: 'ready',
        includeInExport: true,
        status: 'draft'
    };
}

function hexToRgb(hex) {
    const normalized = normalizeHex(hex);
    if (!normalized) return null;
    return {
        r: parseInt(normalized.slice(1, 3), 16),
        g: parseInt(normalized.slice(3, 5), 16),
        b: parseInt(normalized.slice(5, 7), 16)
    };
}

function relativeLuminance({ r, g, b }) {
    const transform = (channel) => {
        const value = channel / 255;
        return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * transform(r) + 0.7152 * transform(g) + 0.0722 * transform(b);
}

export function getContrastRatio(foreground, background) {
    const fg = hexToRgb(foreground);
    const bg = hexToRgb(background);
    if (!fg || !bg) return 0;
    const l1 = relativeLuminance(fg);
    const l2 = relativeLuminance(bg);
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
}

export function getContrastWarning(colors = {}) {
    const ratio = getContrastRatio(colors.textColor, '#ffffff');
    if (ratio >= 4.5) return '';
    return 'Text contrast is below WCAG AA on a white certificate background.';
}
